import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runInboxCycle } from '../../lib/queue/run-inbox';
import { runOutboxCycle } from '../../lib/queue/run-outbox';
import { runAICycle } from '../../lib/ai/run-worker';
import { embeddingFingerprint } from '../../lib/ai/embedding-gateway';
import { createConfiguredKnowledgeProducer } from '../../lib/knowledge/configured';
import { transaction } from '../../lib/database/pool';
import { createEscalation } from '../../lib/tickets/create-ticket';
import { decryptValue, encryptValue, hashLineUserId } from '../../lib/security/identity';

const BASE = new URL('http://127.0.0.1:3001');
assert.equal(BASE.protocol, 'http:', 'LOCAL_HTTP_ONLY');
assert.equal(BASE.hostname, '127.0.0.1', 'LOOPBACK_HOST_REQUIRED');
assert.equal(BASE.port, '3001', 'ISOLATED_LOCAL_HTTP_SERVER_REQUIRED');
assert.equal(BASE.pathname, '/', 'BASE_PATH_NOT_ALLOWED');

const key = process.env.ENCRYPTION_KEY;
const studentSecret = process.env.LINE_STUDENT_CHANNEL_SECRET?.trim();
assert(key, 'TEST_ENCRYPTION_KEY_REQUIRED');
assert(studentSecret, 'TEST_STUDENT_CHANNEL_SECRET_REQUIRED');
assert.equal(process.env.LINE_WEBHOOK_MODE?.trim(), 'durable', 'DURABLE_WEBHOOK_MODE_REQUIRED');
const encryptionKey: string = key;
const lineSecret: string = studentSecret;

// Deliberately fixed to the isolated test database. Never inherit DATABASE_URL.
const fixtureId = randomUUID();
const fixtureTag = fixtureId.replaceAll('-', '').toUpperCase();
const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
  max: 5,
  application_name: `m6-rag-http-${fixtureTag.slice(0, 12)}`,
});
const studentLineId = `U${fixtureTag}`;
const studentHash = hashLineUserId(studentLineId, encryptionKey);
const providerCredential = `fixture-${fixtureTag}`;
const familyCode = `M6_HTTP_${fixtureTag}`;
const embeddingModelId = 'fixture/embedding';
const generationAPIModelId = 'fixture/generation';
const embeddingDimensions = 2;
const embeddingBaseUrl = 'https://openrouter.ai/api/v1';
const fingerprint = embeddingFingerprint({ adapter: 'OPENROUTER', baseUrl: embeddingBaseUrl, modelId: embeddingModelId, dimensions: embeddingDimensions });
const vector = [1, 0];
const eventIds: string[] = [];
const conversations: string[] = [];
const tickets: string[] = [];
const documentIds: string[] = [];
let sessionId = '';
let providerId = '';
let generationModelId = '';
let embeddingRegistryModelId = '';
let familyId = '';
let departmentId = '';
let departmentCreated = false;
let stage = 'preflight';
let fakeCalls = 0;
let generationCalls = 0;
let embeddingCalls = 0;
let catalogCalls = 0;
let takeoverGate: { entered: () => void; wait: Promise<void>; release: () => void } | null = null;
let activeCycle:ReturnType<typeof runAICycle>|undefined;

function gate() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { entered, enter, wait, release };
}

async function noReadyWork(): Promise<void> {
  const [inbox, outbox, jobs] = await Promise.all([
    pool.query("select count(*)::int as count from private.webhook_inbox where status in ('PENDING','PROCESSING')"),
    pool.query("select count(*)::int as count from private.message_outbox where status in ('PENDING','PROCESSING')"),
    pool.query("select count(*)::int as count from private.ai_jobs where status in ('PENDING','PROCESSING')"),
  ]);
  assert.equal(inbox.rows[0].count, 0, 'LOCAL_INBOX_MUST_BE_IDLE');
  assert.equal(outbox.rows[0].count, 0, 'LOCAL_OUTBOX_MUST_BE_IDLE');
  assert.equal(jobs.rows[0].count, 0, 'LOCAL_AI_JOBS_MUST_BE_IDLE');
}

