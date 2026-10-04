import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { TicketStatus } from '../../lib/conversation/state-machine';
import type { DirectUserEvent } from '../../lib/line/events';
import { createEscalation } from '../../lib/tickets/create-ticket';
import { TicketError } from '../../lib/tickets/authorization';
import { processStaffCommand } from '../../lib/tickets/staff-command';
import { applyTicketAction } from '../../lib/tickets/ticket-service';
import {
  decryptValue,
  encryptValue,
  hashLineUserId,
  hashStaffLineUserId,
} from '../../lib/security/identity';
import { hashOpaqueToken } from '../../lib/conversation/quick-reply';
import { notifyTicketStaff } from '../../lib/tickets/notifications';

const localUrl = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';
const pool = new Pool({ connectionString: localUrl, max: 5 });
const makeKey = () => randomBytes(32).toString('base64');

interface FixtureIds {
  departments: string[];
  staff: string[];
  sessions: string[];
  conversations: string[];
  tickets: string[];
}

interface TicketSeed {
  id: string;
  sessionId: string;
  conversationId: string;
}

interface StoredOutboxPayload {
  messages: Array<{
    type: 'text';
    text: string;
    quickReply?: {
      items: Array<{ type: 'action'; action: { type: 'postback'; label: string; data: string } }>;
    };
  }>;
  replyToken?: string;
}

interface StaffOptions {
  id?: string;
  departmentId: string | null;
  role?: 'STAFF' | 'SUPERVISOR' | 'ADMIN' | 'SUPER_ADMIN';
  active?: boolean;
  canViewSensitive?: boolean;
  canViewRestricted?: boolean;
}

interface TicketOptions {
  departmentId: string;
  status?: TicketStatus;
  mode?: 'AI' | 'HUMAN';
  sensitivity?: 'GENERAL' | 'SENSITIVE' | 'RESTRICTED';
  assignedStaffId?: string | null;
}

function newFixture(): FixtureIds {
  return { departments: [], staff: [], sessions: [], conversations: [], tickets: [] };
}

function departmentCode(): string {
  return `TEST_${Array.from(randomBytes(24), byte => String.fromCharCode(65 + (byte % 26))).join('')}`;
}

async function seedDepartment(client: PoolClient, fixture: FixtureIds): Promise<{ id: string; code: string }> {
  const code = departmentCode();
  const id = (await client.query(
    'insert into public.departments(code,name_th,name_en) values($1,$2,$3) returning id',
    [code, 'ฝ่ายทดสอบ', 'Ticket fixture'],
  )).rows[0].id as string;
  fixture.departments.push(id);
  return { id, code };
}

async function seedStaff(client: PoolClient, fixture: FixtureIds, options: StaffOptions): Promise<string> {
  const id = options.id ?? randomUUID();
  await client.query('insert into auth.users(id) values($1)', [id]);
  await client.query(
    `insert into public.staff_profiles
      (id,display_name,department_id,role,active,can_view_sensitive,can_view_restricted)
     values($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      `Fixture ${id.slice(0, 8)}`,
      options.departmentId,
      options.role ?? 'STAFF',
      options.active ?? true,
      options.canViewSensitive ?? false,
      options.canViewRestricted ?? false,
    ],
  );
  fixture.staff.push(id);
  return id;
}

async function seedSession(client: PoolClient, fixture: FixtureIds): Promise<string> {
  const id = (await client.query(
    'insert into public.line_sessions(anonymous_code) values($1) returning id',
    [`Ticket fixture ${randomUUID()}`],
  )).rows[0].id as string;
  fixture.sessions.push(id);
  return id;
}

async function seedConversation(
  client: PoolClient,
  fixture: FixtureIds,
  sessionId: string,
  mode: 'AI' | 'HUMAN',
  status: 'ACTIVE' | 'WAITING' | 'RESOLVED' | 'CLOSED' = 'ACTIVE',
): Promise<string> {
  const id = (await client.query(
    `insert into public.conversations(line_session_id,conversation_type,mode,status)
     values($1,'TICKET',$2,$3) returning id`,
    [sessionId, mode, status],
  )).rows[0].id as string;
  fixture.conversations.push(id);
  return id;
}

function conversationStatus(status: TicketStatus): 'ACTIVE' | 'WAITING' | 'RESOLVED' | 'CLOSED' {
  if (status === 'RESOLVED') return 'RESOLVED';
  if (status === 'CLOSED') return 'CLOSED';
  if (status === 'WAITING_USER') return 'WAITING';
  return 'ACTIVE';
}

async function seedTicket(client: PoolClient, fixture: FixtureIds, options: TicketOptions): Promise<TicketSeed> {
  const status = options.status ?? 'WAITING_STAFF';
  const mode = options.mode ?? 'HUMAN';
  const sessionId = await seedSession(client, fixture);
  const conversationId = await seedConversation(
    client,
    fixture,
    sessionId,
    mode,
    conversationStatus(status),
  );
  const ticket = (await client.query(
    `insert into public.tickets
      (line_session_id,conversation_id,department_id,problem_summary,mode,status,sensitive_level,assigned_staff_id)
     values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      sessionId,
      conversationId,
      options.departmentId,
      'Ticket security integration fixture',
      mode,
      status,
      options.sensitivity ?? 'GENERAL',
      options.assignedStaffId ?? null,
    ],
  )).rows[0];
  const id = ticket.id as string;
  fixture.tickets.push(id);
  await client.query('update public.conversations set active_ticket_id=$2 where id=$1', [conversationId, id]);
  return { id, sessionId, conversationId };
}

