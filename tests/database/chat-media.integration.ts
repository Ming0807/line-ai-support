import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { encryptValue, hashLineUserId } from '../../lib/security/identity';
import { registerStudentChatAttachment, revokeStudentChatAttachment, claimChatAttachment, finishChatAttachment, failChatAttachment } from '../../lib/chat/media-repository';
import { inspectChatMedia, openChatMedia, type ChatMediaRef, type ChatMediaStorage } from '../../lib/chat/media-binary';
import { runChatMediaCycle } from '../../lib/chat/media-worker';
import { readStaffChatAttachment } from '../../lib/chat/media-access';
import { readThread } from '../../lib/chat/service';
import { processStudentContent } from '../../lib/conversation/student-processing';
import { userEventSchema } from '../../lib/line/events';
import { processInboxEvent, type InboxJob } from '../../lib/queue/process-inbox';

const database = process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert.match(database ?? '', /^yru_structured_schema_[a-f0-9]{12}$/u, 'tests require the fixed isolated owned database');
const connectionString = `postgresql://postgres:postgres@127.0.0.1:54422/${database}`;
const key = randomBytes(32).toString('base64');
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 1_000 });

type MediaKind = 'IMAGE' | 'FILE';
type SourceMessage = {
  type: 'message';
  source: { type: 'user'; userId: string };
  message: { type: 'image' | 'file'; id: string; fileName?: string; fileSize?: number; contentProvider?: { type: 'line' } };
  replyToken: string;
};
type StudentIdentity = { userId: string; userHash: string };
type StudentFixture = StudentIdentity & { sessionId: string };

const pdfBytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const malformedJpeg = Uint8Array.from([0xff, 0xd8, 0xff, ...new Array(26).fill(0), 0xff, 0xda, 0xff, 0xd9]);

async function validJpegBytes(): Promise<Uint8Array> {
  return Uint8Array.from(await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 128, g: 64, b: 192 } } }).jpeg().toBuffer());
}

function makeStudentIdentity(userId = `U${randomUUID().replaceAll('-', '')}`): StudentIdentity {
  return { userId, userHash: hashLineUserId(userId, key) };
}

async function createStudentSession(identity: StudentIdentity): Promise<StudentFixture> {
  const sessionId = (await pool.query(
    'insert into public.line_sessions(anonymous_code) values($1) returning id',
    [`Chat media ${randomUUID()}`],
  )).rows[0].id as string;
  await pool.query(
    'insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
    [sessionId, identity.userHash, encryptValue(identity.userId, key)],
  );
  return { ...identity, sessionId };
}

async function makeUnsendInboxJob(identity: StudentIdentity, lineMessageId: string): Promise<InboxJob> {
  const event = {
    type: 'unsend',
    source: { type: 'user', userId: identity.userId },
    unsend: { messageId: lineMessageId },
    timestamp: Date.now(),
  };
  const row = (await pool.query(
    `insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,lease_token,lease_until,attempts)
     values('STUDENT',$1,$2,$3,'OTHER','PROCESSING',$4,clock_timestamp()+interval '30 seconds',1) returning *`,
    [randomUUID(), identity.userHash, encryptValue(JSON.stringify(event), key), randomUUID()],
  )).rows[0];
  return row as InboxJob;
}

