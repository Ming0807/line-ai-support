import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { decryptValue, encryptValue, hashLineUserId } from '../../lib/security/identity';
import { classifyEventKind, type DirectUserEvent } from '../../lib/line/events';
import { processStudentContent } from '../../lib/conversation/student-processing';
import { hashOpaqueToken } from '../../lib/conversation/quick-reply';

const localUrl = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';
const key = randomBytes(32).toString('base64');

type QuickChoice = { type: 'action'; action: { type: 'postback'; label: string; data: string; displayText?: string } };
type OutboundPayload = { messages: { type: 'text'; text: string; quickReply?: { items: QuickChoice[] } }[]; replyToken?: string };

async function makeStudent(client: Client) {
  const userId = `U${randomUUID().replaceAll('-', '')}`;
  const userHash = hashLineUserId(userId, key);
  const sessionId = (await client.query(
    'insert into public.line_sessions(anonymous_code) values($1) returning id',
    [`Student fixture ${randomUUID()}`],
  )).rows[0].id as string;
  await client.query(
    'insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
    [sessionId, userHash, encryptValue(userId, key)],
  );
  return { sessionId, userId, userHash };
}

async function sourceEvent(client: Client, userHash: string, event: DirectUserEvent) {
  const eventId = randomUUID();
  const result = await client.query(
    `insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind)
     values('STUDENT',$1,$2,$3,$4) returning id,received_at`,
    [eventId, userHash, encryptValue(JSON.stringify(event), key), classifyEventKind(event)],
  );
  return { id: result.rows[0].id as string, receivedAt: result.rows[0].received_at as Date };
}

function textEvent(userId: string, text: string): DirectUserEvent {
  return { type: 'message', source: { type: 'user', userId }, message: { type: 'text', id: `line-${randomUUID()}`, text }, replyToken: `reply-${randomUUID()}` };
}

function postbackEvent(userId: string, data: string): DirectUserEvent {
  return { type: 'postback', source: { type: 'user', userId }, postback: { data }, replyToken: `reply-${randomUUID()}` };
}

async function process(client: Client, student: { sessionId: string; userId: string; userHash: string }, event: DirectUserEvent) {
  const source = await sourceEvent(client, student.userHash, event);
  const code = await processStudentContent(client, {
    sessionId: student.sessionId,
    eventId: source.id,
    receivedAt: source.receivedAt,
    event,
  }, key);
  return { eventId: source.id, code };
}

async function replyFor(client: Client, eventId: string): Promise<OutboundPayload> {
  const row = (await client.query(
    'select payload_encrypted from private.message_outbox where idempotency_key=$1',
    [`student-response:${eventId}`],
  )).rows[0];
  assert.ok(row, 'the Student response is placed in the encrypted outbox');
  return JSON.parse(decryptValue(row.payload_encrypted, key)) as OutboundPayload;
}

function choices(reply: OutboundPayload): QuickChoice[] {
  return reply.messages.flatMap(message => message.quickReply?.items ?? []);
}

function findChoice(reply: OutboundPayload, predicate: (choice: QuickChoice) => boolean): QuickChoice {
  const choice = choices(reply).find(predicate);
  assert.ok(choice, 'the expected opaque postback choice is present');
  assert.match(choice.action.data, /^yru:choice:[A-Za-z0-9_-]{43}$/);
  return choice;
}

async function activeDepartment(client: Client, code: 'IT' | 'LIBRARY') {
  const row = (await client.query('select id,name_th from public.departments where code=$1 and active', [code])).rows[0];
  assert.ok(row, `the seeded ${code} department is active`);
  return row as { id: string; name_th: string };
}

async function ensureTestDepartments(client: Client) {
  for (const [code, nameTh, nameEn] of [
    ['IT', 'ฝ่ายเทคโนโลยีสารสนเทศ', 'Information Technology'],
    ['LIBRARY', 'ห้องสมุด', 'Library'],
  ]) {
    await client.query(
      'insert into public.departments(code,name_th,name_en) values($1,$2,$3) on conflict(code) do nothing',
      [code, nameTh, nameEn],
    );
  }
}