async function withRollback<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    return await run(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

async function expectTicketError(
  client: PoolClient,
  code: TicketError['code'],
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query('savepoint expected_ticket_error');
  try {
    await assert.rejects(action(), (error: unknown) => error instanceof TicketError && error.code === code);
  } finally {
    await client.query('rollback to savepoint expected_ticket_error');
    await client.query('release savepoint expected_ticket_error');
  }
}

async function assertNoTicketEffects(client: PoolClient, ticketIds: string[]): Promise<void> {
  const history = (await client.query(
    'select count(*)::int as count from public.ticket_history where ticket_id=any($1::uuid[])',
    [ticketIds],
  )).rows[0].count as number;
  const activities = (await client.query(
    'select count(*)::int as count from private.activities where ticket_id=any($1::uuid[])',
    [ticketIds],
  )).rows[0].count as number;
  const receipts = (await client.query(
    'select count(*)::int as count from private.ticket_action_receipts where ticket_id=any($1::uuid[])',
    [ticketIds],
  )).rows[0].count as number;
  const outbox = (await client.query(
    'select count(*)::int as count from private.message_outbox where ticket_id=any($1::uuid[])',
    [ticketIds],
  )).rows[0].count as number;
  assert.deepEqual({ history, activities, receipts, outbox }, { history: 0, activities: 0, receipts: 0, outbox: 0 });
}

async function cleanupCommittedFixture(client: PoolClient, fixture: FixtureIds): Promise<void> {
  if (
    fixture.departments.length === 0
    && fixture.staff.length === 0
    && fixture.sessions.length === 0
    && fixture.conversations.length === 0
    && fixture.tickets.length === 0
  ) return;

  await client.query('begin');
  try {
    await client.query(
      `delete from private.delivery_attempts a
       using private.message_outbox o
       where a.outbox_id=o.id and (
         o.ticket_id=any($1::uuid[]) or o.line_session_id=any($2::uuid[]) or o.recipient_staff_id=any($3::uuid[])
       )`,
      [fixture.tickets, fixture.sessions, fixture.staff],
    );
    await client.query(
      `delete from private.message_outbox
       where ticket_id=any($1::uuid[]) or line_session_id=any($2::uuid[]) or recipient_staff_id=any($3::uuid[])`,
      [fixture.tickets, fixture.sessions, fixture.staff],
    );
    await client.query(
      'delete from private.staff_action_tokens where ticket_id=any($1::uuid[]) or staff_id=any($2::uuid[])',
      [fixture.tickets, fixture.staff],
    );
    await client.query(
      'delete from private.ticket_action_receipts where ticket_id=any($1::uuid[]) or staff_id=any($2::uuid[])',
      [fixture.tickets, fixture.staff],
    );
    await client.query('delete from private.pending_route_choices where line_session_id=any($1::uuid[])', [fixture.sessions]);
    await client.query('delete from private.activities where ticket_id=any($1::uuid[])', [fixture.tickets]);
    await client.query('delete from private.staff_line_identities where staff_id=any($1::uuid[])', [fixture.staff]);
    await client.query(
      'delete from public.ticket_history where ticket_id=any($1::uuid[]) or actor_id=any($2::uuid[])',
      [fixture.tickets, fixture.staff],
    );
    await client.query(
      'delete from public.messages where ticket_id=any($1::uuid[]) or conversation_id=any($2::uuid[]) or sender_staff_id=any($3::uuid[])',
      [fixture.tickets, fixture.conversations, fixture.staff],
    );
    await client.query('update public.conversations set active_ticket_id=null where id=any($1::uuid[])', [fixture.conversations]);
    await client.query('delete from public.tickets where id=any($1::uuid[])', [fixture.tickets]);
    await client.query('delete from public.conversations where id=any($1::uuid[])', [fixture.conversations]);
    await client.query('delete from private.line_identities where line_session_id=any($1::uuid[])', [fixture.sessions]);
    await client.query('delete from public.line_sessions where id=any($1::uuid[])', [fixture.sessions]);
    await client.query('delete from public.staff_department_grants where staff_id=any($1::uuid[])', [fixture.staff]);
    await client.query('delete from public.staff_profiles where id=any($1::uuid[])', [fixture.staff]);
    await client.query('delete from auth.users where id=any($1::uuid[])', [fixture.staff]);
    await client.query('delete from public.departments where id=any($1::uuid[])', [fixture.departments]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function seedStaffBinding(
  client: PoolClient,
  staffId: string,
  userId: string,
  key: string,
): Promise<void> {
  await client.query(
    `insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted)
     values($1,$2,$3)`,
    [staffId, hashStaffLineUserId(userId, key), encryptValue(userId, key)],
  );
}

async function seedStaffToken(
  client: PoolClient,
  input: { staffId: string; ticketId: string; token: string; revision: number; expiresSql?: string },
  key: string,
): Promise<string> {
  const hash = hashOpaqueToken(input.token, key, 'staff-command');
  const expiry = input.expiresSql ?? "clock_timestamp()+interval '30 minutes'";
  await client.query(
    `insert into private.staff_action_tokens(token_hash,staff_id,ticket_id,action,expected_revision,expires_at)
     values($1,$2,$3,'ACCEPT',$4,${expiry})`,
    [hash, input.staffId, input.ticketId, input.revision],
  );
  return hash;
}

function staffCommandEvent(userId: string, token: string): DirectUserEvent {
  return {
    type: 'postback',
    source: { type: 'user', userId },
    postback: { data: `yru:staff:accept:${token}` },
  };
}

function decodeOutboxPayload(encrypted: string, key: string): StoredOutboxPayload {
  assert.match(encrypted, /^v1\./, 'outbox payload must use the versioned encryption envelope');
  return JSON.parse(decryptValue(encrypted, key)) as StoredOutboxPayload;
}

async function assertStoredOpaqueAcceptToken(
  client: PoolClient,
  message: StoredOutboxPayload['messages'][number],
  staffId: string,
  ticketId: string,
  key: string,
): Promise<string> {
  const data = message.quickReply?.items[0]?.action.data;
  assert.equal(typeof data, 'string');
  const match = /^yru:staff:accept:([A-Za-z0-9_-]{43})$/.exec(data!);
  assert.ok(match, 'notification action must contain only an opaque accept token');
  const token = match[1];
  assert.ok(token);
  assert.notEqual(token, staffId);
  assert.notEqual(token, ticketId);
  const hash = hashOpaqueToken(token, key, 'staff-command');
  assert.notEqual(hash, token);
  assert.equal((await client.query(
    `select count(*)::int as count from private.staff_action_tokens
     where token_hash=$1 and staff_id=$2 and ticket_id=$3 and action='ACCEPT'`,
    [hash, staffId, ticketId],
  )).rows[0].count, 1, 'token is represented by a purpose-separated hash in the private token table');
  return token;
}

async function studentArtifactSnapshot(client: PoolClient): Promise<{ sessions: number; identities: number; messages: number }> {
  const row = (await client.query(`select
    (select count(*)::int from public.line_sessions) as sessions,
    (select count(*)::int from private.line_identities) as identities,
    (select count(*)::int from public.messages) as messages`)).rows[0];
  return row as { sessions: number; identities: number; messages: number };
}

after(async () => {
  await pool.end();
});

test('createEscalation keeps HUMAN ticket effects in the caller transaction', async () => {
  const client = await pool.connect();
  const fixture = newFixture();
  const key = makeKey();
  let conversationId = '';
  try {
    await client.query('begin');
    const department = await seedDepartment(client, fixture);
    const sessionId = await seedSession(client, fixture);
    conversationId = await seedConversation(client, fixture, sessionId, 'AI');
    await client.query('commit');

    await client.query('begin');
    const ticket = await createEscalation(client, {
      sessionId,
      conversationId,
      departmentCode: department.code,
      summary: 'Explicitly requested staff help',
    }, key);
    const state = (await client.query(
      `select t.status,t.mode,t.revision,c.mode as conversation_mode,c.status as conversation_status,
         c.conversation_type,c.active_ticket_id
       from public.tickets t join public.conversations c on c.id=t.conversation_id where t.id=$1`,
      [ticket.id],
    )).rows[0];
    assert.deepEqual(state, {
      status: 'WAITING_STAFF',
      mode: 'HUMAN',
      revision: 0,
      conversation_mode: 'HUMAN',
      conversation_status: 'ACTIVE',
      conversation_type: 'TICKET',
      active_ticket_id: ticket.id,
    });
    assert.equal((await client.query(
      "select count(*)::int as count from public.ticket_history where ticket_id=$1 and action in ('CREATED','ROUTED')",
      [ticket.id],
    )).rows[0].count, 2);
    assert.equal((await client.query(
      'select count(*)::int as count from private.activities where ticket_id=$1',
      [ticket.id],
    )).rows[0].count, 2);
    assert.equal((await client.query(
      "select count(*)::int as count from private.message_outbox where ticket_id=$1 and channel='STUDENT' and kind='SYSTEM'",
      [ticket.id],
    )).rows[0].count, 1);

    await client.query('rollback');
    assert.equal((await client.query('select count(*)::int as count from public.tickets where id=$1', [ticket.id])).rows[0].count, 0);
    assert.equal((await client.query('select count(*)::int as count from public.ticket_history where ticket_id=$1', [ticket.id])).rows[0].count, 0);
    assert.equal((await client.query('select count(*)::int as count from private.message_outbox where ticket_id=$1', [ticket.id])).rows[0].count, 0);
    assert.deepEqual((await client.query(
      'select mode,status,conversation_type,active_ticket_id from public.conversations where id=$1',
      [conversationId],
    )).rows[0], { mode: 'AI', status: 'ACTIVE', conversation_type: 'TICKET', active_ticket_id: null });
  } finally {
    await client.query('rollback').catch(() => undefined);
    await cleanupCommittedFixture(client, fixture);
    client.release();
  }
});

test('two concurrent authorized accepts produce one winner and one ACCEPTED audit', async () => {
  const setup = await pool.connect();
  const first = await pool.connect();
  const second = await pool.connect();
  const fixture = newFixture();
  const key = makeKey();
  try {
    await setup.query('begin');
    const department = await seedDepartment(setup, fixture);
    const staffA = await seedStaff(setup, fixture, { departmentId: department.id });
    const staffB = await seedStaff(setup, fixture, { departmentId: department.id });
    const ticket = await seedTicket(setup, fixture, { departmentId: department.id, status: 'WAITING_STAFF' });
    await setup.query('commit');

    type AcceptOutcome =
      | { kind: 'accepted'; result: Awaited<ReturnType<typeof applyTicketAction>> }
      | { kind: 'error'; error: unknown };
    const accept = async (client: PoolClient, staffId: string): Promise<AcceptOutcome> => {
      await client.query('begin');
      try {
        const result = await applyTicketAction(client, staffId, ticket.id, 'ACCEPT', {
          revision: 0,
          requestId: randomUUID(),
        }, key);
        await client.query('commit');
        return { kind: 'accepted', result };
      } catch (error) {
        await client.query('rollback');
        return { kind: 'error', error };
      }
    };
    const attempts = await Promise.all([accept(first, staffA), accept(second, staffB)]);
    const winners = attempts.filter(attempt => attempt.kind === 'accepted');
    const conflicts = attempts.filter(attempt => attempt.kind === 'error'
      && attempt.error instanceof TicketError
      && attempt.error.code === 'CONFLICT');
    assert.equal(winners.length, 1);
    assert.equal(conflicts.length, 1);
    const winner = winners[0];
    assert.ok(winner);
    if (winner.kind !== 'accepted') throw new Error('Expected one accepted outcome');
    assert.equal(winner.result.status, 'STAFF_HANDLING');
    assert.equal(winner.result.revision, 1);

    assert.equal((await setup.query(
      "select count(*)::int as count from public.ticket_history where ticket_id=$1 and action='ACCEPTED'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.equal((await setup.query(
      "select count(*)::int as count from private.activities where ticket_id=$1 and action='ACCEPTED'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.equal((await setup.query(
      "select count(*)::int as count from private.ticket_action_receipts where ticket_id=$1 and action='ACCEPT'",
      [ticket.id],
    )).rows[0].count, 1);
    const final = (await setup.query('select status,revision,assigned_staff_id,mode from public.tickets where id=$1', [ticket.id])).rows[0];
    assert.equal(final.status, 'STAFF_HANDLING');
    assert.equal(final.revision, 1);
    assert.ok([staffA, staffB].includes(final.assigned_staff_id));
    assert.equal(final.mode, 'HUMAN');
  } finally {
    await Promise.all([
      setup.query('rollback').catch(() => undefined),
      first.query('rollback').catch(() => undefined),
      second.query('rollback').catch(() => undefined),
    ]);
    await cleanupCommittedFixture(setup, fixture);
    first.release();
    second.release();
    setup.release();
  }
});

test('department, Admin grant, active-profile, and restricted-scope denials leave no ticket effects', async () => {
  await withRollback(async client => {
    const fixture = newFixture();
    const home = await seedDepartment(client, fixture);
    const other = await seedDepartment(client, fixture);
    const wrongDepartmentStaff = await seedStaff(client, fixture, { departmentId: other.id });
    const ungrantedAdmin = await seedStaff(client, fixture, { departmentId: null, role: 'ADMIN' });
    const inactiveStaff = await seedStaff(client, fixture, { departmentId: home.id, active: false });
    const noRestrictedAccess = await seedStaff(client, fixture, { departmentId: home.id });
    const generalTicket = await seedTicket(client, fixture, { departmentId: home.id });
    const restrictedTicket = await seedTicket(client, fixture, {
      departmentId: home.id,
      sensitivity: 'RESTRICTED',
    });

    await expectTicketError(client, 'NOT_FOUND', () => applyTicketAction(
      client, wrongDepartmentStaff, generalTicket.id, 'ACCEPT', { revision: 0, requestId: randomUUID() }, makeKey(),
    ));
    await expectTicketError(client, 'NOT_FOUND', () => applyTicketAction(
      client, ungrantedAdmin, generalTicket.id, 'ACCEPT', { revision: 0, requestId: randomUUID() }, makeKey(),
    ));
    await expectTicketError(client, 'NOT_FOUND', () => applyTicketAction(
      client, inactiveStaff, generalTicket.id, 'ACCEPT', { revision: 0, requestId: randomUUID() }, makeKey(),
    ));
    await expectTicketError(client, 'NOT_FOUND', () => applyTicketAction(
      client, noRestrictedAccess, restrictedTicket.id, 'ACCEPT', { revision: 0, requestId: randomUUID() }, makeKey(),
    ));

    for (const ticket of [generalTicket, restrictedTicket]) {
      const state = (await client.query('select status,mode,revision,assigned_staff_id from public.tickets where id=$1', [ticket.id])).rows[0];
      assert.deepEqual(state, { status: 'WAITING_STAFF', mode: 'HUMAN', revision: 0, assigned_staff_id: null });
    }
    await assertNoTicketEffects(client, [generalTicket.id, restrictedTicket.id]);
  });
});

test('ordinary Staff who are not assignees cannot reply, resolve, close, reassign, or reopen', async () => {
  await withRollback(async client => {
    const fixture = newFixture();
    const department = await seedDepartment(client, fixture);
    const caller = await seedStaff(client, fixture, { departmentId: department.id });
    const assignee = await seedStaff(client, fixture, { departmentId: department.id });
    const replacement = await seedStaff(client, fixture, { departmentId: department.id });
    const replyTicket = await seedTicket(client, fixture, {
      departmentId: department.id, status: 'STAFF_HANDLING', assignedStaffId: assignee,
    });
    const resolveTicket = await seedTicket(client, fixture, {
      departmentId: department.id, status: 'STAFF_HANDLING', assignedStaffId: assignee,
    });
    const closeTicket = await seedTicket(client, fixture, {
      departmentId: department.id, status: 'RESOLVED', assignedStaffId: assignee,
    });
    const reassignTicket = await seedTicket(client, fixture, { departmentId: department.id });
    const reopenTicket = await seedTicket(client, fixture, {
      departmentId: department.id, status: 'CLOSED', assignedStaffId: assignee,
    });
    const attempts = [
      { ticket: replyTicket, action: 'STAFF_REPLY' as const, input: { revision: 0, requestId: randomUUID(), text: 'Not assigned' } },
      { ticket: resolveTicket, action: 'RESOLVE' as const, input: { revision: 0, requestId: randomUUID() } },
      { ticket: closeTicket, action: 'CLOSE' as const, input: { revision: 0, requestId: randomUUID() } },
      { ticket: reassignTicket, action: 'REASSIGN' as const, input: { revision: 0, requestId: randomUUID(), assigneeId: replacement } },
      { ticket: reopenTicket, action: 'REOPEN' as const, input: { revision: 0, requestId: randomUUID(), reason: 'Not authorized' } },
    ];

    for (const attempt of attempts) {
      await expectTicketError(client, 'NOT_FOUND', () => applyTicketAction(
        client, caller, attempt.ticket.id, attempt.action, attempt.input, makeKey(),
      ));
      const row = (await client.query('select status,revision,assigned_staff_id,mode from public.tickets where id=$1', [attempt.ticket.id])).rows[0];
      assert.equal(row.revision, 0);
      assert.equal(row.assigned_staff_id, attempt.action === 'REASSIGN' ? null : assignee);
      assert.equal(row.mode, 'HUMAN');
    }
    await assertNoTicketEffects(client, attempts.map(attempt => attempt.ticket.id));
  });
});

test('staff reply is idempotent, changed bodies conflict, and stale revisions do not add effects', async () => {
  await withRollback(async client => {
    const fixture = newFixture();
    const department = await seedDepartment(client, fixture);
    const staff = await seedStaff(client, fixture, { departmentId: department.id });
    const ticket = await seedTicket(client, fixture, {
      departmentId: department.id,
      status: 'STAFF_HANDLING',
      assignedStaffId: staff,
    });
    const key = makeKey();
    const requestId = randomUUID();
    const input = { revision: 0, requestId, text: 'Please visit the service desk.' };
    const first = await applyTicketAction(client, staff, ticket.id, 'STAFF_REPLY', input, key);
    const duplicate = await applyTicketAction(client, staff, ticket.id, 'STAFF_REPLY', input, key);
    assert.deepEqual(duplicate, first);
    assert.equal(first.status, 'WAITING_USER');
    assert.equal(first.revision, 1);

    await expectTicketError(client, 'CONFLICT', () => applyTicketAction(
      client, staff, ticket.id, 'STAFF_REPLY', { ...input, text: 'Changed text on the same request.' }, key,
    ));
    await expectTicketError(client, 'CONFLICT', () => applyTicketAction(
      client, staff, ticket.id, 'STAFF_REPLY', { revision: 0, requestId: randomUUID(), text: 'Stale retry.' }, key,
    ));

    assert.equal((await client.query(
      "select count(*)::int as count from public.messages where ticket_id=$1 and sender_type='STAFF'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.equal((await client.query(
      "select count(*)::int as count from public.ticket_history where ticket_id=$1 and action='STAFF_REPLIED'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.equal((await client.query(
      "select count(*)::int as count from private.activities where ticket_id=$1 and action='STAFF_REPLIED'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.equal((await client.query(
      "select count(*)::int as count from private.message_outbox where ticket_id=$1 and channel='STUDENT' and kind='STAFF'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.equal((await client.query(
      "select count(*)::int as count from private.ticket_action_receipts where ticket_id=$1 and action='STAFF_REPLY'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.deepEqual((await client.query('select status,revision,assigned_staff_id,mode from public.tickets where id=$1', [ticket.id])).rows[0], {
      status: 'WAITING_USER', revision: 1, assigned_staff_id: staff, mode: 'HUMAN',
    });
  });
});

test('resolve, close, and reasoned scoped reopen preserve HUMAN and clear assignment', async () => {
  await withRollback(async client => {
    const fixture = newFixture();
    const department = await seedDepartment(client, fixture);
    const supervisor = await seedStaff(client, fixture, { departmentId: department.id, role: 'SUPERVISOR' });
    const ticket = await seedTicket(client, fixture, {
      departmentId: department.id,
      status: 'STAFF_HANDLING',
      assignedStaffId: supervisor,
    });
    const key = makeKey();

    const resolved = await applyTicketAction(client, supervisor, ticket.id, 'RESOLVE', {
      revision: 0, requestId: randomUUID(), reason: 'Guidance provided',
    }, key);
    assert.deepEqual(resolved, { id: ticket.id, status: 'RESOLVED', revision: 1 });
    const closed = await applyTicketAction(client, supervisor, ticket.id, 'CLOSE', {
      revision: 1, requestId: randomUUID(),
    }, key);
    assert.deepEqual(closed, { id: ticket.id, status: 'CLOSED', revision: 2 });
    const reopened = await applyTicketAction(client, supervisor, ticket.id, 'REOPEN', {
      revision: 2, requestId: randomUUID(), reason: 'Student supplied new information',
    }, key);
    assert.deepEqual(reopened, { id: ticket.id, status: 'WAITING_STAFF', revision: 3 });

    assert.deepEqual((await client.query('select status,mode,revision,assigned_staff_id from public.tickets where id=$1', [ticket.id])).rows[0], {
      status: 'WAITING_STAFF', mode: 'HUMAN', revision: 3, assigned_staff_id: null,
    });
    assert.deepEqual((await client.query('select mode,status,active_ticket_id from public.conversations where id=$1', [ticket.conversationId])).rows[0], {
      mode: 'HUMAN', status: 'ACTIVE', active_ticket_id: ticket.id,
    });
    const history = (await client.query(
      'select action,from_status,to_status,metadata from public.ticket_history where ticket_id=$1 order by created_at,id',
      [ticket.id],
    )).rows;
    assert.deepEqual(Object.fromEntries(history.map(row => [row.action, [row.from_status, row.to_status]])), {
      RESOLVED: ['STAFF_HANDLING', 'RESOLVED'],
      CLOSED: ['RESOLVED', 'CLOSED'],
      REOPENED: ['CLOSED', 'WAITING_STAFF'],
    });
    assert.equal(history.find(row => row.action === 'REOPENED')?.metadata.reason, 'Student supplied new information');
    assert.equal((await client.query("select count(*)::int as count from public.tickets where id=$1 and status='REOPENED'", [ticket.id])).rows[0].count, 0);
    assert.deepEqual((await client.query(
      "select action,count(*)::int as count from private.activities where ticket_id=$1 group by action order by action",
      [ticket.id],
    )).rows, [
      { action: 'CLOSED', count: 1 },
      { action: 'REOPENED', count: 1 },
      { action: 'RESOLVED', count: 1 },
    ]);
  });
});

test('reassignment accepts only active eligible targets in the same restricted scope', async () => {
  await withRollback(async client => {
    const fixture = newFixture();
    const department = await seedDepartment(client, fixture);
    const otherDepartment = await seedDepartment(client, fixture);
    const supervisor = await seedStaff(client, fixture, {
      departmentId: department.id, role: 'SUPERVISOR', canViewRestricted: true,
    });
    const eligible = await seedStaff(client, fixture, {
      departmentId: department.id, canViewRestricted: true,
    });
    const noRestricted = await seedStaff(client, fixture, { departmentId: department.id });
    const inactive = await seedStaff(client, fixture, {
      departmentId: department.id, active: false, canViewRestricted: true,
    });
    const wrongDepartment = await seedStaff(client, fixture, {
      departmentId: otherDepartment.id, canViewRestricted: true,
    });
    const ticket = await seedTicket(client, fixture, {
      departmentId: department.id,
      status: 'STAFF_HANDLING',
      sensitivity: 'RESTRICTED',
      assignedStaffId: supervisor,
    });
    const unaccepted = await seedTicket(client, fixture, {
      departmentId: department.id,
      status: 'WAITING_STAFF',
      sensitivity: 'RESTRICTED',
    });
    const key = makeKey();
    const assigned = await applyTicketAction(client, supervisor, ticket.id, 'REASSIGN', {
      revision: 0, requestId: randomUUID(), assigneeId: eligible,
    }, key);
    assert.deepEqual(assigned, { id: ticket.id, status: 'STAFF_HANDLING', revision: 1 });

    for (const assigneeId of [noRestricted, inactive, wrongDepartment]) {
      await expectTicketError(client, 'NOT_FOUND', () => applyTicketAction(
        client, supervisor, ticket.id, 'REASSIGN', {
          revision: 1, requestId: randomUUID(), assigneeId,
        }, key,
      ));
    }
    assert.deepEqual((await client.query('select status,revision,assigned_staff_id from public.tickets where id=$1', [ticket.id])).rows[0], {
      status: 'STAFF_HANDLING', revision: 1, assigned_staff_id: eligible,
    });
    assert.equal((await client.query(
      "select count(*)::int as count from public.ticket_history where ticket_id=$1 and action='REASSIGNED'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.equal((await client.query(
      "select count(*)::int as count from private.activities where ticket_id=$1 and action='REASSIGNED'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.equal((await client.query(
      "select count(*)::int as count from private.ticket_action_receipts where ticket_id=$1 and action='REASSIGN'",
      [ticket.id],
    )).rows[0].count, 1);

    await expectTicketError(client, 'INVALID_ACTION', () => applyTicketAction(
      client, supervisor, unaccepted.id, 'REASSIGN', {
        revision: 0, requestId: randomUUID(), assigneeId: eligible,
      }, key,
    ));
    assert.deepEqual((await client.query('select status,revision,assigned_staff_id from public.tickets where id=$1', [unaccepted.id])).rows[0], {
      status: 'WAITING_STAFF', revision: 0, assigned_staff_id: null,
    });
    await assertNoTicketEffects(client, [unaccepted.id]);
  });
});

test('Staff command rejects unbound, wrong-binding, forged, expired, and stale accept tokens', async () => {
  await withRollback(async client => {
    const fixture = newFixture();
    const department = await seedDepartment(client, fixture);
    const staff = await seedStaff(client, fixture, { departmentId: department.id });
    const otherStaff = await seedStaff(client, fixture, { departmentId: department.id });
    const ticket = await seedTicket(client, fixture, { departmentId: department.id });
    const key = makeKey();
    const staffUserId = `U${randomUUID().replaceAll('-', '')}`;
    const otherUserId = `U${randomUUID().replaceAll('-', '')}`;
    const unboundUserId = `U${randomUUID().replaceAll('-', '')}`;
    await seedStaffBinding(client, staff, staffUserId, key);
    await seedStaffBinding(client, otherStaff, otherUserId, key);

    const boundToken = randomBytes(32).toString('base64url');
    const expiredToken = randomBytes(32).toString('base64url');
    const staleToken = randomBytes(32).toString('base64url');
    await seedStaffToken(client, { staffId: staff, ticketId: ticket.id, token: boundToken, revision: 0 }, key);
    await seedStaffToken(client, {
      staffId: staff, ticketId: ticket.id, token: expiredToken, revision: 0,
      expiresSql: "clock_timestamp()-interval '1 minute'",
    }, key);
    const staleHash = await seedStaffToken(client, {
      staffId: staff, ticketId: ticket.id, token: staleToken, revision: 9,
    }, key);
    const forgedToken = randomBytes(32).toString('base64url');
    const before = await studentArtifactSnapshot(client);

    assert.equal(await processStaffCommand(client, staffCommandEvent(unboundUserId, boundToken), key), 'UNBOUND_STAFF');
    assert.equal(await processStaffCommand(client, staffCommandEvent(otherUserId, boundToken), key), 'INVALID_STAFF_COMMAND');
    assert.equal(await processStaffCommand(client, staffCommandEvent(staffUserId, forgedToken), key), 'INVALID_STAFF_COMMAND');
    assert.equal(await processStaffCommand(client, staffCommandEvent(staffUserId, expiredToken), key), 'INVALID_STAFF_COMMAND');
    assert.equal(await processStaffCommand(client, staffCommandEvent(staffUserId, staleToken), key), 'STAFF_COMMAND_DENIED');

    assert.deepEqual(await studentArtifactSnapshot(client), before);
    assert.equal((await client.query('select count(*)::int as count from private.line_identities where user_hash=$1', [hashLineUserId(staffUserId, key)])).rows[0].count, 0);
    assert.deepEqual((await client.query('select status,revision,assigned_staff_id from public.tickets where id=$1', [ticket.id])).rows[0], {
      status: 'WAITING_STAFF', revision: 0, assigned_staff_id: null,
    });
    await assertNoTicketEffects(client, [ticket.id]);
    assert.equal((await client.query('select consumed_at from private.staff_action_tokens where token_hash=$1', [staleHash])).rows[0].consumed_at, null);
  });
});

test('bound active Staff accepts once; command creates no Student identity, session, or message', async () => {
  await withRollback(async client => {
    const fixture = newFixture();
    const department = await seedDepartment(client, fixture);
    const staff = await seedStaff(client, fixture, { departmentId: department.id });
    const ticket = await seedTicket(client, fixture, { departmentId: department.id });
    const key = makeKey();
    const userId = `U${randomUUID().replaceAll('-', '')}`;
    const token = randomBytes(32).toString('base64url');
    await seedStaffBinding(client, staff, userId, key);
    const tokenHash = await seedStaffToken(client, {
      staffId: staff, ticketId: ticket.id, token, revision: 0,
    }, key);
    const before = await studentArtifactSnapshot(client);

    assert.equal(await processStaffCommand(client, staffCommandEvent(userId, token), key), null);
    assert.equal(await processStaffCommand(client, staffCommandEvent(userId, token), key), 'INVALID_STAFF_COMMAND');

    assert.deepEqual(await studentArtifactSnapshot(client), before);
    assert.equal((await client.query('select count(*)::int as count from private.line_identities where user_hash=$1', [hashLineUserId(userId, key)])).rows[0].count, 0);
    assert.deepEqual((await client.query('select status,mode,revision,assigned_staff_id from public.tickets where id=$1', [ticket.id])).rows[0], {
      status: 'STAFF_HANDLING', mode: 'HUMAN', revision: 1, assigned_staff_id: staff,
    });
    assert.equal((await client.query(
      "select count(*)::int as count from public.ticket_history where ticket_id=$1 and action='ACCEPTED'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.equal((await client.query(
      "select count(*)::int as count from private.activities where ticket_id=$1 and action='ACCEPTED'",
      [ticket.id],
    )).rows[0].count, 1);
    assert.ok((await client.query('select consumed_at from private.staff_action_tokens where token_hash=$1', [tokenHash])).rows[0].consumed_at);
  });
});

test('createEscalation notifies only active bound in-scope Staff one recipient at a time', async () => {
  await withRollback(async client => {
    const fixture = newFixture();
    const department = await seedDepartment(client, fixture);
    const otherDepartment = await seedDepartment(client, fixture);
    const activeStaff = await seedStaff(client, fixture, { departmentId: department.id });
    const grantedAdmin = await seedStaff(client, fixture, { departmentId: null, role: 'ADMIN' });
    const superAdmin = await seedStaff(client, fixture, { departmentId: null, role: 'SUPER_ADMIN' });
    const wrongDepartment = await seedStaff(client, fixture, { departmentId: otherDepartment.id });
    const ungrantedAdmin = await seedStaff(client, fixture, { departmentId: null, role: 'ADMIN' });
    const inactiveStaff = await seedStaff(client, fixture, { departmentId: department.id, active: false });
    await client.query(
      'insert into public.staff_department_grants(staff_id,department_id) values($1,$2)',
      [grantedAdmin, department.id],
    );
    const key = makeKey();
    const rawLineIds: string[] = [];
    for (const staffId of [activeStaff, grantedAdmin, superAdmin, wrongDepartment, ungrantedAdmin, inactiveStaff]) {
      const lineId = `U${randomUUID().replaceAll('-', '')}`;
      rawLineIds.push(lineId);
      await seedStaffBinding(client, staffId, lineId, key);
    }
    const sessionId = await seedSession(client, fixture);
    const conversationId = await seedConversation(client, fixture, sessionId, 'AI');
    const anonymousCode = (await client.query('select anonymous_code from public.line_sessions where id=$1', [sessionId])).rows[0].anonymous_code as string;
    const summary = `GENERAL_PRIVATE_SUMMARY_${randomUUID()}`;
    const ticket = await createEscalation(client, {
      sessionId,
      conversationId,
      departmentCode: department.code,
      summary,
    }, key);
    const storedTicket = (await client.query('select ticket_no from public.tickets where id=$1', [ticket.id])).rows[0];
    const notifications = (await client.query(
      `select recipient_staff_id,channel,kind,line_session_id,conversation_id,ticket_id,delivery_mode,payload_encrypted
       from private.message_outbox where ticket_id=$1 and kind='NOTIFICATION' order by recipient_staff_id`,
      [ticket.id],
    )).rows;
    assert.equal(notifications.length, 3, 'one private notification is created for each eligible recipient');
    assert.deepEqual(
      notifications.map(row => row.recipient_staff_id),
      [activeStaff, grantedAdmin, superAdmin].sort(),
    );
    for (const row of notifications) {
      assert.equal(row.channel, 'STAFF');
      assert.equal(row.kind, 'NOTIFICATION');
      assert.equal(row.ticket_id, ticket.id);
      assert.equal(row.line_session_id, null, 'a Staff notification is not a Student session broadcast');
      assert.equal(row.conversation_id, null);
      assert.equal(row.delivery_mode, 'PUSH');
      const payload = decodeOutboxPayload(row.payload_encrypted, key);
      assert.equal(payload.messages.length, 1);
      assert.ok(payload.messages[0]);
      assert.equal(payload.messages[0].text, `มีงานใหม่ ${storedTicket.ticket_no} · ความสำคัญ MEDIUM\nเปิดแดชบอร์ดเพื่อดูรายละเอียด`);
      assert.equal(payload.messages[0].text.includes(summary), false);
      assert.equal(payload.messages[0].text.includes(anonymousCode), false);
      for (const rawLineId of rawLineIds) assert.equal(payload.messages[0].text.includes(rawLineId), false);
      const token = await assertStoredOpaqueAcceptToken(client, payload.messages[0], row.recipient_staff_id, ticket.id, key);
      assert.equal(row.payload_encrypted.includes(token), false, 'the stored payload remains encrypted');
    }
    assert.equal((await client.query(
      "select count(*)::int as count from private.message_outbox where ticket_id=$1 and channel='STAFF' and recipient_staff_id is null",
      [ticket.id],
    )).rows[0].count, 0, 'no channel-wide Staff broadcast is enqueued');
  });
});

test('restricted Staff notification stays generic, encrypted, and scoped to bound eligible recipients', async () => {
  await withRollback(async client => {
    const fixture = newFixture();
    const department = await seedDepartment(client, fixture);
    const otherDepartment = await seedDepartment(client, fixture);
    const restrictedStaff = await seedStaff(client, fixture, {
      departmentId: department.id, canViewRestricted: true,
    });
    const grantedAdmin = await seedStaff(client, fixture, {
      departmentId: null, role: 'ADMIN', canViewRestricted: true,
    });
    const superAdmin = await seedStaff(client, fixture, { departmentId: null, role: 'SUPER_ADMIN' });
    const noRestrictedAccess = await seedStaff(client, fixture, { departmentId: department.id });
    const restrictedAdminWithoutFlag = await seedStaff(client, fixture, {
      departmentId: null, role: 'ADMIN',
    });
    const wrongDepartment = await seedStaff(client, fixture, {
      departmentId: otherDepartment.id, canViewRestricted: true,
    });
    const ungrantedAdmin = await seedStaff(client, fixture, {
      departmentId: null, role: 'ADMIN', canViewRestricted: true,
    });
    const inactiveStaff = await seedStaff(client, fixture, {
      departmentId: department.id, active: false, canViewRestricted: true,
    });
    await client.query(
      'insert into public.staff_department_grants(staff_id,department_id) values($1,$2)',
      [grantedAdmin, department.id],
    );
    await client.query(
      'insert into public.staff_department_grants(staff_id,department_id) values($1,$2)',
      [restrictedAdminWithoutFlag, department.id],
    );
    const key = makeKey();
    const rawLineIds: string[] = [];
    const allStaff = [
      restrictedStaff,
      grantedAdmin,
      superAdmin,
      noRestrictedAccess,
      restrictedAdminWithoutFlag,
      wrongDepartment,
      ungrantedAdmin,
      inactiveStaff,
    ];
    for (const staffId of allStaff) {
      const lineId = `U${randomUUID().replaceAll('-', '')}`;
      rawLineIds.push(lineId);
      await seedStaffBinding(client, staffId, lineId, key);
    }
    const ticket = await seedTicket(client, fixture, {
      departmentId: department.id, sensitivity: 'RESTRICTED',
    });
    const summary = `RESTRICTED_PRIVATE_SUMMARY_${randomUUID()}`;
    await client.query('update public.tickets set problem_summary=$2 where id=$1', [ticket.id, summary]);
    const anonymousCode = (await client.query(
      'select anonymous_code from public.line_sessions where id=$1',
      [ticket.sessionId],
    )).rows[0].anonymous_code as string;
    const ticketData = (await client.query(
      'select id,ticket_no,department_id,sensitive_level,priority,revision from public.tickets where id=$1',
      [ticket.id],
    )).rows[0];
    await notifyTicketStaff(client, ticketData, key);

    const notifications = (await client.query(
      `select recipient_staff_id,channel,kind,line_session_id,conversation_id,ticket_id,delivery_mode,payload_encrypted
       from private.message_outbox where ticket_id=$1 and kind='NOTIFICATION' order by recipient_staff_id`,
      [ticket.id],
    )).rows;
    assert.equal(notifications.length, 3);
    assert.deepEqual(notifications.map(row => row.recipient_staff_id), [restrictedStaff, grantedAdmin, superAdmin].sort());
    const genericText = 'มีงานที่ต้องตรวจสอบ กรุณาเข้าสู่แดชบอร์ดตามสิทธิ์ของคุณ';
    for (const row of notifications) {
      assert.equal(row.channel, 'STAFF');
      assert.equal(row.kind, 'NOTIFICATION');
      assert.equal(row.ticket_id, ticket.id);
      assert.equal(row.line_session_id, null);
      assert.equal(row.conversation_id, null);
      assert.equal(row.delivery_mode, 'PUSH');
      const payload = decodeOutboxPayload(row.payload_encrypted, key);
      assert.equal(payload.replyToken, undefined);
      assert.equal(payload.messages.length, 1);
      assert.ok(payload.messages[0]);
      assert.equal(payload.messages[0].text, genericText);
      for (const privateValue of [summary, anonymousCode, ticket.id, row.recipient_staff_id, ...rawLineIds]) {
        assert.equal(payload.messages[0].text.includes(privateValue), false);
      }
      const token = await assertStoredOpaqueAcceptToken(client, payload.messages[0], row.recipient_staff_id, ticket.id, key);
      assert.equal(row.payload_encrypted.includes(token), false);
      for (const privateValue of [summary, anonymousCode, ticket.id, row.recipient_staff_id, ...rawLineIds]) {
        assert.equal(row.payload_encrypted.includes(privateValue), false);
      }
    }
    assert.equal((await client.query(
      "select count(*)::int as count from private.message_outbox where ticket_id=$1 and channel='STAFF' and recipient_staff_id is null",
      [ticket.id],
    )).rows[0].count, 0);
  });
});

test('M4 private ticket, token, identity, activity, and delivery tables deny anon/authenticated grants', async () => {
  await withRollback(async client => {
    const tableNames = [
      'activities',
      'ticket_action_receipts',
      'pending_route_choices',
      'staff_line_identities',
      'staff_action_tokens',
      'message_outbox',
      'delivery_attempts',
    ];
    const schema = (await client.query(`select
      has_schema_privilege('anon','private','USAGE') as anon_usage,
      has_schema_privilege('authenticated','private','USAGE') as authenticated_usage,
      has_schema_privilege('service_role','private','USAGE') as service_usage`)).rows[0];
    assert.deepEqual(schema, { anon_usage: false, authenticated_usage: true, service_usage: true });

    const historySequence = (await client.query(`select
      has_sequence_privilege('anon','public.ticket_history_history_seq_seq','USAGE') as anon_usage,
      has_sequence_privilege('anon','public.ticket_history_history_seq_seq','SELECT') as anon_select,
      has_sequence_privilege('anon','public.ticket_history_history_seq_seq','UPDATE') as anon_update,
      has_sequence_privilege('authenticated','public.ticket_history_history_seq_seq','USAGE') as authenticated_usage,
      has_sequence_privilege('authenticated','public.ticket_history_history_seq_seq','SELECT') as authenticated_select,
      has_sequence_privilege('authenticated','public.ticket_history_history_seq_seq','UPDATE') as authenticated_update,
      has_sequence_privilege('service_role','public.ticket_history_history_seq_seq','USAGE') as service_usage,
      has_sequence_privilege('service_role','public.ticket_history_history_seq_seq','SELECT') as service_select`)).rows[0];
    assert.deepEqual(historySequence, {
      anon_usage: false,
      anon_select: false,
      anon_update: false,
      authenticated_usage: false,
      authenticated_select: false,
      authenticated_update: false,
      service_usage: true,
      service_select: true,
    });

    const rows = (await client.query(
      `select c.relname,c.relrowsecurity,
        has_table_privilege('anon',c.oid,'SELECT') as anon_select,
        has_table_privilege('anon',c.oid,'INSERT') as anon_insert,
        has_table_privilege('anon',c.oid,'UPDATE') as anon_update,
        has_table_privilege('anon',c.oid,'DELETE') as anon_delete,
        has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
        has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert,
        has_table_privilege('authenticated',c.oid,'UPDATE') as authenticated_update,
        has_table_privilege('authenticated',c.oid,'DELETE') as authenticated_delete,
        has_table_privilege('service_role',c.oid,'SELECT') as service_select,
        has_table_privilege('service_role',c.oid,'INSERT') as service_insert,
        has_table_privilege('service_role',c.oid,'UPDATE') as service_update,
        has_table_privilege('service_role',c.oid,'DELETE') as service_delete
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='private' and c.relkind='r' and c.relname=any($1::text[])
       order by c.relname`,
      [tableNames],
    )).rows;
    assert.deepEqual(rows.map(row => row.relname), [...tableNames].sort());
    for (const row of rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} should have RLS enabled`);
      for (const privilege of ['select', 'insert', 'update', 'delete']) {
        assert.equal(row[`anon_${privilege}`], false, `anon ${privilege} must be revoked on ${row.relname}`);
        assert.equal(row[`authenticated_${privilege}`], false, `authenticated ${privilege} must be revoked on ${row.relname}`);
        assert.equal(row[`service_${privilege}`], true, `service_role ${privilege} must be granted on ${row.relname}`);
      }
    }
  });
});