async function processOwnedInboxJob(job: InboxJob): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await processInboxEvent(client, job, key, { aiEnabled: false });
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function makeStudentMediaSource(
  kind: MediaKind,
  metadata: { fileName?: string; fileSize?: number } = {},
  options: { assignedStaffId?: string; student?: StudentFixture; lineMessageId?: string } = {},
) {
  const student = options.student ?? await createStudentSession(makeStudentIdentity());
  const { userId, userHash, sessionId } = student;
  const type = kind === 'IMAGE' ? 'image' : 'file';
  const message: SourceMessage['message'] = {
    type,
    id: options.lineMessageId ?? `line-${randomUUID()}`,
    contentProvider: { type: 'line' },
    ...(kind === 'FILE' ? { fileName: metadata.fileName ?? 'report.pdf', fileSize: metadata.fileSize ?? 64 } : {}),
  };
  const event: SourceMessage = {
    type: 'message',
    source: { type: 'user', userId },
    message,
    replyToken: `reply-${randomUUID()}`,
  };
  const sourceEventId = (await pool.query(
    `insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind)
     values('STUDENT',$1,$2,$3,'MESSAGE') returning id`,
    [randomUUID(), userHash, encryptValue(JSON.stringify(event), key)],
  )).rows[0].id as string;
  const conversationId = (await pool.query(
    `insert into public.conversations(line_session_id,conversation_type,mode,status,topic)
     values($1,$2,$3,'ACTIVE','media fixture') returning id`,
    [sessionId, options.assignedStaffId ? 'TICKET' : 'GENERAL', options.assignedStaffId ? 'HUMAN' : 'AI'],
  )).rows[0].id as string;
  let ticketId: string | null = null;
  if (options.assignedStaffId) {
    const department = (await pool.query('select id from public.departments where code=$1 and active', ['IT'])).rows[0];
    assert.ok(department);
    ticketId = (await pool.query(
      `insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status,assigned_staff_id)
       values($1,$2,$3,'media access fixture','HUMAN','WAITING_STAFF',$4) returning id`,
      [sessionId, conversationId, department.id, options.assignedStaffId],
    )).rows[0].id as string;
    await pool.query('update public.conversations set active_ticket_id=$2 where id=$1', [conversationId, ticketId]);
  }
  const messageId = (await pool.query(
    `insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content,line_message_id,source_event_id)
     values($1,$2,'USER',$3,$4,$5,$6) returning id`,
    [conversationId, ticketId, kind, kind === 'IMAGE' ? '[ไฟล์แนบ]' : '[เอกสารแนบ]', message.id, sourceEventId],
  )).rows[0].id as string;
  return { sessionId, userId, userHash, conversationId, ticketId, messageId, sourceEventId, lineMessageId: message.id, event };
}

async function makeStaffProfile(departmentCode: 'IT' | 'LIBRARY', active = true) {
  const staffId = randomUUID();
  await pool.query('insert into auth.users(id,email) values($1,$2)', [staffId, `${staffId}@example.invalid`]);
  const departmentId = (await pool.query('select id from public.departments where code=$1 and active', [departmentCode])).rows[0]?.id;
  assert.ok(departmentId, `the seeded ${departmentCode} department is active`);
  await pool.query(
    `insert into public.staff_profiles(id,department_id,display_name,role,active)
     values($1,$2,'Chat media fixture','STAFF',$3)`,
    [staffId, departmentId, active],
  );
  return staffId;
}

function chatRef(claim: NonNullable<Awaited<ReturnType<typeof claimChatAttachment>>>, bytes: Uint8Array, contentType: string): ChatMediaRef {
  return {
    attachmentId: claim.id,
    messageId: claim.messageId,
    sourceEventId: claim.sourceEventId,
    objectId: claim.leaseToken,
    ...inspectChatMedia(bytes, contentType, claim.kind, claim.source.declaredBytes),
  };
}

after(async () => pool.end());

test('private attachment schema exists after migration replay', async () => {
  const relation = (await pool.query(`select to_regclass('private.chat_attachments')::text as table_name`)).rows[0];
  assert.ok(relation?.table_name, 'the private.chat_attachments table must be created by an additive migration');
});

test('attachment metadata is private and has RLS with no browser read path', async () => {
  const privileges = (await pool.query(`select c.relrowsecurity,
    has_table_privilege('anon','private.chat_attachments','SELECT') as anon_read,
    has_table_privilege('authenticated','private.chat_attachments','SELECT') as authenticated_read,
    has_table_privilege('anon','private.chat_attachments','INSERT,UPDATE,DELETE') as anon_write,
    has_table_privilege('authenticated','private.chat_attachments','INSERT,UPDATE,DELETE') as authenticated_write,
    has_table_privilege('service_role','private.chat_attachments','SELECT,INSERT,UPDATE') as service_access
    from pg_class c where c.oid='private.chat_attachments'::regclass`)).rows[0];
  assert.equal(privileges.relrowsecurity, true, 'private attachment rows use RLS');
  assert.equal(privileges.anon_read, false);
  assert.equal(privileges.authenticated_read, false);
  assert.equal(privileges.anon_write, false);
  assert.equal(privileges.authenticated_write, false);
  assert.equal(privileges.service_access, true, 'the backend service role can operate the queue');
  assert.equal((await pool.query(`select count(*)::int as count from pg_policies where schemaname='private' and tablename='chat_attachments'`)).rows[0].count, 0,
    'there is no browser-facing RLS policy for attachment metadata');

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await assert.rejects(client.query('select * from private.chat_attachments'), /permission denied/u,
      'authenticated users cannot read encrypted source metadata');
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
});

