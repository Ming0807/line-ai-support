import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool, type PoolClient} from 'pg';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import {expandSameSection} from '../../lib/knowledge/section-expansion';
import type {KnowledgeScope} from '../../lib/knowledge/types';

// CONV-V2-02: real PostgreSQL proof that same-section expansion keeps retrieval's eligibility,
// document revision and section boundaries. Every case runs in a rolled-back transaction.
const baseScope: KnowledgeScope = {historical: false, academicYear: null, asOfDate: null, familyCodes: [], departmentCode: null,
  audience: null, studentType: null, semester: null, programCode: null, curriculumCode: null, cohort: null};
const fingerprint = 'd'.repeat(64);
const database = process.env.YRU_OWNED_DATABASE;
assert.match(database ?? '', /^yru_owned_[a-f0-9]{12}$/u, 'run through scripts/database/run-owned-test.ts');
const poolOptions = {connectionString: `postgresql://postgres:postgres@127.0.0.1:54422/${database}`, max: 2};
const today = '2026-10-04';

interface ChunkSpec {
  index: number;
  section: string;
  content: string;
  vector?: string;
  requiresReview?: boolean;
}

async function guide(client: PoolClient, code: string, chunks: ChunkSpec[]) {
  const family = (await client.query(`insert into public.document_families(code,name,category) values($1,'Controlled guide','GUIDE')
  on conflict(code) do update set name=excluded.name returning id`, [code])).rows[0].id;
  const id = (await client.query(`insert into public.documents(document_family_id,title,version_name,version_stream,academic_year,
  status,is_current,approval_status,approved_at,official_source,extraction_reviewed,requires_review,visibility,archive_only,
  effective_from,effective_to,audience,program_code,cohort,authority_level,source_url,checksum)
  values($1,'Controlled Wi-Fi guide','2569',$2,2569,'ACTIVE',true,'APPROVED',clock_timestamp(),true,true,false,'PUBLIC',false,
  '2026-01-01',null,'ALL',null,null,100,'https://fixture.yru.ac.th/wifi.pdf',$3) returning id`,
  [family, randomUUID(), randomUUID().replaceAll('-', '').repeat(2)])).rows[0].id;
  const ids: string[] = [];
  for (const chunk of chunks) {
    ids.push((await client.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,section_title,content,requires_review,
    embedding,embedding_dimensions,embedding_fingerprint) values($1,$2,null,$3,$4,$5,$6::extensions.vector,2,$7) returning id`,
    [id, chunk.index, chunk.section, chunk.content, chunk.requiresReview ?? false, chunk.vector ?? '[0.6,0.8]', fingerprint])).rows[0].id);
  }
  return {id, ids};
}

async function withDatabase(work: (client: PoolClient) => Promise<void>) {
  const pool = new Pool(poolOptions), client = await pool.connect();
  try {
    await client.query('begin');
    await work(client);
  } finally {
    await client.query('rollback');
    client.release();
    await pool.end();
  }
}

const familyCode = () => 'FIXTURE_' + randomUUID().replaceAll('-', '').toUpperCase();

test('real PG adds the whole matched section in order and stops at the next heading', () => withDatabase(async client => {
  const code = familyCode();
  const doc = await guide(client, code, [
    {index: 0, section: 'เชื่อมต่อ Wi-Fi', content: '1. เปิดการตั้งค่า Wi-Fi'},
    {index: 1, section: 'เชื่อมต่อ Wi-Fi', content: '2. ปิด MAC แบบสุ่มของอุปกรณ์', vector: '[1,0]'},
    {index: 2, section: 'เชื่อมต่อ Wi-Fi', content: '3. เข้าสู่ระบบที่ passport'},
    {index: 3, section: 'การพิมพ์', content: 'ขั้นตอนการพิมพ์งาน'},
  ]);
  const selected = await searchKnowledge(client, {scope: {...baseScope, familyCodes: [code]}, vector: [1, 0], fingerprint, threshold: 0.9, limit: 1}, today);
  assert.deepEqual(selected.map(item => item.chunkId), [doc.ids[1]]);
  const result = await expandSameSection(client, selected, {vector: [1, 0], fingerprint});
  assert.equal(result.incompleteSections, 0);
  assert.deepEqual(result.evidence.map(item => item.chunkId), [doc.ids[1], doc.ids[0], doc.ids[2]]);
  assert(result.evidence.every(item => item.documentId === doc.id && item.ruleProof));
  assert(result.evidence.every(item => Number.isFinite(item.similarity)));
}));

test('real PG skips a section that contains a chunk still requiring review', () => withDatabase(async client => {
  const code = familyCode();
  const doc = await guide(client, code, [
    {index: 0, section: 'ขั้นตอน', content: 'ขั้นที่ 1', vector: '[1,0]'},
    {index: 1, section: 'ขั้นตอน', content: 'ขั้นที่ 2 ยังไม่ผ่านการตรวจ', requiresReview: true},
    {index: 2, section: 'ขั้นตอน', content: 'ขั้นที่ 3'},
  ]);
  const selected = await searchKnowledge(client, {scope: {...baseScope, familyCodes: [code]}, vector: [1, 0], fingerprint, threshold: 0.9, limit: 1}, today);
  const result = await expandSameSection(client, selected, {vector: [1, 0], fingerprint});
  assert.deepEqual(result.evidence.map(item => item.chunkId), [doc.ids[0]]);
  assert.equal(result.incompleteSections, 1);
  assert(!result.evidence.some(item => item.content.includes('ยังไม่ผ่าน')));
}));

test('real PG adds nothing when the selected revision is no longer current', () => withDatabase(async client => {
  const code = familyCode();
  const doc = await guide(client, code, [
    {index: 0, section: 'ขั้นตอน', content: 'ขั้นที่ 1', vector: '[1,0]'},
    {index: 1, section: 'ขั้นตอน', content: 'ขั้นที่ 2'},
  ]);
  const selected = await searchKnowledge(client, {scope: {...baseScope, familyCodes: [code]}, vector: [1, 0], fingerprint, threshold: 0.9, limit: 1}, today);
  await client.query('update public.documents set revision=revision+1 where id=$1', [doc.id]);
  const result = await expandSameSection(client, selected, {vector: [1, 0], fingerprint});
  assert.deepEqual(result.evidence.map(item => item.chunkId), [doc.ids[0]]);
}));