async function noProviderConfiguration(): Promise<void> {
  const result = await pool.query(`select
    (select count(*)::int from private.ai_providers) as providers,
    (select count(*)::int from private.ai_models) as models`);
  assert.equal(result.rows[0].providers, 0, 'NO_EXISTING_PROVIDER_CONFIGURATION');
  assert.equal(result.rows[0].models, 0, 'NO_EXISTING_MODEL_CONFIGURATION');
}

async function assertNoBusinessTransactionDuringHttp(): Promise<void> {
  const active = await pool.query(`select count(*)::int as count from pg_stat_activity
    where application_name=$1 and pid<>pg_backend_pid() and xact_start is not null`, [`m6-rag-http-${fixtureTag.slice(0, 12)}`]);
  assert.equal(active.rows[0].count, 0, 'NO_BUSINESS_TRANSACTION_DURING_PROVIDER_HTTP');
}

function responseJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

const fakeProviderFetch: typeof fetch = async (input, init) => {
  fakeCalls += 1;
  const url = new URL(String(input));
  assert.equal(url.protocol, 'https:', 'FAKE_PROVIDER_HTTPS_ONLY');
  assert.equal(url.hostname, 'openrouter.ai', 'FREE_OPENROUTER_HOST_ONLY_NO_PAID_NATIVE_CALL');
  assert.equal(url.port, '', 'FAKE_PROVIDER_DEFAULT_PORT_ONLY');
  assert.equal(init?.redirect, 'error', 'PROVIDER_REDIRECTS_DISABLED');
  await assertNoBusinessTransactionDuringHttp();

  if (init?.method === 'GET') {
    catalogCalls += 1;
    assert.equal(new Headers(init?.headers).has('authorization'), false, 'PUBLIC_CATALOG_HAS_NO_KEY');
    assert.equal(url.pathname === '/api/v1/models' || url.pathname === '/api/v1/embeddings/models', true, 'KNOWN_CATALOG_ONLY');
    return responseJson({ data: [{ id: url.pathname === '/api/v1/models' ? generationAPIModelId : embeddingModelId,
      pricing: { prompt: '0', completion: '0', request: '0', image: '0', web_search: '0', internal_reasoning: '0' } }] });
  }
  assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${providerCredential}`, 'FIXTURE_CREDENTIAL_ONLY');
  assert.equal(init?.method, 'POST', 'PROVIDER_POST_ONLY');

  if (url.pathname === '/api/v1/embeddings') {
    embeddingCalls += 1;
    const request = JSON.parse(String(init?.body)) as { model?: string; input?: string[]; dimensions?: number };
    assert.equal(request.model, embeddingModelId);
    assert.equal(request.dimensions, embeddingDimensions);
    assert.equal(request.input?.length, 1);
    return responseJson({
      object: 'list',
      model: embeddingModelId,
      data: [{ object: 'embedding', index: 0, embedding: vector }],
      usage: { prompt_tokens: 6, total_tokens: 6 },
    });
  }

  assert.equal(url.pathname, '/api/v1/chat/completions', 'ONLY_FREE_CHAT_OR_EMBEDDINGS');
  generationCalls += 1;
  const request = JSON.parse(String(init?.body)) as {
    model?: string;
    response_format?: { json_schema?: { name?: string } };
    messages?: Array<{ role: string; content: string }>;
    provider?: { max_price?: { prompt?: number; completion?: number }; require_parameters?: boolean };
  };
  assert.equal(request.model, generationAPIModelId);
  assert.deepEqual(request.provider?.max_price, { prompt: 0, completion: 0 }, 'ZERO_PRICE_ROUTING_CEILINGS');
  assert.equal(request.provider?.require_parameters, true);
  const schemaName = request.response_format?.json_schema?.name;
  assert.equal(schemaName === 'knowledge_scope' || schemaName === 'knowledge_answer', true, 'KNOWN_RAG_TASK_ONLY');
  const userMessage = [...(request.messages ?? [])].reverse().find((item) => item.role === 'user');
  assert(userMessage, 'RAG_USER_INPUT_PRESENT');
  const userData = JSON.parse(userMessage.content) as { question?: string; evidence?: Array<{ chunkId: string }> };

  if (schemaName === 'knowledge_scope') {
    const isHistorical = /(?:ย้อนหลั|ที่ผ่านมา|ย้อนหลัง|2567)/u.test(userData.question ?? '');
    const scope = {
      historical: isHistorical,
      academicYear: isHistorical ? 2567 : null,
      asOfDate: null,
      familyCodes: [familyCode],
      departmentCode: null,
      audience: 'REGULAR',
      studentType: null,
      semester: null,
      programCode: null,
      curriculumCode: null,
      cohort: null,
    };
    return responseJson({ model: generationAPIModelId, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(scope) } }],
      usage: { prompt_tokens: 31, completion_tokens: 11, total_tokens: 42 } });
  }

  if (takeoverGate) {
    takeoverGate.entered();
    await takeoverGate.wait;
    takeoverGate = null;
  }
  assert(userData.evidence?.length, 'GROUNDED_EVIDENCE_REACHED_GENERATION');
  const answer = {
    answer: /2567/u.test(userData.question ?? '') ? 'คำตอบควบคุมสำหรับข้อมูลปี 2567' : 'คำตอบควบคุมสำหรับข้อมูลปัจจุบัน',
    citationChunkIds: [userData.evidence[0]!.chunkId],
  };
  return responseJson({ model: generationAPIModelId, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer) } }],
    usage: { prompt_tokens: 52, completion_tokens: 16, total_tokens: 68 } });
};

const producer = createConfiguredKnowledgeProducer(pool, encryptionKey, { fetchImpl: fakeProviderFetch });

function signedEvent(message: string, suffix: string) {
  const id = `m6-rag-${suffix}-${randomUUID()}`;
  eventIds.push(id);
  return {
    type: 'message', webhookEventId: id, source: { type: 'user', userId: studentLineId },
    message: { type: 'text', id: `line-${randomUUID()}`, text: message },
    replyToken: `fixture-reply-${randomUUID()}`, timestamp: Date.now(),
  };
}

async function signedPost(event: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify({ events: [event] });
  const signature = createHmac('sha256', lineSecret).update(body).digest('base64');
  const response = await fetch(new URL('/api/line/student/webhook', BASE), {
    method: 'POST', body, headers: { 'x-line-signature': signature }, redirect: 'error',
  });
  assert.equal(response.status, 200, 'SIGNED_STUDENT_WEBHOOK_ACCEPTED');
}

async function processOne(event: Record<string, unknown>): Promise<void> {
  await signedPost(event);
  const cycle = await runInboxCycle(pool, encryptionKey, { aiEnabled: true });
  assert.deepEqual(cycle, { claimed: 1, completed: 1, failed: 0 }, 'ONLY_FIXTURE_INBOX_EVENT_CLAIMED');
  const stored = await pool.query('select status,last_error_code from private.webhook_inbox where event_id=$1 and channel=\'STUDENT\'', [event.webhookEventId]);
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].status, 'DONE');
  assert.equal(stored.rows[0].last_error_code, null);
}

interface LinePayload { messages: { text: string; quickReply?: { items: { action: { label: string; data: string; displayText?: string } }[] } }[] }

async function latestPayload(kind: 'AI' | 'SYSTEM', conversationId?: string): Promise<{ id: string; payload: LinePayload }> {
  const row = (await pool.query(`select id,payload_encrypted from private.message_outbox
    where line_session_id=$1 and kind=$2 and status='PENDING' and ($3::uuid is null or conversation_id=$3)
    order by outbox_seq desc limit 1`, [sessionId, kind, conversationId ?? null])).rows[0];
  assert(row, `FIXTURE_${kind}_OUTBOX_PRESENT`);
  return { id: row.id, payload: JSON.parse(decryptValue(row.payload_encrypted, encryptionKey)) as LinePayload };
}

async function drainOutbox(): Promise<number> {
  let sent = 0;
  for (let index = 0; index < 24; index += 1) {
    const cycle = await runOutboxCycle(pool, encryptionKey, {
      accessTokens: { STUDENT: 'local-fake-token', STAFF: 'local-fake-token' },
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.equal(url.protocol, 'https:', 'FAKE_LINE_HTTPS_ONLY');
        assert.equal(url.hostname, 'api.line.me', 'FAKE_LINE_HOST_ONLY');
        assert.match(url.pathname, /^\/v2\/bot\/message\/(reply|push)$/u);
        await assertNoBusinessTransactionDuringHttp();
        return new Response(null, { status: 200 });
      },
    });
    sent += cycle.sent;
    assert.equal(cycle.failed, 0, 'FAKE_LINE_DELIVERY_SUCCEEDED');
    if (cycle.claimed === 0) return sent;
  }
  assert.fail('OUTBOX_DRAIN_BOUNDED_LIMIT_REACHED');
}

async function postbackForNewTopic(data:string): Promise<void> {
  assert.match(data, /^yru:choice:/u, 'NEW_TOPIC_CHOICE_IS_OPAQUE_TOKEN');
  const eventId = `m6-rag-new-topic-${randomUUID()}`;
  eventIds.push(eventId);
  await processOne({ type: 'postback', webhookEventId: eventId, source: { type: 'user', userId: studentLineId },
    postback: { data }, replyToken: `fixture-reply-${randomUUID()}`, timestamp: Date.now() });
}

async function insertProviderFixtures(): Promise<void> {
  const inserted = (await pool.query(`insert into private.ai_providers(name,adapter,base_url,api_key_encrypted,enabled,priority)
    values($1,'OPENROUTER',$2,$3,true,0) returning id`, [`m6-rag-http-${fixtureTag}`, embeddingBaseUrl, encryptValue(providerCredential, encryptionKey)])).rows[0];
  providerId = inserted.id;
  generationModelId = (await pool.query(`insert into private.ai_models(provider_id,model_id,display_name,purpose,embedding_dimensions,
    supports_tools,supports_json,supports_vision,enabled,priority,timeout_ms,input_price_per_million,output_price_per_million)
    values($1,$2,'Fixture generation','GENERATION',null,false,true,false,true,0,10000,0,0) returning id`, [providerId,generationAPIModelId])).rows[0].id;
  embeddingRegistryModelId = (await pool.query(`insert into private.ai_models(provider_id,model_id,display_name,purpose,embedding_dimensions,
    supports_tools,supports_json,supports_vision,enabled,priority,timeout_ms,input_price_per_million,output_price_per_million)
    values($1,$2,'Fixture embedding','EMBEDDING',$3,false,false,false,true,0,10000,0,null) returning id`,
  [providerId, embeddingModelId, embeddingDimensions])).rows[0].id;
}

async function insertKnowledgeFixtures(): Promise<void> {
  familyId = (await pool.query(`insert into public.document_families(code,name,category)
    values($1,'Local controlled RAG fixture','GUIDE') returning id`, [familyCode])).rows[0].id;
  const versions = [
    { year: 2569, version: 'Current 2569 fixture', status: 'ACTIVE', current: true, effective: '2026-01-01', page: 9 },
    { year: 2567, version: 'Historical 2567 fixture', status: 'SUPERSEDED', current: false, effective: '2024-01-01', page: 67 },
  ] as const;
  for (const item of versions) {
    const documentId = (await pool.query(`insert into public.documents(document_family_id,title,document_type,version_name,version_stream,
      academic_year,audience,student_type,status,is_current,authority_level,approval_status,approved_at,official_source,extraction_reviewed,
      requires_review,visibility,effective_from,source_url,source_page_url,mime_type,checksum)
      values($1,$2,'GUIDE',$3,'m6-http-controlled-stream',$4,'REGULAR','ALL',$5,$6,90,'APPROVED',clock_timestamp(),true,true,
      false,'PUBLIC',$7,$8,$8,'application/pdf',$9) returning id`, [
      familyId, `Controlled local source ${item.year}`, item.version, item.year, item.status, item.current, item.effective,
      `https://fixture.yru.ac.th/m6/${item.year}.pdf`, createHash('sha256').update(`${fixtureId}:${item.year}`).digest('hex'),
    ])).rows[0].id as string;
    documentIds.push(documentId);
    await pool.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,section_title,content,embedding,
      embedding_dimensions,embedding_fingerprint) values($1,0,$2,'ข้อมูลควบคุม','Controlled evidence for year '||$3,'[1,0]',2,$4)`,
    [documentId, item.page, item.year, fingerprint]);
  }
}

async function setupSession(): Promise<void> {
  sessionId = (await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id', [fixtureId])).rows[0].id;
  await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
    [sessionId, studentHash, encryptValue(studentLineId, encryptionKey)]);
  const department = (await pool.query("select id from public.departments where code='REGISTRATION'")).rows[0];
  if (department) departmentId = department.id;
  else {
    departmentId = (await pool.query(`insert into public.departments(code,name_th,name_en,description,active)
      values('REGISTRATION','ฝ่ายรับสมัครและทะเบียน','Registration','M6 local RAG takeover fixture',true) returning id`)).rows[0].id;
    departmentCreated = true;
  }
}

async function cleanup(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if(providerId){
      await client.query('delete from private.ai_errors where provider_id=$1',[providerId]);
      await client.query('delete from private.ai_usage_logs where provider_id=$1',[providerId]);
    }
    if (sessionId) {
      const conversationIds = (await client.query('select id from public.conversations where line_session_id=$1', [sessionId])).rows.map((row) => row.id as string);
      const ticketIds = (await client.query('select id from public.tickets where line_session_id=$1', [sessionId])).rows.map((row) => row.id as string);
      const outboxIds = (await client.query('select id from private.message_outbox where line_session_id=$1 or ticket_id=any($2::uuid[])', [sessionId, ticketIds])).rows.map((row) => row.id as string);
      await client.query('delete from private.delivery_attempts where outbox_id=any($1::uuid[])', [outboxIds]);
      await client.query('delete from private.pending_route_choices where line_session_id=$1', [sessionId]);
      await client.query('delete from private.ai_jobs where line_session_id=$1', [sessionId]);
      await client.query('delete from private.staff_action_tokens where ticket_id=any($1::uuid[])', [ticketIds]);
      await client.query('delete from private.ticket_action_receipts where ticket_id=any($1::uuid[])', [ticketIds]);
      await client.query('delete from private.activities where ticket_id=any($1::uuid[])', [ticketIds]);
      await client.query('delete from public.ticket_history where ticket_id=any($1::uuid[])', [ticketIds]);
      await client.query('delete from private.message_outbox where id=any($1::uuid[])', [outboxIds]);
      await client.query('delete from public.messages where conversation_id=any($1::uuid[])', [conversationIds]);
      await client.query('update public.conversations set active_ticket_id=null where id=any($1::uuid[])', [conversationIds]);
      await client.query('delete from public.tickets where id=any($1::uuid[])', [ticketIds]);
      await client.query('delete from public.conversations where id=any($1::uuid[])', [conversationIds]);
      await client.query('delete from private.line_identities where line_session_id=$1', [sessionId]);
      await client.query('delete from public.line_sessions where id=$1', [sessionId]);
    }
    if (eventIds.length) {
      await client.query('delete from private.staff_inbound_messages where source_event_id in (select id from private.webhook_inbox where event_id=any($1::text[]))', [eventIds]);
      await client.query('delete from public.messages where source_event_id in (select id from private.webhook_inbox where event_id=any($1::text[]))', [eventIds]);
      await client.query('delete from private.webhook_inbox where event_id=any($1::text[])', [eventIds]);
    }
    if (documentIds.length) {
      await client.query('delete from public.knowledge_chunks where document_id=any($1::uuid[])', [documentIds]);
      await client.query('delete from public.documents where id=any($1::uuid[])', [documentIds]);
    }
    if (familyId) await client.query('delete from public.document_families where id=$1', [familyId]);
    if (providerId) {
      await client.query('delete from private.ai_model_observations where provider_id=$1', [providerId]);
      await client.query('delete from private.ai_models where provider_id=$1', [providerId]);
      await client.query('delete from private.ai_providers where id=$1', [providerId]);
    }
    if (departmentCreated && departmentId) await client.query('delete from public.departments where id=$1 and code=$2', [departmentId, 'REGISTRATION']);
    await client.query('commit');
  } catch {
    await client.query('rollback').catch(() => undefined);
    throw new Error('FIXTURE_CLEANUP_FAILED');
  } finally {
    client.release();
  }
}

try {
  stage = 'preflight';
  await noReadyWork();
  await noProviderConfiguration();
  stage = 'fixture_setup';
  await setupSession();
  await insertProviderFixtures();
  await insertKnowledgeFixtures();
  await noReadyWork();

  stage = 'signed_current_intake';
  const currentEvent = signedEvent('ขอข้อมูลบริการสำหรับนักศึกษาภาคปกติ', 'current');
  await processOne(currentEvent);
  const currentMessage = (await pool.query('select id,conversation_id from public.messages where source_event_id=(select id from private.webhook_inbox where event_id=$1) and sender_type=\'USER\'', [currentEvent.webhookEventId])).rows[0];
  assert(currentMessage, 'SIGNED_USER_MESSAGE_STORED');
  const currentConversation = currentMessage.conversation_id as string;
  conversations.push(currentConversation);
  const currentJob = (await pool.query('select id,status from private.ai_jobs where message_id=$1', [currentMessage.id])).rows[0];
  assert(currentJob, 'DURABLE_AI_JOB_PREPARED');
  assert.equal(currentJob.status, 'PENDING');
  assert.equal(fakeCalls, 0, 'NO_PROVIDER_CALL_DURING_INBOX_TRANSACTION');
  assert.equal((await pool.query("select count(*)::int count from private.message_outbox where conversation_id=$1 and kind='SYSTEM'", [currentConversation])).rows[0].count, 0, 'NO_PREMATURE_SYSTEM_REPLY');
  const initialCounts = await pool.query(`select
    (select count(*)::int from public.messages where conversation_id=$1 and sender_type='USER') as user_messages,
    (select count(*)::int from private.ai_jobs where line_session_id=$2) as jobs`, [currentConversation, sessionId]);
  assert.deepEqual(initialCounts.rows[0], { user_messages: 1, jobs: 1 });

  stage = 'current_grounded_answer';
  const currentResult = await runAICycle(pool, encryptionKey, { produce: producer });
  assert.deepEqual(currentResult, { claimed: 1, completed: 1, suppressed: 0, failed: 0 });
  assert.equal(embeddingCalls, 1);
  assert.equal(generationCalls, 2, 'SCOPE_AND_ANSWER_USED_FREE_CHAT_FAKE');
  const currentOutbox = await latestPayload('AI', currentConversation);
  assert(currentOutbox.payload.messages[0]!.text.includes('หน้า 9'), 'BACKEND_PAGE_CITATION_PRESENT');
  assert(currentOutbox.payload.messages[0]!.text.includes('https://fixture.yru.ac.th/m6/2569.pdf'), 'BACKEND_SOURCE_CITATION_PRESENT');
  assert.equal((await pool.query('select status from private.ai_jobs where id=$1', [currentJob.id])).rows[0].status, 'DONE');

  stage = 'signed_redelivery_deduplicated';
  await signedPost(currentEvent);
  assert.equal((await runInboxCycle(pool, encryptionKey, { aiEnabled: true })).claimed, 0, 'SIGNED_REDELIVERY_HAS_NO_SECOND_EFFECT');
  assert.equal((await pool.query('select count(*)::int count from private.ai_jobs where message_id=$1', [currentMessage.id])).rows[0].count, 1);
  assert.equal((await pool.query('select count(*)::int count from public.messages where line_message_id=$1', [currentEvent.message.id])).rows[0].count, 1);
  await drainOutbox();

  stage = 'historical_question_context_choice';
  const historicalEvent = signedEvent('ขอข้อมูลบริการภาคปกติย้อนหลังปีการศึกษา 2567', 'historical');
  await processOne(historicalEvent);
  const historicalQuestion = (await pool.query('select id,conversation_id from public.messages where source_event_id=(select id from private.webhook_inbox where event_id=$1) and sender_type=\'USER\'', [historicalEvent.webhookEventId])).rows[0];
  assert(historicalQuestion, 'HISTORICAL_USER_MESSAGE_STORED');
  const contextConversation = historicalQuestion.conversation_id as string;
  conversations.push(contextConversation);
  const routeChoice = await latestPayload('SYSTEM');
  const newAction = routeChoice.payload.messages.flatMap((message) => message.quickReply?.items.map((item) => item.action) ?? [])
    .find((action) => action.displayText === 'เริ่มเรื่องใหม่');
  assert(newAction, 'NEW_CONTEXT_CHOICE_PRESENT');
  assert.match(newAction.data, /^yru:choice:/u, 'OPAQUE_CONTEXT_CHOICE');
  await drainOutbox();
  const historicalPostbackId = `m6-rag-historical-choice-${randomUUID()}`;
  eventIds.push(historicalPostbackId);
  await processOne({ type: 'postback', webhookEventId: historicalPostbackId, source: { type: 'user', userId: studentLineId },
    postback: { data: newAction.data }, replyToken: `fixture-reply-${randomUUID()}`, timestamp: Date.now() });
  const historicalJob = (await pool.query('select id,message_id,conversation_id,status from private.ai_jobs where message_id=$1', [historicalQuestion.id])).rows[0];
  assert(historicalJob, 'OPAQUE_NEW_CHOICE_PREPARED_HISTORICAL_AI_JOB');
  assert.equal(historicalJob.status, 'PENDING');
  const historicalConversation = historicalJob.conversation_id as string;
  conversations.push(historicalConversation);
  const historicalResult = await runAICycle(pool, encryptionKey, { produce: producer });
  assert.deepEqual(historicalResult, { claimed: 1, completed: 1, suppressed: 0, failed: 0 });
  const historicalOutbox = await latestPayload('AI', historicalConversation);
  assert(historicalOutbox.payload.messages[0]!.text.includes('ปี 2567'), 'HISTORICAL_YEAR_CITATION_PRESENT');
  assert(historicalOutbox.payload.messages[0]!.text.includes('หน้า 67'), 'HISTORICAL_PAGE_CITATION_PRESENT');
  assert(historicalOutbox.payload.messages[0]!.text.includes('https://fixture.yru.ac.th/m6/2567.pdf'), 'HISTORICAL_SOURCE_CITATION_PRESENT');
  await drainOutbox();

  stage = 'takeover_during_provider_http';
  const takeoverEvent = signedEvent('ขอคำแนะนำเพิ่มเติมสำหรับนักศึกษาภาคปกติ', 'takeover');
  await processOne(takeoverEvent);
  const takeoverQuestion = (await pool.query('select id,conversation_id from public.messages where source_event_id=(select id from private.webhook_inbox where event_id=$1) and sender_type=\'USER\'', [takeoverEvent.webhookEventId])).rows[0];
  assert(takeoverQuestion, 'TAKEOVER_QUESTION_STORED');
  const takeoverChoice = await latestPayload('SYSTEM');
  const startNew = takeoverChoice.payload.messages.flatMap((message) => message.quickReply?.items.map((item) => item.action) ?? [])
    .find((action) => action.displayText === 'เริ่มเรื่องใหม่');
  assert(startNew, 'TAKEOVER_FIXTURE_NEW_TOPIC_CHOICE');
  await drainOutbox();
  await postbackForNewTopic(startNew.data);
  const takeoverJob = (await pool.query('select id,conversation_id,status from private.ai_jobs where message_id=$1', [takeoverQuestion.id])).rows[0];
  assert(takeoverJob, 'TAKEOVER_AI_JOB_PREPARED');
  const takeoverConversation = takeoverJob.conversation_id as string;
  conversations.push(takeoverConversation);
  const waiting = gate();
  takeoverGate = { entered: waiting.enter, wait: waiting.wait, release: waiting.release };
  const pendingCycle = runAICycle(pool, encryptionKey, { produce: producer });
  activeCycle=pendingCycle;
  let entryTimer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([waiting.entered,pendingCycle.then(()=>{throw new Error('ANSWER_GATE_NOT_REACHED');}),
   new Promise<never>((_resolve,reject)=>{entryTimer=setTimeout(()=>reject(new Error('ANSWER_GATE_DEADLINE')),10_000);})]);}
  finally{if(entryTimer)clearTimeout(entryTimer);}
  const ticket = await transaction((client) => createEscalation(client, {
    sessionId, conversationId: takeoverConversation, departmentCode: 'REGISTRATION', summary: 'Fixture takeover during generation',
  }, encryptionKey), pool);
  tickets.push(ticket.id);
  waiting.release();
  const takeoverResult = await pendingCycle;
  assert.deepEqual(takeoverResult, { claimed: 1, completed: 0, suppressed: 1, failed: 0 }, 'TAKEOVER_SUPPRESSES_IN_FLIGHT_RESULT');
  assert.equal((await pool.query('select status from private.ai_jobs where id=$1', [takeoverJob.id])).rows[0].status, 'SUPPRESSED');
  assert.equal((await pool.query("select count(*)::int count from private.message_outbox where conversation_id=$1 and kind='AI'", [takeoverConversation])).rows[0].count, 0, 'NO_AI_OUTBOX_AFTER_TAKEOVER');
  assert.equal((await pool.query('select count(*)::int count from public.tickets where id=$1 and mode=\'HUMAN\'', [ticket.id])).rows[0].count, 1);
  await drainOutbox();

  stage = 'provider_usage_observations';
  const observations = await pool.query(`select request_type,status,input_tokens,output_tokens,estimated_cost from private.ai_usage_logs
    where provider_id=$1 and conversation_id=any($2::uuid[]) order by request_type,created_at`, [providerId, conversations]);
  assert(observations.rows.some((row) => row.request_type === 'KNOWLEDGE_SCOPE' && row.status === 'SUCCESS'));
  assert(observations.rows.some((row) => row.request_type === 'KNOWLEDGE_ANSWER' && row.status === 'SUCCESS'));
  assert(observations.rows.filter((row) => row.request_type === 'EMBEDDING_QUERY' && row.status === 'SUCCESS').length >= 2);
  assert(observations.rows.every((row) => row.input_tokens !== null && row.output_tokens !== null));
  assert(observations.rows.every((row) => Number(row.estimated_cost) === 0 && row.estimated_cost !== null), 'VERIFIED_FREE_USAGE_COST_ZERO');
  assert.equal((await pool.query('select cost_mode from private.ai_providers where id=$1',[providerId])).rows[0].cost_mode, 'FREE_ONLY');
  const modelObservations=(await pool.query('select http_status,result,action from private.ai_model_observations where provider_id=$1',[providerId])).rows;
  assert(modelObservations.length >= observations.rows.length && modelObservations.every(row=>row.http_status===200&&row.result==='SUCCESS'&&row.action==='RUNTIME'), 'TRUE_RUNTIME_HTTP_PERSISTED');
  const observationsAndErrors = await pool.query(`select
    (select count(*)::int from private.ai_usage_logs where provider_id=$1) as usage_count,
    (select count(*)::int from private.ai_errors where provider_id=$1) as error_count`, [providerId]);
  assert(observationsAndErrors.rows[0].usage_count >= 7);
  assert.equal(observationsAndErrors.rows[0].error_count, 0);
  assert.equal(fakeCalls, generationCalls + embeddingCalls + catalogCalls, 'ALL_PROVIDER_HTTP_WAS_FAKE');
  assert.equal(catalogCalls, generationCalls + embeddingCalls, 'FRESH_PUBLIC_PRICE_GATE_BEFORE_EVERY_INFERENCE');
  assert(generationModelId && embeddingRegistryModelId, 'EXPLICIT_GENERATION_AND_EMBEDDING_MODELS_CONFIGURED');

  console.log(JSON.stringify({
    stage: 'rag_flow_http_verified', signedStudentIntake: true, durableJobBeforeProvider: true,
    groundedBackendCitations: true, redeliveryIdempotent: true, historicalNewContextChoice: true,
    takeoverSuppressed: true, providerUsageObservations: observations.rows.length,
    fakeProviderCalls: fakeCalls, catalogCalls, verifiedFreeCostZero: true, paidNativeCalls: 0,
    actualRuntimeHttpPersisted: true, fakeLineDeliveriesOnly: true, status: 'PASS',
  }));
} catch(error) {
  const check=error instanceof Error&&/^[A-Z_0-9]{1,100}$/.test(error.message)?error.message:'ASSERTION_OR_RUNTIME';
  const errors=providerId?(await pool.query('select error_type,http_status from private.ai_errors where provider_id=$1',[providerId]).catch(()=>({rows:[]}))).rows:[];
  console.error(JSON.stringify({ code: 'RAG_FLOW_HTTP_FAILED', stage,check,catalogCalls,generationCalls,embeddingCalls,errors }));
  process.exitCode = 1;
} finally {
  takeoverGate?.release();
  await activeCycle?.catch(()=>undefined);
  try { await cleanup(); }
  catch { console.error(JSON.stringify({ code: 'FIXTURE_CLEANUP_FAILED', stage })); process.exitCode = 1; }
  await pool.end();
}
