import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import type {KnowledgeScope} from '../../lib/knowledge/types';

const fingerprint='d'.repeat(64),scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
async function fixture(work:(client:PoolClient,family:string,code:string)=>Promise<void>){
 const pool=new Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres',max:2}),client=await pool.connect();
 try{await client.query('begin');const code='REL_'+randomUUID().replaceAll('-','').toUpperCase();
 const family=(await client.query("insert into public.document_families(code,name,category) values($1,'Controlled relationships','REGULATION') returning id",[code])).rows[0].id;
 await work(client,family,code);
 }finally{await client.query('rollback');client.release();await pool.end();}
}
async function doc(c:PoolClient,family:string,options:{current?:boolean;from?:string;to?:string;status?:string;audience?:string;visibility?:string;vector?:string|null;year?:number;department?:string;approvedAt?:string}={}){
 const id=(await c.query(`insert into public.documents(document_family_id,title,version_name,version_stream,academic_year,status,is_current,approval_status,approved_at,official_source,extraction_reviewed,requires_review,visibility,effective_from,effective_to,audience,checksum,source_url,department_id)
 values($1,'Controlled relationship source','v1','main',$2,$3,$4,'APPROVED',coalesce($10::timestamptz,clock_timestamp()),true,true,false,$5,$6,$7,$8,$9,'https://fixture.yru.ac.th/rules.pdf',(select id from public.departments where code=$11)) returning id`,[family,options.year??2569,options.status??'ACTIVE',options.current??false,options.visibility??'PUBLIC',options.from??'2026-01-01',options.to??null,options.audience??'ALL',randomUUID().replaceAll('-','').repeat(2),options.approvedAt??null,options.department??null])).rows[0].id;
 if(options.vector!==null)await c.query(`insert into public.knowledge_chunks(document_id,chunk_index,content,embedding,embedding_dimensions,embedding_fingerprint) values($1,0,'Exact controlled passage',$2::extensions.vector,2,$3)`,[id,options.vector??'[1,0]',fingerprint]);return id as string;
}
const relate=(c:PoolClient,source:string,target:string,type:'AMENDS'|'CANCELS')=>c.query('insert into public.document_relationships(source_document_id,target_document_id,relation_type) values($1,$2,$3)',[source,target,type]);
const search=(c:PoolClient,code:string,patch:Partial<KnowledgeScope>={},today='2026-10-06',limit=12)=>searchKnowledge(c,{scope:{...scope,familyCodes:[code],...patch},vector:[1,0],fingerprint,limit},today);