test('verified Student processing registers file metadata from the encrypted source event', async () => {
  const userId = `U${randomUUID().replaceAll('-', '')}`;
  const userHash = hashLineUserId(userId, key);
  const sessionId = (await pool.query(
    'insert into public.line_sessions(anonymous_code) values($1) returning id',
    [`Processed media ${randomUUID()}`],
  )).rows[0].id as string;
  await pool.query(
    'insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
    [sessionId, userHash, encryptValue(userId, key)],
  );
  const rawEvent: SourceMessage = {
    type: 'message',
    source: { type: 'user', userId },
    message: { type: 'file', id: `line-${randomUUID()}`, fileName: 'Course handout.pdf', fileSize: pdfBytes.length, contentProvider: { type: 'line' } },
    replyToken: `reply-${randomUUID()}`,
  };
  const eventRow = (await pool.query(
    `insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind)
     values('STUDENT',$1,$2,$3,'MESSAGE') returning id,received_at`,
    [randomUUID(), userHash, encryptValue(JSON.stringify(rawEvent), key)],
  )).rows[0];
  const parsedEvent = userEventSchema.parse(rawEvent);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await processStudentContent(client, {
      sessionId,
      eventId: eventRow.id,
      receivedAt: eventRow.received_at,
      event: parsedEvent,
    }, key, { aiEnabled: false });
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const message = (await pool.query('select id,message_type,source_event_id from public.messages where line_message_id=$1', [rawEvent.message.id])).rows[0];
  assert.ok(message);
  assert.equal(message.message_type, 'FILE');
  assert.equal(message.source_event_id, eventRow.id);
  const attachment = (await pool.query('select id,kind,status,source_encrypted from private.chat_attachments where message_id=$1', [message.id])).rows[0];
  assert.ok(attachment, 'the durable USER message receives a private attachment queue row in its processing transaction');
  assert.equal(attachment.kind, 'FILE');
  assert.equal(attachment.status, 'PENDING');
  assert.equal(attachment.source_encrypted.includes('Course handout.pdf'), false);
  const claim = await claimChatAttachment(pool, key);
  assert.ok(claim);
  assert.equal(claim.id, attachment.id);
  assert.equal(claim.source.lineMessageId, rawEvent.message.id);
  assert.equal(claim.source.fileName, 'Course handout.pdf');
  assert.equal(claim.source.declaredBytes, pdfBytes.length);
  assert.equal(await failChatAttachment(pool, claim, 'NOT_FOUND'), true);
});

test('registration verifies the encrypted Student source and is idempotent per USER message', async () => {
  const fixture = await makeStudentMediaSource('FILE', { fileName: '../finance/\u0007report.pdf', fileSize: pdfBytes.length });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await registerStudentChatAttachment(client, { messageId: fixture.messageId, sourceEventId: fixture.sourceEventId }, key);
    await registerStudentChatAttachment(client, { messageId: fixture.messageId, sourceEventId: fixture.sourceEventId }, key);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const row = (await pool.query(
    'select id,message_id,source_event_id,kind,source_encrypted,status,attempts from private.chat_attachments where message_id=$1',
    [fixture.messageId],
  )).rows[0];
  assert.ok(row, 'a verified LINE file creates one private attachment job');
  assert.equal(row.kind, 'FILE');
  assert.equal(row.status, 'PENDING');
  assert.equal(row.attempts, 0);
  assert.equal(row.source_event_id, fixture.sourceEventId);
  assert.equal(row.source_encrypted.includes('report.pdf'), false, 'original metadata is not stored in plaintext');
  assert.equal((await pool.query('select count(*)::int as count from private.chat_attachments where message_id=$1', [fixture.messageId])).rows[0].count, 1,
    'replaying registration cannot create a second queue row');

  const claim = await claimChatAttachment(pool, key);
  assert.ok(claim);
  assert.equal(claim.id, row.id);
  assert.equal(claim.messageId, fixture.messageId);
  assert.equal(claim.sourceEventId, fixture.sourceEventId);
  assert.equal(claim.kind, 'FILE');
  assert.equal(claim.source.lineMessageId, fixture.lineMessageId);
  assert.equal(claim.source.fileName, 'financereport.pdf');
  assert.equal(claim.source.declaredBytes, pdfBytes.length);
  assert.equal(await failChatAttachment(pool, claim, 'NOT_FOUND'), true, 'terminal source failure closes the fixture job');
  const failed = (await pool.query('select status,error_code from private.chat_attachments where id=$1', [claim.id])).rows[0];
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.error_code, 'NOT_FOUND');
});

