import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { encryptValue } from '../../lib/security/identity';
import {
  incidentReplyOptionsSchema,
  incidentReplyPreviewSchema,
} from '../../lib/incidents/batch-reply-contracts';
import {
  getIncidentReplyOptions,
  previewIncidentReply,
  revalidateIncidentReplyPreview,
} from '../../lib/incidents/batch-preview';

const database = process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database && /^yru_structured_schema_[a-f0-9]{12}$/.test(database), 'OWNED_DATABASE_REQUIRED');
const pool = new Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:54422/${database}`,
  max: 4,
  application_name: 'incident-batch-preview-owned-qa',
});
const key = Buffer.alloc(32, 81).toString('base64');
const departmentIds: string[] = [];
const staffIds: string[] = [];
const ticketIds: string[] = [];
const incidentIds: string[] = [];
const sessionIds: string[] = [];
const conversationIds: string[] = [];
const privateMarkers: string[] = [];

after(async () => {
  try {
    if (ticketIds.length) {
      await pool.query(
        `update public.tickets set status='CANCELLED'
          where id=any($1::uuid[]) and status not in ('CANCELLED','CLOSED','RESOLVED')`,
        [ticketIds],
      );
    }
    if (staffIds.length) {
      await pool.query('update public.staff_profiles set active=false where id=any($1::uuid[])', [staffIds]);
    }
    if (departmentIds.length) {
      await pool.query('update public.departments set active=false where id=any($1::uuid[])', [departmentIds]);
    }
  } finally {
    await pool.end();
  }
});

type TicketStatus = 'WAITING_STAFF' | 'STAFF_HANDLING' | 'WAITING_USER' | 'CLOSED' | 'AI_HANDLING';
type DepartmentKey = 'main' | 'foreign';

interface CaseSpec {
  name: string;
  assigned: 'actor' | 'other' | 'supervisor' | 'foreign' | null;
  status: TicketStatus;
  sensitivity?: 'GENERAL' | 'SENSITIVE' | 'RESTRICTED';
  mode?: 'HUMAN' | 'AI';
  department?: DepartmentKey;
  session?: string;
  messages?: number;
  cursorAfter?: number;
}

interface CaseRow {
  id: string;
  conversationId: string;
  sessionId: string;
  ticketCode: string;
  name: string;
}

interface BatchFixture {
  actorId: string;
  supervisorId: string;
  otherStaffId: string;
  foreignStaffId: string;
  departments: Record<DepartmentKey, string>;
  incidentId: string;
  foreignIncidentId: string;
  cases: Record<string, CaseRow>;
  foreignCases: CaseRow[];
  addCase(spec: CaseSpec): Promise<CaseRow>;
  addIncident(departmentId: string, members: CaseRow[]): Promise<string>;
}

function letters(): string {
  return randomUUID().replaceAll('-', '').toUpperCase().replace(/[0-9]/gu, digit => String.fromCharCode(65 + Number(digit)));
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof Error && 'code' in error && error.code === code;
}

function input(ticketIds: string[], options: { intervention?: boolean; text?: string } = {}) {
  return {
    requestId: randomUUID(),
    ticketIds,
    text: options.text ?? 'The shared network service is being investigated. We will send another update here.',
    intervention: options.intervention ?? false,
  };
}

async function seedStaff(
  departmentId: string,
  role: 'STAFF' | 'SUPERVISOR',
  canViewSensitive: boolean,
): Promise<string> {
  const id = randomUUID();
  staffIds.push(id);
  await pool.query('insert into auth.users(id) values($1)', [id]);
  await pool.query(
    `insert into public.staff_profiles(id,department_id,role,display_name,active,can_view_sensitive,can_view_restricted)
     values($1,$2,$3,$4,true,$5,false)`,
    [id, departmentId, role, `Batch preview fixture ${letters().slice(0, 8)}`, canViewSensitive],
  );
  return id;
}

async function createFixture(): Promise<BatchFixture> {
  const departments: Record<DepartmentKey, string> = { main: '', foreign: '' };
  for (const keyName of ['main', 'foreign'] as const) {
    const code = `BATCH_QA_${letters().slice(0, 30)}`;
    const result = await pool.query(
      'insert into public.departments(code,name_th,name_en) values($1,$2,$3) returning id',
      [code, `แผนกทดสอบ ${code}`, `Owned batch preview ${code}`],
    );
    departments[keyName] = result.rows[0].id as string;
    departmentIds.push(departments[keyName]);
  }

  const actorId = await seedStaff(departments.main, 'STAFF', true);
  const supervisorId = await seedStaff(departments.main, 'SUPERVISOR', true);
  const otherStaffId = await seedStaff(departments.main, 'STAFF', false);
  const foreignStaffId = await seedStaff(departments.foreign, 'STAFF', false);
  const cases: Record<string, CaseRow> = {};
  const sessionByAlias = new Map<string, string>();

  const addCase = async (spec: CaseSpec): Promise<CaseRow> => {
    const departmentId = departments[spec.department ?? 'main'];
    const sessionAlias = spec.session ?? `${spec.name}-session`;
    let sessionId = sessionByAlias.get(`${spec.department ?? 'main'}:${sessionAlias}`);
    if (!sessionId) {
      const session = await pool.query(
        'insert into public.line_sessions(anonymous_code) values($1) returning id',
        [`BATCH_ANON_${letters()}`],
      );
      sessionId = session.rows[0].id as string;
      sessionByAlias.set(`${spec.department ?? 'main'}:${sessionAlias}`, sessionId);
      sessionIds.push(sessionId);
    }
    const mode = spec.mode ?? 'HUMAN';
    const conversationStatus = spec.status === 'CLOSED' ? 'CLOSED' : spec.status === 'WAITING_USER' ? 'WAITING' : 'ACTIVE';
    const conversation = await pool.query(
      `insert into public.conversations(line_session_id,conversation_type,mode,status)
       values($1,'TICKET',$2,$3) returning id`,
      [sessionId, mode, conversationStatus],
    );
    const conversationId = conversation.rows[0].id as string;
    conversationIds.push(conversationId);
    const assignedStaffId = spec.assigned === 'actor' ? actorId
      : spec.assigned === 'supervisor' ? supervisorId
        : spec.assigned === 'other' ? otherStaffId
          : spec.assigned === 'foreign' ? foreignStaffId
            : null;
    const ticket = await pool.query(
      `insert into public.tickets
         (line_session_id,conversation_id,department_id,problem_summary,category,mode,status,sensitive_level,assigned_staff_id)
       values($1,$2,$3,$4,'IT_NETWORK',$5,$6,$7,$8) returning id,ticket_no,revision`,
      [sessionId, conversationId, departmentId, `BATCH_PRIVATE_SUMMARY_${letters()}`, mode, spec.status,
        spec.sensitivity ?? 'GENERAL', assignedStaffId],
    );
    const row = ticket.rows[0] as { id: string; ticket_no: string; revision: number };
    ticketIds.push(row.id);
    await pool.query('update public.conversations set active_ticket_id=$2 where id=$1', [conversationId, row.id]);

    const messageSeqs: string[] = [];
    for (let index = 0; index < (spec.messages ?? 0); index++) {
      const marker = `BATCH_PRIVATE_USER_MESSAGE_${letters()}`;
      privateMarkers.push(marker);
      const message = await pool.query(
        `insert into public.messages(conversation_id,ticket_id,sender_type,content)
         values($1,$2,'USER',$3) returning id`,
        [conversationId, row.id, marker],
      );
      const order = await pool.query(
        'select message_seq::text from private.staff_chat_message_order where message_id=$1',
        [message.rows[0].id],
      );
      assert.ok(order.rows[0]?.message_seq, 'each fixture USER message has its installed ordered source mapping');
      messageSeqs.push(order.rows[0].message_seq as string);
    }
    if (spec.cursorAfter && messageSeqs[spec.cursorAfter - 1]) {
      await pool.query(
        `insert into private.staff_chat_read_cursors(staff_id,ticket_id,read_through_seq)
         values($1,$2,$3)`,
        [actorId, row.id, messageSeqs[spec.cursorAfter - 1]],
      );
    }
    return { id: row.id, conversationId, sessionId, ticketCode: row.ticket_no, name: spec.name };
  };

  const addIncident = async (departmentId: string, members: CaseRow[]): Promise<string> => {
    const incidentId = randomUUID();
    incidentIds.push(incidentId);
    const distinctSessions = new Set(members.map(member => member.sessionId)).size;
    await pool.query(
      `insert into public.incidents
        (id,department_id,title,category,status,severity,sensitive_level,report_count,distinct_session_count,first_report_at,last_report_at)
       values($1,$2,'Owned batch preview incident','IT_NETWORK','INVESTIGATING','HIGH','GENERAL',$3,$4,clock_timestamp(),clock_timestamp())`,
      [incidentId, departmentId, Math.max(2, members.length), Math.max(2, distinctSessions)],
    );
    for (const member of members) {
      const revision = (await pool.query('select revision from public.tickets where id=$1', [member.id])).rows[0].revision;
      await pool.query(
        `insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score)
         values($1,$2,$3,.93)`,
        [incidentId, member.id, revision],
      );
    }
    return incidentId;
  };

  const specs: CaseSpec[] = [
    { name: 'own-active', assigned: 'actor', status: 'STAFF_HANDLING', session: 'shared', messages: 2, cursorAfter: 1 },
    { name: 'own-waiting-user', assigned: 'actor', status: 'WAITING_USER', session: 'shared', messages: 1 },
    { name: 'other-assignee', assigned: 'other', status: 'STAFF_HANDLING', messages: 1 },
    { name: 'unassigned', assigned: null, status: 'WAITING_STAFF', messages: 1 },
    { name: 'private', assigned: 'actor', status: 'STAFF_HANDLING', sensitivity: 'SENSITIVE', messages: 1 },
    { name: 'closed', assigned: 'actor', status: 'CLOSED', messages: 1 },
    { name: 'not-human', assigned: 'actor', status: 'AI_HANDLING', mode: 'AI', messages: 1 },
  ];
  for (const spec of specs) cases[spec.name] = await addCase(spec);
  const incidentId = await addIncident(departments.main, Object.values(cases));
  const foreignCasesSeeded = [
    await addCase({ name: 'foreign-one', department: 'foreign', assigned: 'foreign', status: 'STAFF_HANDLING' }),
    await addCase({ name: 'foreign-two', department: 'foreign', assigned: 'foreign', status: 'WAITING_USER' }),
  ];
  const foreignIncidentId = await addIncident(departments.foreign, foreignCasesSeeded);

  return {
    actorId, supervisorId, otherStaffId, foreignStaffId, departments, incidentId, foreignIncidentId,
    cases, foreignCases: foreignCasesSeeded, addCase, addIncident,
  };
}

async function sideEffects(fixture: BatchFixture): Promise<unknown> {
  const selectedIds = [...Object.values(fixture.cases), ...fixture.foreignCases].map(row => row.id);
  const [messages, outbox, history, tickets, incidents, memberships] = await Promise.all([
    pool.query('select count(*)::int count from public.messages where ticket_id=any($1::uuid[])', [selectedIds]),
    pool.query('select count(*)::int count from private.message_outbox where ticket_id=any($1::uuid[])', [selectedIds]),
    pool.query('select count(*)::int count from public.ticket_history where ticket_id=any($1::uuid[])', [selectedIds]),
    pool.query(
      `select id,status,revision,assigned_staff_id,staff_line_epoch from public.tickets
        where id=any($1::uuid[]) order by id`, [selectedIds],
    ),
    pool.query('select id,status,revision from public.incidents where id=any($1::uuid[]) order by id', [incidentIds]),
    pool.query(
      `select incident_id,ticket_id,ticket_revision from public.incident_tickets
        where incident_id=any($1::uuid[]) order by incident_id,ticket_id`, [incidentIds],
    ),
  ]);
  return {
    messages: messages.rows[0].count,
    outbox: outbox.rows[0].count,
    history: history.rows[0].count,
    tickets: tickets.rows,
    incidents: incidents.rows,
    memberships: memberships.rows,
  };
}

test('options give a safe complete scoped snapshot and count distinct sessions and unread USER sources', async () => {
  const fixture = await createFixture();
  const options = await getIncidentReplyOptions(fixture.actorId, fixture.incidentId, { pool, key });
  assert.equal(incidentReplyOptionsSchema.safeParse(options).success, true);
  assert.equal(options.incidentId, fixture.incidentId);
  assert.equal(options.items.length, 7, 'every visible current member appears, including ineligible members');
  assert.deepEqual(options.workload, {
    memberCases: 7,
    activeCases: 6,
    anonymousSessions: 6,
    activeAnonymousSessions: 5,
    unassignedCases: 1,
    assignedStaff: 2,
    pendingUserMessages: 6,
  });

  const byId = new Map(options.items.map(item => [item.ticketId, item]));
  assert.equal(byId.get(fixture.cases['own-active']!.id)?.eligibility, 'OWN_CASE');
  assert.equal(byId.get(fixture.cases['own-active']!.id)?.pendingUserMessages, 1,
    'the actor read cursor excludes only the USER source rows already acknowledged');
  assert.equal(byId.get(fixture.cases['own-waiting-user']!.id)?.eligibility, 'OWN_CASE');
  assert.equal(byId.get(fixture.cases['own-waiting-user']!.id)?.pendingUserMessages, 1);
  assert.equal(byId.get(fixture.cases['other-assignee']!.id)?.eligibility, 'OTHER_ASSIGNEE');
  assert.equal(byId.get(fixture.cases.unassigned!.id)?.eligibility, 'UNASSIGNED');
  assert.equal(byId.get(fixture.cases.private!.id)?.eligibility, 'PRIVATE_CASE');
  assert.equal(byId.get(fixture.cases.closed!.id)?.eligibility, 'INACTIVE_CASE');
  assert.equal(byId.get(fixture.cases['not-human']!.id)?.eligibility, 'NOT_HUMAN');

  const projection = JSON.stringify(options);
  for (const id of [...sessionIds, ...conversationIds, ...privateMarkers]) assert.equal(projection.includes(id), false);
  assert.equal(projection.includes(fixture.actorId), false);
  assert.equal(projection.includes(fixture.supervisorId), false);
  assert.equal(projection.includes(fixture.otherStaffId), false);
  assert.equal(projection.includes(fixture.foreignStaffId), false);
});

test('preview requires explicit recipients, deduplicates sessions, and makes no send or ticket side effects', async () => {
  const fixture = await createFixture();
  const before = await sideEffects(fixture);
  const selected = [fixture.cases['own-active']!.id, fixture.cases['own-waiting-user']!.id];
  const request = input(selected, { text: 'A checked shared update for these two cases.' });
  const preview = await previewIncidentReply(fixture.actorId, fixture.incidentId, request, { pool, key });

  assert.equal(incidentReplyPreviewSchema.safeParse(preview).success, true);
  assert.equal(preview.status, 'REVIEW_ONLY');
  assert.equal(preview.requestId, request.requestId);
  assert.equal(preview.caseCount, 2);
  assert.equal(preview.cases.length, 2);
  assert.equal(preview.recipientCount, 1, 'two selected tickets on one LINE session yield one recipient');
  assert.equal(preview.commonText, request.text);
  assert.equal(preview.intervention, false);
  assert.equal(preview.deliveries.length, 1);
  assert.equal(preview.deliveries[0]!.recipientCode, 'R1');
  assert.deepEqual(preview.deliveries[0]!.cases, preview.cases);
  assert.equal(preview.deliveries[0]!.messages.map(message => message.text).join(''),
    `อัปเดตเคส: ${preview.cases.map(item => item.ticketCode).join(', ')}\n\n${request.text}`);
  const serialized = JSON.stringify(preview);
  for (const id of [...sessionIds, ...conversationIds, ...privateMarkers, fixture.actorId, fixture.otherStaffId]) {
    assert.equal(serialized.includes(id), false);
  }
  assert.equal(serialized.includes('previewReceiptPlaintext'), false);

  const preparation = await revalidateIncidentReplyPreview(
    fixture.actorId, fixture.incidentId, preview.previewReceipt, { pool, key },
  );
  assert.equal(preparation.status, 'REVIEW_ONLY');
  assert.equal(preparation.requestId, request.requestId);
  assert.equal(preparation.caseCount, 2);
  assert.deepEqual(await sideEffects(fixture), before);
});

test('exact packet preview partitions multiple sessions without cross-recipient labels and is request-order stable', async () => {
  const fixture = await createFixture();
  const extra = await fixture.addCase({name:'another-own-session',assigned:'actor',status:'STAFF_HANDLING'});
  await pool.query('insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score) select $1,id,revision,.93 from public.tickets where id=$2', [fixture.incidentId,extra.id]);
  const ids = [fixture.cases['own-active']!.id,fixture.cases['own-waiting-user']!.id,extra.id];
  const text = 'ต้นข้อความ '+ 'รายละเอียดการแก้ไข'.repeat(160)+' ท้ายข้อความ';
  const request = input(ids, {text});
  const before = await sideEffects(fixture);
  const first = await previewIncidentReply(fixture.actorId,fixture.incidentId,request,{pool,key});
  const reordered = await previewIncidentReply(fixture.actorId,fixture.incidentId,{...request,ticketIds:[...ids].reverse()},{pool,key});
  assert.deepEqual(first.deliveries,reordered.deliveries);assert.equal(first.deliveries.length,2);
  assert.deepEqual(first.deliveries.map(delivery=>delivery.cases.length).sort(),[1,2]);
  for(const delivery of first.deliveries){
    const whole=delivery.messages.map(message=>message.text).join('');
    assert.equal(whole,`อัปเดตเคส: ${delivery.cases.map(item=>item.ticketCode).join(', ')}\n\n${text}`);
    assert(delivery.messages.every(message=>message.text.length<=5000));
    for(const other of first.cases.filter(item=>!delivery.cases.some(own=>own.ticketId===item.ticketId)))assert(!whole.includes(other.ticketCode));
  }
  await revalidateIncidentReplyPreview(fixture.actorId,fixture.incidentId,first.previewReceipt,{pool,key});
  assert.deepEqual(await sideEffects(fixture),before);
});

test('a staff member cannot select another assignee, unassigned, private, closed, or AI case', async () => {
  const fixture = await createFixture();
  const ineligibleIds = [
    fixture.cases['other-assignee']!.id,
    fixture.cases.unassigned!.id,
    fixture.cases.private!.id,
    fixture.cases.closed!.id,
    fixture.cases['not-human']!.id,
  ];
  for (const ticketId of ineligibleIds) {
    await assert.rejects(
      previewIncidentReply(fixture.actorId, fixture.incidentId, input([ticketId]), { pool, key }),
      `ineligible case ${ticketId} must not enter a batch preview`,
    );
  }
  await assert.rejects(
    previewIncidentReply(fixture.actorId, fixture.incidentId,
      input([fixture.cases['other-assignee']!.id], { intervention: true }), { pool, key }),
    'ordinary staff cannot grant themselves supervisory intervention',
  );
});

test('an inactive session or a conversation no longer aligned to its ticket cannot be selected', async () => {
  const fixture = await createFixture();
  const selected = fixture.cases['own-active']!;
  await pool.query('update public.line_sessions set active=false where id=$1', [selected.sessionId]);
  const inactive = await getIncidentReplyOptions(fixture.actorId, fixture.incidentId, { pool, key });
  assert.equal(inactive.items.find(item => item.ticketId === selected.id)?.eligibility, 'INACTIVE_CASE');
  await assert.rejects(
    previewIncidentReply(fixture.actorId, fixture.incidentId, input([selected.id]), { pool, key }),
    'a case from an inactive anonymous session is not a recipient',
  );

  await pool.query('update public.line_sessions set active=true where id=$1', [selected.sessionId]);
  await pool.query('update public.conversations set active_ticket_id=null where id=$1', [selected.conversationId]);
  const misaligned = await getIncidentReplyOptions(fixture.actorId, fixture.incidentId, { pool, key });
  assert.equal(misaligned.items.find(item => item.ticketId === selected.id)?.eligibility, 'NOT_HUMAN');
  await assert.rejects(
    previewIncidentReply(fixture.actorId, fixture.incidentId, input([selected.id]), { pool, key }),
    'a conversation not aligned to the selected ticket is not a recipient',
  );
});

test('supervisors must explicitly attest intervention for another assigned case', async () => {
  const fixture = await createFixture();
  const options = await getIncidentReplyOptions(fixture.supervisorId, fixture.incidentId, { pool, key });
  assert.equal(options.canIntervene, true);
  const other = options.items.find(item => item.ticketId === fixture.cases['other-assignee']!.id);
  assert.equal(other?.eligibility, 'INTERVENTION_REQUIRED');

  await assert.rejects(
    previewIncidentReply(fixture.supervisorId, fixture.incidentId,
      input([fixture.cases['other-assignee']!.id]), { pool, key }),
    'a supervisor cannot use ordinary mode to reply for another assignee',
  );
  const preview = await previewIncidentReply(
    fixture.supervisorId,
    fixture.incidentId,
    input([fixture.cases['other-assignee']!.id], { intervention: true }),
    { pool, key },
  );
  assert.equal(preview.intervention, true);
  assert.equal(preview.caseCount, 1);
  assert.equal(preview.recipientCount, 1);
});

test('foreign incident membership and scope-hidden members are not disclosed', async () => {
  const fixture = await createFixture();
  await assert.rejects(
    getIncidentReplyOptions(fixture.actorId, fixture.foreignIncidentId, { pool, key }),
    errorCode('NOT_FOUND'),
  );
  await assert.rejects(
    getIncidentReplyOptions(fixture.otherStaffId, fixture.incidentId, { pool, key }),
    errorCode('NOT_FOUND'),
  );
});

test('revalidation conflicts when a new USER message arrives after the reviewed snapshot', async () => {
  const fixture = await createFixture();
  const preview = await previewIncidentReply(
    fixture.actorId, fixture.incidentId, input([fixture.cases['own-active']!.id]), { pool, key },
  );
  const marker = `BATCH_PRIVATE_LATE_USER_${letters()}`;
  privateMarkers.push(marker);
  await pool.query(
    `insert into public.messages(conversation_id,ticket_id,sender_type,content)
     values($1,$2,'USER',$3)`,
    [fixture.cases['own-active']!.conversationId, fixture.cases['own-active']!.id, marker],
  );
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, preview.previewReceipt, { pool, key }),
    errorCode('CONFLICT'),
  );
});

test('revalidation conflicts when a member is added after the reviewed snapshot', async () => {
  const fixture = await createFixture();
  const preview = await previewIncidentReply(
    fixture.actorId, fixture.incidentId, input([fixture.cases['own-active']!.id]), { pool, key },
  );
  const lateMember = await fixture.addCase({ name: 'late-member', assigned: 'actor', status: 'STAFF_HANDLING' });
  await pool.query(
    `insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score)
     select $1,id,revision,.93 from public.tickets where id=$2`,
    [fixture.incidentId, lateMember.id],
  );
  assert.equal((await pool.query('select count(*)::int count from public.incident_tickets where incident_id=$1', [fixture.incidentId])).rows[0].count, 8);
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, preview.previewReceipt, { pool, key }),
    errorCode('CONFLICT'),
  );
});

test('revalidation conflicts when a selected ticket is reassigned after preview', async () => {
  const fixture = await createFixture();
  const selected = fixture.cases['own-active']!;
  const preview = await previewIncidentReply(fixture.actorId, fixture.incidentId, input([selected.id]), { pool, key });
  await pool.query('update public.tickets set assigned_staff_id=$2 where id=$1', [selected.id, fixture.otherStaffId]);
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, preview.previewReceipt, { pool, key }),
    errorCode('CONFLICT'),
  );
});

test('revalidation fails closed after the actor is revoked', async () => {
  const fixture = await createFixture();
  const preview = await previewIncidentReply(
    fixture.actorId, fixture.incidentId, input([fixture.cases['own-active']!.id]), { pool, key },
  );
  await pool.query('update public.staff_profiles set active=false where id=$1', [fixture.actorId]);
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, preview.previewReceipt, { pool, key }),
    errorCode('NOT_FOUND'),
  );
});

test('tampered, wrong-actor, wrong-incident, and wrong-key receipts cannot revalidate', async () => {
  const fixture = await createFixture();
  const request = input([fixture.cases['own-active']!.id]);
  const preview = await previewIncidentReply(
    fixture.actorId, fixture.incidentId, request, { pool, key },
  );
  const tampered = `${preview.previewReceipt.slice(0, -1)}${preview.previewReceipt.endsWith('a') ? 'b' : 'a'}`;
  await assert.rejects(revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, tampered, { pool, key }));
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.supervisorId, fixture.incidentId, preview.previewReceipt, { pool, key }),
  );
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.actorId, fixture.foreignIncidentId, preview.previewReceipt, { pool, key }),
  );
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, preview.previewReceipt,
      { pool, key: Buffer.alloc(32, 82).toString('base64') }),
  );
  const now = Date.now();
  const wrongPurpose = encryptValue(JSON.stringify({
    purpose: 'another-purpose',
    actorId: fixture.actorId,
    incidentId: fixture.incidentId,
    selection: request,
    snapshotDigest: 'a'.repeat(64),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60_000).toISOString(),
  }), key);
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, wrongPurpose, { pool, key }),
    errorCode('CONFLICT'),
  );
  const expiredReceipt = encryptValue(JSON.stringify({
    purpose: 'incident-reply-preview-v1',
    actorId: fixture.actorId,
    incidentId: fixture.incidentId,
    selection: request,
    snapshotDigest: 'a'.repeat(64),
    issuedAt: new Date(now - 20 * 60_000).toISOString(),
    expiresAt: new Date(now - 10 * 60_000).toISOString(),
  }), key);
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, expiredReceipt, { pool, key }),
    errorCode('CONFLICT'),
  );
});

test('an acknowledged USER message without its ordered source mapping cannot authorize a preview', async () => {
  const fixture = await createFixture();
  const ticketId = fixture.cases['own-active']!.id;
  const acknowledged = (await pool.query(
    `select o.message_id id from private.staff_chat_message_order o
       join public.messages m on m.id=o.message_id and m.ticket_id=o.ticket_id and m.sender_type='USER'
      join private.staff_chat_read_cursors r on r.staff_id=$2 and r.ticket_id=o.ticket_id and o.message_seq<=r.read_through_seq
      where o.ticket_id=$1 order by o.message_seq limit 1`,
    [ticketId, fixture.actorId],
  )).rows[0];
  assert.ok(acknowledged, 'the fixture has an acknowledged USER source row');
  await pool.query('delete from private.staff_chat_message_order where message_id=$1', [acknowledged.id]);
  await assert.rejects(
    previewIncidentReply(fixture.actorId, fixture.incidentId, input([ticketId]), { pool, key }),
    'the options/preview path must reject incomplete USER-to-order mappings even before the latest message',
  );
});

test('a latest USER source mapping removed after preview invalidates both preview and receipt', async () => {
  const fixture = await createFixture();
  const ticketId = fixture.cases['own-active']!.id;
  const preview = await previewIncidentReply(
    fixture.actorId, fixture.incidentId, input([ticketId]), { pool, key },
  );
  const message = (await pool.query(
    `select o.message_id id from private.staff_chat_message_order o
       join public.messages m on m.id=o.message_id and m.ticket_id=o.ticket_id and m.sender_type='USER'
      where o.ticket_id=$1 order by o.message_seq desc limit 1`,
    [ticketId],
  )).rows[0];
  assert.ok(message);
  await pool.query('delete from private.staff_chat_message_order where message_id=$1', [message.id]);
  await assert.rejects(
    previewIncidentReply(fixture.actorId, fixture.incidentId, input([ticketId]), { pool, key }),
    'a missing USER source mapping must fail closed instead of undercounting the read cursor',
  );
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, preview.previewReceipt, { pool, key }),
    errorCode('CONFLICT'),
    'removing the ordered mapping after review changes the bound source snapshot',
  );
});

test('revalidation conflicts when a USER source order row is moved to another ticket', async () => {
  const fixture = await createFixture();
  const selected = fixture.cases['own-active']!;
  const preview = await previewIncidentReply(
    fixture.actorId, fixture.incidentId, input([selected.id]), { pool, key },
  );
  const latest = (await pool.query(
    `select o.message_id id from private.staff_chat_message_order o
       join public.messages m on m.id=o.message_id and m.ticket_id=o.ticket_id and m.sender_type='USER'
      where o.ticket_id=$1 order by o.message_seq desc limit 1`,
    [selected.id],
  )).rows[0];
  assert.ok(latest);
  await pool.query('update private.staff_chat_message_order set ticket_id=$2 where message_id=$1', [
    latest.id, fixture.cases['own-waiting-user']!.id,
  ]);
  await assert.rejects(
    revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, preview.previewReceipt, { pool, key }),
    errorCode('CONFLICT'),
  );
});

test('more than 500 current members fails closed instead of returning a truncated options list', async () => {
  const fixture = await createFixture();
  const sharedSession = (await pool.query(
    'insert into public.line_sessions(anonymous_code) values($1) returning id', [`BATCH_ANON_${letters()}`],
  )).rows[0].id as string;
  sessionIds.push(sharedSession);
  const inserted = await pool.query(
    `with generated as materialized (
       select gen_random_uuid() conversation_id,gen_random_uuid() ticket_id from generate_series(1,494)
     ), created_conversations as (
       insert into public.conversations(id,line_session_id,conversation_type,mode,status)
       select conversation_id,$1,'TICKET','HUMAN','ACTIVE' from generated returning id
     ), created_tickets as (
       insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,category,mode,status,sensitive_level,assigned_staff_id)
       select g.ticket_id,$1,g.conversation_id,$2,'BATCH_PRIVATE_OVERFLOW','IT_NETWORK','HUMAN','STAFF_HANDLING','GENERAL',$3
         from generated g join created_conversations c on c.id=g.conversation_id
       returning id,revision,conversation_id
     )
     insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score)
       select $4,id,revision,.93 from created_tickets returning ticket_id`,
    [sharedSession, fixture.departments.main, fixture.actorId, fixture.incidentId],
  );
  const addedTicketIds = inserted.rows.map(row => row.ticket_id as string);
  assert.equal(addedTicketIds.length, 494);
  ticketIds.push(...addedTicketIds);
  await pool.query(
    `update public.conversations c set active_ticket_id=t.id
       from public.tickets t where t.conversation_id=c.id and t.id=any($1::uuid[])`,
    [addedTicketIds],
  );
  await pool.query('update public.incidents set report_count=500 where id=$1', [fixture.incidentId]);
  assert.equal((await pool.query('select count(*)::int count from public.incident_tickets where incident_id=$1', [fixture.incidentId])).rows[0].count, 501);
  await assert.rejects(
    getIncidentReplyOptions(fixture.actorId, fixture.incidentId, { pool, key }),
    errorCode('UNAVAILABLE'),
    'a bounded read must not silently hide the 501st current member',
  );
});

// Root acceptance additions: logical state restored after an authority/membership
// change still requires a fresh recipient review, and ACK changes its source state.
test('a read acknowledgment after preview requires a fresh workload review', async () => {
  const fixture = await createFixture();
  const ticketId = fixture.cases['own-active']!.id;
  const preview = await previewIncidentReply(fixture.actorId, fixture.incidentId, input([ticketId]), { pool, key });
  await pool.query(`update private.staff_chat_read_cursors set read_through_seq=(
    select max(message_seq) from private.staff_chat_message_order where ticket_id=$2)
    where staff_id=$1 and ticket_id=$2`, [fixture.actorId, ticketId]);
  await assert.rejects(revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, preview.previewReceipt, { pool, key }), errorCode('CONFLICT'));
});

test('revoking and restoring an actor does not revive the old preview receipt', async () => {
  const fixture = await createFixture();
  const preview = await previewIncidentReply(fixture.actorId, fixture.incidentId, input([fixture.cases['own-active']!.id]), { pool, key });
  await pool.query('update public.staff_profiles set active=false where id=$1', [fixture.actorId]);
  await pool.query('update public.staff_profiles set active=true where id=$1', [fixture.actorId]);
  await assert.rejects(revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, preview.previewReceipt, { pool, key }), errorCode('CONFLICT'));
});

test('removing and restoring identical membership does not revive the old preview receipt', async () => {
  const fixture = await createFixture();
  const ticketId = fixture.cases['own-active']!.id;
  const preview = await previewIncidentReply(fixture.actorId, fixture.incidentId, input([ticketId]), { pool, key });
  const previous = (await pool.query('delete from public.incident_tickets where incident_id=$1 and ticket_id=$2 returning ticket_revision,similarity_score', [fixture.incidentId, ticketId])).rows[0];
  await pool.query('insert into public.incident_tickets(incident_id,ticket_id,ticket_revision,similarity_score) values($1,$2,$3,$4)', [fixture.incidentId, ticketId, previous.ticket_revision, previous.similarity_score]);
  await assert.rejects(revalidateIncidentReplyPreview(fixture.actorId, fixture.incidentId, preview.previewReceipt, { pool, key }), errorCode('CONFLICT'));
});