test('retrieval includes the base and every applicable amendment even a low similarity required member',()=>fixture(async(c,family,code)=>{
 const base=await doc(c,family,{current:true}),a=await doc(c,family),b=await doc(c,family,{vector:'[0,1]'});
 await relate(c,a,base,'AMENDS');await relate(c,b,base,'AMENDS');
 const rows=await search(c,code);assert.deepEqual(new Set(rows.map(r=>r.documentId)),new Set([base,a,b]));
 assert(rows.every(r=>r.ruleProof?.baseDocumentId===base&&r.ruleProof.ruleRevision==='0'&&r.ruleProof.evaluationDate==='2026-10-06'));
 assert.equal(new Set(rows.map(r=>r.ruleProof?.contextDigest)).size,1);
}));
test('future, expired, private, wrong-year and known wrong-audience instruments do not join a public group',()=>fixture(async(c,family,code)=>{
 const base=await doc(c,family,{current:true});
 for(const options of [{from:'2027-01-01'},{to:'2026-09-01'},{visibility:'INTERNAL'},{year:2568},{audience:'WEEKEND'}])await relate(c,await doc(c,family,options),base,'AMENDS');
 assert.deepEqual((await search(c,code,{audience:'REGULAR'})).map(r=>r.documentId),[base]);
}));
test('unknown student scope with a potentially applicable narrow amendment requires clarification',()=>fixture(async(c,family,code)=>{
 const base=await doc(c,family,{current:true});await relate(c,await doc(c,family,{audience:'REGULAR'}),base,'AMENDS');
 await assert.rejects(search(c,code),{message:'KNOWLEDGE_SCOPE_AMBIGUOUS'});
 assert.equal((await search(c,code,{audience:'REGULAR'})).length,2);
}));
test('cancelling one amendment retains base and other amendments; cancelling base removes the group',()=>fixture(async(c,family,code)=>{
 const base=await doc(c,family,{current:true}),a=await doc(c,family),b=await doc(c,family);
 await relate(c,a,base,'AMENDS');await relate(c,b,base,'AMENDS');await relate(c,await doc(c,family),a,'CANCELS');
 assert.deepEqual(new Set((await search(c,code)).map(r=>r.documentId)),new Set([base,b]));
 await relate(c,await doc(c,family),base,'CANCELS');assert.deepEqual(await search(c,code),[]);
}));
test('historical as-of dates resolve relationship effects without instruments competing as base versions',()=>fixture(async(c,family,code)=>{
 const base=await doc(c,family,{current:true}),a=await doc(c,family,{from:'2026-06-01'}),cancel=await doc(c,family,{from:'2026-09-01'});
 await relate(c,a,base,'AMENDS');await relate(c,cancel,a,'CANCELS');
 const at=(date:string)=>search(c,code,{historical:true,asOfDate:date});
 assert.deepEqual((await at('2026-05-01')).map(r=>r.documentId),[base]);
 assert.deepEqual(new Set((await at('2026-08-01')).map(r=>r.documentId)),new Set([base,a]));
 assert.deepEqual((await at('2026-10-01')).map(r=>r.documentId),[base]);
 await assert.rejects(search(c,code,{historical:true,academicYear:2569}),{message:'KNOWLEDGE_SCOPE_AMBIGUOUS'});
}));
test('a missing required vector cannot silently produce a base-only answer',()=>fixture(async(c,family,code)=>{
 const base=await doc(c,family,{current:true});await relate(c,await doc(c,family,{vector:null}),base,'AMENDS');
 await assert.rejects(search(c,code),{message:'KNOWLEDGE_CONTEXT_INCOMPLETE'});
}));
test('thirteen mandatory members cannot be truncated to a twelve-evidence result',()=>fixture(async(c,family,code)=>{
 const base=await doc(c,family,{current:true});for(let i=0;i<12;i++)await relate(c,await doc(c,family),base,'AMENDS');
 await assert.rejects(search(c,code),{message:'KNOWLEDGE_CONTEXT_INCOMPLETE'});
}));
test('date, membership and family revision change proof while the base chunk itself stays unchanged',()=>fixture(async(c,family,code)=>{
 const base=await doc(c,family,{current:true}),a=await doc(c,family,{from:'2026-10-07'});await relate(c,a,base,'AMENDS');
 const before=(await search(c,code)).find(r=>r.documentId===base)!,after=(await search(c,code,{},'2026-10-07')).find(r=>r.documentId===base)!;
 assert.equal(before.chunkId,after.chunkId);assert.notEqual(before.ruleProof?.contextDigest,after.ruleProof?.contextDigest);
 await c.query('update public.document_families set rule_revision=rule_revision+1 where id=$1',[family]);
 assert.equal((await search(c,code))[0].ruleProof?.ruleRevision,'1');
}));
test('group ranking includes exact-department relevance and freshness of its required amendments',()=>fixture(async(c,family,code)=>{
 const base=await doc(c,family,{current:true,approvedAt:'2026-01-01'}),a=await doc(c,family,{department:'IT',approvedAt:'2026-10-01'});await relate(c,a,base,'AMENDS');
 const otherCode=code+'_OTHER',other=(await c.query("insert into public.document_families(code,name,category) values($1,'Other controlled rule','REGULATION') returning id",[otherCode])).rows[0].id;
 await doc(c,other,{current:true,department:'IT',approvedAt:'2026-09-01'});
 const rows=await searchKnowledge(c,{scope:{...scope,familyCodes:[code,otherCode],departmentCode:'IT'},vector:[1,0],fingerprint,limit:2},'2026-10-06');
 assert.deepEqual(new Set(rows.map(r=>r.documentId)),new Set([base,a]));
}));
test('visible legacy indirect amendment and cancellation chains require controlled incomplete-context handling',()=>fixture(async(c,family,code)=>{
 const base=await doc(c,family,{current:true}),a=await doc(c,family);await relate(c,a,base,'AMENDS');
 const indirect=await doc(c,family);await relate(c,indirect,a,'AMENDS');
 await assert.rejects(search(c,code),{message:'KNOWLEDGE_CONTEXT_INCOMPLETE'});
 await c.query("delete from public.document_relationships where source_document_id=$1",[indirect]);
 const cancel=await doc(c,family);await relate(c,cancel,a,'CANCELS');await relate(c,indirect,cancel,'CANCELS');
 await assert.rejects(search(c,code),{message:'KNOWLEDGE_CONTEXT_INCOMPLETE'});
 await c.query("update public.documents set visibility='INTERNAL' where id=$1",[indirect]);
 assert.deepEqual((await search(c,code)).map(r=>r.documentId),[base]);
}));