test('registration rejects a source event from another Student session without creating a row', async () => {
  const fixture = await makeStudentMediaSource('IMAGE');
  const foreign = await makeStudentMediaSource('IMAGE');
  const client = await pool.connect();
  try {
    await assert.rejects(
      registerStudentChatAttachment(client, { messageId: fixture.messageId, sourceEventId: foreign.sourceEventId }, key),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'SOURCE_CHANGED',
    );
  } finally {
    client.release();
  }
  assert.equal((await pool.query('select count(*)::int as count from private.chat_attachments where message_id=$1', [fixture.messageId])).rows[0].count, 0);
});

test('expired attachment leases are replaced and cannot publish after reclaim', async () => {
  const jpegBytes = await validJpegBytes();
  const fixture = await makeStudentMediaSource('IMAGE');
  const client = await pool.connect();
  try {
    await registerStudentChatAttachment(client, { messageId: fixture.messageId, sourceEventId: fixture.sourceEventId }, key);
  } finally {
    client.release();
  }
  const first = await claimChatAttachment(pool, key);
  assert.ok(first);
  const beforeExpiry = (await pool.query('select attempts,lease_until from private.chat_attachments where id=$1', [first.id])).rows[0];
  assert.equal(beforeExpiry.attempts, 1);
  assert.ok(new Date(beforeExpiry.lease_until).getTime() > Date.now());
  assert.equal(await claimChatAttachment(pool, key), null, 'an active lease is not double-claimed');

  await pool.query("update private.chat_attachments set lease_until=clock_timestamp()-interval '1 millisecond' where id=$1", [first.id]);
  const second = await claimChatAttachment(pool, key);
  assert.ok(second);
  assert.notEqual(second.leaseToken, first.leaseToken, 'reclaim issues a new fencing token');
  assert.equal((await pool.query('select attempts from private.chat_attachments where id=$1', [first.id])).rows[0].attempts, 2);
  const staleRef = chatRef(first, jpegBytes, 'image/jpeg');
  const currentRef = chatRef(second, jpegBytes, 'image/jpeg');
  assert.equal(await finishChatAttachment(pool, first, { ref: staleRef }, key), false, 'an expired worker cannot publish READY');
  assert.equal((await pool.query('select status,lease_token from private.chat_attachments where id=$1', [first.id])).rows[0].status, 'PROCESSING');
  assert.equal(await finishChatAttachment(pool, second, { ref: currentRef }, key), true, 'the current lease may commit the exact source-bound ref');
  const ready = (await pool.query('select status,object_id,mime_type,byte_length,checksum,lease_token from private.chat_attachments where id=$1', [first.id])).rows[0];
  assert.equal(ready.status, 'READY');
  assert.equal(ready.object_id, second.leaseToken);
  assert.equal(ready.mime_type, 'image/jpeg');
  assert.equal(ready.byte_length, jpegBytes.length);
  assert.equal(ready.checksum, currentRef.checksum);
  assert.equal(ready.lease_token, null);
});

