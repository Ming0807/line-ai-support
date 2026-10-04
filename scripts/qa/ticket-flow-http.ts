import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { runInboxCycle } from '../../lib/queue/run-inbox';
import { runOutboxCycle } from '../../lib/queue/run-outbox';
import { decryptValue, encryptValue, hashLineUserId, hashStaffLineUserId } from '../../lib/security/identity';
import { applyTicketAction } from '../../lib/tickets/ticket-service';

const base = new URL(process.env.LINE_TEST_BASE_URL ?? 'http://127.0.0.1:3001');
assert.equal(base.protocol, 'http:', 'LOCAL_HTTP_ONLY');
assert.equal(base.hostname, '127.0.0.1', 'LOOPBACK_HOST_REQUIRED');
assert.equal(base.port, '3001', 'ISOLATED_LOCAL_HTTP_SERVER_REQUIRED');
assert.equal(base.pathname, '/', 'BASE_PATH_NOT_ALLOWED');
assert.equal(base.username, '', 'BASE_CREDENTIALS_NOT_ALLOWED');
assert.equal(base.password, '', 'BASE_CREDENTIALS_NOT_ALLOWED');
assert.equal(process.env.LINE_WEBHOOK_MODE?.trim(), 'durable', 'DURABLE_WEBHOOK_MODE_REQUIRED');

const key = process.env.ENCRYPTION_KEY;
if (!key) throw new Error('TEST_ENCRYPTION_KEY_REQUIRED');
const encryptionKey: string = key;
const studentSecret = process.env.LINE_STUDENT_CHANNEL_SECRET?.trim();
const staffSecret = process.env.LINE_STAFF_CHANNEL_SECRET?.trim();
if (!studentSecret || !staffSecret) throw new Error('TEST_CHANNEL_SECRETS_REQUIRED');
const studentChannelSecret: string = studentSecret;
const staffChannelSecret: string = staffSecret;

// Never derive this connection from .env. This harness is fixed to the isolated local DB.
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres', max: 2 });
const fixture = randomUUID();
const studentLineId = `U${fixture.replaceAll('-', '')}`;
const staffLineId = `U${randomUUID().replaceAll('-', '')}`;
const studentHash = hashLineUserId(studentLineId, encryptionKey);
const staffHash = hashStaffLineUserId(staffLineId, encryptionKey);
const staffId = randomUUID();
const fixtureEventIds: string[] = [];
const tracked = { departmentId: '', departmentCreated: false, sessionId: '', conversationId: '', ticketId: '' };
let registrationLabel = 'ฝ่ายรับสมัครและทะเบียน';
let stage = 'preflight';

interface QuickAction { label: string; data: string; displayText?: string }
interface OutboxPayload { messages: { text: string; quickReply?: { items: { action: QuickAction }[] } }[]; replyToken?: string }

async function noReadyWork(): Promise<void> {
  const [inbox, outbox] = await Promise.all([
    pool.query("select count(*)::int as count from private.webhook_inbox where status in ('PENDING','PROCESSING')"),
    pool.query("select count(*)::int as count from private.message_outbox where status in ('PENDING','PROCESSING')"),
  ]);
  assert.equal(inbox.rows[0].count, 0, 'LOCAL_INBOX_MUST_BE_IDLE');
  assert.equal(outbox.rows[0].count, 0, 'LOCAL_OUTBOX_MUST_BE_IDLE');
}

async function signedPost(channel: 'STUDENT' | 'STAFF', event: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify({ events: [event] });
  const secret = channel === 'STUDENT' ? studentChannelSecret : staffChannelSecret;
  const signature = createHmac('sha256', secret).update(body).digest('base64');
  const response = await fetch(new URL(`/api/line/${channel.toLowerCase()}/webhook`, base), {
    method: 'POST', body, headers: { 'x-line-signature': signature },
  });
  assert.equal(response.status, 200, 'SIGNED_WEBHOOK_ACCEPTED');
}

function studentMessage(text: string): Record<string, unknown> {
  const eventId = `ticket-flow-student-${randomUUID()}`;
  fixtureEventIds.push(eventId);
  return { type: 'message', webhookEventId: eventId, source: { type: 'user', userId: studentLineId },
    message: { type: 'text', id: `msg-${randomUUID()}`, text }, replyToken: `reply-${randomUUID()}`, timestamp: Date.now() };
}

