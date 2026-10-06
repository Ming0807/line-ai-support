import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {getImportAssistance} from '../../lib/imports/assistance';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob,readImportOriginal} from '../../lib/imports/import-staging';
import {analyzeImportJob,editImportExtraction} from '../../lib/imports/import-extraction';
import {saveImportReview,getImportReview} from '../../lib/imports/import-review';
import {applyImportAssistance,parseAssistanceEnvelope} from '../../lib/imports/assistance-contract';
import {unfinishedReviewDraft} from '../fixtures/import-review';
async function fixture(work:(f:{pool:Pool;actor:string;staff:string;key:string})=>Promise<void>){
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:4}),actor=randomUUID(),staff=randomUUID(),key=Buffer.alloc(32,98).toString('base64'),referenceId=randomUUID();
 try{
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']]){await pool.query('insert into auth.users(id) values($1)',[id]);await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Assistance fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);}
  await pool.query("insert into public.document_families(id,code,name,category) values($1,'WIFI_GUIDE','คู่มือ Wi-Fi','ระบบดิจิทัล') on conflict(code) do nothing",[referenceId]);
  await work({pool,actor,staff,key});
 }finally{await pool.query('delete from private.knowledge_import_jobs where creator_id=$1',[actor]);await pool.query('delete from public.document_families where id=$1',[referenceId]);await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[[actor,staff]]);await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[[actor,staff]]);await pool.query('delete from auth.users where id=any($1::uuid[])',[[actor,staff]]);await pool.end();}
}
async function ready(f:{pool:Pool;actor:string;key:string}){
 const options={pool:f.pool,key:f.key,originalBackend:'PRIVATE_DATABASE' as const};
 const source=createImportSource({bytes:Buffer.from(`<html><h1>คู่มือ Wi-Fi ${randomUUID()}</h1><p>ปีการศึกษา 2569</p><p>ประกาศ ณ วันที่ ๖ ตุลาคม พ.ศ. ๒๕๖๙</p><p>มีผลตั้งแต่วันที่ 1 พฤศจิกายน 2569</p></html>`),filename:'assistance.html',mimeType:'text/html',sourceUrl:'https://fixture.yru.ac.th/assistance.html',acquiredFrom:'UPLOAD',fetchedAt:null});
 const {job}=await createImportJob(f.actor,source,options);const preview=await analyzeImportJob(f.actor,job.id,0,options);return {options,source,job:preview.job,preview};
}
test('assistance denies ordinary/inactive actors before private originals and aborts safely',()=>fixture(async f=>{
 const denied={pool:f.pool,get key():string{throw new Error('PRIVATE_KEY_BEFORE_AUTH');}};
 await assert.rejects(getImportAssistance(f.staff,'malformed',denied),/FORBIDDEN/);
 const r=await ready(f),controller=new AbortController();controller.abort();await assert.rejects(getImportAssistance(f.actor,r.job.id,{...r.options,signal:controller.signal}),/CONFLICT/);
 await assert.rejects(getImportAssistance(f.actor,'invalid',r.options),/NOT_FOUND/);
 await f.pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);await assert.rejects(getImportAssistance(f.actor,r.job.id,r.options),/FORBIDDEN/);
}));
test('actual extraction provides bound suggestions and reference names without publishing or changing saved review',()=>fixture(async f=>{
 const r=await ready(f),before=(await f.pool.query('select revision,publication_status from private.knowledge_import_jobs where id=$1',[r.job.id])).rows[0];
 const a=await getImportAssistance(f.actor,r.job.id,r.options);assert.equal(a.jobRevision,1);assert.equal(a.extractionRevision,1);assert.equal(a.metadata.title,r.preview.analysis.title);assert.equal(a.metadata.publishedAt,'2026-10-06');assert.equal(a.metadata.effectiveFrom,'2026-11-01');assert.equal(a.metadata.visibility,'INTERNAL');assert(a.departments.some(d=>d.code==='IT'&&d.name));assert(a.families.some(v=>v.code==='WIFI_GUIDE'));
 assert.equal(a.metadata.familyCode,'WIFI_GUIDE');assert.equal(a.metadata.departmentCode,'IT');assert.equal(a.metadata.academicYear,2569);assert.equal(a.metadata.sourceUrl,r.job.sourceUrl);
 const draft=applyImportAssistance(unfinishedReviewDraft(),a);draft.metadata.title='คนตรวจแก้ชื่อแล้ว';const saved=await saveImportReview(f.actor,r.job.id,{expectedJobRevision:1,expectedExtractionRevision:1,expectedReviewRevision:0,draft},r.options);
 await getImportAssistance(f.actor,r.job.id,r.options);assert.deepEqual(await getImportReview(f.actor,r.job.id,r.options),saved);assert.deepEqual((await f.pool.query('select revision,publication_status from private.knowledge_import_jobs where id=$1',[r.job.id])).rows[0],before);assert.equal((await f.pool.query('select count(*)::int n from private.knowledge_import_publications where job_id=$1',[r.job.id])).rows[0].n,0);
 assert.deepEqual(Buffer.from((await readImportOriginal(f.actor,r.job.id,r.options)).bytes),Buffer.from(r.source.bytes));
 for(const field of ['original_ciphertext','analysis_encrypted','content','actorId','checksum','secret'])assert(!JSON.stringify(a).includes(field));
}));
test('editing extraction changes proposal bindings and old proposal is rejected',()=>fixture(async f=>{
 const r=await ready(f),old=await getImportAssistance(f.actor,r.job.id,r.options);const pages=r.preview.extraction.pages.flatMap((p,index)=>p.text.includes('1 พฤศจิกายน 2569')?[{index,text:p.text.replace('1 พฤศจิกายน 2569','2026-12-01')}]:[]);assert(pages.length>0);await editImportExtraction(f.actor,r.job.id,1,{reason:'Controlled date correction',pages},r.options);
 const latest=await getImportAssistance(f.actor,r.job.id,r.options);assert.equal(latest.jobRevision,2);assert.equal(latest.extractionRevision,2);assert.equal(latest.metadata.effectiveFrom,'2026-12-01');assert.equal(parseAssistanceEnvelope({assistance:old},{jobId:r.job.id,jobRevision:2,extractionRevision:2}),null);
}));
test('concurrent extraction change between read and final snapshot rejects an obsolete proposal',()=>fixture(async f=>{
 const r=await ready(f);
 const options={...r.options,beforeRead:async()=>{await editImportExtraction(f.actor,r.job.id,1,{reason:'Concurrent controlled edit',title:'New title revision'},r.options);}};
 await assert.rejects(getImportAssistance(f.actor,r.job.id,options),/CONFLICT/);
}));
