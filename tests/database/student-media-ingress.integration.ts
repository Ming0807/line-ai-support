import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { classifyEventKind, type DirectUserEvent } from '../../lib/line/events';
import { processStudentContent } from '../../lib/conversation/student-processing';
import { decryptValue, encryptValue, hashLineUserId } from '../../lib/security/identity';

const database = process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert.match(database ?? '', /^yru_structured_schema_[a-f0-9]{12}$/u, 'tests require the fixed isolated owned database');
const connectionString = `postgresql://postgres:postgres@127.0.0.1:54422/${database}`;
const key = randomBytes(32).toString('base64');

type MediaType = 'image' | 'file' | 'sticker' | 'audio' | 'video' | 'location';
type QuickChoice = { type: 'action'; action: { type: 'postback'; label: string; data: string; displayText?: string } };
type OutboundPayload = { messages: { type: 'text'; text: string; quickReply?: { items: QuickChoice[] } }[]; replyToken?: string };
const mediaTypes: MediaType[] = ['image', 'file', 'sticker', 'audio', 'video', 'location'];
const storedType: Record<MediaType, 'IMAGE' | 'FILE' | 'SYSTEM'> = {
  image: 'IMAGE',
  file: 'FILE',
  sticker: 'SYSTEM',
  audio: 'SYSTEM',
  video: 'SYSTEM',
  location: 'SYSTEM',
};

async function withRollback(run: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('begin');
    await run(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end();
  }
}

async function makeStudent(client: Client) {
  const userId = `U${randomUUID().replaceAll('-', '')}`;
  const userHash = hashLineUserId(userId, key);
  const sessionId = (await client.query(
    'insert into public.line_sessions(anonymous_code) values($1) returning id',
    [`Media fixture ${randomUUID()}`],
  )).rows[0].id as string;
  await client.query(
    'insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
    [sessionId, userHash, encryptValue(userId, key)],
  );
  return { sessionId, userId, userHash };
}

function mediaEvent(userId: string, type: MediaType, messageId = `line-${randomUUID()}`): DirectUserEvent {
  return {
    type: 'message',
    source: { type: 'user', userId },
    message: { type, id: messageId },
    replyToken: `reply-${randomUUID()}`,
  };
}

function textEvent(userId: string, text: string): DirectUserEvent {
  return {
    type: 'message',
    source: { type: 'user', userId },
    message: { type: 'text', id: `line-${randomUUID()}`, text },
    replyToken: `reply-${randomUUID()}`,
  };
}

function postbackEvent(userId: string, data: string): DirectUserEvent {
  return {
    type: 'postback',
    source: { type: 'user', userId },
    postback: { data },
    replyToken: `reply-${randomUUID()}`,
  };
}

async function sourceEvent(client: Client, userHash: string, event: DirectUserEvent, eventId: string = randomUUID()) {
  const inserted = await client.query(
    `insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind)
     values('STUDENT',$1,$2,$3,$4) on conflict(channel,event_id) do nothing returning id,received_at`,
    [eventId, userHash, encryptValue(JSON.stringify(event), key), classifyEventKind(event)],
  );
  const row = inserted.rows[0] ?? (await client.query(
    `select id,received_at from private.webhook_inbox where channel='STUDENT' and event_id=$1`,
    [eventId],
  )).rows[0];
  return { id: row.id as string, receivedAt: row.received_at as Date, eventId };
}

async function runStudentEvent(client: Client, student: { sessionId: string; userId: string; userHash: string }, event: DirectUserEvent, eventId?: string) {
  const source = await sourceEvent(client, student.userHash, event, eventId);
  const code = await processStudentContent(client, {
    sessionId: student.sessionId,
    eventId: source.id,
    receivedAt: source.receivedAt,
    event,
  }, key, { aiEnabled: true });
  return { ...source, code };
}

async function makeHumanTicket(client: Client, sessionId: string) {
  const department = (await client.query('select id from public.departments where code=$1 and active', ['IT'])).rows[0];
  assert.ok(department, 'the seeded IT department is active');
  const conversationId = (await client.query(
    `insert into public.conversations(line_session_id,conversation_type,mode,status,topic)
     values($1,'TICKET','HUMAN','ACTIVE','media ingress fixture') returning id`,
    [sessionId],
  )).rows[0].id as string;
  const ticket = (await client.query(
    `insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status)
     values($1,$2,$3,'media ingress fixture','HUMAN','WAITING_STAFF') returning id,ticket_no`,
    [sessionId, conversationId, department.id],
  )).rows[0];
  await client.query('update public.conversations set active_ticket_id=$2 where id=$1', [conversationId, ticket.id]);
  return { conversationId, ticketId: ticket.id as string, ticketNo: ticket.ticket_no as string };
}

async function replyFor(client: Client, eventId: string): Promise<OutboundPayload> {
  const row = (await client.query(
    'select payload_encrypted from private.message_outbox where idempotency_key=$1',
    [`student-response:${eventId}`],
  )).rows[0];
  assert.ok(row, 'the Student response is placed in the encrypted outbox');
  return JSON.parse(decryptValue(row.payload_encrypted, key)) as OutboundPayload;
}

function findChoice(reply: OutboundPayload, predicate: (choice: QuickChoice) => boolean): QuickChoice {
  const choice = reply.messages.flatMap(message => message.quickReply?.items ?? []).find(predicate);
  assert.ok(choice, 'the expected opaque postback choice is present');
  assert.match(choice.action.data, /^yru:choice:[A-Za-z0-9_-]{43}$/u);
  return choice;
}