async function makeConversation(client: Client, sessionId: string, input: { mode?: 'AI' | 'HUMAN'; status?: 'ACTIVE' | 'WAITING' | 'CLOSED'; topic: string }) {
  return (await client.query(
    `insert into public.conversations(line_session_id,conversation_type,mode,status,topic)
     values($1,$2,$3,$4,$5) returning id`,
    [sessionId, input.mode === 'HUMAN' ? 'TICKET' : 'GENERAL', input.mode ?? 'AI', input.status ?? 'ACTIVE', input.topic],
  )).rows[0].id as string;
}

async function makeHumanTicket(client: Client, student: { sessionId: string }, input: { status: 'WAITING_STAFF' | 'WAITING_USER' | 'CLOSED'; topic: string }) {
  const department = await activeDepartment(client, 'IT');
  const conversationStatus = input.status === 'CLOSED' ? 'CLOSED' : 'ACTIVE';
  const conversationId = await makeConversation(client, student.sessionId, { mode: 'HUMAN', status: conversationStatus, topic: input.topic });
  const ticket = (await client.query(
    `insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status)
     values($1,$2,$3,$4,'HUMAN',$5) returning id,ticket_no`,
    [student.sessionId, conversationId, department.id, input.topic, input.status],
  )).rows[0];
  await client.query('update public.conversations set active_ticket_id=$2 where id=$1', [conversationId, ticket.id]);
  return { conversationId, ticketId: ticket.id as string, ticketNo: ticket.ticket_no as string };
}

async function withRollback(run: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString: localUrl });
  await client.connect();
  try {
    await client.query('begin');
    await ensureTestDepartments(client);
    await run(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end();
  }
}

test('neutral Student text can explicitly contact IT and create a HUMAN ticket', async () => {
  await withRollback(async client => {
    const student = await makeStudent(client);
    const incoming = textEvent(student.userId, 'ขอคำแนะนำเรื่องการใช้งานระบบ');
    const first = await process(client, student, incoming);
    assert.equal(first.code, null);
    const initialReply = await replyFor(client, first.eventId);
    assert.match(initialReply.messages[0].text, /ได้รับข้อความแล้ว/);
    assert.equal(typeof incoming === 'object' && incoming.type === 'message' && initialReply.replyToken === incoming.replyToken, true, 'the encrypted outbox payload preserves the single-use reply token');
    const delivery = (await client.query('select delivery_mode,reply_deadline_at from private.message_outbox where idempotency_key=$1', [`student-response:${first.eventId}`])).rows[0];
    assert.equal(delivery.delivery_mode, 'REPLY');
    assert.ok(delivery.reply_deadline_at, 'the encrypted event reply token is represented by a reply delivery deadline');
    const contact = findChoice(initialReply, item => item.action.displayText === 'ติดต่อเจ้าหน้าที่');
    assert.ok(choices(initialReply).some(item => item.action.displayText === 'เริ่มเรื่องใหม่'));

    const contactResult = await process(client, student, postbackEvent(student.userId, contact.action.data));
    assert.equal(contactResult.code, null);
    const departmentReply = await replyFor(client, contactResult.eventId);
    const it = await activeDepartment(client, 'IT');
    const itChoice = findChoice(departmentReply, item => item.action.displayText === it.name_th);
    assert.match(departmentReply.messages[0].text, /เลือกหน่วยงาน/);

    const selected = await process(client, student, postbackEvent(student.userId, itChoice.action.data));
    assert.equal(selected.code, null);
    const ticket = (await client.query(
      `select t.id,t.ticket_no,t.mode,t.status,t.problem_summary,d.code as department_code,c.mode as conversation_mode,c.conversation_type
         from public.tickets t join public.departments d on d.id=t.department_id
         join public.conversations c on c.id=t.conversation_id where t.line_session_id=$1`,
      [student.sessionId],
    )).rows[0];
    assert.ok(ticket);
    assert.equal(ticket.department_code, 'IT');
    assert.equal(ticket.mode, 'HUMAN');
    assert.equal(ticket.status, 'WAITING_STAFF');
    assert.equal(ticket.conversation_mode, 'HUMAN');
    assert.equal(ticket.conversation_type, 'TICKET');
    assert.equal(ticket.problem_summary, 'ขอคำแนะนำเรื่องการใช้งานระบบ');
    const history = (await client.query(
      "select action,to_status from public.ticket_history where ticket_id=$1 order by created_at,id",
      [ticket.id],
    )).rows;
    assert.deepEqual(new Set(history.map(row => row.action)), new Set(['CREATED', 'ROUTED']));
    assert.ok(history.every(row => row.to_status === 'WAITING_STAFF'));
    assert.equal((await client.query(
      'select count(*)::int as count from public.messages where ticket_id=$1 and sender_type=\'USER\'',
      [ticket.id],
    )).rows[0].count, 1);
    const ack = (await client.query('select payload_encrypted from private.message_outbox where ticket_id=$1 and kind=\'SYSTEM\'', [ticket.id])).rows[0];
    assert.ok(ack);
    assert.match(decryptValue(ack.payload_encrypted, key), new RegExp(ticket.ticket_no));
  });
});