test('three crashed media attempts become terminal instead of remaining PROCESSING', async () => {
  const fixture = await makeStudentMediaSource('IMAGE');
  const client = await pool.connect();
  try {
    await registerStudentChatAttachment(client, { messageId: fixture.messageId, sourceEventId: fixture.sourceEventId }, key);
  } finally {
    client.release();
  }
  const leases = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const claim = await claimChatAttachment(pool, key);
    assert.ok(claim);
    leases.push(claim);
    assert.equal((await pool.query('select attempts from private.chat_attachments where id=$1', [claim.id])).rows[0].attempts, attempt);
    await pool.query("update private.chat_attachments set lease_until=clock_timestamp()-interval '1 millisecond' where id=$1", [claim.id]);
  }
  assert.notEqual(leases[0].leaseToken, leases[2].leaseToken);
  assert.equal(await claimChatAttachment(pool, key), null, 'expired final-attempt leases are closed rather than reclaimed');
  const row = (await pool.query('select status,attempts,error_code,lease_token,lease_until from private.chat_attachments where message_id=$1', [fixture.messageId])).rows[0];
  assert.equal(row.status, 'FAILED');
  assert.equal(row.attempts, 3);
  assert.equal(row.error_code, 'LEASE_EXPIRED');
  assert.equal(row.lease_token, null);
  assert.equal(row.lease_until, null);
});

test('media download and storage complete outside the database claim transaction', async () => {
  const jpegBytes = await validJpegBytes();
  const fixture = await makeStudentMediaSource('IMAGE');
  const client = await pool.connect();
  try {
    await registerStudentChatAttachment(client, { messageId: fixture.messageId, sourceEventId: fixture.sourceEventId }, key);
  } finally {
    client.release();
  }
  const objects = new Map<string, { ref: ChatMediaRef; envelope: Uint8Array }>();
  let downloadCount = 0;
  let putCount = 0;
  const storage: ChatMediaStorage = {
    async put(ref, envelope) {
      const state = (await pool.query('select status,lease_token from private.chat_attachments where id=$1', [ref.attachmentId])).rows[0];
      assert.equal(state.status, 'PROCESSING', 'the lease was committed before external storage');
      assert.equal(state.lease_token, ref.objectId);
      assert.deepEqual(Uint8Array.from(openChatMedia(envelope, ref, key)), jpegBytes);
      putCount++;
      objects.set(ref.objectId, { ref, envelope: Uint8Array.from(envelope) });
    },
    async get(ref) {
      const object = objects.get(ref.objectId);
      assert.ok(object);
      return Uint8Array.from(object.envelope);
    },
  };
  const result = await runChatMediaCycle(pool, key, {
    async download(lineMessageId) {
      assert.equal(lineMessageId, fixture.lineMessageId);
      const state = (await pool.query('select status,lease_token from private.chat_attachments where message_id=$1', [fixture.messageId])).rows[0];
      assert.equal(state.status, 'PROCESSING', 'the lease is committed and observable during download');
      assert.ok(state.lease_token);
      downloadCount++;
      return { bytes: jpegBytes, contentType: 'image/jpeg' };
    },
    storage,
  });
  assert.deepEqual(result, { claimed: 1, completed: 1, failed: 0 });
  assert.equal(downloadCount, 1);
  assert.equal(putCount, 1);
  assert.equal((await pool.query('select status from private.chat_attachments where message_id=$1', [fixture.messageId])).rows[0].status, 'READY');
});

test('image bytes with a JPEG signature but invalid pixels never reach private storage or READY', async () => {
  const fixture = await makeStudentMediaSource('IMAGE');
  const client = await pool.connect();
  try {
    await registerStudentChatAttachment(client, { messageId: fixture.messageId, sourceEventId: fixture.sourceEventId }, key);
  } finally {
    client.release();
  }
  assert.doesNotThrow(() => inspectChatMedia(malformedJpeg, 'image/jpeg', 'IMAGE'));
  let puts = 0;
  const storage: ChatMediaStorage = {
    async put() { puts++; },
    async get() { throw new Error('unexpected storage read'); },
  };
  const result = await runChatMediaCycle(pool, key, {
    async download() { return { bytes: malformedJpeg, contentType: 'image/jpeg' }; },
    storage,
  });
  assert.deepEqual(result, { claimed: 1, completed: 0, failed: 1 });
  assert.equal(puts, 0, 'decoder rejection happens before storage upload');
  const row = (await pool.query('select status,error_code,object_id,mime_type,byte_length,checksum from private.chat_attachments where message_id=$1', [fixture.messageId])).rows[0];
  assert.equal(row.status, 'FAILED');
  assert.equal(row.error_code, 'INVALID_ATTACHMENT');
  assert.equal(row.object_id, null);
  assert.equal(row.mime_type, null);
  assert.equal(row.byte_length, null);
  assert.equal(row.checksum, null);
});

