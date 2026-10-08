import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from 'pg';
import {getStructuredRegistryEntry} from '../../lib/knowledge/structured-registry';
import {STRUCTURED_DATASETS,validateStructuredPayload} from '../../lib/knowledge/structured-payload';
import type {DatasetType,ImportFormat} from '../../lib/imports/types';
import {structuredMappingFixture} from '../fixtures/structured-mapping';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_ISOLATED_DATABASE_REQUIRED');
const hash='a'.repeat(64),otherHash='b'.repeat(64);
type Fixture={client:Client;document:string;job:string;row:string;department:string;checksum:string;dataset:DatasetType;format:ImportFormat};
async function fixture(dataset:DatasetType,format:ImportFormat='CSV'):Promise<Fixture>{
 const client=new Client({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres'});
 await client.connect();
 try{
  await client.query('begin');
  const actor=randomUUID(),department=randomUUID(),family=randomUUID(),document=randomUUID(),job=randomUUID(),row=randomUUID();
  const checksum=structuredMappingFixture(dataset,format).source.checksum;
  await client.query('insert into auth.users(id,email) values($1,$2)',[actor,`${actor}@example.invalid`]);
  await client.query('insert into public.departments(id,code,name_th,name_en) values($1,$2,$3,$3)',[department,`STR_${actor.slice(0,8)}`,'Synthetic schema test']);
  await client.query("insert into public.staff_profiles(id,department_id,display_name,role) values($1,$2,'Synthetic actor','SUPER_ADMIN')",[actor,department]);
  await client.query("insert into public.document_families(id,code,name,category) values($1,$2,'Synthetic schema family','TEST')",[family,`STR_${actor.slice(0,8).toUpperCase()}`]);
  await client.query(`insert into public.documents(id,document_family_id,department_id,title,version_name,version_stream,status,is_current,approval_status,approved_by,approved_at,extraction_reviewed,requires_review,effective_from,checksum,revision)
   values($1,$2,$3,'Synthetic source','v1','DEFAULT','ACTIVE',true,'APPROVED',$4,now(),true,false,'2026-10-07',$5,4)`,[document,family,department,actor,checksum]);
  await client.query(`insert into private.knowledge_import_jobs(id,original_id,creator_id,checksum,format,byte_length,original_ciphertext,source_metadata_encrypted,revision)
   values($1,$2,$3,$4,$5,1,decode(repeat('00',34),'hex'),repeat('x',40),3)`,[job,randomUUID(),actor,checksum,format]);
  await client.query(`insert into private.knowledge_import_revisions(job_id,revision,actor_id,kind,extraction_checksum,extraction_encrypted,analysis_encrypted)
   values($1,1,$2,'PARSED',$3,repeat('x',40),repeat('x',40))`,[job,actor,hash]);
  await client.query(`insert into private.knowledge_import_reviews(job_id,review_revision,job_revision,extraction_revision,actor_id,payload_hash,review_encrypted)
   values($1,2,3,1,$2,$3,repeat('x',40))`,[job,actor,hash]);
  await client.query('set local role service_role');
  return {client,document,job,row,department,checksum,dataset,format};
 }catch(error){await client.query('rollback').catch(()=>{});await client.end();throw error;}
}
async function using(dataset:DatasetType,run:(f:Fixture)=>Promise<void>){
 const f=await fixture(dataset);try{await run(f);}finally{
  await f.client.query('rollback');
  // Two COMMIT tests retain immutable evidence. Retire only their owned synthetic directory entry.
  // It is not a university unit and must not contaminate later support snapshots in this disposable DB.
  await f.client.query('update public.departments set active=false where id=$1',[f.department]);
  await f.client.end();
 }
}
async function rejected(client:Client,run:()=>Promise<unknown>,code:string,message?:string){
 await client.query('savepoint expected_failure');
 try {await assert.rejects(run,error=>error instanceof Error&&'code' in error&&error.code===code&&(!message||error.message===message));}
 finally {await client.query('rollback to savepoint expected_failure');await client.query('release savepoint expected_failure');}
}
async function provenance(f:Fixture,overrides:Record<string,unknown>={}){
 const firstRow={CSV:4,XLSX:9,PDF:7,DOCX:13,HTML:21}[f.format];
 const values={id:f.row,document_id:f.document,dataset_code:f.dataset,published_document_revision:4,job_id:f.job,job_revision:3,extraction_revision:1,review_revision:2,source_checksum:f.checksum,source_format:f.format,extraction_digest:hash,mapping_digest:hash,payload_digest:hash,plan_digest:hash,registry_version:'structured-v1',mapper_version:'structured-mapper-v1',table_index:0,row_index:1,table_first_row:firstRow,source_row:firstRow+1,coordinate_kind:f.format==='XLSX'?'WORKSHEET_CELL':f.format==='CSV'?'CSV_RECORD':'EXTRACTED_LOGICAL',evidence_encrypted:'x'.repeat(40),...overrides};
 const keys=Object.keys(values);
 // Identifiers are constants from this private test, never HTTP/model input.
 await f.client.query(`insert into private.structured_row_provenance(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(values));
}
async function typedRow(f:Fixture,overrides:Record<string,unknown>={}){
 const source=structuredMappingFixture(f.dataset,'CSV').expectedPayload;
 const extra=['university_services','university_systems','service_forms','announcements'].includes(f.dataset)?{department_id:f.department}:{};
 const values:Record<string,unknown>={id:f.row,document_id:f.document,...extra,...source,...overrides};
 if('opening_hours' in values&&values.opening_hours!==null)values.opening_hours=JSON.stringify(values.opening_hours);
 const keys=Object.keys(values);
 await f.client.query(`insert into public.${f.dataset}(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(values));
}

test('all seven actual tables and private provenance are installed',async()=>{
 const client=new Client({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres'});await client.connect();
 try{
  const result=await client.query('select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname=any($1::text[]) and c.relkind=$2',[ [...STRUCTURED_DATASETS,'structured_row_provenance'],'r']);
  assert.equal(result.rowCount,8);assert(result.rows.every(row=>row.relrowsecurity===true));
 }finally{await client.end();}
});
test('Postgres generated discriminator is unavailable in BEFORE UPDATE, regenerated afterward',()=>using('tuition_fees',async f=>{
 await f.client.query('set local role postgres');
 await f.client.query(`create temporary table discriminator_probe(id integer primary key,flag boolean,dataset_code text generated always as ('fixed'::text) stored);
  create temporary table discriminator_observation(old_present boolean,new_missing boolean);
  create function pg_temp.observe_discriminator() returns trigger language plpgsql as $$
   begin insert into pg_temp.discriminator_observation values((to_jsonb(old)->>'dataset_code')='fixed',(to_jsonb(new)->>'dataset_code') is null);return new;end;$$;
  create trigger discriminator_probe_before before update on discriminator_probe for each row execute function pg_temp.observe_discriminator();
  insert into discriminator_probe(id,flag) values(1,true);update discriminator_probe set flag=false where id=1;`);
 assert.deepEqual((await f.client.query('select * from discriminator_observation')).rows,[{old_present:true,new_missing:true}]);
 assert.equal((await f.client.query('select dataset_code from discriminator_probe')).rows[0].dataset_code,'fixed');
}));
for(const dataset of STRUCTURED_DATASETS){
 test(`${dataset}: reviewed source row, exact decimals and current projection`,()=>using(dataset,async f=>{
  await provenance(f);await typedRow(f,{active:false,is_current:false});await f.client.query('set constraints all immediate');
  const {rows:[row]}=await f.client.query(`select * from public.${dataset} where id=$1`,[f.row]);
  assert.equal(row.document_id,f.document);assert.equal(row.dataset_code,dataset);assert.equal(row.active,true);assert.equal(row.is_current,true);
  if(dataset==='tuition_fees')assert.equal(row.fee_amount,'1234.50');
  if(dataset==='transfer_courses'){assert.equal(row.source_credits,'3.000');assert.equal(row.target_credits,'3');}
  if(dataset==='university_services')assert.equal(row.opening_hours,'จันทร์–ศุกร์');
 }));
 test(`${dataset}: anon/authenticated cannot read or write source or provenance`,()=>using(dataset,async f=>{
  await provenance(f);await typedRow(f);
  for(const role of ['anon','authenticated']){
   await f.client.query(`set local role ${role}`);
   for(const table of [`public.${dataset}`,'private.structured_row_provenance'])for(const statement of [`select * from ${table}`,`delete from ${table}`,`insert into ${table} default values`])await rejected(f.client,()=>f.client.query(statement),'42501');
  }
 }));
 test(`${dataset}: service role cannot mutate payload/delete/truncate; owner trigger also protects history`,()=>using(dataset,async f=>{
  await provenance(f);await typedRow(f);
  const field=getStructuredRegistryEntry(dataset).fields.find(field=>field.kind==='TEXT')!.name;
  await rejected(f.client,()=>f.client.query(`update public.${dataset} set ${field}='changed' where id=$1`,[f.row]),'42501');
  await rejected(f.client,()=>f.client.query(`delete from public.${dataset}`),'42501');
  await rejected(f.client,()=>f.client.query(`truncate public.${dataset}`),'42501');
  await f.client.query('set local role postgres');
  await rejected(f.client,()=>f.client.query(`update public.${dataset} set ${field}='changed' where id=$1`,[f.row]),'23514','STRUCTURED_ROW_IMMUTABLE');
  await rejected(f.client,()=>f.client.query(`delete from public.${dataset}`),'23514','STRUCTURED_ROW_IMMUTABLE');
 }));
 test(`${dataset}: lifecycle retirement preserves payload and private provenance`,()=>using(dataset,async f=>{
  await provenance(f);await typedRow(f);
  const before=(await f.client.query(`select to_jsonb(r)-array['active','is_current','updated_at'] as value from public.${dataset} r where id=$1`,[f.row])).rows[0].value;
  await f.client.query("update public.documents set status='SUPERSEDED',is_current=false,revision=revision+1 where id=$1",[f.document]);
  const after=(await f.client.query(`select active,is_current,to_jsonb(r)-array['active','is_current','updated_at'] as value from public.${dataset} r where id=$1`,[f.row])).rows[0];
  assert.equal(after.active,false);assert.equal(after.is_current,false);assert.deepEqual(after.value,before);
  assert.equal((await f.client.query('select published_document_revision from private.structured_row_provenance where id=$1',[f.row])).rows[0].published_document_revision,4);
  await f.client.query(`update public.${dataset} set active=true,is_current=true where id=$1`,[f.row]);
  assert.equal((await f.client.query(`select active from public.${dataset} where id=$1`,[f.row])).rows[0].active,false);
 }));
 test(`${dataset}: typed row cannot bypass provenance or owning source`,()=>using(dataset,async f=>{
  await rejected(f.client,()=>typedRow(f),'23503');
  await provenance(f);
  await rejected(f.client,()=>typedRow(f,{document_id:randomUUID()}),'23503');
  await rejected(f.client,()=>typedRow(f,{dataset_code:'tuition_fees'}),'428C9');
  await typedRow(f);await f.client.query('set constraints all immediate');
 }));
 test(`${dataset}: blank/oversized source strings are rejected`,()=>using(dataset,async f=>{
  await provenance(f);
  const field=getStructuredRegistryEntry(dataset).fields.find(field=>field.kind==='TEXT')!;
  await rejected(f.client,()=>typedRow(f,{[field.name]:'   '}),'23514');
  await rejected(f.client,()=>typedRow(f,{[field.name]:'x'.repeat(5001)}),'23514');
  await rejected(f.client,()=>typedRow(f,{[field.name]:'bad\u0001text'}),'23514');
 }));
 test(`${dataset}: another dataset's provenance cannot satisfy the typed row FK`,()=>using(dataset,async f=>{
  await provenance(f,{dataset_code:dataset==='tuition_fees'?'academic_calendar_events':'tuition_fees'});
  await rejected(f.client,()=>typedRow(f),'23503');
 }));
 test(`${dataset}: every required source field is enforced`,()=>using(dataset,async f=>{
  await provenance(f);
  for(const field of getStructuredRegistryEntry(dataset).fields.filter(field=>!field.nullable))await rejected(f.client,()=>typedRow(f,{[field.name]:null}),'23502');
 }));
 test(`${dataset}: optional source fields preserve explicit null`,()=>using(dataset,async f=>{
  await provenance(f);
  const nullable=Object.fromEntries(getStructuredRegistryEntry(dataset).fields.filter(field=>field.nullable).map(field=>[field.name,null]));
  await typedRow(f,nullable);await f.client.query('set constraints all immediate');
  const row=(await f.client.query(`select * from public.${dataset} where id=$1`,[f.row])).rows[0];
  for(const key of Object.keys(nullable))assert.equal(row[key],null);
 }));
 test(`${dataset}: valid maximum-length multibyte source fields fit actual indexes`,()=>using(dataset,async f=>{
  await provenance(f);
  const values=Object.fromEntries(getStructuredRegistryEntry(dataset).fields.filter(field=>field.kind==='TEXT').map(field=>{
   let seed=[...field.name].reduce((sum,char)=>sum+char.charCodeAt(0),0);
   const value='ก'+Array.from({length:field.maxLength!-1},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return String.fromCharCode(0x4e00+seed%0x5200);}).join('');
   return [field.name,value];
  }));
  validateStructuredPayload(dataset,{...structuredMappingFixture(dataset,'CSV').expectedPayload,...values});
  await typedRow(f,values);await f.client.query('set constraints all immediate');
 }));
}
test('private evidence is immutable and service cannot delete/update/truncate it',()=>using('tuition_fees',async f=>{
 await provenance(f);await typedRow(f);
 for(const statement of ['update private.structured_row_provenance set payload_digest=$1','delete from private.structured_row_provenance','truncate private.structured_row_provenance'])await rejected(f.client,()=>f.client.query(statement,statement.includes('$1')?[otherHash]:[]),'42501');
 await f.client.query('set local role postgres');
 await rejected(f.client,()=>f.client.query('update private.structured_row_provenance set payload_digest=$1',[otherHash]),'23514','STRUCTURED_PROVENANCE_IMMUTABLE');
 await rejected(f.client,()=>f.client.query('delete from private.structured_row_provenance'),'23514','STRUCTURED_PROVENANCE_IMMUTABLE');
}));
test('orphan provenance fails deferred constraint and paired insert succeeds',()=>using('tuition_fees',async f=>{
 await provenance(f);
 await rejected(f.client,()=>f.client.query('set constraints all immediate'),'23514','STRUCTURED_PROVENANCE_ROW_REQUIRED');
 await typedRow(f);await f.client.query('set constraints all immediate');
}));
test('immutable source checksum/revision and exact review tuple are required',()=>using('tuition_fees',async f=>{
 await rejected(f.client,()=>provenance(f,{source_checksum:otherHash}),'23514','STRUCTURED_SOURCE_BINDING_INVALID');
 await rejected(f.client,()=>provenance(f,{published_document_revision:3}),'23514','STRUCTURED_SOURCE_BINDING_INVALID');
 await rejected(f.client,()=>provenance(f,{job_revision:2}),'23503');
 await rejected(f.client,()=>provenance(f,{extraction_revision:2}),'23503');
 await rejected(f.client,()=>provenance(f,{source_format:'XLSX',coordinate_kind:'WORKSHEET_CELL'}),'23503');
 await rejected(f.client,()=>provenance(f,{dataset_code:'anything'}),'23514');
}));
test('coordinates/hashes/version/envelope bounds are rejected',()=>using('tuition_fees',async f=>{
 for(const override of [{source_row:6},{row_index:10000},{table_index:1000},{coordinate_kind:'WORKSHEET_CELL'},{mapping_digest:'invalid'},{registry_version:'v2'},{mapper_version:'v2'},{evidence_encrypted:'x'.repeat(39)},{evidence_encrypted:'x'.repeat(1398201)}])await rejected(f.client,()=>provenance(f,override),'23514');
}));
for(const dataset of ['university_services','university_systems','service_forms','announcements'] as const){
 test(`${dataset}: department belongs to owning document`,()=>using(dataset,async f=>{
  await provenance(f);await rejected(f.client,()=>typedRow(f,{department_id:null}),'23514','STRUCTURED_DEPARTMENT_MISMATCH');
  await typedRow(f);
  await rejected(f.client,()=>f.client.query('update public.documents set department_id=null where id=$1',[f.document]),'23514','STRUCTURED_DOCUMENT_SOURCE_IMMUTABLE');
 }));
}
test('document checksum cannot rewrite retained structured source',()=>using('tuition_fees',async f=>{
 await provenance(f);await typedRow(f);
 await rejected(f.client,()=>f.client.query('update public.documents set checksum=$1 where id=$2',[otherHash,f.document]),'23514','STRUCTURED_DOCUMENT_SOURCE_IMMUTABLE');
}));
test('draft/rejected documents cannot accept structured provenance',()=>using('tuition_fees',async f=>{
 await f.client.query("update public.documents set status='DRAFT',is_current=false,approval_status='PENDING' where id=$1",[f.document]);
 await rejected(f.client,()=>provenance(f),'23514','STRUCTURED_SOURCE_BINDING_INVALID');
}));
test('fee numeric rejects silent rounding, negative, infinity/NaN and overflow',()=>using('tuition_fees',async f=>{
 await provenance(f);
 for(const fee_amount of ['1.001','1.000','-0.01','10000000000','NaN','Infinity','-Infinity'])await rejected(f.client,()=>typedRow(f,{fee_amount}),'23514');
 await typedRow(f,{fee_amount:'9999999999.99'});
 assert.equal((await f.client.query('select fee_amount from public.tuition_fees')).rows[0].fee_amount,'9999999999.99');
}));
test('credits reject excessive scale/negative/overflow; exact zero is valid',()=>using('transfer_courses',async f=>{
 await provenance(f);
 for(const source_credits of ['3.0001','3.0000','-1','1000','NaN','Infinity'])await rejected(f.client,()=>typedRow(f,{source_credits}),'23514');
 await typedRow(f,{source_credits:'0.000',target_credits:'999.999'});
}));
test('owner cannot rewrite decimal lexeme scale in retained source',()=>using('tuition_fees',async f=>{
 await provenance(f);await typedRow(f,{fee_amount:'1.0'});await f.client.query('set local role postgres');
 await rejected(f.client,()=>f.client.query('update public.tuition_fees set fee_amount=1.00'),'23514','STRUCTURED_ROW_IMMUTABLE');
}));
test('civil interval/year/currency bounds and actual invalid date',()=>using('tuition_fees',async f=>{
 await provenance(f);
 for(const override of [{academic_year:2399},{academic_year:3001},{currency:'thb'},{effective_from:'1799-12-31'},{effective_to:'2401-01-01'},{effective_to:'2026-10-06'}])await rejected(f.client,()=>typedRow(f,override),'23514');
 await rejected(f.client,()=>typedRow(f,{effective_from:'2026-02-30'}),'22008');
}));
test('announcement timestamp rejects representable sub-millisecond precision and invalid bounds',()=>using('announcements',async f=>{
 await provenance(f);
 for(const override of [{publish_at:'2026-10-07T00:00:00.0001Z'},{publish_at:'infinity'},{effective_from:'1799-12-31T23:59:59.999Z'},{effective_to:'2026-10-06T01:00:00.000Z'},{priority:101}])await rejected(f.client,()=>typedRow(f,override),'23514');
 await typedRow(f,{publish_at:'2026-10-07T00:00:00.001Z'});
}));
test('opening_hours stores source text, rejects invented JSON object',()=>using('university_services',async f=>{
 await provenance(f);
 // typedRow always encodes source strings; exercise the actual JSONB constraint directly.
 const original=structuredMappingFixture(f.dataset,'CSV').expectedPayload;
 const keys=['id','document_id','department_id',...Object.keys(original)];
 await rejected(f.client,()=>f.client.query(`insert into public.university_services(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})`,[f.row,f.document,f.department,...Object.entries(original).map(([key,value])=>key==='opening_hours'?'{}':value)]),'23514');
}));
test('document retirement and history projections roll back together',()=>using('tuition_fees',async f=>{
 await provenance(f);await typedRow(f);await f.client.query('savepoint lifecycle');
 await f.client.query("update public.documents set status='SUPERSEDED',is_current=false where id=$1",[f.document]);
 await f.client.query('rollback to savepoint lifecycle');
 assert.equal((await f.client.query('select active,is_current from public.tuition_fees')).rows[0].active,true);
 assert.equal((await f.client.query('select status from public.documents where id=$1',[f.document])).rows[0].status,'ACTIVE');
}));
test('private functions have empty search path, security invoker and no browser execute',()=>using('tuition_fees',async f=>{
 const rows=(await f.client.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as auth_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like '%structured%' and p.proname not like 'test_%' ")).rows;
 assert(rows.length>=5);assert(rows.every(row=>!row.prosecdef&&!row.anon_execute&&!row.auth_execute&&row.proconfig?.includes('search_path=""')));
}));
for(const dataset of STRUCTURED_DATASETS)for(const format of ['PDF','DOCX','XLSX','HTML'] as const){
 test(`${dataset}: ${format} immutable source identity and coordinate kind`,async()=>{
  const f=await fixture(dataset,format);
  try{
   await provenance(f);await typedRow(f);await f.client.query('set constraints all immediate');
   const result=(await f.client.query('select source_format,coordinate_kind from private.structured_row_provenance where id=$1',[f.row])).rows[0];
   assert.equal(result.source_format,format);assert.equal(result.coordinate_kind,format==='XLSX'?'WORKSHEET_CELL':'EXTRACTED_LOGICAL');
  }finally{await f.client.query('rollback');await f.client.end();}
 });
}
test('orphan provenance rejects actual COMMIT and rolls back source fixture',()=>using('tuition_fees',async f=>{
 await provenance(f);
 await assert.rejects(()=>f.client.query('commit'),error=>error instanceof Error&&error.message==='STRUCTURED_PROVENANCE_ROW_REQUIRED');
 assert.equal((await f.client.query('select count(*)::int as n from public.documents where id=$1',[f.document])).rows[0].n,0);
}));
test('valid provenance/typed row pair survives actual COMMIT',()=>using('transfer_courses',async f=>{
 await provenance(f);await typedRow(f);await f.client.query('commit');
 assert.equal((await f.client.query('select count(*)::int as n from public.transfer_courses where id=$1',[f.row])).rows[0].n,1);
}));
test('row projection update cannot deadlock a concurrent document retirement',()=>using('tuition_fees',async f=>{
 await provenance(f);await typedRow(f);await f.client.query('commit');
 await f.client.query('begin');await f.client.query('set local role service_role');
 await f.client.query("set local statement_timeout='5s'");
 const other=new Client({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres'});await other.connect();
 let retirement:Promise<{error:unknown}>|undefined;
 try{
  await other.query("begin;set local role service_role;set local statement_timeout='5s'");
  await other.query('select id from public.tuition_fees where id=$1 for update',[f.row]);
  const backend=(await f.client.query('select pg_backend_pid() as pid')).rows[0].pid;
  retirement=f.client.query("update public.documents set status='SUPERSEDED',is_current=false where id=$1",[f.document]).then(()=>({error:null}),error=>({error}));
  let blocked=false;
  for(let i=0;i<100;i++){
   if((await other.query('select cardinality(pg_blocking_pids($1))>0 as blocked',[backend])).rows[0].blocked){blocked=true;break;}
   await delay(10);
  }
  assert.equal(blocked,true,'DOCUMENT_RETIREMENT_MUST_REACH_ROW_LOCK');
  // Catalog-first publication may hold the catalog while waiting for our row.
  // The out-of-order direct writer must fail retryably rather than deadlock.
  await assert.rejects(other.query('update public.tuition_fees set active=true,is_current=true where id=$1',[f.row]),{code:'40001',message:'STRUCTURED_SELECTION_RETRY'});
  await other.query('rollback');
  const result=await retirement;
  if(result.error instanceof Error&&'code' in result.error)assert.fail(`CONCURRENT_RETIREMENT_${String(result.error.code)}`);
  assert.equal(result.error,null);
  assert.deepEqual((await f.client.query('select active,is_current from public.tuition_fees where id=$1',[f.row])).rows[0],{active:false,is_current:false});
 }finally{
  await other.query('rollback');await other.end();if(retirement)await retirement;
 }
}));