test('choice tokens are session-, snapshot-, expiry-, replay-, and prompt-bound across every active context', async () => {
  await withRollback(async client => {
    const student = await makeStudent(client);
    const firstContext = await makeConversation(client, student.sessionId, { topic: 'older context' });
    const secondContext = await makeConversation(client, student.sessionId, { topic: 'newer context' });
    const message = await process(client, student, textEvent(student.userId, 'ขอความช่วยเหลือเรื่องเดิม'));
    const prompt = await replyFor(client, message.eventId);
    const newChoice = findChoice(prompt, item => item.action.displayText === 'เริ่มเรื่องใหม่');
    const continueChoices = choices(prompt).filter(item => item.action.displayText?.startsWith('ต่อ '));
    assert.equal(continueChoices.length, 2, 'all active owned contexts are offered, not only the most recent one');

    const choiceRows = (await client.query(
      `select choice->>'action' as action,choice->>'conversationId' as conversation_id,pending_message_id,consumed_at
         from private.pending_route_choices where pending_message_id=(select id from public.messages where source_event_id=$1)`,
      [message.eventId],
    )).rows;
    const contextIds = new Set(choiceRows.filter(row => row.action === 'CONTINUE').map(row => row.conversation_id));
    assert.equal(contextIds.has(firstContext), true, 'the earlier active context is selectable');
    assert.equal(contextIds.has(secondContext), true, 'the later active context is selectable');
    assert.ok(choiceRows.every(row => row.pending_message_id));

    const foreign = await makeStudent(client);
    const foreignTry = await process(client, foreign, postbackEvent(foreign.userId, continueChoices[0].action.data));
    assert.equal(foreignTry.code, 'INVALID_CHOICE');
    assert.match((await replyFor(client, foreignTry.eventId)).messages[0].text, /หมดอายุหรือถูกใช้แล้ว/);
    const forged = await process(client, student, postbackEvent(student.userId, `yru:choice:${'A'.repeat(43)}`));
    assert.equal(forged.code, 'INVALID_CHOICE');
    assert.match((await replyFor(client, forged.eventId)).messages[0].text, /หมดอายุหรือถูกใช้แล้ว/);
    assert.equal((await client.query('select count(*)::int as count from public.tickets where line_session_id=$1', [student.sessionId])).rows[0].count, 0);

    const pendingMessageId = (await client.query('select id from public.messages where source_event_id=$1', [message.eventId])).rows[0].id as string;
    const targetChoice = continueChoices[0];
    const targetHash = hashOpaqueToken(targetChoice.action.data.slice('yru:choice:'.length), key);
    const targetConversationId = (await client.query("select choice->>'conversationId' as conversation_id from private.pending_route_choices where token_hash=$1", [targetHash])).rows[0].conversation_id as string;
    await client.query('update public.conversations set revision=revision+1 where id=$1', [targetConversationId]);
    const stale = await process(client, student, postbackEvent(student.userId, targetChoice.action.data));
    assert.equal(stale.code, 'INVALID_CHOICE');
    assert.equal((await client.query('select count(*)::int as count from public.tickets where line_session_id=$1', [student.sessionId])).rows[0].count, 0);
    await client.query('update public.conversations set revision=revision-1 where id=$1', [targetConversationId]);

    const newChoiceHash = hashOpaqueToken(newChoice.action.data.slice('yru:choice:'.length), key);
    await client.query('update private.pending_route_choices set expires_at=clock_timestamp()-interval \'1 second\' where token_hash=$1', [newChoiceHash]);
    const expired = await process(client, student, postbackEvent(student.userId, newChoice.action.data));
    assert.equal(expired.code, 'INVALID_CHOICE');
    assert.match((await replyFor(client, expired.eventId)).messages[0].text, /หมดอายุหรือถูกใช้แล้ว/);
    assert.equal((await client.query('select count(*)::int as count from public.tickets where line_session_id=$1', [student.sessionId])).rows[0].count, 0);
    await client.query('update private.pending_route_choices set expires_at=clock_timestamp()+interval \'5 minutes\' where token_hash=$1', [newChoiceHash]);

    const started = await process(client, student, postbackEvent(student.userId, newChoice.action.data));
    assert.equal(started.code, null);
    const originalChoiceHashes = [newChoice, ...continueChoices].map(item => hashOpaqueToken(item.action.data.slice('yru:choice:'.length), key));
    assert.equal((await client.query('select count(*)::int as count from private.pending_route_choices where token_hash=any($1::text[]) and consumed_at is not null', [originalChoiceHashes])).rows[0].count, originalChoiceHashes.length, 'consuming one prompt choice invalidates every alternative from that prompt');
    const pending = (await client.query('select m.conversation_id,c.conversation_type,c.mode,m.metadata from public.messages m join public.conversations c on c.id=m.conversation_id where m.id=$1', [pendingMessageId])).rows[0];
    assert.equal(pending.conversation_id !== firstContext && pending.conversation_id !== secondContext, true, 'the new-topic choice owns a separate conversation');
    assert.equal(pending.conversation_type, 'GENERAL');
    assert.equal(pending.mode, 'AI');
    assert.equal(pending.metadata.routing_status, 'ROUTED');
    const replay = await process(client, student, postbackEvent(student.userId, continueChoices[1].action.data));
    assert.equal(replay.code, 'INVALID_CHOICE');
    assert.equal((await client.query('select count(*)::int as count from public.tickets where line_session_id=$1', [student.sessionId])).rows[0].count, 0);
  });
});

