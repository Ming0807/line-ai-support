import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes, randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob} from '../../lib/ai/jobs';
import {runAICycle} from '../../lib/ai/run-worker';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import {expandSameSection} from '../../lib/knowledge/section-expansion';
import {processStudentContent} from '../../lib/conversation/student-processing';
import {SHOW_FULL_LABEL} from '../../lib/line/answer-presentation';
import type {KnowledgeScope} from '../../lib/knowledge/types';
import {decryptValue, encryptValue, hashLineUserId} from '../../lib/security/identity';

// CONV-V2-05 on a disposable database with every migration (scripts/database/run-owned-test.ts).
const database = process.env.YRU_OWNED_DATABASE;
assert.match(database ?? '', /^yru_owned_[a-f0-9]{12}$/u, 'run through scripts/database/run-owned-test.ts');
const pool = new Pool({connectionString: `postgresql://postgres:postgres@127.0.0.1:54422/${database}`, max: 4});
const key = randomBytes(32).toString('base64');
const fingerprint = 'f'.repeat(64);
const vector = [1, 0];
const scope: KnowledgeScope = {historical: false, academicYear: null, asOfDate: null, familyCodes: [], departmentCode: null,
  audience: null, studentType: null, semester: null, programCode: null, curriculumCode: null, cohort: null};
const longAnswer = Array.from({length: 10}, (_, index) => `${index + 1}. ขั้นตอนที่ ${index + 1} ${'ก'.repeat(100)}`).join('\n');

async function setup() {
  const session = (await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id', [randomUUID()])).rows[0].id;
  const user = 'U' + randomUUID().replaceAll('-', '');
  await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
    [session, hashLineUserId(user, key), encryptValue(user, key)]);
  const conversation = (await pool.query('insert into public.conversations(line_session_id) values($1) returning id', [session])).rows[0].id;
  const code = 'FIXTURE_' + randomUUID().replaceAll('-', '').toUpperCase();
  scope.familyCodes = [code];
  const family = (await pool.query(`insert into public.document_families(code,name,category) values($1,'Controlled guide','GUIDE') returning id`, [code])).rows[0].id;
  const document = (await pool.query(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,
   approval_status,approved_at,official_source,extraction_reviewed,requires_review,effective_from,source_url,checksum)
   values($1,'คู่มือ Wi-Fi มหาวิทยาลัย','2569','controlled','ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'2026-01-01',
   'https://fixture.yru.ac.th/wifi.pdf',$2) returning id`, [family, 'b'.repeat(64)])).rows[0].id;
  for (const [index, vectorText] of [[0, '[1,0]'], [1, '[0.6,0.8]'], [2, '[0.6,0.8]']] as const) {
    await pool.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,section_title,content,embedding,embedding_dimensions,embedding_fingerprint)
     values($1,$2,3,'เชื่อมต่อ Wi-Fi',$3,$4,2,$5)`, [document, index, `ขั้นที่ ${index + 1} ของการเชื่อมต่อ`, vectorText, fingerprint]);
  }
  return {session, user, conversation, document};
}

async function ask(session: string, conversation: string, text: string) {
  const message = (await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT',$2) returning id`,
    [conversation, text])).rows[0].id;
  await transaction(c => prepareAIJob(c, {sessionId: session, conversationId: conversation, messageId: message, replyToken: 'private-token', receivedAt: new Date()}, key), pool);
}

/** Same shape the V2 flow returns: selected evidence plus its whole section, citing an added chunk. */
async function sectionAnswer() {
  const evidence = await transaction(async c => {
    const selected = await searchKnowledge(c, {scope, vector, fingerprint, threshold: 0.9, limit: 1});
    return (await expandSameSection(c, selected, {vector, fingerprint})).evidence;
  }, pool);
  assert.equal(evidence.length, 3, 'section expansion supplies all three steps');
  return {kind: 'ANSWER' as const, output: {answer: longAnswer, citationChunkIds: [evidence[2].chunkId]}, scope, evidence,
    queryVector: vector, fingerprint, sectionExpanded: true as const};
}

async function outbox(conversation: string) {
  return (await pool.query('select kind,payload_encrypted from private.message_outbox where conversation_id=$1 order by created_at,id', [conversation])).rows
    .map(row => ({kind: row.kind as string, ...JSON.parse(decryptValue(row.payload_encrypted, key))}));
}

async function press(session: string, user: string, data: string) {
  const eventId = randomUUID();
  await transaction(c => processStudentContent(c, {sessionId: session, eventId, receivedAt: new Date(),
    event: {type: 'postback', source: {type: 'user', userId: user}, postback: {data}, replyToken: 'press-token'}}, key), pool);
  return (await pool.query('select payload_encrypted from private.message_outbox where idempotency_key=$1', [`student-response:${eventId}`])).rows
    .map(row => JSON.parse(decryptValue(row.payload_encrypted, key)))[0];
}