test('unsend before the original media event leaves a hash-only tombstone and prevents later registration', async () => {
  const identity = makeStudentIdentity();
  const lineMessageId = `line-${randomUUID()}`;
  const sessionsBefore = (await pool.query('select count(*)::int as count from public.line_sessions')).rows[0].count;
  const unsend = await makeUnsendInboxJob(identity, lineMessageId);
  await processOwnedInboxJob(unsend);
  assert.equal((await pool.query('select count(*)::int as count from public.line_sessions')).rows[0].count, sessionsBefore,
    'processing an unknown-user unsend does not create a Student session');
  assert.equal((await pool.query('select count(*)::int as count from private.line_identities where user_hash=$1', [identity.userHash])).rows[0].count, 0);
  const tombstone = (await pool.query(
    'select user_hash,line_message_hash,source_event_id from private.chat_media_revocations where user_hash=$1',
    [identity.userHash],
  )).rows[0];
  assert.ok(tombstone);
  assert.equal(tombstone.source_event_id, unsend.id);
  assert.equal(tombstone.line_message_hash.length, 64);
  assert.equal(JSON.stringify(tombstone).includes(lineMessageId), false, 'the tombstone retains no raw LINE message ID');

  const student = await createStudentSession(identity);
  const original = await makeStudentMediaSource('IMAGE', {}, { student, lineMessageId });
  const client = await pool.connect();
  try {
    await registerStudentChatAttachment(client, { messageId: original.messageId, sourceEventId: original.sourceEventId }, key);
  } finally {
    client.release();
  }
  const attachment = (await pool.query('select status,error_code,revoked_at from private.chat_attachments where message_id=$1', [original.messageId])).rows[0];
  assert.equal(attachment.status, 'FAILED');
  assert.equal(attachment.error_code, 'SOURCE_CHANGED');
  assert.ok(attachment.revoked_at);
  assert.equal(await claimChatAttachment(pool, key), null, 'an original arriving after an unsend cannot be downloaded');
});

test('unsend cancels pending and processing attachments and fences a stale worker finish', async () => {
  const student = await createStudentSession(makeStudentIdentity());
  const pending = await makeStudentMediaSource('IMAGE', {}, { student });
  const processing = await makeStudentMediaSource('IMAGE', {}, { student });
  const client = await pool.connect();
  try {
    await registerStudentChatAttachment(client, { messageId: pending.messageId, sourceEventId: pending.sourceEventId }, key);
    await registerStudentChatAttachment(client, { messageId: processing.messageId, sourceEventId: processing.sourceEventId }, key);
  } finally {
    client.release();
  }

  await processOwnedInboxJob(await makeUnsendInboxJob(student, pending.lineMessageId));
  const pendingRow = (await pool.query('select status,error_code,revoked_at,lease_token from private.chat_attachments where message_id=$1', [pending.messageId])).rows[0];
  assert.equal(pendingRow.status, 'FAILED');
  assert.equal(pendingRow.error_code, 'SOURCE_CHANGED');
  assert.ok(pendingRow.revoked_at);
  assert.equal(pendingRow.lease_token, null);

  const claim = await claimChatAttachment(pool, key);
  assert.ok(claim);
  assert.equal(claim.messageId, processing.messageId);
  const bytes = await validJpegBytes();
  const staleRef = chatRef(claim, bytes, 'image/jpeg');
  await processOwnedInboxJob(await makeUnsendInboxJob(student, processing.lineMessageId));
  const processingRow = (await pool.query('select status,error_code,revoked_at,lease_token,lease_until from private.chat_attachments where message_id=$1', [processing.messageId])).rows[0];
  assert.equal(processingRow.status, 'FAILED');
  assert.equal(processingRow.error_code, 'SOURCE_CHANGED');
  assert.ok(processingRow.revoked_at);
  assert.equal(processingRow.lease_token, null);
  assert.equal(processingRow.lease_until, null);
  assert.equal(await finishChatAttachment(pool, claim, { ref: staleRef }, key), false,
    'a worker whose attachment was unsent cannot publish READY after its download completes');
});