function postback(userId: string, prefix: string, data: string): Record<string, unknown> {
  const eventId = `ticket-flow-${prefix}-${randomUUID()}`;
  fixtureEventIds.push(eventId);
  return { type: 'postback', webhookEventId: eventId, source: { type: 'user', userId },
    postback: { data }, replyToken: `reply-${randomUUID()}`, timestamp: Date.now() };
}

async function processOne(channel: 'STUDENT' | 'STAFF', event: Record<string, unknown>): Promise<void> {
  const eventId = String(event.webhookEventId);
  await signedPost(channel, event);
  const cycle = await runInboxCycle(pool, encryptionKey);
  assert.deepEqual(cycle, { claimed: 1, completed: 1, failed: 0 }, 'ONLY_FIXTURE_EVENT_CLAIMED');
  const stored = await pool.query('select status,last_error_code from private.webhook_inbox where channel=$1 and event_id=$2', [channel, eventId]);
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].status, 'DONE');
  assert.equal(stored.rows[0].last_error_code, null, 'EVENT_PROCESSED');
}

async function outboxPayload(id: string): Promise<OutboxPayload> {
  const row = (await pool.query('select payload_encrypted from private.message_outbox where id=$1', [id])).rows[0];
  if (!row) throw new Error('FIXTURE_OUTBOX_MISSING');
  return JSON.parse(decryptValue(row.payload_encrypted, encryptionKey)) as OutboxPayload;
}

async function latestStudentPayload(): Promise<{ id: string; payload: OutboxPayload }> {
  const row = (await pool.query("select id,payload_encrypted from private.message_outbox where line_session_id=$1 and channel='STUDENT' order by outbox_seq desc limit 1", [tracked.sessionId])).rows[0];
  if (!row) throw new Error('STUDENT_RESPONSE_MISSING');
  return { id: row.id, payload: JSON.parse(decryptValue(row.payload_encrypted, encryptionKey)) as OutboxPayload };
}

function actionFor(payload: OutboxPayload, predicate: (action: QuickAction) => boolean): QuickAction {
  const action = payload.messages.flatMap(message => message.quickReply?.items.map(item => item.action) ?? []).find(predicate);
  if (!action) throw new Error('QUICK_REPLY_ACTION_MISSING');
  return action;
}

async function drainOutbox(): Promise<number> {
  let delivered = 0;
  for (let cycleIndex = 0; cycleIndex < 24; cycleIndex++) {
    const result = await runOutboxCycle(pool, encryptionKey, {
      accessTokens: { STUDENT: 'local-fake-token', STAFF: 'local-fake-token' },
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.equal(url.hostname, 'api.line.me', 'FAKE_TRANSPORT_ONLY');
        assert.match(url.pathname, /^\/v2\/bot\/message\/(reply|push)$/);
        return new Response(null, { status: 200 });
      },
    });
    delivered += result.sent;
    assert.equal(result.failed, 0, 'FAKE_OUTBOX_DELIVERY_SUCCEEDED');
    if (result.claimed === 0) return delivered;
  }
  assert.fail('OUTBOX_DRAIN_BOUNDED_LIMIT_REACHED');
}