test('explicit new topic preserves an existing HUMAN ticket before Library escalation', async () => {
  await withRollback(async client => {
    const student = await makeStudent(client);
    const old = await makeHumanTicket(client, student, { status: 'WAITING_STAFF', topic: 'งานเดิมที่เจ้าหน้าที่ดูแล' });
    const message = await process(client, student, textEvent(student.userId, 'ขอยืมหนังสือจากห้องสมุด'));
    const prompt = await replyFor(client, message.eventId);
    const newTopic = findChoice(prompt, item => item.action.displayText === 'เริ่มเรื่องใหม่');
    assert.equal((await client.query('select count(*)::int as count from public.tickets where line_session_id=$1', [student.sessionId])).rows[0].count, 1, 'keywords do not automatically route a request to Library');

    const newResult = await process(client, student, postbackEvent(student.userId, newTopic.action.data));
    assert.equal(newResult.code, null);
    const newPrompt = await replyFor(client, newResult.eventId);
    const contact = findChoice(newPrompt, item => item.action.displayText === 'ติดต่อเจ้าหน้าที่');
    const contactResult = await process(client, student, postbackEvent(student.userId, contact.action.data));
    const departmentPrompt = await replyFor(client, contactResult.eventId);
    const library = await activeDepartment(client, 'LIBRARY');
    const libraryChoice = findChoice(departmentPrompt, item => item.action.displayText === library.name_th);
    const escalated = await process(client, student, postbackEvent(student.userId, libraryChoice.action.data));
    assert.equal(escalated.code, null);

    const oldRow = (await client.query(
      `select t.mode,t.status,t.problem_summary,c.id as conversation_id from public.tickets t
       join public.conversations c on c.id=t.conversation_id where t.id=$1`, [old.ticketId],
    )).rows[0];
    assert.equal(oldRow.mode, 'HUMAN');
    assert.equal(oldRow.status, 'WAITING_STAFF');
    assert.equal(oldRow.problem_summary, 'งานเดิมที่เจ้าหน้าที่ดูแล');
    assert.equal(oldRow.conversation_id === old.conversationId, true, 'the original ticket remains attached to its original conversation');
    const newRow = (await client.query(
      `select t.mode,t.status,t.problem_summary,d.code as department_code,c.mode as conversation_mode
         from public.tickets t join public.departments d on d.id=t.department_id
         join public.conversations c on c.id=t.conversation_id where t.line_session_id=$1 and t.id<>$2`,
      [student.sessionId, old.ticketId],
    )).rows[0];
    assert.ok(newRow);
    assert.equal(newRow.department_code, 'LIBRARY');
    assert.equal(newRow.mode, 'HUMAN');
    assert.equal(newRow.status, 'WAITING_STAFF');
    assert.equal(newRow.conversation_mode, 'HUMAN');
    assert.equal(newRow.problem_summary, 'ขอยืมหนังสือจากห้องสมุด');
  });
});

