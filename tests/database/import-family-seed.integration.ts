import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {getInitialDocumentFamilies} from '../../lib/imports/family-catalog';
import {seedInitialDocumentFamilies} from '../../lib/imports/family-seed';
test('fixed nineteen-family seed dry-run is read-only; apply/idempotent replay preserve existing metadata and publish nothing',async()=>{
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'}),client=await pool.connect();
 try{
  await client.query('begin');
  await client.query("insert into public.document_families(code,name,category,default_storage_mode) values('ACADEMIC_CALENDAR','ชื่อที่มหาวิทยาลัยตั้งไว้','รักษาค่าเดิม','BOTH') on conflict(code) do nothing");
  const preserved=(await client.query("select * from public.document_families where code='ACADEMIC_CALENDAR'")).rows[0];
  const before=(await client.query('select (select count(*) from public.document_families) f,(select count(*) from public.documents) d,(select count(*) from public.knowledge_chunks) c')).rows[0];
  const dry=await seedInitialDocumentFamilies(client,false);assert.equal(dry.requested,19);assert.equal(dry.inserted,0);assert.equal(dry.existing+dry.missingCodes.length,19);
  assert.deepEqual((await client.query('select (select count(*) from public.document_families) f,(select count(*) from public.documents) d,(select count(*) from public.knowledge_chunks) c')).rows[0],before);
  const applied=await seedInitialDocumentFamilies(client,true);assert.equal(applied.requested,19);assert.equal(applied.inserted,dry.missingCodes.length);assert.deepEqual(applied.missingCodes,[]);
  assert.deepEqual((await client.query("select * from public.document_families where code='ACADEMIC_CALENDAR'")).rows[0],preserved);
  const replay=await seedInitialDocumentFamilies(client,true);assert.equal(replay.existing,19);assert.equal(replay.inserted,0);
  const rows=(await client.query('select code from public.document_families where code=any($1::text[]) order by code',[getInitialDocumentFamilies().map(row=>row.code)])).rows;assert.equal(rows.length,19);
  assert.deepEqual((await client.query('select (select count(*) from public.documents) d,(select count(*) from public.knowledge_chunks) c')).rows[0],{d:before.d,c:before.c});
 }finally{await client.query('rollback');client.release();await pool.end();}
});