async function action(staff: string, ticket: string, name: 'ACCEPT'|'STAFF_REPLY'|'RESOLVE'|'CLOSE', input: { revision: number; requestId: string; text?: string; reason?: string }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await applyTicketAction(client, staff, ticket, name, input, encryptionKey);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

async function cleanup(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (!tracked.sessionId) {
      tracked.sessionId = (await client.query('select line_session_id from private.line_identities where user_hash=$1', [studentHash])).rows[0]?.line_session_id ?? '';
    }
    if (tracked.sessionId) {
      const convs = (await client.query('select id from public.conversations where line_session_id=$1', [tracked.sessionId])).rows.map(row => row.id as string);
      const tickets = (await client.query('select id from public.tickets where line_session_id=$1', [tracked.sessionId])).rows.map(row => row.id as string);
      const outboxes = (await client.query('select id from private.message_outbox where line_session_id=$1 or recipient_staff_id=$2', [tracked.sessionId, staffId])).rows.map(row => row.id as string);
      await client.query('delete from private.delivery_attempts where outbox_id=any($1::uuid[])', [outboxes]);
      await client.query('delete from private.pending_route_choices where line_session_id=$1', [tracked.sessionId]);
      await client.query('delete from private.staff_action_tokens where staff_id=$1 or ticket_id=any($2::uuid[])', [staffId, tickets]);
      await client.query('delete from private.ticket_action_receipts where staff_id=$1 or ticket_id=any($2::uuid[])', [staffId, tickets]);
      await client.query('delete from private.activities where ticket_id=any($1::uuid[])', [tickets]);
      await client.query('delete from public.ticket_history where ticket_id=any($1::uuid[])', [tickets]);
      await client.query('delete from public.messages where conversation_id=any($1::uuid[])', [convs]);
      await client.query('update public.conversations set active_ticket_id=null where id=any($1::uuid[])', [convs]);
      await client.query('delete from private.message_outbox where id=any($1::uuid[])', [outboxes]);
      await client.query('delete from public.tickets where id=any($1::uuid[])', [tickets]);
      await client.query('delete from public.conversations where id=any($1::uuid[])', [convs]);
      await client.query('delete from private.staff_inbound_messages where source_event_id in(select id from private.webhook_inbox where event_id=any($1::text[]))', [fixtureEventIds]);
      await client.query('delete from public.messages where source_event_id in(select id from private.webhook_inbox where event_id=any($1::text[]))', [fixtureEventIds]);
      await client.query('delete from private.line_identities where line_session_id=$1', [tracked.sessionId]);
      await client.query('delete from public.line_sessions where id=$1', [tracked.sessionId]);
    }
    if (fixtureEventIds.length) await client.query('delete from private.webhook_inbox where event_id=any($1::text[])', [fixtureEventIds]);
    await client.query('delete from private.staff_line_identities where staff_id=$1', [staffId]);
    await client.query('delete from public.staff_profiles where id=$1', [staffId]);
    await client.query('delete from auth.users where id=$1', [staffId]);
    if (tracked.departmentCreated) await client.query('delete from public.departments where id=$1 and code=$2', [tracked.departmentId, 'REGISTRATION']);
    await client.query('commit');
  } catch {
    await client.query('rollback');
    throw new Error('FIXTURE_CLEANUP_FAILED');
  } finally { client.release(); }
}