test('a long section answer is sent short first and the full text is sent once on request after a fresh evidence check', async () => {
  const f = await setup();
  await ask(f.session, f.conversation, 'ต่อไวไฟมหาลัยยังไง');
  assert.equal((await runAICycle(pool, key, {produce: sectionAnswer})).completed, 1);

  const [short] = await outbox(f.conversation);
  assert.equal(short.messages.length, 1);
  const first = short.messages[0];
  assert(first.text.length < longAnswer.length);
  assert(first.text.startsWith('1. ขั้นตอนที่ 1'));
  assert(first.text.includes('ที่มา: คู่มือ Wi-Fi มหาวิทยาลัย'));
  assert.equal(first.quickReply.items.length, 1);
  assert.equal(first.quickReply.items[0].action.label, SHOW_FULL_LABEL);
  const stored = (await pool.query("select metadata from public.messages where conversation_id=$1 and sender_type='AI'", [f.conversation])).rows;
  assert.equal(stored[0].metadata.presentation, 'SHORT_FIRST');

  const full = await press(f.session, f.user, first.quickReply.items[0].action.data);
  const fullText = full.messages.map((message: {text: string}) => message.text).join('');
  assert(fullText.includes('10. ขั้นตอนที่ 10'));
  assert(fullText.includes('แหล่งอ้างอิง'));
  const kinds = (await outbox(f.conversation)).map(row => row.kind);
  assert.deepEqual(kinds, ['AI', 'AI'], 'the full text uses the AI outbox fence for this conversation');
  const presentations = (await pool.query("select metadata->>'presentation' p from public.messages where conversation_id=$1 and sender_type='AI' order by created_at,id",
    [f.conversation])).rows.map(row => row.p);
  assert.deepEqual(presentations, ['SHORT_FIRST', 'FULL_ON_REQUEST']);

  const again = await press(f.session, f.user, first.quickReply.items[0].action.data);
  assert(again.messages[0].text.includes('หมดอายุหรือถูกใช้แล้ว'), 'the choice is single-use');
});

test('the full text is refused when the source changed after the short answer', async () => {
  const f = await setup();
  await ask(f.session, f.conversation, 'ต่อไวไฟมหาลัยยังไง');
  assert.equal((await runAICycle(pool, key, {produce: sectionAnswer})).completed, 1);
  const [short] = await outbox(f.conversation);
  await pool.query("update public.knowledge_chunks set content='ขั้นที่ 3 ฉบับแก้ไข' where document_id=$1 and chunk_index=2", [f.document]);
  const reply = await press(f.session, f.user, short.messages[0].quickReply.items[0].action.data);
  assert(reply.messages[0].text.includes('เปลี่ยนแล้วหรือหมดอายุ'));
  assert(!reply.messages[0].text.includes('ขั้นตอนที่ 10'));
});

test('the full text is never sent after Staff takes over the conversation', async () => {
  const f = await setup();
  await ask(f.session, f.conversation, 'ต่อไวไฟมหาลัยยังไง');
  assert.equal((await runAICycle(pool, key, {produce: sectionAnswer})).completed, 1);
  const [short] = await outbox(f.conversation);
  await pool.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1", [f.conversation]);
  const reply = await press(f.session, f.user, short.messages[0].quickReply.items[0].action.data);
  assert(!JSON.stringify(reply).includes('ขั้นตอนที่ 10'));
  assert.equal((await outbox(f.conversation)).length, 1, 'no second AI message was queued for the conversation');
});

test('a V2 failure message offers the existing talk-to-staff choice', async () => {
  const f = await setup();
  await ask(f.session, f.conversation, 'สวัสดี');
  const {TURN_FAILED_TEXT} = await import('../../lib/ai/turn-flow-v2');
  assert.equal((await runAICycle(pool, key, {produce: async () => ({kind: 'CLARIFY', text: TURN_FAILED_TEXT})})).completed, 1);
  const [reply] = await outbox(f.conversation);
  assert.equal(reply.messages[0].text, TURN_FAILED_TEXT);
  assert.equal(reply.messages[0].quickReply.items[0].action.label, 'คุยกับเจ้าหน้าที่');
  const offered = (await pool.query("select choice from private.pending_route_choices where line_session_id=$1", [f.session])).rows;
  assert.deepEqual(offered.map(row => row.choice.action), ['CONTACT']);
});

test.after(async () => {
  await pool.end();
});
