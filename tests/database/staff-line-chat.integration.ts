import assert from 'node:assert/strict';
import { before, after, afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { transaction } from '../../lib/database/pool';
import { type DirectUserEvent } from '../../lib/line/events';
import { classifyEventKind } from '../../lib/line/events';
import { processInboxEvent, type InboxJob } from '../../lib/queue/process-inbox';
import { decryptValue, encryptValue, hashLineUserId, hashStaffLineUserId } from '../../lib/security/identity';
import { notifyTicketStaff,notifyTicketUserReply } from '../../lib/tickets/notifications';
import { runOutboxCycle } from '../../lib/queue/run-outbox';
import { hashOpaqueToken } from '../../lib/conversation/quick-reply';
import { applyTicketAction } from '../../lib/tickets/ticket-service';
import { flushStaffAlerts } from '../../lib/incidents/staff-alerts';

const database = process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database && /^yru_structured_schema_[a-f0-9]{12}$/.test(database), 'STAFF-LINE-CHAT tests require the owned structured-schema database');
const pool = new Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:54422/${database}`, max: 6 });
const key = Buffer.alloc(32, 97).toString('base64');
const staffIds: string[] = [];
const staffLineUserIds: string[] = [];
const ticketIds: string[] = [];
const inboxIds: string[] = [];
let staffChatDepartmentId:string;

async function staffAlertEventsInstalled(): Promise<boolean> {
  return (await pool.query("select to_regclass('private.staff_alert_events') is not null ready")).rows[0]?.ready === true;
}

async function flushCapturedStaffAlerts(): Promise<void> {
  if (!await staffAlertEventsInstalled()) return;
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await flushStaffAlerts(pool, key, { appBaseUrl: 'https://alerts.fixture' });
    if (result.released === 0 && result.suppressed === 0) return;
  }
  throw new Error('STAFF_ALERT_FIXTURE_FLUSH_BOUND');
}

async function suppressOwnedPendingStaffAlerts(): Promise<void> {
  if (staffIds.length === 0 || !await staffAlertEventsInstalled()) return;
  await pool.query(
    `update private.staff_alert_events
        set status='SUPPRESSED',suppression_code='ALERT_CONTEXT_CHANGED',completed_at=clock_timestamp()
      where staff_id=any($1::uuid[]) and status='PENDING'`,
    [staffIds],
  );
}

before(async()=>{
  await pool.query("update public.departments set active=false where code like 'CHAT_QA_%'");
  staffChatDepartmentId=(await pool.query('insert into public.departments(code,name_th,name_en) values($1,$2,$3) returning id',
    [`CHAT_QA_${randomUUID().slice(0,8).toUpperCase().replace(/[0-9]/g,d=>String.fromCharCode(75+Number(d)))}`,'แผนก fixture ของชุด Staff chat','Owned Staff chat fixture'])).rows[0].id;
  if (await staffAlertEventsInstalled()) {
    await pool.query('update private.incident_rules set alert_debounce_seconds=0 where id=1');
  }
  // This suite exclusively owns a disposable database. Retained prior RED runs must not enter a later transport probe.
  await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where status in('PENDING','PROCESSING')");
  await pool.query("update public.tickets set status='CANCELLED' where problem_summary like 'STAFF_CHAT_PRIVATE_%' and status not in('CANCELLED','CLOSED','RESOLVED')");
});

interface StaffMessage {
  type: 'text';
  text: string;
  quickReply?: { items: Array<{ type: 'action'; action: { type: 'postback'; label: string; data: string } }> };
}

interface StaffPayload {
  messages: StaffMessage[];
  replyToken?: string;
}

after(async () => {
  try {
    await pool.query(
      `update private.webhook_inbox
          set status='DONE',lease_token=null,lease_until=null,completed_at=coalesce(completed_at,clock_timestamp())
        where id=any($1::uuid[])`,
      [inboxIds],
    );
    await pool.query(
      `update private.message_outbox
          set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=coalesce(completed_at,clock_timestamp())
        where status in ('PENDING','PROCESSING')
          and (ticket_id=any($1::uuid[]) or recipient_staff_id=any($2::uuid[]) or line_session_id in(select line_session_id from public.tickets where id=any($1::uuid[])))`,
      [ticketIds, staffIds],
    );
    await suppressOwnedPendingStaffAlerts();
    await pool.query('update private.staff_line_identities set active=false where staff_id=any($1::uuid[])', [staffIds]);
    await pool.query('update public.staff_profiles set active=false where id=any($1::uuid[])', [staffIds]);
    await pool.query('update public.departments set active=false where id=$1',[staffChatDepartmentId]);
  } finally {
    await pool.end();
  }
});

afterEach(async () => {
  await pool.query(
    `update private.message_outbox
        set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=coalesce(completed_at,clock_timestamp())
      where status in ('PENDING','PROCESSING')
        and (ticket_id=any($1::uuid[]) or recipient_staff_id=any($2::uuid[]) or line_session_id in(select line_session_id from public.tickets where id=any($1::uuid[])))`,
    [ticketIds, staffIds],
  );
  await suppressOwnedPendingStaffAlerts();
  await pool.query('update private.staff_line_identities set active=false where staff_id=any($1::uuid[])', [staffIds]);
  await pool.query('update public.staff_profiles set active=false where id=any($1::uuid[])', [staffIds]);
  await pool.query("update public.tickets set status='CANCELLED' where id=any($1::uuid[]) and status not in('CANCELLED','CLOSED','RESOLVED')",[ticketIds]);
});

interface ChatFixture {
  departmentId: string;
  staff: Array<{ id: string; lineUserId: string }>;
  sessionId: string;
  studentLineUserId: string;
  conversationId: string;
  ticket: { id: string; ticketNo: string };
}

async function seedStaff(departmentId: string): Promise<{ id: string; lineUserId: string }> {
  const id = randomUUID();
  const lineUserId = `U${randomUUID().replaceAll('-', '')}`;
  staffIds.push(id);
  staffLineUserIds.push(lineUserId);
  await pool.query('insert into auth.users(id) values($1)', [id]);
  await pool.query(
    `insert into public.staff_profiles(id,display_name,department_id,role,active,can_view_sensitive,can_view_restricted)
     values($1,$2,$3,'STAFF',true,false,false)`,
    [id, `Staff chat fixture ${id.slice(0, 8)}`, departmentId],
  );
  await pool.query(
    `insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted)
     values($1,$2,$3)`,
    [id, hashStaffLineUserId(lineUserId, key), encryptValue(lineUserId, key)],
  );
  return { id, lineUserId };
}

async function seedTicket(departmentId: string): Promise<{ id: string; ticketNo: string }> {
  const sessionId = (await pool.query(
    'insert into public.line_sessions(anonymous_code) values($1) returning id',
    [`STAFF_CHAT_${randomUUID()}`],
  )).rows[0].id as string;
  const conversationId = (await pool.query(
    `insert into public.conversations(line_session_id,conversation_type,mode)
     values($1,'TICKET','HUMAN') returning id`,
    [sessionId],
  )).rows[0].id as string;
  const ticket = (await pool.query(
    `insert into public.tickets
       (line_session_id,conversation_id,department_id,problem_summary,mode,status,sensitive_level,assigned_staff_id)
     values($1,$2,$3,$4,'HUMAN','WAITING_STAFF','GENERAL',null)
     returning id,ticket_no`,
    [sessionId, conversationId, departmentId, `STAFF_CHAT_PRIVATE_${randomUUID()}`],
  )).rows[0] as { id: string; ticket_no: string };
  ticketIds.push(ticket.id);
  await pool.query('update public.conversations set active_ticket_id=$2 where id=$1', [conversationId, ticket.id]);
  return { id: ticket.id, ticketNo: ticket.ticket_no };
}

async function chatFixture(options: {
  staffCount?: number;
  existingStaff?: ChatFixture['staff'];
  status?: 'WAITING_STAFF' | 'STAFF_HANDLING' | 'WAITING_USER' | 'CLOSED';
  sensitivity?: 'GENERAL' | 'SENSITIVE' | 'RESTRICTED';
  assignedStaffIndex?: number | null;
  restrictedStaff?: boolean;
} = {}): Promise<ChatFixture> {
  const departmentId = staffChatDepartmentId;
  assert.ok(departmentId, 'the suite has its own department so prior fixture queues cannot enter its results');
  const staff: ChatFixture['staff'] = options.existingStaff ? [...options.existingStaff] : [];
  if (!options.existingStaff) {
    for (let index = 0; index < (options.staffCount ?? 1); index++) {
      const identity = await seedStaff(departmentId);
      if (options.restrictedStaff) {
        await pool.query('update public.staff_profiles set can_view_restricted=true where id=$1', [identity.id]);
      }
      staff.push(identity);
    }
  }
  const session = await pool.query(
    'insert into public.line_sessions(anonymous_code) values($1) returning id',
    [`STAFF_CHAT_${randomUUID()}`],
  );
  const sessionId = session.rows[0].id as string;
  const studentLineUserId = `U${randomUUID().replaceAll('-', '')}`;
  await pool.query(
    `insert into private.line_identities(line_session_id,user_hash,user_id_encrypted)
     values($1,$2,$3)`,
    [sessionId, hashLineUserId(studentLineUserId, key), encryptValue(studentLineUserId, key)],
  );
  const status = options.status ?? 'WAITING_STAFF';
  const conversationId = (await pool.query(
    `insert into public.conversations(line_session_id,conversation_type,mode,status)
     values($1,'TICKET','HUMAN',$2) returning id`,
    [sessionId, status === 'CLOSED' ? 'CLOSED' : status === 'WAITING_USER' ? 'WAITING' : 'ACTIVE'],
  )).rows[0].id as string;
  const assignedStaff = options.assignedStaffIndex === undefined
    ? null
    : options.assignedStaffIndex === null ? null : staff[options.assignedStaffIndex]?.id;
  if (options.assignedStaffIndex !== undefined && options.assignedStaffIndex !== null) assert.ok(assignedStaff);
  const ticket = (await pool.query(
    `insert into public.tickets
       (line_session_id,conversation_id,department_id,problem_summary,mode,status,sensitive_level,assigned_staff_id)
     values($1,$2,$3,$4,'HUMAN',$5,$6,$7)
     returning id,ticket_no`,
    [sessionId, conversationId, departmentId, `STAFF_CHAT_PRIVATE_${randomUUID()}`, status, options.sensitivity ?? 'GENERAL', assignedStaff ?? null],
  )).rows[0] as { id: string; ticket_no: string };
  ticketIds.push(ticket.id);
  await pool.query('update public.conversations set active_ticket_id=$2 where id=$1', [conversationId, ticket.id]);
  return { departmentId, staff, sessionId, studentLineUserId, conversationId, ticket: { id: ticket.id, ticketNo: ticket.ticket_no } };
}

async function notifyCase(fixture: ChatFixture): Promise<void> {
  await transaction(async client => {
    const ticket = (await client.query(
      `select id,ticket_no,department_id,sensitive_level,priority,revision
         from public.tickets where id=$1`,
      [fixture.ticket.id],
    )).rows[0];
    await notifyTicketStaff(client, ticket, key);
  }, pool);
  await flushCapturedStaffAlerts();
}

async function latestStaffPayload(staffId: string): Promise<StaffPayload> {
  const row = (await pool.query(
    `select payload_encrypted from private.message_outbox
      where channel='STAFF' and recipient_staff_id=$1
      order by outbox_seq desc limit 1`,
    [staffId],
  )).rows[0];
  assert.ok(row, `a Staff control message is present for ${staffId}`);
  return decodePayload(row.payload_encrypted as string);
}

function quickReplyData(payload: StaffPayload, label: string): string {
  const item = payload.messages.flatMap(message => message.quickReply?.items ?? [])
    .find(candidate => candidate.action.label === label);
  assert.ok(item, `the Staff control message offers ${label}`);
  return item.action.data;
}

async function notificationAcceptToken(fixture: ChatFixture, staffId: string): Promise<string> {
  const row = (await pool.query(
    `select payload_encrypted from private.message_outbox
      where ticket_id=$1 and recipient_staff_id=$2 and channel='STAFF' and kind in('ALERT','NOTIFICATION')
      order by case when kind='ALERT' then 0 else 1 end,outbox_seq desc limit 1`,
    [fixture.ticket.id, staffId],
  )).rows[0];
  assert.ok(row, 'the bound department Staff member has a scoped accept alert');
  const payload = decodePayload(row.payload_encrypted as string);
  const data = payload.messages[0]?.quickReply?.items[0]?.action.data;
  const match = /^yru:staff:accept:([A-Za-z0-9_-]{43})$/.exec(data ?? '');
  assert.ok(match, 'the notification has an opaque accept token');
  return match[1];
}

async function inboxJob(channel: 'STAFF' | 'STUDENT', event: DirectUserEvent): Promise<InboxJob> {
  const leaseToken = randomUUID();
  const row = (await pool.query(
    `insert into private.webhook_inbox
       (channel,event_id,event_kind,user_hash,payload_encrypted,status,lease_token,lease_until,attempts)
     values($1,$2,$3,$4,$5,'PROCESSING',$6,clock_timestamp()+interval '1 minute',1)
     returning *`,
    [channel, randomUUID(), classifyEventKind(event), hashLineUserId(event.source.userId, key), encryptValue(JSON.stringify(event), key), leaseToken],
  )).rows[0];
  inboxIds.push(row.id as string);
  return {
    id: row.id as string,
    channel,
    lease_token: leaseToken,
    payload_encrypted: row.payload_encrypted as string,
    user_hash: row.user_hash as string,
    attempts: row.attempts as number,
  };
}

async function processEvent(channel: 'STAFF' | 'STUDENT', event: DirectUserEvent): Promise<string> {
  const job = await inboxJob(channel, event);
  await transaction(client => processInboxEvent(client, job, key, { aiEnabled: true }), pool);
  return job.id;
}

async function replayInbox(eventId: string): Promise<void> {
  const leaseToken = randomUUID();
  const row = (await pool.query(
    `update private.webhook_inbox set status='PROCESSING',lease_token=$2,
       lease_until=clock_timestamp()+interval '1 minute',completed_at=null,attempts=attempts+1
     where id=$1 returning *`,
    [eventId, leaseToken],
  )).rows[0];
  assert.ok(row, 'the committed source event remains available for worker replay');
  const job: InboxJob = {
    id: row.id as string,
    channel: row.channel as 'STAFF' | 'STUDENT',
    lease_token: leaseToken,
    payload_encrypted: row.payload_encrypted as string,
    user_hash: row.user_hash as string,
    attempts: row.attempts as number,
  };
  await transaction(client => processInboxEvent(client, job, key, { aiEnabled: true }), pool);
}

function staffTextEvent(staff: ChatFixture['staff'][number], text: string): DirectUserEvent {
  return {
    type: 'message',
    source: { type: 'user', userId: staff.lineUserId },
    message: { type: 'text', id: `staff-${randomUUID()}`, text },
  };
}

function staffPostbackEvent(staff: ChatFixture['staff'][number], data: string): DirectUserEvent {
  return { type: 'postback', source: { type: 'user', userId: staff.lineUserId }, postback: { data } };
}

function studentTextEvent(fixture: ChatFixture, text: string): DirectUserEvent {
  return {
    type: 'message',
    source: { type: 'user', userId: fixture.studentLineUserId },
    message: { type: 'text', id: `student-${randomUUID()}`, text },
  };
}

async function acceptCase(fixture: ChatFixture, staffIndex = 0): Promise<StaffPayload> {
  await notifyCase(fixture);
  const staff = fixture.staff[staffIndex];
  assert.ok(staff);
  await acceptJob(staff.lineUserId, await notificationAcceptToken(fixture, staff.id));
  return latestStaffPayload(staff.id);
}

async function latestStudentPayload(fixture: ChatFixture): Promise<StaffPayload> {
  const row = (await pool.query(
    `select payload_encrypted from private.message_outbox
      where channel='STUDENT' and line_session_id=$1 order by outbox_seq desc limit 1`,
    [fixture.sessionId],
  )).rows[0];
  assert.ok(row, 'a Student receipt is queued for the owned session');
  return decodePayload(row.payload_encrypted as string);
}

async function suppressStaffOutbox(staff: ChatFixture['staff']): Promise<void> {
  await pool.query(
    `update private.message_outbox
        set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp()
      where channel='STAFF' and recipient_staff_id=any($1::uuid[]) and status in ('PENDING','PROCESSING')`,
    [staff.map(item => item.id)],
  );
}

async function dispatchWithCapture(): Promise<{ result: { claimed: number; sent: number; failed: number }; requests: Array<{ url: string; authorization: string; body: { to?: string; messages?: unknown[] } }> }> {
  const requests: Array<{ url: string; authorization: string; body: { to?: string; messages?: unknown[] } }> = [];
  const result = await runOutboxCycle(pool, key, {
    accessTokens: { STUDENT: 'fixture-student-token', STAFF: 'fixture-staff-token' },
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization') ?? '',
        body: JSON.parse(String(init?.body ?? '{}')) as { to?: string; messages?: unknown[] },
      });
      return new Response(null, { status: 200 });
    },
  });
  return { result, requests };
}

function decodePayload(value: string): StaffPayload {
  assert.match(value, /^v1\./, 'Staff payloads remain encrypted at rest');
  return JSON.parse(decryptValue(value, key)) as StaffPayload;
}

async function acceptJob(lineUserId: string, token: string): Promise<string> {
  const event: DirectUserEvent = {
    type: 'postback',
    source: { type: 'user', userId: lineUserId },
    postback: { data: `yru:staff:accept:${token}` },
  };
  const leaseToken = randomUUID();
  const row = (await pool.query(
    `insert into private.webhook_inbox
       (channel,event_id,event_kind,user_hash,payload_encrypted,status,lease_token,lease_until,attempts)
     values('STAFF',$1,'OTHER',$2,$3,'PROCESSING',$4,clock_timestamp()+interval '1 minute',1)
     returning *`,
    [randomUUID(), hashLineUserId(lineUserId, key), encryptValue(JSON.stringify(event), key), leaseToken],
  )).rows[0];
  inboxIds.push(row.id as string);
  const job: InboxJob = {
    id: row.id as string,
    channel: 'STAFF',
    lease_token: leaseToken,
    payload_encrypted: row.payload_encrypted as string,
    user_hash: row.user_hash as string,
    attempts: row.attempts as number,
  };
  await transaction(client => processInboxEvent(client, job, key), pool);
  return row.id as string;
}

test('simultaneous Staff accept postbacks assign once and send safe per-staff receipts with explicit OPEN', async () => {
  const departmentId = staffChatDepartmentId;
  assert.ok(departmentId, 'the suite department is initialized');
  const first = await seedStaff(departmentId);
  const second = await seedStaff(departmentId);
  const ticket = await seedTicket(departmentId);

  await transaction(async client => {
    const row = (await client.query(
      `select id,ticket_no,department_id,sensitive_level,priority,revision
         from public.tickets where id=$1`,
      [ticket.id],
    )).rows[0];
    await notifyTicketStaff(client, row, key);
  }, pool);
  await flushCapturedStaffAlerts();

  const notifications = (await pool.query(
    `select id,recipient_staff_id,payload_encrypted
       from private.message_outbox
      where ticket_id=$1 and channel='STAFF' and kind in('ALERT','NOTIFICATION')
      order by recipient_staff_id`,
    [ticket.id],
  )).rows as Array<{ id: string; recipient_staff_id: string; payload_encrypted: string }>;
  const expectedAlertKind = await staffAlertEventsInstalled() ? 'ALERT' : 'NOTIFICATION';
  assert.deepEqual((await pool.query(
    `select distinct kind from private.message_outbox where id=any($1::uuid[])`,
    [notifications.map(row => row.id)],
  )).rows.map(row => row.kind as string), [expectedAlertKind], 'NEW case alert uses ALERT after migration 41 and legacy NOTIFICATION before it');
  assert.deepEqual(notifications.map(row => row.recipient_staff_id).sort(), [first.id, second.id].sort());
  const tokenByStaff = new Map<string, string>();
  for (const row of notifications) {
    const payload = decodePayload(row.payload_encrypted);
    const data = payload.messages[0]?.quickReply?.items[0]?.action.data;
    const match = /^yru:staff:accept:([A-Za-z0-9_-]{43})$/.exec(data ?? '');
    assert.ok(match, 'each eligible department-bound Staff member receives an opaque accept token');
    tokenByStaff.set(row.recipient_staff_id, match[1]);
  }

  const outcomes = await Promise.all([
    acceptJob(first.lineUserId, tokenByStaff.get(first.id)!),
    acceptJob(second.lineUserId, tokenByStaff.get(second.id)!),
  ]);

  const state = (await pool.query(
    `select status,assigned_staff_id,revision from public.tickets where id=$1`,
    [ticket.id],
  )).rows[0];
  assert.equal(state.status, 'STAFF_HANDLING');
  assert.ok([first.id, second.id].includes(state.assigned_staff_id));
  assert.equal(state.revision, 1);
  assert.equal((await pool.query(
    `select count(*)::int as count from public.ticket_history where ticket_id=$1 and action='ACCEPTED'`,
    [ticket.id],
  )).rows[0].count, 1, 'the concurrent claim creates one accepted history row');

  const receipts = (await pool.query(
    `select id,recipient_staff_id,kind,ticket_id,payload_encrypted
       from private.message_outbox
      where recipient_staff_id=any($1::uuid[])
        and id<>all($2::uuid[])
      order by recipient_staff_id,id`,
    [[first.id, second.id], notifications.map(row => row.id)],
  )).rows as Array<{
    id: string;
    recipient_staff_id: string;
    kind: string;
    ticket_id: string | null;
    payload_encrypted: string;
  }>;
  assert.equal(receipts.length, 2, 'both the winner and loser receive a Staff action receipt');
  assert.deepEqual(receipts.map(row => row.recipient_staff_id).sort(), [first.id, second.id].sort());
  const rawAcceptTokens = [...tokenByStaff.values()];
  const allPrivateValues = [...staffLineUserIds, ...staffIds, ticket.id, ...rawAcceptTokens];
  for (const row of receipts) {
    const payload = decodePayload(row.payload_encrypted);
    assert.equal(payload.replyToken, undefined, 'a Staff receipt contains no LINE reply credential');
    const message = payload.messages[0];
    assert.ok(message);
    for (const value of allPrivateValues) assert.equal(message.text.includes(value), false);
    for (const token of rawAcceptTokens) assert.equal(message.text.includes(token), false);
    assert.equal(message.quickReply?.items.some(item => item.action.label === 'เปิดคุยเคสนี้')??false,
      row.recipient_staff_id===state.assigned_staff_id, 'only the winner can open the accepted case');
    assert.ok(message.quickReply?.items.some(item => item.action.label === 'งานของฉัน'), 'the receipt offers fresh MY_CASES recovery');
    assert.ok(message.quickReply?.items.some(item => item.action.label === 'คิวฝ่าย'), 'the receipt offers fresh department-queue recovery');
  }
  const winnerReceipt = receipts.find(row => row.recipient_staff_id === state.assigned_staff_id);
  const loserReceipt = receipts.find(row => row.recipient_staff_id !== state.assigned_staff_id);
  assert.ok(winnerReceipt && loserReceipt);
  assert.match(decodePayload(winnerReceipt.payload_encrypted).messages[0]!.text, new RegExp(ticket.ticketNo));
  assert.doesNotMatch(decodePayload(loserReceipt.payload_encrypted).messages[0]!.text, new RegExp(ticket.ticketNo));
  assert.equal((await pool.query(
    `select count(*)::int as count from private.webhook_inbox where id=any($1::uuid[]) and status='DONE'`,
    [outcomes],
  )).rows[0].count, 2, 'both signed Staff inbox jobs complete through the normal lease path');
  await replayInbox(outcomes[0]!);
  assert.equal((await pool.query(
    `select count(*)::int as count from private.message_outbox
      where recipient_staff_id=any($1::uuid[]) and id<>all($2::uuid[])`,
    [[first.id, second.id], notifications.map(row => row.id)],
  )).rows[0].count, 2, 'replaying the exact ACCEPT inbox event cannot duplicate its receipt');
  assert.equal((await pool.query(
    `select count(*)::int as count from public.ticket_history where ticket_id=$1 and action='ACCEPTED'`,
    [ticket.id],
  )).rows[0].count, 1);
});

test('OPEN pins one case across another acceptance, consecutive Staff replies, Student followups, and replay', async () => {
  const first = await chatFixture();
  const second = await chatFixture({ existingStaff: first.staff });
  const staff = first.staff[0]!;
  await notifyCase(first);
  await notifyCase(second);

  const firstAccept = await notificationAcceptToken(first, staff.id);
  await acceptJob(staff.lineUserId, firstAccept);
  const firstReceipt = await latestStaffPayload(staff.id);
  const openData = quickReplyData(firstReceipt, 'เปิดคุยเคสนี้');
  assert.match(openData, /^yru:staff:chat:[A-Za-z0-9_-]{43}$/);
  await processEvent('STAFF', staffPostbackEvent(staff, openData));
  const selected = (await pool.query(
    `select ticket_id,assignment_epoch,selection_id,viewed_through_seq from private.staff_line_case_context
      where staff_id=$1`,
    [staff.id],
  )).rows[0];
  assert.ok(selected);
  assert.equal(selected.ticket_id, first.ticket.id);

  const secondAccept = await notificationAcceptToken(second, staff.id);
  await acceptJob(staff.lineUserId, secondAccept);
  const stillSelected = (await pool.query(
    `select ticket_id,assignment_epoch,selection_id,viewed_through_seq from private.staff_line_case_context
      where staff_id=$1`,
    [staff.id],
  )).rows[0];
  assert.deepEqual(stillSelected, selected, 'accepting a different case does not change the selected reply target');

  const firstReply = staffTextEvent(staff, `STAFF_REPLY_ONE_${randomUUID()}`);
  const firstReplyEventId = await processEvent('STAFF', firstReply);
  assert.equal((await pool.query('select status from public.tickets where id=$1', [first.ticket.id])).rows[0].status, 'WAITING_USER');
  const secondReply = staffTextEvent(staff, `STAFF_REPLY_TWO_${randomUUID()}`);
  await processEvent('STAFF', secondReply);
  assert.equal((await pool.query('select status from public.tickets where id=$1', [first.ticket.id])).rows[0].status, 'WAITING_USER');
  assert.equal((await pool.query(
    `select count(*)::int as count from public.messages
      where ticket_id=$1 and sender_type='STAFF' and sender_staff_id=$2`,
    [first.ticket.id, staff.id],
  )).rows[0].count, 2, 'each consecutive Staff reply while WAITING_USER is stored once');
  assert.equal((await pool.query('select count(*)::int as count from public.messages where ticket_id=$1 and sender_type=\'STAFF\'',[second.ticket.id])).rows[0].count, 0);
  const staffOutbox = (await pool.query(
    `select ticket_id,payload_encrypted from private.message_outbox
      where channel='STUDENT' and kind='STAFF' and ticket_id=any($1::uuid[])
      order by outbox_seq`,
    [[first.ticket.id, second.ticket.id]],
  )).rows as Array<{ ticket_id: string; payload_encrypted: string }>;
  assert.equal(staffOutbox.length, 2);
  assert.deepEqual(new Set(staffOutbox.map(row => row.ticket_id)), new Set([first.ticket.id]));
  const replyPayloads = staffOutbox.map(row => decodePayload(row.payload_encrypted));
  assert.ok(replyPayloads.some(payload => payload.messages.some(message => message.text.startsWith('STAFF_REPLY_ONE_'))));
  assert.ok(replyPayloads.some(payload => payload.messages.some(message => message.text.startsWith('STAFF_REPLY_TWO_'))));

  const studentEvents = [
    studentTextEvent(first, `STUDENT_REPLY_ONE_${randomUUID()}`),
    studentTextEvent(first, `STUDENT_REPLY_TWO_${randomUUID()}`),
  ];
  const studentInboxIds: string[] = [];
  studentInboxIds.push(await processEvent('STUDENT',studentEvents[0]!));
  const choices=(await latestStudentPayload(first)).messages.flatMap(message=>message.quickReply?.items??[]);
  const continueChoice=choices.find(item=>item.action.label.startsWith('ต่อ '));
  assert.ok(continueChoice,'the Student deliberately selects the HUMAN case before free-form followups');
  await processEvent('STUDENT',{type:'postback',source:{type:'user',userId:first.studentLineUserId},postback:{data:continueChoice.action.data}});
  studentInboxIds.push(await processEvent('STUDENT',studentEvents[1]!));
  const studentMessages = (await pool.query(
    `select source_event_id,ticket_id,conversation_id from public.messages
      where source_event_id=any($1::uuid[]) order by source_event_id`,
    [studentInboxIds],
  )).rows;
  assert.equal(studentMessages.length, 2);
  assert.ok(studentMessages.every(row => row.ticket_id === first.ticket.id && row.conversation_id === first.conversationId));
  assert.equal((await pool.query('select count(*)::int as count from private.ai_jobs where line_session_id=$1', [first.sessionId])).rows[0].count, 0);
  const cursor = (await pool.query(
    `select read_through_seq from private.staff_chat_read_cursors where staff_id=$1 and ticket_id=$2`,
    [staff.id, first.ticket.id],
  )).rows[0];
  assert.equal(cursor,undefined,'OPEN alone does not acknowledge or infer a read receipt');
  const currentContext = (await pool.query(
    'select viewed_through_seq from private.staff_line_case_context where staff_id=$1 and ticket_id=$2',
    [staff.id, first.ticket.id],
  )).rows[0];
  assert.equal(Number(currentContext.viewed_through_seq), Number(selected.viewed_through_seq), 'new events do not advance a cursor from an earlier OPEN snapshot');
  const laterMessages = (await pool.query(
    `select message_seq from private.staff_chat_message_order where ticket_id=$1`,
    [first.ticket.id],
  )).rows.map(row => Number(row.message_seq));
  assert.ok(laterMessages.some(sequence => sequence > Number(selected.viewed_through_seq)), 'messages arriving after OPEN remain beyond the observed snapshot');
  assert.equal((await pool.query(
    `select count(*)::int as count from private.message_outbox
      where channel='STAFF' and kind='CHAT' and ticket_id=$1 and recipient_staff_id=$2 and idempotency_key like 'user-reply:%'`,
    [first.ticket.id, staff.id],
  )).rows[0].count, 2, 'each repeated GENERAL USER reply alerts the current assignee');

  await replayInbox(firstReplyEventId);
  assert.equal((await pool.query(
    `select count(*)::int as count from public.messages
      where ticket_id=$1 and sender_type='STAFF' and sender_staff_id=$2`,
    [first.ticket.id, staff.id],
  )).rows[0].count, 2, 'a reclaimed Staff inbox event cannot duplicate its message');
  assert.equal((await pool.query(
    `select count(*)::int as count from private.message_outbox
      where channel='STUDENT' and kind='STAFF' and ticket_id=$1`,
    [first.ticket.id],
  )).rows[0].count, 2, 'replay cannot duplicate the Student outbox entry');
});

test('no-context Staff text and media return safe guidance without Student or AI effects', async () => {
  const fixture = await chatFixture();
  const staff = fixture.staff[0]!;
  const privateText = `NO_CONTEXT_PRIVATE_${randomUUID()}`;
  await processEvent('STAFF', staffTextEvent(staff, privateText));
  let reply = await latestStaffPayload(staff.id);
  assert.ok(reply.messages[0]?.text.trim(), 'no-context text receives clear selection guidance');
  assert.doesNotMatch(reply.messages[0]!.text, new RegExp(privateText));
  assert.match(reply.messages[0]!.text, /เคส|งาน|เลือก|คุย|ข้อความ/);

  for (const mediaType of ['file', 'sticker'] as const) {
    const event: DirectUserEvent = {
      type: 'message',
      source: { type: 'user', userId: staff.lineUserId },
      message: { type: mediaType, id: `${mediaType}-${randomUUID()}` },
    };
    await processEvent('STAFF', event);
    reply = await latestStaffPayload(staff.id);
    assert.match(reply.messages[0]!.text, /รองรับ|ส่งเป็นข้อความ|ข้อความ|ไฟล์/);
  }
  assert.equal((await pool.query('select count(*)::int as count from private.ai_jobs where line_session_id=$1', [fixture.sessionId])).rows[0].count, 0);
  assert.equal((await pool.query('select count(*)::int as count from public.messages where ticket_id=$1 and sender_type=\'STAFF\'', [fixture.ticket.id])).rows[0].count, 0);
  assert.equal((await pool.query('select count(*)::int as count from private.message_outbox where channel=\'STUDENT\' and line_session_id=$1', [fixture.sessionId])).rows[0].count, 0);
});

test('typed and slash queue commands recover fresh work after accept tokens expire', async () => {
  const ownCase = await chatFixture({ status: 'WAITING_USER', assignedStaffIndex: 0 });
  const departmentCase = await chatFixture({ existingStaff: ownCase.staff });
  const staff = ownCase.staff[0]!;
  await notifyCase(departmentCase);
  const originalToken = await notificationAcceptToken(departmentCase, staff.id);
  const originalHash = hashOpaqueToken(originalToken, key, 'staff-command');
  await pool.query(
    `update private.staff_action_tokens set expires_at=clock_timestamp()-interval '1 second'
      where token_hash=$1`,
    [originalHash],
  );

  const casesEventId = await processEvent('STAFF', staffTextEvent(staff, 'งานของฉัน'));
  let ownPayload = await latestStaffPayload(staff.id);
  assert.match(ownPayload.messages[0]!.text, new RegExp(ownCase.ticket.ticketNo));
  assert.equal((await pool.query('select last_error_code from private.webhook_inbox where id=$1', [casesEventId])).rows[0].last_error_code, null);

  await processEvent('STAFF', staffTextEvent(staff, '/cases'));
  ownPayload = await latestStaffPayload(staff.id);
  assert.match(ownPayload.messages[0]!.text, new RegExp(ownCase.ticket.ticketNo));

  for (const command of ['คิวฝ่าย', '/queue']) {
    const eventId = await processEvent('STAFF', staffTextEvent(staff, command));
    const queuePayload = await latestStaffPayload(staff.id);
    assert.match(queuePayload.messages[0]!.text, new RegExp(departmentCase.ticket.ticketNo));
    assert.equal((await pool.query('select last_error_code from private.webhook_inbox where id=$1', [eventId])).rows[0].last_error_code, null);
    const freshTokenData = queuePayload.messages.flatMap(message => message.quickReply?.items ?? [])
      .map(item => item.action.data).find(data => /^yru:staff:accept:[A-Za-z0-9_-]{43}$/.test(data));
    assert.ok(freshTokenData, 'fresh queue results mint a new opaque accept action after prior-token expiry');
    const freshToken = freshTokenData!.slice('yru:staff:accept:'.length);
    assert.notEqual(freshToken, originalToken);
    assert.equal((await pool.query(
      `select count(*)::int as count from private.staff_action_tokens
        where token_hash=$1 and staff_id=$2 and ticket_id=$3 and consumed_at is null and expires_at>clock_timestamp()`,
      [hashOpaqueToken(freshToken, key, 'staff-command'), staff.id, departmentCase.ticket.id],
    )).rows[0].count, 1);
  }
});

test('stale OPEN and STOP tokens cannot retarget a newer explicit case selection', async () => {
  const first = await chatFixture();
  const second = await chatFixture({ existingStaff: first.staff });
  const staff = first.staff[0]!;
  const firstReceipt = await acceptCase(first);
  const staleOpen = quickReplyData(firstReceipt, 'เปิดคุยเคสนี้');
  await processEvent('STAFF', staffPostbackEvent(staff, staleOpen));
  const firstContext = (await pool.query(
    'select selection_id from private.staff_line_case_context where staff_id=$1 and ticket_id=$2',
    [staff.id, first.ticket.id],
  )).rows[0];
  assert.ok(firstContext);
  const staleStop = quickReplyData(await latestStaffPayload(staff.id), 'หยุดคุย');
  await processEvent('STAFF', staffPostbackEvent(staff, staleStop));
  assert.equal((await pool.query('select count(*)::int as count from private.staff_line_case_context where staff_id=$1 and expires_at>clock_timestamp()', [staff.id])).rows[0].count, 0);

  const secondReceipt = await acceptCase(second);
  const secondOpen = quickReplyData(secondReceipt, 'เปิดคุยเคสนี้');
  await processEvent('STAFF', staffPostbackEvent(staff, secondOpen));
  const secondContext = (await pool.query(
    'select ticket_id,selection_id from private.staff_line_case_context where staff_id=$1',
    [staff.id],
  )).rows[0];
  assert.equal(secondContext.ticket_id, second.ticket.id);

  await processEvent('STAFF', staffPostbackEvent(staff, staleStop));
  await processEvent('STAFF', staffPostbackEvent(staff, staleOpen));
  const afterStaleActions = (await pool.query(
    'select ticket_id,selection_id from private.staff_line_case_context where staff_id=$1',
    [staff.id],
  )).rows[0];
  assert.deepEqual(afterStaleActions, secondContext, 'stale controls leave the current selection intact');

  await processEvent('STAFF', staffTextEvent(staff, `CURRENT_CASE_ONLY_${randomUUID()}`));
  assert.equal((await pool.query('select count(*)::int as count from public.messages where ticket_id=$1 and sender_type=\'STAFF\'', [first.ticket.id])).rows[0].count, 0);
  assert.equal((await pool.query('select count(*)::int as count from public.messages where ticket_id=$1 and sender_type=\'STAFF\'', [second.ticket.id])).rows[0].count, 1);
});

test('typed Thai and slash stop commands clear only the staff member’s explicit case context', async () => {
  const fixture = await chatFixture();
  const staff = fixture.staff[0]!;
  const receipt = await acceptCase(fixture);
  await processEvent('STAFF', staffPostbackEvent(staff, quickReplyData(receipt, 'เปิดคุยเคสนี้')));
  assert.equal((await pool.query('select count(*)::int as count from private.staff_line_case_context where staff_id=$1', [staff.id])).rows[0].count, 1);

  await processEvent('STAFF', staffTextEvent(staff, 'หยุดคุย'));
  assert.equal((await pool.query('select count(*)::int as count from private.staff_line_case_context where staff_id=$1 and expires_at>clock_timestamp()', [staff.id])).rows[0].count, 0);

  await processEvent('STAFF', staffTextEvent(staff, 'งานของฉัน'));
  const freshOpen = quickReplyData(await latestStaffPayload(staff.id), `เปิด ${fixture.ticket.ticketNo}`);
  await processEvent('STAFF', staffPostbackEvent(staff, freshOpen));
  assert.equal((await pool.query('select count(*)::int as count from private.staff_line_case_context where staff_id=$1', [staff.id])).rows[0].count, 1);
  await processEvent('STAFF', staffTextEvent(staff, '/stop'));
  assert.equal((await pool.query('select count(*)::int as count from private.staff_line_case_context where staff_id=$1 and expires_at>clock_timestamp()', [staff.id])).rows[0].count, 0);
  assert.equal((await pool.query('select count(*)::int as count from private.message_outbox where channel=\'STUDENT\' and ticket_id=$1', [fixture.ticket.id])).rows[0].count, 0);
});

test('expired, stolen, reassigned, closed, and unbound case contexts never relay Staff text', async () => {
  const expired = await chatFixture();
  const expiredStaff = expired.staff[0]!;
  const expiredReceipt = await acceptCase(expired);
  await processEvent('STAFF', staffPostbackEvent(expiredStaff, quickReplyData(expiredReceipt, 'เปิดคุยเคสนี้')));
  await pool.query(
    `update private.staff_line_case_context set expires_at=clock_timestamp()-interval '1 second'
      where staff_id=$1 and ticket_id=$2`,
    [expiredStaff.id, expired.ticket.id],
  );
  await processEvent('STAFF', staffTextEvent(expiredStaff, 'EXPIRED_CONTEXT_PRIVATE'));
  assert.equal((await pool.query('select count(*)::int as count from private.message_outbox where channel=\'STUDENT\' and ticket_id=$1', [expired.ticket.id])).rows[0].count, 0);

  const stolen = await chatFixture({ staffCount: 2 });
  const other = stolen.staff[1]!;
  const stolenReceipt = await acceptCase(stolen, 0);
  const ownerOpen = quickReplyData(stolenReceipt, 'เปิดคุยเคสนี้');
  await processEvent('STAFF', staffPostbackEvent(other, ownerOpen));
  assert.equal((await pool.query('select count(*)::int as count from private.staff_line_case_context where staff_id=$1', [other.id])).rows[0].count, 0);
  await processEvent('STAFF', staffTextEvent(other, 'OTHER_STAFF_PRIVATE'));
  assert.equal((await pool.query('select count(*)::int as count from private.message_outbox where channel=\'STUDENT\' and ticket_id=$1', [stolen.ticket.id])).rows[0].count, 0);

  const reassigned = await chatFixture({ staffCount: 2 });
  const originalOwner = reassigned.staff[0]!;
  const replacement = reassigned.staff[1]!;
  await pool.query("update public.staff_profiles set role='SUPERVISOR' where id=$1", [replacement.id]);
  const reassignedReceipt = await acceptCase(reassigned, 0);
  await processEvent('STAFF', staffPostbackEvent(originalOwner, quickReplyData(reassignedReceipt, 'เปิดคุยเคสนี้')));
  const revision = (await pool.query('select revision from public.tickets where id=$1', [reassigned.ticket.id])).rows[0].revision as number;
  await transaction(client => applyTicketAction(client, replacement.id, reassigned.ticket.id, 'REASSIGN', {
    revision,
    requestId: randomUUID(),
    assigneeId: replacement.id,
  }, key), pool);
  await processEvent('STAFF', staffTextEvent(originalOwner, 'REASSIGNED_CONTEXT_PRIVATE'));
  assert.equal((await pool.query('select count(*)::int as count from private.message_outbox where channel=\'STUDENT\' and ticket_id=$1', [reassigned.ticket.id])).rows[0].count, 0);

  const closed = await chatFixture();
  const closedStaff = closed.staff[0]!;
  const closedReceipt = await acceptCase(closed);
  await processEvent('STAFF', staffPostbackEvent(closedStaff, quickReplyData(closedReceipt, 'เปิดคุยเคสนี้')));
  const closeRevision = (await pool.query('select revision from public.tickets where id=$1', [closed.ticket.id])).rows[0].revision as number;
  await transaction(client => applyTicketAction(client, closedStaff.id, closed.ticket.id, 'RESOLVE', {
    revision: closeRevision,
    requestId: randomUUID(),
  }, key), pool);
  await transaction(client=>applyTicketAction(client,closedStaff.id,closed.ticket.id,'CLOSE',{revision:closeRevision+1,requestId:randomUUID()},key),pool);
  await processEvent('STAFF', staffTextEvent(closedStaff, 'CLOSED_CONTEXT_PRIVATE'));
  assert.equal((await pool.query('select count(*)::int as count from private.message_outbox where channel=\'STUDENT\' and ticket_id=$1', [closed.ticket.id])).rows[0].count, 0);

  const unbound = await chatFixture();
  const unboundStaff = unbound.staff[0]!;
  const unboundReceipt = await acceptCase(unbound);
  await processEvent('STAFF', staffPostbackEvent(unboundStaff, quickReplyData(unboundReceipt, 'เปิดคุยเคสนี้')));
  await pool.query('update private.staff_line_identities set active=false where staff_id=$1', [unboundStaff.id]);
  await processEvent('STAFF', staffTextEvent(unboundStaff, 'UNBOUND_CONTEXT_PRIVATE'));
  assert.equal((await pool.query('select count(*)::int as count from private.message_outbox where channel=\'STUDENT\' and ticket_id=$1', [unbound.ticket.id])).rows[0].count, 0);
});

test('restricted cases cannot be opened for LINE relay or disclose case details in Staff payloads', async () => {
  const fixture = await chatFixture({ sensitivity: 'RESTRICTED', restrictedStaff: true });
  const staff = fixture.staff[0]!;
  await notifyCase(fixture);
  const notification = (await pool.query(
    `select payload_encrypted from private.message_outbox
      where ticket_id=$1 and recipient_staff_id=$2 and channel='STAFF' and kind in('ALERT','NOTIFICATION')`,
    [fixture.ticket.id, staff.id],
  )).rows[0];
  assert.ok(notification);
  const token = await notificationAcceptToken(fixture, staff.id);
  await acceptJob(staff.lineUserId, token);
  const receipt = await latestStaffPayload(staff.id);
  const openItem = receipt.messages.flatMap(message => message.quickReply?.items ?? [])
    .find(item => item.action.label === 'เปิดคุยเคสนี้');
  if (openItem) await processEvent('STAFF', staffPostbackEvent(staff, openItem.action.data));
  await processEvent('STAFF', staffTextEvent(staff, 'RESTRICTED_PRIVATE_REPLY'));

  const sensitivePayloads = (await pool.query(
    `select payload_encrypted from private.message_outbox
      where recipient_staff_id=$1 and channel='STAFF'`,
    [staff.id],
  )).rows;
  assert.ok(sensitivePayloads.length >= 2);
  for (const row of sensitivePayloads) {
    const encoded = row.payload_encrypted as string;
    const payload = decodePayload(encoded);
    assert.equal(payload.replyToken, undefined);
    const serialized = JSON.stringify(payload);
    for (const privateValue of [fixture.ticket.id, fixture.ticket.ticketNo, staff.lineUserId, fixture.studentLineUserId, 'RESTRICTED_PRIVATE_REPLY']) {
      assert.equal(serialized.includes(privateValue), false);
    }
  }
  assert.equal((await pool.query('select count(*)::int as count from private.message_outbox where channel=\'STUDENT\' and ticket_id=$1', [fixture.ticket.id])).rows[0].count, 0);
  assert.equal((await pool.query('select count(*)::int as count from public.messages where ticket_id=$1 and sender_type=\'STAFF\'', [fixture.ticket.id])).rows[0].count, 0);
});

test('protected Staff chat delivery pushes only to the linked Student through the injected transport', async () => {
  const fixture = await chatFixture();
  const staff = fixture.staff[0]!;
  const receipt = await acceptCase(fixture);
  await processEvent('STAFF', staffPostbackEvent(staff, quickReplyData(receipt, 'เปิดคุยเคสนี้')));
  const text = `DELIVERY_TARGET_PRIVATE_${randomUUID()}`;
  await processEvent('STAFF', staffTextEvent(staff, text));
  await suppressStaffOutbox(fixture.staff);
  const queuedStudentPayload = await latestStudentPayload(fixture);
  assert.ok(queuedStudentPayload.messages.some(message => message.text.includes(text)));

  const queued = (await pool.query(
    `select id,status,payload_encrypted from private.message_outbox
      where channel='STUDENT' and kind='STAFF' and ticket_id=$1`,
    [fixture.ticket.id],
  )).rows[0];
  assert.ok(queued);
  assert.equal(queued.status, 'PENDING');
  const delivery = await dispatchWithCapture();
  assert.deepEqual(delivery.result, { claimed: 1, sent: 1, failed: 0 });
  assert.equal(delivery.requests.length, 1, 'the fake fetch implementation is the only transport used');
  assert.match(delivery.requests[0]!.url, /^https:\/\/api\.line\.me\/v2\/bot\/message\/push$/);
  assert.equal(delivery.requests[0]!.body.to, fixture.studentLineUserId, 'the protected reply reaches the linked anonymous Student session');
  assert.ok(JSON.stringify(delivery.requests[0]!.body.messages).includes(text));
  assert.notEqual(delivery.requests[0]!.authorization, `Bearer ${fixture.studentLineUserId}`);
  assert.equal((await pool.query('select status from private.message_outbox where id=$1', [queued.id])).rows[0].status, 'SENT');
});

test('a queued chat reply is suppressed before transport after reassignment changes its bound case epoch', async () => {
  const fixture = await chatFixture({ staffCount: 2 });
  const originalOwner = fixture.staff[0]!;
  const supervisor = fixture.staff[1]!;
  await pool.query("update public.staff_profiles set role='SUPERVISOR' where id=$1", [supervisor.id]);
  const receipt = await acceptCase(fixture, 0);
  await processEvent('STAFF', staffPostbackEvent(originalOwner, quickReplyData(receipt, 'เปิดคุยเคสนี้')));
  await processEvent('STAFF', staffTextEvent(originalOwner, `STALE_DELIVERY_PRIVATE_${randomUUID()}`));
  await suppressStaffOutbox(fixture.staff);

  const queued = (await pool.query(
    `select id from private.message_outbox
      where channel='STUDENT' and kind='STAFF' and ticket_id=$1`,
    [fixture.ticket.id],
  )).rows[0];
  assert.ok(queued);
  const revision = (await pool.query('select revision from public.tickets where id=$1', [fixture.ticket.id])).rows[0].revision as number;
  await transaction(client => applyTicketAction(client, supervisor.id, fixture.ticket.id, 'REASSIGN', {
    revision,
    requestId: randomUUID(),
    assigneeId: supervisor.id,
  }, key), pool);

  const delivery = await dispatchWithCapture();
  assert.equal(delivery.requests.length, 0, 'stale ownership is rejected before the injected HTTP transport');
  assert.equal((await pool.query('select status from private.message_outbox where id=$1', [queued.id])).rows[0].status, 'SUPPRESSED');
});

test('explicit ACK covers complete displayed messages and never a newer arrival',async()=>{
 const f=await chatFixture({status:'STAFF_HANDLING',assignedStaffIndex:0}),staff=f.staff[0]!;
 const insert=async(text:string)=>(await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,content) values($1,$2,'USER',$3) returning id",[f.conversationId,f.ticket.id,text])).rows[0].id;
 await insert('🙂'.repeat(2500));const second=await insert('second');
 await processEvent('STAFF',staffTextEvent(staff,'งานของฉัน'));
 await processEvent('STAFF',staffPostbackEvent(staff,quickReplyData(await latestStaffPayload(staff.id),`เปิด ${f.ticket.ticketNo}`)));
 const preview=await latestStaffPayload(staff.id);assert.equal(preview.messages.length,4,'long source is split completely before the footer');
 const ack=quickReplyData(preview,'รับทราบข้อความ');
 assert.equal((await pool.query('select count(*)::int n from private.staff_chat_read_cursors where staff_id=$1',[staff.id])).rows[0].n,0);
 const later=await insert('arrived after the displayed snapshot');
 await processEvent('STAFF',staffPostbackEvent(staff,ack));
 const cursor=(await pool.query('select read_through_seq from private.staff_chat_read_cursors where staff_id=$1 and ticket_id=$2',[staff.id,f.ticket.id])).rows[0].read_through_seq;
 const observed=(await pool.query('select message_seq from private.staff_chat_message_order where message_id=$1',[second])).rows[0].message_seq;
 const next=(await pool.query('select message_seq from private.staff_chat_message_order where message_id=$1',[later])).rows[0].message_seq;
 assert.equal(cursor,observed);assert(BigInt(cursor)<BigInt(next));assert((await latestStaffPayload(staff.id)).messages.some(m=>m.text.includes('arrived after')));
});

test('another case USER alert cannot change the selected recipient or mix answers',async()=>{
 const first=await chatFixture({status:'STAFF_HANDLING',assignedStaffIndex:0}),second=await chatFixture({existingStaff:first.staff,status:'WAITING_USER',assignedStaffIndex:0}),staff=first.staff[0]!;
 await processEvent('STAFF',staffTextEvent(staff,'งานของฉัน'));await processEvent('STAFF',staffPostbackEvent(staff,quickReplyData(await latestStaffPayload(staff.id),`เปิด ${first.ticket.ticketNo}`)));
 const before=(await pool.query('select ticket_id,selection_id from private.staff_line_case_context where staff_id=$1',[staff.id])).rows[0];
 const message=(await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,content) values($1,$2,'USER','OTHER_CASE_PRIVATE_FACT') returning id",[second.conversationId,second.ticket.id])).rows[0].id;
 await transaction(async c=>{const t=(await c.query('select * from public.tickets where id=$1',[second.ticket.id])).rows[0];await notifyTicketUserReply(c,t,message,key);},pool);
 assert.deepEqual((await pool.query('select ticket_id,selection_id from private.staff_line_case_context where staff_id=$1',[staff.id])).rows[0],before);
 const alert=await latestStaffPayload(staff.id);assert(alert.messages.some(m=>m.text.includes(second.ticket.ticketNo)));assert(alert.messages.some(m=>m.text.includes('ยังไม่เปลี่ยนเคส')));
 await processEvent('STAFF',staffTextEvent(staff,'ANSWER_FOR_FIRST_ONLY'));
 assert.equal((await pool.query("select count(*)::int n from public.messages where ticket_id=$1 and sender_type='STAFF' and content='ANSWER_FOR_FIRST_ONLY'",[first.ticket.id])).rows[0].n,1);
 assert.equal((await pool.query("select count(*)::int n from public.messages where ticket_id=$1 and sender_type='STAFF'",[second.ticket.id])).rows[0].n,0);
});

test('unlink/rebind and profile revoke/restore cannot revive a context, old token or queued content',async()=>{
 for(const catalog of ['binding','profile'] as const){
  const f=await chatFixture(),staff=f.staff[0]!;const receipt=await acceptCase(f),open=quickReplyData(receipt,'เปิดคุยเคสนี้');
  await processEvent('STAFF',staffPostbackEvent(staff,open));await processEvent('STAFF',staffTextEvent(staff,'QUEUED_BEFORE_ACCESS_CHANGE'));
  const oldMenu=quickReplyData(await latestStaffPayload(staff.id),'งานของฉัน');
  const queued=(await pool.query("select id from private.message_outbox where channel='STUDENT' and kind='STAFF' and ticket_id=$1",[f.ticket.id])).rows[0].id;
  if(catalog==='binding'){
   await pool.query('update private.staff_line_identities set active=false where staff_id=$1',[staff.id]);await pool.query('update private.staff_line_identities set active=true where staff_id=$1',[staff.id]);
  }else{await pool.query('update public.staff_profiles set active=false where id=$1',[staff.id]);await pool.query('update public.staff_profiles set active=true where id=$1',[staff.id]);}
  await processEvent('STAFF',staffPostbackEvent(staff,oldMenu));await processEvent('STAFF',staffTextEvent(staff,'MUST_NOT_RELAY_AFTER_RESTORE'));
  assert.equal((await pool.query("select count(*)::int n from public.messages where ticket_id=$1 and content='MUST_NOT_RELAY_AFTER_RESTORE'",[f.ticket.id])).rows[0].n,0);
  assert.equal((await pool.query('select status from private.message_outbox where id=$1',[queued])).rows[0].status,'SUPPRESSED');
  await pool.query("update private.message_outbox set status='SUPPRESSED',lease_token=null,lease_until=null,completed_at=clock_timestamp() where channel='STAFF' and recipient_staff_id=any($1::uuid[]) and status in('PENDING','PROCESSING')",[staffIds]);
  assert.equal((await dispatchWithCapture()).requests.length,0);
 }
});

test('a displayed queue code is suppressed if the case privacy changes before dispatch',async()=>{
 const f=await chatFixture(),staff=f.staff[0]!;
 await processEvent('STAFF',staffTextEvent(staff,'คิวฝ่าย'));
 const queue=(await pool.query("select id from private.message_outbox where recipient_staff_id=$1 and kind='CONTROL' order by outbox_seq desc limit 1",[staff.id])).rows[0].id;
 await pool.query("update public.tickets set sensitive_level='RESTRICTED' where id=$1",[f.ticket.id]);
 const result=await dispatchWithCapture();assert.equal(result.requests.length,0);assert.equal((await pool.query('select status from private.message_outbox where id=$1',[queue])).rows[0].status,'SUPPRESSED');
});

test('an older unprocessed OPEN cannot overwrite a newer deliberate selection',async()=>{
 const first=await chatFixture({status:'STAFF_HANDLING',assignedStaffIndex:0}),second=await chatFixture({existingStaff:first.staff,status:'STAFF_HANDLING',assignedStaffIndex:0}),staff=first.staff[0]!;
 await processEvent('STAFF',staffTextEvent(staff,'งานของฉัน'));const menu=await latestStaffPayload(staff.id);
 const old=await inboxJob('STAFF',staffPostbackEvent(staff,quickReplyData(menu,`เปิด ${first.ticket.ticketNo}`)));
 await processEvent('STAFF',staffPostbackEvent(staff,quickReplyData(menu,`เปิด ${second.ticket.ticketNo}`)));
 await transaction(c=>processInboxEvent(c,old,key),pool);
 assert.equal((await pool.query('select ticket_id from private.staff_line_case_context where staff_id=$1',[staff.id])).rows[0].ticket_id,second.ticket.id);
});

test('a delayed OPEN cannot revive the selected chat after a newer deliberate STOP',async()=>{
 const f=await chatFixture({status:'STAFF_HANDLING',assignedStaffIndex:0}),staff=f.staff[0]!;
 await processEvent('STAFF',staffTextEvent(staff,'งานของฉัน'));
 await processEvent('STAFF',staffPostbackEvent(staff,quickReplyData(await latestStaffPayload(staff.id),`เปิด ${f.ticket.ticketNo}`)));
 await processEvent('STAFF',staffTextEvent(staff,'งานของฉัน'));
 const delayed=await inboxJob('STAFF',staffPostbackEvent(staff,quickReplyData(await latestStaffPayload(staff.id),`เปิด ${f.ticket.ticketNo}`)));
 await processEvent('STAFF',staffTextEvent(staff,'หยุดคุย'));
 await transaction(c=>processInboxEvent(c,delayed,key),pool);
 assert.equal((await pool.query('select count(*)::int n from private.staff_line_case_context where staff_id=$1 and expires_at>clock_timestamp()',[staff.id])).rows[0].n,0,'STOP must fence older unprocessed OPEN');
 await processEvent('STAFF',staffTextEvent(staff,'THIS_MUST_NOT_REACH_STUDENT'));
 assert.equal((await pool.query("select count(*)::int n from public.messages where ticket_id=$1 and sender_type='STAFF'",[f.ticket.id])).rows[0].n,0);
});

test('an older typed STOP cannot expire a newer explicit OPEN',async()=>{
 const f=await chatFixture({status:'STAFF_HANDLING',assignedStaffIndex:0}),staff=f.staff[0]!;
 await processEvent('STAFF',staffTextEvent(staff,'งานของฉัน'));
 const delayed=await inboxJob('STAFF',staffTextEvent(staff,'หยุดคุย'));
 await processEvent('STAFF',staffPostbackEvent(staff,quickReplyData(await latestStaffPayload(staff.id),`เปิด ${f.ticket.ticketNo}`)));
 await transaction(c=>processInboxEvent(c,delayed,key),pool);
 assert.equal((await pool.query('select count(*)::int n from private.staff_line_case_context where staff_id=$1 and expires_at>clock_timestamp()',[staff.id])).rows[0].n,1,'older STOP cannot change the newer explicit target');
});

test('authority mutation cannot complete while guarded LINE HTTP is in progress',async()=>{
 const f=await chatFixture(),staff=f.staff[0]!;const receipt=await acceptCase(f);await processEvent('STAFF',staffPostbackEvent(staff,quickReplyData(receipt,'เปิดคุยเคสนี้')));
 await processEvent('STAFF',staffTextEvent(staff,'FENCED_NETWORK'));await suppressStaffOutbox(f.staff);
 let mutationCode:string|undefined;
 await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'fixture',STAFF:'fixture'},fetchImpl:async()=>{
  try{await pool.query('update public.staff_profiles set active=false where id=$1',[staff.id]);}catch(e){mutationCode=(e as {code?:string}).code;}
  assert.equal(mutationCode,'40001');return new Response(null,{status:200});
 }});
 assert.equal(mutationCode,'40001');await pool.query('update public.staff_profiles set active=false where id=$1',[staff.id]);
});

test('Staff unfollow revokes the binding and selection without sending a follow-up message',async()=>{
 const f=await chatFixture(),staff=f.staff[0]!;const receipt=await acceptCase(f);await processEvent('STAFF',staffPostbackEvent(staff,quickReplyData(receipt,'เปิดคุยเคสนี้')));
 await processEvent('STAFF',{type:'unfollow',source:{type:'user',userId:staff.lineUserId}});
 assert.equal((await pool.query('select active from private.staff_line_identities where staff_id=$1',[staff.id])).rows[0].active,false);
 assert.equal((await pool.query('select count(*)::int n from private.staff_line_case_context where staff_id=$1 and expires_at>clock_timestamp()',[staff.id])).rows[0].n,0);
 await processEvent('STAFF',{type:'follow',source:{type:'user',userId:staff.lineUserId}});
 assert.equal((await pool.query('select active from private.staff_line_identities where staff_id=$1',[staff.id])).rows[0].active,false,'follow alone cannot restore authorization or an old selected chat');
});

test('Dashboard queued replies are suppressed after the sender is revoked',async()=>{
 const f=await chatFixture({status:'STAFF_HANDLING',assignedStaffIndex:0});
 const revision=(await pool.query('select revision from public.tickets where id=$1',[f.ticket.id])).rows[0].revision;
 await transaction(c=>applyTicketAction(c,f.staff[0]!.id,f.ticket.id,'STAFF_REPLY',{revision,requestId:randomUUID(),text:'Dashboard owned pending reply'},key),pool);
 const queued=(await pool.query("select id from private.message_outbox where ticket_id=$1 and kind='STAFF'",[f.ticket.id])).rows[0].id;
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff[0]!.id]);
 const capture=await dispatchWithCapture();assert.equal(capture.requests.length,0,'revoked sender must not dispatch a previously queued Dashboard reply');
 assert.equal((await pool.query('select status from private.message_outbox where id=$1',[queued])).rows[0].status,'SUPPRESSED');
});

test('Dashboard queued replies are suppressed after assignment epoch changes',async()=>{
 const f=await chatFixture({staffCount:2,status:'STAFF_HANDLING',assignedStaffIndex:0});
 const revision=(await pool.query('select revision from public.tickets where id=$1',[f.ticket.id])).rows[0].revision;
 await transaction(c=>applyTicketAction(c,f.staff[0]!.id,f.ticket.id,'STAFF_REPLY',{revision,requestId:randomUUID(),text:'Dashboard original assignee reply'},key),pool);
 await pool.query('update public.tickets set assigned_staff_id=$2 where id=$1',[f.ticket.id,f.staff[1]!.id]);
 const capture=await dispatchWithCapture();assert.equal(capture.requests.length,0,'a new assignment must invalidate the original sender authority');
});

test('queued LINE manual reply cannot outlive its original selection deadline',async()=>{
 const f=await chatFixture();
 const receipt=await acceptCase(f);
 await processEvent('STAFF',staffPostbackEvent(f.staff[0]!,quickReplyData(receipt,'เปิดคุยเคสนี้')));
 await pool.query("update private.staff_line_case_context set expires_at=clock_timestamp()+interval '2 seconds' where staff_id=$1",[f.staff[0]!.id]);
 const deadline=(await pool.query('select expires_at from private.staff_line_case_context where staff_id=$1',[f.staff[0]!.id])).rows[0].expires_at;
 await processEvent('STAFF',staffTextEvent(f.staff[0]!,'LINE original selection bounded reply'));
 await suppressStaffOutbox(f.staff);
 await pool.query('select pg_sleep(greatest(0,extract(epoch from $1::timestamptz-clock_timestamp()))+0.01)',[deadline]);
 const capture=await dispatchWithCapture();assert.equal(capture.requests.length,0,'expired original selection must suppress queued Student delivery');
});

test('Dashboard replies retain sensitive scope without requiring a personal LINE binding',async()=>{
 const f=await chatFixture({status:'STAFF_HANDLING',assignedStaffIndex:0,sensitivity:'RESTRICTED',restrictedStaff:true});
 await pool.query('update private.staff_line_identities set active=false where staff_id=$1',[f.staff[0]!.id]);
 const revision=(await pool.query('select revision from public.tickets where id=$1',[f.ticket.id])).rows[0].revision;
 await transaction(c=>applyTicketAction(c,f.staff[0]!.id,f.ticket.id,'STAFF_REPLY',{revision,requestId:randomUUID(),text:'Scoped Dashboard response'},key),pool);
 const capture=await dispatchWithCapture();assert.equal(capture.requests.length,1);
 assert.equal(capture.requests[0]!.body.to,f.studentLineUserId);
 assert.equal(JSON.stringify(capture.requests[0]!.body).includes('selectionExpiresAt'),false,'server selection metadata must not appear on the LINE wire');
});

test('revoke then restore cannot revive a queued Dashboard reply',async()=>{
 const f=await chatFixture({status:'STAFF_HANDLING',assignedStaffIndex:0});
 const revision=(await pool.query('select revision from public.tickets where id=$1',[f.ticket.id])).rows[0].revision;
 await transaction(c=>applyTicketAction(c,f.staff[0]!.id,f.ticket.id,'STAFF_REPLY',{revision,requestId:randomUUID(),text:'Sticky Dashboard invalidation'},key),pool);
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff[0]!.id]);
 await pool.query('update public.staff_profiles set active=true where id=$1',[f.staff[0]!.id]);
 assert.equal((await dispatchWithCapture()).requests.length,0);
});

test('switching LINE to T2 preserves queued T1 recipient and original authority',async()=>{
 const first=await chatFixture(),second=await chatFixture({existingStaff:first.staff});
 const staff=first.staff[0]!,openFirst=quickReplyData(await acceptCase(first),'เปิดคุยเคสนี้');
 const openSecond=quickReplyData(await acceptCase(second),'เปิดคุยเคสนี้');
 await processEvent('STAFF',staffPostbackEvent(staff,openFirst));
 await processEvent('STAFF',staffTextEvent(staff,'Reply intended only for T1'));
 await processEvent('STAFF',staffPostbackEvent(staff,openSecond));
 await suppressStaffOutbox(first.staff);
 const capture=await dispatchWithCapture();assert.equal(capture.requests.length,1);
 assert.equal(capture.requests[0]!.body.to,first.studentLineUserId);
 assert.notEqual(capture.requests[0]!.body.to,second.studentLineUserId);
 assert.equal((await pool.query('select ticket_id from private.staff_line_case_context where staff_id=$1',[staff.id])).rows[0].ticket_id,second.ticket.id);
});

test('manual reply enqueue rejects a conversation whose active ticket changed',async()=>{
 const f=await chatFixture({status:'STAFF_HANDLING',assignedStaffIndex:0});
 await pool.query('update public.conversations set active_ticket_id=null where id=$1',[f.conversationId]);
 const revision=(await pool.query('select revision from public.tickets where id=$1',[f.ticket.id])).rows[0].revision;
 await assert.rejects(transaction(c=>applyTicketAction(c,f.staff[0]!.id,f.ticket.id,'STAFF_REPLY',{revision,requestId:randomUUID(),text:'Must not enqueue'},key),pool),
  {message:'CONFLICT'});
 assert.equal((await pool.query("select count(*)::int n from private.message_outbox where ticket_id=$1 and kind='STAFF'",[f.ticket.id])).rows[0].n,0);
});

test('Staff chat storage is browser denied and service runtime cannot delete retained rows',async()=>{
 const names=['staff_line_case_context','staff_chat_commands','staff_chat_message_order','staff_chat_read_cursors','staff_chat_delivery_guards','staff_chat_delivery_cases'];
 for(const name of names){
  const access=(await pool.query(`select has_table_privilege('anon',$1,'SELECT') anon,has_table_privilege('authenticated',$1,'SELECT') authenticated,
   has_table_privilege('service_role',$1,'SELECT') service_select,has_table_privilege('service_role',$1,'DELETE') service_delete`,[`private.${name}`])).rows[0];
  assert.deepEqual(access,{anon:false,authenticated:false,service_select:true,service_delete:false});
 }
});