try {
  await noReadyWork();
  stage = 'fixture_setup';
  const department = (await pool.query("select id,active,name_th from public.departments where code='REGISTRATION'")).rows[0];
  if (department) {
    assert.equal(department.active, true, 'REGISTRATION_DEPARTMENT_ACTIVE');
    registrationLabel = department.name_th;
    const eligible = await pool.query(`select count(*)::int as count from public.staff_profiles s join private.staff_line_identities i on i.staff_id=s.id and i.active
      where s.active and s.department_id=$1`, [department.id]);
    assert.equal(eligible.rows[0].count, 0, 'REGISTRATION_SCOPE_HAS_NO_PREEXISTING_BOUND_STAFF');
    tracked.departmentId = department.id;
  } else {
    const created = await pool.query("insert into public.departments(code,name_th,name_en,description,active) values('REGISTRATION','ฝ่ายรับสมัครและทะเบียน','Registration','Local ticket-flow fixture',true) returning id");
    tracked.departmentId = created.rows[0].id;
    tracked.departmentCreated = true;
  }
  await pool.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'authenticated','authenticated',$2,'',clock_timestamp(),'{}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp())`, [staffId, `ticket-flow-${fixture}@example.test`]);
  await pool.query("insert into public.staff_profiles(id,department_id,display_name,role,active) values($1,$2,'Local ticket-flow staff','STAFF',true)", [staffId, tracked.departmentId]);
  await pool.query('insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted,active) values($1,$2,$3,true)', [staffId, staffHash, encryptValue(staffLineId, encryptionKey)]);
  await noReadyWork();

  stage = 'student_signed_intake';
  await processOne('STUDENT', studentMessage('ขอติดต่อฝ่ายรับสมัครเรื่องเอกสาร'));
  tracked.sessionId = (await pool.query('select line_session_id from private.line_identities where user_hash=$1', [studentHash])).rows[0]?.line_session_id ?? '';
  assert(tracked.sessionId, 'STUDENT_SESSION_CREATED');
  let latest = await latestStudentPayload();
  const contact = actionFor(latest.payload, item => item.data.startsWith('yru:choice:') && item.displayText === 'ติดต่อเจ้าหน้าที่');
  await drainOutbox();

  stage = 'contact_department_choice';
  await processOne('STUDENT', postback(studentLineId, 'contact', contact.data));
  latest = await latestStudentPayload();
  const registration = actionFor(latest.payload, item => item.data.startsWith('yru:choice:') && item.displayText === registrationLabel);
  await drainOutbox();

  stage = 'human_ticket_and_staff_notice';
  await processOne('STUDENT', postback(studentLineId, 'department', registration.data));
  tracked.conversationId = (await pool.query('select id from public.conversations where line_session_id=$1 and active_ticket_id is not null', [tracked.sessionId])).rows[0]?.id ?? '';
  const ticket = (await pool.query("select id,status,mode,revision from public.tickets where line_session_id=$1 and department_id=$2", [tracked.sessionId, tracked.departmentId])).rows[0];
  assert(ticket, 'ROUTED_TICKET_CREATED');
  tracked.ticketId = ticket.id;
  assert.equal(ticket.status, 'WAITING_STAFF');
  assert.equal(ticket.mode, 'HUMAN');
  const history = await pool.query("select action from public.ticket_history where ticket_id=$1 order by history_seq", [tracked.ticketId]);
  assert.deepEqual(history.rows.map(row => row.action), ['CREATED', 'ROUTED']);
  const notification = (await pool.query("select id from private.message_outbox where ticket_id=$1 and channel='STAFF' and kind='NOTIFICATION'", [tracked.ticketId])).rows[0];
  assert(notification, 'ELIGIBLE_STAFF_NOTIFICATION_QUEUED');
  const staffPayload = await outboxPayload(notification.id);
  const accept = actionFor(staffPayload, item => item.data.startsWith('yru:staff:accept:'));
  await drainOutbox();

  stage = 'signed_staff_accept';
  await processOne('STAFF', postback(staffLineId, 'accept', accept.data));
  let ticketState = (await pool.query('select status,revision,assigned_staff_id from public.tickets where id=$1', [tracked.ticketId])).rows[0];
  assert.equal(ticketState.status, 'STAFF_HANDLING');
  assert.equal(ticketState.assigned_staff_id, staffId);

  stage = 'staff_service_reply_and_retry';
  await drainOutbox();
  const requestId = randomUUID();
  const reply = await action(staffId, tracked.ticketId, 'STAFF_REPLY', { revision: ticketState.revision, requestId, text: 'ได้รับเรื่องแล้ว กำลังตรวจสอบให้ครับ' });
  const replay = await action(staffId, tracked.ticketId, 'STAFF_REPLY', { revision: ticketState.revision, requestId, text: 'ได้รับเรื่องแล้ว กำลังตรวจสอบให้ครับ' });
  assert.deepEqual(replay, reply, 'ACTION_REPLAY_RETURNS_SAME_RESULT');
  const replyCounts = await pool.query(`select
    (select count(*)::int from public.ticket_history where ticket_id=$1 and action='STAFF_REPLIED') as history_count,
    (select count(*)::int from public.messages where ticket_id=$1 and sender_type='STAFF') as message_count,
    (select count(*)::int from private.message_outbox where ticket_id=$1 and kind='STAFF') as outbox_count`, [tracked.ticketId]);
  assert.deepEqual(replyCounts.rows[0], { history_count: 1, message_count: 1, outbox_count: 1 });
  const staffReplyOutbox = (await pool.query("select id,line_retry_key,status from private.message_outbox where ticket_id=$1 and kind='STAFF'", [tracked.ticketId])).rows[0];
  assert(staffReplyOutbox, 'STAFF_REPLY_OUTBOX_CREATED');
  const captured: { retryKey: string | null; body: string }[] = [];
  const transport = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'api.line.me', 'FAKE_TRANSPORT_ONLY');
    assert.equal(url.pathname, '/v2/bot/message/push');
    captured.push({ retryKey: new Headers(init?.headers).get('X-Line-Retry-Key'), body: String(init?.body ?? '') });
    return new Response(null, { status: captured.length === 1 ? 503 : 409 });
  };
  const failedPush = await runOutboxCycle(pool, encryptionKey, { accessTokens: { STUDENT: 'local-fake-token', STAFF: 'local-fake-token' }, fetchImpl: transport });
  assert.deepEqual(failedPush, { claimed: 1, sent: 0, failed: 1 }, 'PUSH_503_RETRYABLE');
  const retryState = (await pool.query('select status,attempts,available_at from private.message_outbox where id=$1', [staffReplyOutbox.id])).rows[0];
  assert.equal(retryState.status, 'PENDING');
  assert.equal(retryState.attempts, 1);
  await delay(Math.max(0, new Date(retryState.available_at).getTime() - Date.now()) + 100);
  const acceptedRetry = await runOutboxCycle(pool, encryptionKey, { accessTokens: { STUDENT: 'local-fake-token', STAFF: 'local-fake-token' }, fetchImpl: transport });
  assert.deepEqual(acceptedRetry, { claimed: 1, sent: 1, failed: 0 }, 'PUSH_409_IDEMPOTENT_ACCEPTANCE');
  assert.equal(captured.length, 2);
  assert.equal(captured[0].retryKey, captured[1].retryKey);
  assert.equal(captured[0].retryKey, staffReplyOutbox.line_retry_key);
  assert.equal(captured[0].body, captured[1].body, 'RETRY_BODY_STABLE');
  const attempts = await pool.query('select http_status,accepted from private.delivery_attempts where outbox_id=$1 order by created_at,id', [staffReplyOutbox.id]);
  assert.deepEqual(attempts.rows, [{ http_status: 503, accepted: false }, { http_status: 409, accepted: true }]);

  stage = 'student_continue_choice';
  ticketState = (await pool.query('select status,revision from public.tickets where id=$1', [tracked.ticketId])).rows[0];
  assert.equal(ticketState.status, 'WAITING_USER');
  await processOne('STUDENT', studentMessage('ขอบคุณครับ มีเอกสารเพิ่มเติม'));
  latest = await latestStudentPayload();
  const continueAction = actionFor(latest.payload, item => item.data.startsWith('yru:choice:') && Boolean(item.displayText?.startsWith('ต่อ ')));
  await drainOutbox();
  await processOne('STUDENT', postback(studentLineId, 'continue', continueAction.data));
  ticketState = (await pool.query('select status,revision from public.tickets where id=$1', [tracked.ticketId])).rows[0];
  assert.equal(ticketState.status, 'STAFF_HANDLING', 'CONTINUE_REPLIES_TO_SAME_HUMAN_TICKET');

  stage = 'human_new_topic_preserves_ticket';
  await processOne('STUDENT', studentMessage('ห้องสมุดปิดกี่โมง'));
  latest = await latestStudentPayload();
  const newTopic = actionFor(latest.payload, item => item.data.startsWith('yru:choice:') && item.displayText === 'เริ่มเรื่องใหม่');
  await drainOutbox();
  await processOne('STUDENT', postback(studentLineId, 'new-topic', newTopic.data));
  const preserved = (await pool.query('select status,mode,conversation_id from public.tickets where id=$1', [tracked.ticketId])).rows[0];
  assert.equal(preserved.status, 'STAFF_HANDLING');
  assert.equal(preserved.mode, 'HUMAN');
  assert.equal(preserved.conversation_id, tracked.conversationId);
  const topicConversations = await pool.query("select count(*)::int as count from public.conversations where line_session_id=$1 and id<>$2 and conversation_type='GENERAL'", [tracked.sessionId, tracked.conversationId]);
  assert(topicConversations.rows[0].count >= 1, 'NEW_TOPIC_OPENS_SEPARATE_AI_CONVERSATION');
  await drainOutbox();

  stage = 'resolve_and_close';
  ticketState = (await pool.query('select status,revision from public.tickets where id=$1', [tracked.ticketId])).rows[0];
  const resolved = await action(staffId, tracked.ticketId, 'RESOLVE', { revision: ticketState.revision, requestId: randomUUID(), reason: 'ตรวจสอบครบแล้ว' });
  assert.equal(resolved.status, 'RESOLVED');
  const closed = await action(staffId, tracked.ticketId, 'CLOSE', { revision: resolved.revision, requestId: randomUUID() });
  assert.equal(closed.status, 'CLOSED');
  const final = (await pool.query('select status,mode,revision from public.tickets where id=$1', [tracked.ticketId])).rows[0];
  assert.equal(final.status, 'CLOSED');
  assert.equal(final.mode, 'HUMAN');
  await noReadyWork();
  console.log(JSON.stringify({ stage: 'ticket_flow_http_verified', signedStudentIngress: true, signedStaffIngress: true,
    contactAndDepartmentChoice: true, ticketRoutedAndNotified: true, staffAccepted: true, staffReplyActionReplaySingleEffect: true,
    fakePush503Then409StableRequest: true, studentContinueSameTicket: true, newTopicPreservedHumanTicket: true,
    resolvedAndClosed: true, realLineCalls: false, target: 'local-loopback' }));
} catch {
  console.error(JSON.stringify({ code: 'TICKET_FLOW_HTTP_CHECK_FAILED', stage }));
  process.exitCode = 1;
} finally {
  stage = 'cleanup';
  try { await cleanup(); }
  catch { console.error(JSON.stringify({ code: 'TICKET_FLOW_FIXTURE_CLEANUP_FAILED' })); process.exitCode = 1; }
  await pool.end();
}