test('unsupported Student message types are classified as SYSTEM before AI preparation', async () => {
  await withRollback(async client => {
    const student = await makeStudent(client);
    const event = mediaEvent(student.userId, 'sticker');
    const source = await runStudentEvent(client, student, event);
    assert.equal(source.code, null);
    const message = (await client.query(
      'select message_type,content,metadata from public.messages where source_event_id=$1',
      [source.id],
    )).rows[0];
    assert.ok(message, 'the accepted LINE media event is durably represented');
    assert.equal(message.message_type, 'SYSTEM', 'a sticker placeholder must never be classified as user text');
  });
});

test('all accepted nontext Student messages retain safe types, placeholders, and replay idempotency', async () => {
  await withRollback(async client => {
    for (const type of mediaTypes) {
      const student = await makeStudent(client);
      const event = mediaEvent(student.userId, type);
      const first = await runStudentEvent(client, student, event);
      assert.equal(first.code, null, `${type} is accepted without an external transport`);
      const message = (await client.query(
        `select id,message_type,content,metadata,line_message_id,source_event_id
         from public.messages where source_event_id=$1`,
        [first.id],
      )).rows[0];
      assert.ok(message, `${type} is persisted`);
      assert.equal(message.message_type, storedType[type], `${type} cannot be text-shaped input`);
      assert.ok(message.content.trim().length > 0, `${type} has a visible placeholder`);
      assert.equal(message.line_message_id, event.type === 'message' ? event.message.id : null);
      assert.equal(message.metadata.routing_status, 'ROUTED');
      if (type !== 'image' && type !== 'file') {
        assert.equal(message.metadata.source_message_type, type, `${type} keeps its original LINE message kind`);
        assert.notEqual(message.content, '[ไฟล์แนบ]', `${type} gets a meaningful type-specific placeholder`);
        assert.match(message.content, /[\u0E00-\u0E7F]/u, `${type} placeholder is readable Thai`);
      }
      assert.equal((await client.query('select count(*)::int as count from private.ai_jobs where line_session_id=$1', [student.sessionId])).rows[0].count, 0,
        `${type} placeholder does not enter AI generation`);

      await runStudentEvent(client, student, event, first.eventId);
      assert.equal((await client.query(
        `select count(*)::int as count from private.webhook_inbox where channel='STUDENT' and event_id=$1`, [first.eventId],
      )).rows[0].count, 1, `${type} event replay does not duplicate the inbox receipt`);
      assert.equal((await client.query('select count(*)::int as count from public.messages where line_message_id=$1', [message.line_message_id])).rows[0].count, 1,
        `${type} event replay does not duplicate the message`);
      assert.equal((await client.query('select count(*)::int as count from private.ai_jobs where message_id=$1', [message.id])).rows[0].count, 0,
        `${type} event replay still creates no AI job`);

      const duplicateReceipt = await runStudentEvent(client, student, event);
      assert.notEqual(duplicateReceipt.eventId, first.eventId, 'a distinct webhook event may refer to the same LINE message');
      assert.equal((await client.query('select count(*)::int as count from public.messages where line_message_id=$1', [message.line_message_id])).rows[0].count, 1,
        `${type} duplicate message identity remains idempotent`);
      assert.equal((await client.query('select count(*)::int as count from private.ai_jobs where line_session_id=$1', [student.sessionId])).rows[0].count, 0,
        `${type} duplicate message identity does not create an AI job`);
    }
  });
});

test('nontext Student messages remain attached to an existing HUMAN ticket', async () => {
  await withRollback(async client => {
    const student = await makeStudent(client);
    const ticket = await makeHumanTicket(client, student.sessionId);
    const initialQuestion = await runStudentEvent(client, student, textEvent(student.userId, 'ขอให้เจ้าหน้าที่ช่วยตรวจเรื่องนี้'));
    const prompt = await replyFor(client, initialQuestion.id);
    const continueChoice = findChoice(prompt, choice => choice.action.displayText === `ต่อ ${ticket.ticketNo}`);
    const selected = await runStudentEvent(client, student, postbackEvent(student.userId, continueChoice.action.data));
    assert.equal(selected.code, null, 'the HUMAN ticket is selected through its normal user choice');
    for (const type of mediaTypes) {
      const event = mediaEvent(student.userId, type);
      const source = await runStudentEvent(client, student, event);
      assert.equal(source.code, null);
      const message = (await client.query(
        'select message_type,content,ticket_id,conversation_id,sender_type from public.messages where source_event_id=$1',
        [source.id],
      )).rows[0];
      assert.ok(message, `${type} is persisted on the HUMAN route`);
      assert.equal(message.message_type, storedType[type], `${type} preserves its type under HUMAN routing`);
      assert.ok(message.content.trim().length > 0);
      assert.equal(message.sender_type, 'USER');
      assert.equal(message.ticket_id, ticket.ticketId);
      assert.equal(message.conversation_id, ticket.conversationId);
      assert.equal((await client.query('select count(*)::int as count from private.ai_jobs where line_session_id=$1', [student.sessionId])).rows[0].count, 0,
        'HUMAN ticket content never enters AI generation');
    }
  });
});

test('ordinary routed Student text remains unchanged and eligible for AI', async () => {
  await withRollback(async client => {
    const student = await makeStudent(client);
    const event = textEvent(student.userId, 'ห้องสมุดเปิดกี่โมง');
    const source = await runStudentEvent(client, student, event);
    const message = (await client.query(
      'select id,message_type,content from public.messages where source_event_id=$1', [source.id],
    )).rows[0];
    assert.ok(message);
    assert.equal(message.message_type, 'TEXT');
    assert.equal(message.content, event.type === 'message' && event.message.type === 'text' ? event.message.text : null);
    assert.equal((await client.query('select count(*)::int as count from private.ai_jobs where message_id=$1', [message.id])).rows[0].count, 1,
      'ordinary Student text still prepares one durable job');
  });
});
