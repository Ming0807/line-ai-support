import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob} from '../../lib/imports/import-staging';
import {analyzeImportJob,editImportExtraction} from '../../lib/imports/import-extraction';
import {getImportModelAssistance} from '../../lib/imports/model-assistance';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DATABASE_REQUIRED');
async function fixture(work:(value:{pool:Pool;actor:string;id:string;options:{pool:Pool;key:string}})=>Promise<void>){
 const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4}),actor=randomUUID(),key=Buffer.alloc(32,93).toString('base64');
 try{
  await pool.query('insert into auth.users(id) values($1)',[actor]);
  await pool.query("insert into public.staff_profiles(id,role,display_name,active) values($1,'SUPER_ADMIN','Synthetic import model reviewer',true)",[actor]);
  const source=createImportSource({bytes:Buffer.from(`<html><h1>คู่มือห้องสมุด ${randomUUID()}</h1><p>ปีการศึกษา 2569</p></html>`),filename:'synthetic.html',mimeType:'text/html',sourceUrl:'https://fixture.yru.ac.th/guide',acquiredFrom:'UPLOAD',fetchedAt:null});
  const options={pool,key},created=await createImportJob(actor,source,{...options,originalBackend:'PRIVATE_DATABASE'});
  await analyzeImportJob(actor,created.job.id,0,options);
  await work({pool,actor,id:created.job.id,options});
 }finally{await pool.end();} // Parent owns and drops the exact disposable database; never normal tables.
}
const request={expectedJobRevision:1,expectedExtractionRevision:1,externalProcessingConfirmed:true};
test('actual import model proposal does not hold SQL or mutate review/publication',()=>fixture(async f=>{
 const before=(await f.pool.query('select revision,publication_status from private.knowledge_import_jobs where id=$1',[f.id])).rows[0];
 let called=false;
 const result=await getImportModelAssistance(f.actor,f.id,request,{...f.options,generate:async input=>{
  called=true;assert.equal(input.taskType,'IMPORT_METADATA');
  assert.equal(Number((await f.pool.query("select count(*) n from pg_stat_activity where datname=current_database() and state='idle in transaction'")).rows[0].n),0);
  return {output:{suggestions:[]},toolCalls:[]};
 }});
 assert(called);assert.equal(result.jobRevision,1);
 assert.deepEqual((await f.pool.query('select revision,publication_status from private.knowledge_import_jobs where id=$1',[f.id])).rows[0],before);
 assert.equal(Number((await f.pool.query('select count(*) n from private.knowledge_import_publications where job_id=$1',[f.id])).rows[0].n),0);
}));
test('actual concurrent extraction edit invalidates a model result',()=>fixture(async f=>{
 await assert.rejects(getImportModelAssistance(f.actor,f.id,request,{...f.options,generate:async()=>{
  await editImportExtraction(f.actor,f.id,1,{title:'Changed synthetic title',reason:'Concurrent edit fixture'},f.options);
  return {output:{suggestions:[]},toolCalls:[]};
 }}),/CONFLICT/);
}));
test('revoked admin during model generation cannot receive the result',()=>fixture(async f=>{
 await assert.rejects(getImportModelAssistance(f.actor,f.id,request,{...f.options,generate:async()=>{
  await f.pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);
  return {output:{suggestions:[]},toolCalls:[]};
 }}),/FORBIDDEN/);
}));
test('a family removed during model generation invalidates its suggestion',()=>fixture(async f=>{
 const familyId=randomUUID(),code=`TEST_${randomUUID().replaceAll('-','').toUpperCase()}`;
 await f.pool.query('insert into public.document_families(id,code,name,category) values($1,$2,$3,$4)',[familyId,code,'คู่มือห้องสมุด','Synthetic']);
 await assert.rejects(getImportModelAssistance(f.actor,f.id,request,{...f.options,generate:async()=>{
  await f.pool.query('delete from public.document_families where id=$1',[familyId]);
  return {output:{suggestions:[{field:'familyCode',value:code,segmentId:'p1',quote:'คู่มือห้องสมุด'}]},toolCalls:[]};
 }}),/CONFLICT/);
}));

test('oversized reference catalog refuses inference without silently dropping references',()=>fixture(async f=>{
 const prefix=`BOUND_${randomUUID().replaceAll('-','').toUpperCase()}`;
 const ids:string[]=[];
 try{
  for(let index=0;index<110;index++){
   const id=randomUUID();ids.push(id);
   await f.pool.query('insert into public.departments(id,code,name_th,name_en) values($1,$2,$3,$3)',[id,`${prefix}_${index}`,'Synthetic reference '.repeat(10)]);
  }
  let called=false;
  await assert.rejects(getImportModelAssistance(f.actor,f.id,request,{...f.options,generate:async()=>{
   called=true;return {output:{suggestions:[]},toolCalls:[]};
  }}),/AI_UNAVAILABLE/);
  assert.equal(called,false);
 }finally{await f.pool.query('delete from public.departments where id=any($1::uuid[])',[ids]);}
}));
