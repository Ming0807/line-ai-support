import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {readPublicFamilyCatalog} from '../../lib/knowledge/family-catalog';
import {createKnowledgeToolRegistry} from '../../lib/ai/backend-tools';
import {createKnowledgeProducer,type KnowledgeProducerOptions} from '../../lib/knowledge/answer-producer';
import {searchKnowledge} from '../../lib/knowledge/retrieval';
import type {KnowledgeScope} from '../../lib/knowledge/types';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:4});
const createdDocuments:string[]=[];
after(async()=>{try{await pool.query("update public.documents set status='DRAFT',is_current=false,visibility='INTERNAL' where id=any($1::uuid[])",[createdDocuments]);}finally{await pool.end();}});
const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
const fingerprint='e'.repeat(64),vector=[1,0];
async function document(code:string,title:string,options:{visibility?:string;reviewed?:boolean;authority?:number}={}){
 const family=(await pool.query("insert into public.document_families(code,name,category) values($1,'PRIVATE_ADMIN_FAMILY_NAME','GUIDE') returning id",[code])).rows[0].id;
 const id=(await pool.query(`insert into public.documents(document_family_id,title,version_name,version_stream,status,is_current,approval_status,approved_at,
  official_source,extraction_reviewed,requires_review,visibility,archive_only,effective_from,audience,authority_level,source_url,checksum)
  values($1,$2,'current',$3,case when $4 then 'ACTIVE' else 'DRAFT' end,$4,'APPROVED',clock_timestamp(),true,$4,false,$5,false,'2026-01-01','ALL',$6,'https://nse.yru.ac.th/guide',$7) returning id`,
 [family,title,randomUUID(),options.reviewed??true,options.visibility??'PUBLIC',options.authority??80,randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
 createdDocuments.push(id);return id as string;
}
async function chunk(documentId:string,index:number,content:string){
 return (await pool.query(`insert into public.knowledge_chunks(document_id,chunk_index,section_title,content,embedding,embedding_dimensions,embedding_fingerprint,source_locations)
  values($1,$2,'คู่มือ Wi-Fi',$3,'[1,0]'::extensions.vector,2,$4,$5) returning id`,[documentId,index,content,fingerprint,
  JSON.stringify([{kind:'HTML',sourceUrl:'https://nse.yru.ac.th/guide',blockStart:index+1,blockEnd:index+1,headingPath:['คู่มือ Wi-Fi'],tableIndex:null}])])).rows[0].id as string;
}
const code=()=>`CAT_${randomUUID().replaceAll('-','').toUpperCase()}`;
test('catalog reads only approved current PUBLIC navigation names and excludes private admin family names',async()=>{
 const visible=code(),privateCode=code(),unreviewed=code();
 await document(visible,'Public Wi-Fi guide');await document(privateCode,'PRIVATE_SOURCE_TITLE',{visibility:'INTERNAL'});await document(unreviewed,'UNREVIEWED_TITLE',{reviewed:false});
 const client=await pool.connect();try{const catalog=await readPublicFamilyCatalog(client);assert(catalog);
  assert(catalog.some(row=>row.code===visible&&row.name==='Public Wi-Fi guide'));
  assert(!catalog.some(row=>row.code===privateCode||row.code===unreviewed));assert(!JSON.stringify(catalog).includes('PRIVATE_ADMIN_FAMILY_NAME'));
 }finally{client.release();}
});
test('the backend catalog tool requires current owned AI context and cannot run for HUMAN or another session',async()=>{
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[code()])).rows[0].id;
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 const registry=createKnowledgeToolRegistry(pool,{}),context={lineSessionId:session,conversationId:conversation,conversationRevision:0};
 const call={name:'get_public_family_catalog',arguments:{}};
 assert(Array.isArray(await registry.execute(call,context,['get_public_family_catalog'])));
 await assert.rejects(registry.execute(call,{...context,lineSessionId:randomUUID()},['get_public_family_catalog']));
 await pool.query("update public.conversations set mode='HUMAN' where id=$1",[conversation]);
 await assert.rejects(registry.execute(call,context,['get_public_family_catalog']));
});
test('one compact planner call selects two related families and real retrieval supplies complete ordered procedure evidence',async()=>{
 const first=code(),second=code(),unrelated=code();
 const guide=await document(first,'Connection guide'),registration=await document(second,'Registration guide');
 const other=await document(unrelated,'Unrelated high authority regulation',{authority:100});
 await chunk(other,0,'Unrelated policy cannot replace wireless instructions.');
 const before=await chunk(guide,0,'1. ลงทะเบียนอุปกรณ์ที่ passport.yru.ac.th');
 const privacy=await chunk(guide,1,'2. เลือก Phone MAC ก่อนเชื่อมต่อ');
 await chunk(guide,2,'3. เชื่อมต่อ YRU-WiFi');
 const register=await chunk(registration,0,'เลือก Register YRU WIFI แล้ว New กรอก Mac Address 12 หลักและกด Submit');
 const client=await pool.connect();let catalog;
 try{catalog=await readPublicFamilyCatalog(client);}finally{client.release();}assert(catalog);
 const calls:string[]=[];
 const generate:KnowledgeProducerOptions['generate']=async input=>{
  calls.push(input.taskType);
  if(input.taskType==='KNOWLEDGE_PLAN'){
   assert(JSON.parse(input.messages[1].content).familyCatalog.some((entry:{code:string})=>entry.code===first));
   return {output:input.responseSchema.parse({scope:{...scope,familyCodes:[first,second]},selection:{method:'RAG',query:null,notApplicable:null}}),toolCalls:[],providerId:'controlled',modelId:'controlled',fallbackUsed:false};
  }
  assert.equal(input.taskType,'KNOWLEDGE_ANSWER');
  const evidence=JSON.parse(input.messages[1].content).evidence as {content:string;chunkId:string}[];
  const joined=evidence.map(row=>row.content).join('\n');assert(joined.includes('Phone MAC'));assert(joined.includes('passport.yru.ac.th'));assert(joined.includes('Register YRU WIFI'));assert(!joined.includes('Unrelated policy'));
  assert(joined.indexOf('ลงทะเบียนอุปกรณ์')<joined.indexOf('Phone MAC'));assert(joined.indexOf('Phone MAC')<joined.indexOf('3. เชื่อมต่อ'));
  return {output:input.responseSchema.parse({answer:'1. ลงทะเบียนที่ passport.yru.ac.th ผ่าน Register YRU WIFI\n2. เลือก Phone MAC\n3. เชื่อมต่อ YRU-WiFi',citationChunkIds:[before,privacy,register]}),toolCalls:[],providerId:'controlled',modelId:'controlled',fallbackUsed:false};
 };
 const produce=createKnowledgeProducer({compactPlanning:true,publicFamilyCatalog:async()=>catalog,generate,structuredSearch:async()=>({status:'EMPTY'}),
  embed:async()=>({vectors:[vector],fingerprint,dimensions:2,providerId:'controlled',modelId:'controlled',fallbackUsed:false}),
  search:async input=>{const c=await pool.connect();try{await c.query('begin');return await searchKnowledge(c,input);}finally{await c.query('rollback');c.release();}}});
 const result=await produce({jobId:randomUUID(),sessionId:randomUUID(),conversationId:randomUUID(),messageId:randomUUID(),revision:0,question:'ต่อไวไฟมหาลัยยังไง',history:[]},new AbortController().signal);
 assert.equal(result.kind,'ANSWER');assert.deepEqual(calls,['KNOWLEDGE_PLAN','KNOWLEDGE_ANSWER']);
});
test('family navigation does not authorize a source revoked before the actual retrieval',async()=>{
 const selected=code(),source=await document(selected,'Revocable guide');await chunk(source,0,'Controlled revoked instructions');
 const client=await pool.connect();let catalog;try{catalog=await readPublicFamilyCatalog(client);}finally{client.release();}assert(catalog);
 let calls=0;
 const generate:KnowledgeProducerOptions['generate']=async input=>{
  calls++;assert.equal(input.taskType,'KNOWLEDGE_PLAN');
  await pool.query("update public.documents set visibility='INTERNAL' where id=$1",[source]);
  return {output:input.responseSchema.parse({scope:{...scope,familyCodes:[selected]},selection:{method:'RAG',query:null,notApplicable:null}}),toolCalls:[],providerId:'controlled',modelId:'controlled',fallbackUsed:false};
 };
 const produce=createKnowledgeProducer({compactPlanning:true,publicFamilyCatalog:async()=>catalog,generate,structuredSearch:async()=>({status:'EMPTY'}),
  embed:async()=>({vectors:[vector],fingerprint,dimensions:2,providerId:'controlled',modelId:'controlled',fallbackUsed:false}),
  search:async input=>{const c=await pool.connect();try{await c.query('begin');return await searchKnowledge(c,input);}finally{await c.query('rollback');c.release();}}});
 const result=await produce({jobId:randomUUID(),sessionId:randomUUID(),conversationId:randomUUID(),messageId:randomUUID(),revision:0,question:'ขอขั้นตอนใช้บริการ',history:[]},new AbortController().signal);
 assert.equal(result.kind,'CLARIFY');assert.equal(calls,1);
});

test('more than fifty public families returns unavailable catalog rather than silently dropping navigation choices',async()=>{
 for(let i=0;i<51;i++)await document(code(),`Guide ${i}`);
 const client=await pool.connect();try{assert.equal(await readPublicFamilyCatalog(client),null);}finally{client.release();}
});