test('a selected WAITING_USER context attaches pending text to its ticket without an AI reply', async () => {
  await withRollback(async client => {
    const student = await makeStudent(client);
    const ticket = await makeHumanTicket(client, student, { status: 'WAITING_USER', topic: 'รอข้อมูลเพิ่มเติม' });
    const message = await process(client, student, textEvent(student.userId, 'ส่งรายละเอียดที่เจ้าหน้าที่ขอแล้ว'));
    const prompt = await replyFor(client, message.eventId);
    const continueChoice = findChoice(prompt, item => item.action.displayText?.startsWith('ต่อ ') === true);
    const before = (await client.query('select count(*)::int as count from private.message_outbox where line_session_id=$1', [student.sessionId])).rows[0].count;

    const continued = await process(client, student, postbackEvent(student.userId, continueChoice.action.data));
    assert.equal(continued.code, null);
    assert.equal((await client.query('select count(*)::int as count from private.message_outbox where line_session_id=$1', [student.sessionId])).rows[0].count, before, 'HUMAN context sends no automatic AI response');
    const attached = (await client.query('select ticket_id,conversation_id,sender_type,content,metadata from public.messages where source_event_id=$1', [message.eventId])).rows[0];
    assert.equal(attached.ticket_id === ticket.ticketId, true, 'the pending message remains owned by its ticket');
    assert.equal(attached.conversation_id === ticket.conversationId, true, 'the pending message remains owned by its conversation');
    assert.equal(attached.sender_type, 'USER');
    assert.equal(attached.content, 'ส่งรายละเอียดที่เจ้าหน้าที่ขอแล้ว');
    assert.equal(attached.metadata.routing_status, 'ROUTED');
    assert.equal((await client.query('select status from public.tickets where id=$1', [ticket.ticketId])).rows[0].status, 'STAFF_HANDLING');
    assert.deepEqual((await client.query('select action,from_status,to_status from public.ticket_history where ticket_id=$1 order by created_at,id', [ticket.ticketId])).rows,
      [{ action: 'USER_REPLIED', from_status: 'WAITING_USER', to_status: 'STAFF_HANDLING' }]);
  });
});

test('text after a CLOSED ticket creates a separate AI context and leaves the closed ticket untouched', async () => {
  await withRollback(async client => {
    const student = await makeStudent(client);
    const closed = await makeHumanTicket(client, student, { status: 'CLOSED', topic: 'เรื่องที่ปิดแล้ว' });
    const received = await process(client, student, textEvent(student.userId, 'ขอเริ่มเรื่องใหม่'));
    assert.equal(received.code, null);
    const newContext = (await client.query(
      'select id,conversation_type,mode,status from public.conversations where line_session_id=$1 and id<>$2',
      [student.sessionId, closed.conversationId],
    )).rows[0];
    assert.ok(newContext);
    assert.equal(newContext.conversation_type, 'GENERAL');
    assert.equal(newContext.mode, 'AI');
    assert.equal((await client.query('select mode,status from public.conversations where id=$1', [closed.conversationId])).rows[0].status, 'CLOSED');
    assert.equal((await client.query('select mode,status from public.tickets where id=$1', [closed.ticketId])).rows[0].status, 'CLOSED');
    assert.equal((await client.query('select count(*)::int as count from public.tickets where line_session_id=$1', [student.sessionId])).rows[0].count, 1);
  });
});