test('durable Student unsend revokes the ready attachment for its verified sender only', async () => {
  const fixture = await makeStudentMediaSource('IMAGE');
  const client = await pool.connect();
  try {
    await registerStudentChatAttachment(client, { messageId: fixture.messageId, sourceEventId: fixture.sourceEventId }, key);
  } finally {
    client.release();
  }
  const objects = new Map<string, Uint8Array>();
  const storage: ChatMediaStorage = {
    async put(ref, envelope) { objects.set(ref.objectId, Uint8Array.from(envelope)); },
    async get(ref) {
      const envelope = objects.get(ref.objectId);
      assert.ok(envelope);
      return Uint8Array.from(envelope);
    },
  };
  const jpegBytes = await validJpegBytes();
  const worker = await runChatMediaCycle(pool, key, {
    async download() { return { bytes: jpegBytes, contentType: 'image/jpeg' }; },
    storage,
  });
  assert.deepEqual(worker, { claimed: 1, completed: 1, failed: 0 });
  const unsend = await makeUnsendInboxJob(fixture, fixture.lineMessageId);
  await processOwnedInboxJob(unsend);
  const inbox = (await pool.query('select status,last_error_code from private.webhook_inbox where id=$1', [unsend.id])).rows[0];
  assert.equal(inbox.status, 'DONE');
  assert.equal(inbox.last_error_code, null, 'a verified unsend is processed under its current durable inbox lease');
  const revoked = (await pool.query('select status,revoked_at from private.chat_attachments where message_id=$1', [fixture.messageId])).rows[0];
  assert.equal(revoked.status, 'READY', 'the immutable completed state remains intact behind its revocation marker');
  assert.ok(revoked.revoked_at);
  const tombstones = (await pool.query(
    'select user_hash,line_message_hash,source_event_id from private.chat_media_revocations where user_hash=$1',
    [fixture.userHash],
  )).rows;
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].source_event_id, unsend.id);
  assert.match(tombstones[0].line_message_hash, /^[a-f0-9]{64}$/u);

  const revokeClient = await pool.connect();
  try {
    await revokeClient.query('begin');
    await revokeStudentChatAttachment(revokeClient, {
      userHash: fixture.userHash,
      lineMessageId: fixture.lineMessageId,
      eventId: unsend.id,
    }, key);
    await assert.rejects(
      revokeStudentChatAttachment(revokeClient, {
        userHash: makeStudentIdentity().userHash,
        lineMessageId: fixture.lineMessageId,
        eventId: unsend.id,
      }, key),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'SOURCE_CHANGED',
    );
    await revokeClient.query('commit');
  } catch (error) {
    await revokeClient.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    revokeClient.release();
  }
  assert.equal((await pool.query('select count(*)::int as count from private.chat_media_revocations where user_hash=$1', [fixture.userHash])).rows[0].count, 1,
    'duplicate unsend processing is idempotent and another user hash cannot revoke it');
});

test('Staff thread projects attachment status and reads bytes only under current ticket scope', async () => {
  const jpegBytes = await validJpegBytes();
  const staffId = await makeStaffProfile('IT');
  const foreignStaffId = await makeStaffProfile('LIBRARY');
  const fixture = await makeStudentMediaSource('IMAGE', {}, { assignedStaffId: staffId });
  assert.ok(fixture.ticketId);
  const client = await pool.connect();
  try {
    await registerStudentChatAttachment(client, { messageId: fixture.messageId, sourceEventId: fixture.sourceEventId }, key);
  } finally {
    client.release();
  }

  const pendingThread = await readThread(staffId, fixture.ticketId, {}, { pool, key });
  const pendingMessage = pendingThread.messages.find(message => message.id === fixture.messageId);
  assert.ok(pendingMessage);
  assert.deepEqual(pendingMessage.attachments.map(({ name, mimeType, size, status, downloadUrl }) => ({ name, mimeType, size, status, downloadUrl })), [
    { name: 'รูปภาพ', mimeType: 'application/octet-stream', size: 0, status: 'PENDING', downloadUrl: null },
  ], 'the frozen thread DTO exposes only safe attachment metadata while pending');

  const objects = new Map<string, { ref: ChatMediaRef; envelope: Uint8Array }>();
  let storageReads = 0;
  const storage: ChatMediaStorage = {
    async put(ref, envelope) { objects.set(ref.objectId, { ref, envelope: Uint8Array.from(envelope) }); },
    async get(ref) {
      storageReads++;
      const object = objects.get(ref.objectId);
      assert.ok(object);
      return Uint8Array.from(object.envelope);
    },
  };
  const worker = await runChatMediaCycle(pool, key, {
    async download(lineMessageId) {
      assert.equal(lineMessageId, fixture.lineMessageId);
      return { bytes: jpegBytes, contentType: 'image/jpeg' };
    },
    storage,
  });
  assert.deepEqual(worker, { claimed: 1, completed: 1, failed: 0 });

  const readyThread = await readThread(staffId, fixture.ticketId, {}, { pool, key });
  const readyMessage = readyThread.messages.find(message => message.id === fixture.messageId);
  assert.ok(readyMessage);
  const attachment = readyMessage.attachments[0];
  assert.ok(attachment);
  assert.equal(attachment.status, 'READY');
  assert.equal(attachment.mimeType, 'image/jpeg');
  assert.equal(attachment.size, jpegBytes.length);
  assert.equal(attachment.downloadUrl, `/api/chat/tickets/${fixture.ticketId}/attachments/${attachment.id}`);
  assert.equal('objectId' in attachment, false, 'storage references never leave the private repository');

  const allowed = await readStaffChatAttachment(staffId, fixture.ticketId, attachment.id, { pool, key, storage });
  assert.deepEqual(Uint8Array.from(allowed.bytes), jpegBytes);
  assert.equal(allowed.name, 'รูปภาพ');
  assert.equal(allowed.mimeType, 'image/jpeg');
  assert.equal(storageReads, 1);

  const tamperedStorage: ChatMediaStorage = {
    ...storage,
    async get(ref) {
      storageReads++;
      const object = objects.get(ref.objectId);
      assert.ok(object);
      const corrupted = Uint8Array.from(object.envelope);
      corrupted[corrupted.length - 1] ^= 1;
      return corrupted;
    },
  };
  await assert.rejects(
    readStaffChatAttachment(staffId, fixture.ticketId, attachment.id, { pool, key, storage: tamperedStorage }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_ATTACHMENT',
    'tampered encrypted bytes fail closed before any response is returned',
  );
  assert.equal(storageReads, 2);

  await assert.rejects(
    readStaffChatAttachment(foreignStaffId, fixture.ticketId, attachment.id, { pool, key, storage }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'NOT_FOUND',
  );
  await assert.rejects(
    readStaffChatAttachment(staffId, randomUUID(), attachment.id, { pool, key, storage }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'NOT_FOUND',
  );
  assert.equal(storageReads, 2, 'wrong scope and wrong ticket are denied before storage bytes are requested');

  const revokingStorage: ChatMediaStorage = {
    ...storage,
    async get(ref) {
      storageReads++;
      const object = objects.get(ref.objectId);
      assert.ok(object);
      await pool.query('update public.staff_profiles set active=false where id=$1', [staffId]);
      return Uint8Array.from(object.envelope);
    },
  };
  await assert.rejects(
    readStaffChatAttachment(staffId, fixture.ticketId, attachment.id, { pool, key, storage: revokingStorage }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'NOT_FOUND',
    'revocation during the storage read is caught by the final authority check',
  );
  assert.equal(storageReads, 3);

  await pool.query('update public.staff_profiles set active=true where id=$1', [staffId]);
  const unsend = await makeUnsendInboxJob(fixture, fixture.lineMessageId);
  await processOwnedInboxJob(unsend);
  const revokedThread = await readThread(staffId, fixture.ticketId, {}, { pool, key });
  const revokedMessage = revokedThread.messages.find(message => message.id === fixture.messageId);
  assert.ok(revokedMessage);
  assert.deepEqual(revokedMessage.attachments.map(({ name, status, downloadUrl }) => ({ name, status, downloadUrl })), [
    { name: 'ไฟล์ที่ยกเลิกส่งแล้ว', status: 'FAILED', downloadUrl: null },
  ], 'the thread DTO hides a revoked ready object behind FAILED/null URL');
  await assert.rejects(
    readStaffChatAttachment(staffId, fixture.ticketId, attachment.id, { pool, key, storage }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'NOT_FOUND',
  );
  assert.equal(storageReads, 3, 'revoked bytes are denied before external storage is read');
});
