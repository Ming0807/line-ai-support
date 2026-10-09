import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {readActivities,readLogs} from '../../lib/operations/reads';
import {parseActivityQuery,parseLogQuery} from '../../lib/operations/contracts';
import {readOperationsSummary,readOperationsAnalytics,readOperationsUsage,readOperationsDepartments,readOperationsSettings} from '../../lib/operations/metrics';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DISPOSABLE_DATABASE_REQUIRED');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:3});
after(()=>pool.end());
async function fixture(){
 const a=randomUUID(),b=randomUUID(),staff=randomUUID(),sensitive=randomUUID(),admin=randomUUID(),superAdmin=randomUUID(),session=randomUUID(),marker='OPS_'+randomUUID();
 await pool.query("insert into public.departments(id,code,name_th,name_en) values($1,$3,$3,$3),($2,$4,$4,$4)",[a,b,'OPS_'+a.replaceAll('-',''),'OPS_'+b.replaceAll('-','')]);
 for(const id of [staff,sensitive,admin,superAdmin])await pool.query('insert into auth.users(id) values($1)',[id]);
 await pool.query(`insert into public.staff_profiles(id,department_id,display_name,role,can_view_sensitive) values
 ($1,$5,$6,'STAFF',false),($2,$5,$6,'STAFF',true),($3,null,$6,'ADMIN',false),($4,null,$6,'SUPER_ADMIN',true)`,[staff,sensitive,admin,superAdmin,a,marker]);
 await pool.query('insert into public.staff_department_grants(staff_id,department_id) values($1,$2)',[admin,a]);
 await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[session,marker]);
 const ticket=async(department=a,sensitivity='GENERAL')=>{
  const conversation=randomUUID(),id=randomUUID();await pool.query("insert into public.conversations(id,line_session_id,conversation_type,mode,status) values($1,$2,'TICKET','HUMAN','ACTIVE')",[conversation,session]);
  await pool.query("insert into public.tickets(id,line_session_id,conversation_id,department_id,problem_summary,category,mode,status,sensitive_level) values($1,$2,$3,$4,'Synthetic operations test','GENERAL','HUMAN','WAITING_STAFF',$5)",[id,session,conversation,department,sensitivity]);return id;
 };
 const activity=async(ticketId:string|null,action='STAFF_REPLIED',at='2040-01-01T00:00:00Z')=>{
  const id=randomUUID();await pool.query('insert into private.activities(id,ticket_id,actor_id,action,metadata,created_at) values($1,$2,$3,$4,$5::jsonb,$6)',[id,ticketId,staff,action,JSON.stringify({token:'NEVER_PUBLIC',lineId:'NEVER_PUBLIC',message:'NEVER_PUBLIC'}),at]);return id;
 };
 const read=(actor:string,query='')=>readActivities(actor,parseActivityQuery(new URLSearchParams('from=2040-01-01&to=2040-01-01&q='+encodeURIComponent(marker)+(query?'&'+query:''))),{pool});
 const logs=(actor:string,query='')=>readLogs(actor,parseLogQuery(new URLSearchParams('from=2040-01-01&to=2040-01-01'+(query?'&'+query:''))),{pool});
 return {a,b,staff,sensitive,admin,superAdmin,session,marker,ticket,activity,read,logs};
}
test('activities enforce department/sensitivity including truthful totals and hidden global journal',async()=>{
 const f=await fixture();const ordinary=await f.activity(await f.ticket()),sensitive=await f.activity(await f.ticket(f.a,'SENSITIVE'));
 await f.activity(await f.ticket(f.a,'RESTRICTED'));await f.activity(await f.ticket(f.b));await f.activity(null,'KNOWLEDGE_IMPORT_PUBLISHED');
 const own=await f.read(f.staff);assert.deepEqual(own.items.map(row=>row.id),[ordinary]);assert.equal(own.pagination.total,1);
 assert.deepEqual(new Set((await f.read(f.sensitive)).items.map(row=>row.id)),new Set([ordinary,sensitive]));
 assert.equal((await f.read(f.admin)).pagination.total,1);assert.equal((await f.read(f.superAdmin)).pagination.total,5);
 assert.equal((await f.read(f.staff,'action=APPROVE_KNOWLEDGE')).pagination.total,0);
 assert.equal((await f.read(f.superAdmin,'action=APPROVE_KNOWLEDGE')).pagination.total,1);
 assert(!JSON.stringify(own).includes('NEVER_PUBLIC'));assert(!JSON.stringify(own).includes(f.session));
});
test('activities preserve stable pages/out-of-range totals and fresh revoked grants/actor',async()=>{
 const f=await fixture(),ticket=await f.ticket(),ids=[];for(let i=0;i<4;i++)ids.push(await f.activity(ticket));ids.sort();
 const first=await f.read(f.admin,'pageSize=2'),second=await f.read(f.admin,'pageSize=2&page=2'),far=await f.read(f.admin,'pageSize=2&page=99');
 assert.deepEqual(first.items.map(row=>row.id),ids.slice(0,2));assert.deepEqual(second.items.map(row=>row.id),ids.slice(2));assert.equal(first.pagination.total,4);assert.equal(far.items.length,0);assert.equal(far.pagination.total,4);
 await pool.query('delete from public.staff_department_grants where staff_id=$1',[f.admin]);assert.equal((await f.read(f.admin)).pagination.total,0);
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);await assert.rejects(f.read(f.staff),{code:'NOT_FOUND'});await assert.rejects(f.read(randomUUID()),{code:'NOT_FOUND'});
});
test('activities apply Bangkok bounds and search only projected safe fields literally',async()=>{
 const f=await fixture(),ticket=await f.ticket();await f.activity(ticket,'CREATED','2039-12-31T16:59:59Z');const start=await f.activity(ticket,'CREATED','2039-12-31T17:00:00Z'),end=await f.activity(ticket,'CREATED','2040-01-01T16:59:59Z');await f.activity(ticket,'CREATED','2040-01-01T17:00:00Z');
 assert.deepEqual((await f.read(f.staff)).items.map(row=>row.id),[end,start]);
 const direct=(q:string)=>readActivities(f.staff,parseActivityQuery(new URLSearchParams({from:'2040-01-01',to:'2040-01-01',q})),{pool});
 assert.equal((await direct('NEVER_PUBLIC')).pagination.total,0);assert.equal((await direct("%' OR true --")).pagination.total,0);
 await pool.query('update public.staff_profiles set display_name=$2 where id=$1',[f.staff,'literal 100%_! '+f.marker]);assert.equal((await direct('100%_!')).pagination.total,2);assert.equal((await direct('100XYZ')).pagination.total,0);
});
test('unknown activity strings become fixed OTHER without disclosing their contents',async()=>{
 const f=await fixture();await f.activity(await f.ticket(),'NEVER_PUBLIC');const result=await f.read(f.staff,'action=OTHER');assert.equal(result.pagination.total,1);assert.equal(result.items[0].action,'OTHER');assert(!JSON.stringify(result).includes('NEVER_PUBLIC'));
});
test('logs require active SUPER_ADMIN and expose only fixed source observations',async()=>{
 const f=await fixture();for(const actor of [f.staff,f.sensitive,f.admin])await assert.rejects(f.logs(actor),{code:'FORBIDDEN'});
 const provider=(await pool.query("insert into private.ai_providers(name,adapter,base_url,api_key_encrypted) values($1,'OPENAI','https://api.openai.com/v1',$2) returning id",[randomUUID(),'v1.'+'x'.repeat(80)])).rows[0].id;
 const model=(await pool.query("insert into private.ai_models(provider_id,model_id,display_name) values($1,'synthetic-ops','Synthetic ops') returning id",[provider])).rows[0].id;
 const ai=(await pool.query("insert into private.ai_errors(provider_id,model_id,error_type,http_status,message,created_at) values($1,$2,'AUTH_ERROR',401,'AUTH_ERROR','2040-01-01T00:00:00Z') returning id",[provider,model])).rows[0].id;
 const outbox=(await pool.query("insert into private.message_outbox(idempotency_key,line_session_id,kind,payload_encrypted) values($1,$2,'SYSTEM','NEVER_PUBLIC') returning id",[randomUUID(),f.session])).rows[0].id;
 await pool.query("insert into private.delivery_attempts(outbox_id,http_status,error_code,request_id,accepted,created_at) values($1,429,'NEVER_PUBLIC','NEVER_PUBLIC',false,'2040-01-01T00:00:00Z'),($1,409,null,'NEVER_PUBLIC',true,'2040-01-01T00:00:00Z')",[outbox]);
 const aiResult=await f.logs(f.superAdmin,'component=ai-gateway&code=AUTH_ERROR');assert(aiResult.items.some(row=>row.id==='ai:'+ai&&row.httpStatus===401));
 const unknown=await f.logs(f.superAdmin,'component=line-delivery&code=LINE_DELIVERY_FAILED&severity=WARN');assert.equal(unknown.pagination.total,1);assert.equal(unknown.items[0].httpStatus,429);
 const accepted=await f.logs(f.superAdmin,'component=line-delivery&severity=INFO');assert.equal(accepted.pagination.total,1);assert.equal(accepted.items[0].code,'LINE_DELIVERED');assert.equal(accepted.items[0].httpStatus,409);
 const serialized=JSON.stringify(await f.logs(f.superAdmin));for(const privateValue of ['NEVER_PUBLIC',provider,model,outbox,f.session])assert(!serialized.includes(privateValue));
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.superAdmin]);await assert.rejects(f.logs(f.superAdmin),{code:'NOT_FOUND'});
});
test('summary aggregates every visible ticket beyond100 rows and bounds future intake',async()=>{
 const f=await fixture(),now=()=>new Date('2026-10-08T12:00:00Z'),ids=[];
 for(let i=0;i<105;i++){const id=await f.ticket();ids.push(id);await pool.query("update public.tickets set created_at='2026-10-07T18:00:00Z' where id=$1",[id]);}
 await f.ticket(f.a,'RESTRICTED');await f.ticket(f.b);const future=await f.ticket();await pool.query("update public.tickets set created_at='2040-01-01T00:00:00Z' where id=$1",[future]);
 const filters={from:'2026-10-08',to:'2026-10-08'};
 const own=await readOperationsSummary(f.staff,filters,{pool,now});assert.equal(own.counts.total,105);assert.equal(own.counts.open,105);assert.deepEqual(own.intake,[{date:'2026-10-08',count:105}]);
 assert.equal((await readOperationsSummary(f.staff,{...filters,department:f.b},{pool,now})).counts.total,0);
 const departments=await readOperationsDepartments(f.staff,{pool,now});assert.deepEqual(departments.items.map(d=>d.id),[f.a]);assert.equal(departments.items[0].totalTickets,105);assert(departments.items[0].activeStaff>=3);
 await pool.query('update public.staff_profiles set active=false where id=$1',[f.staff]);await assert.rejects(readOperationsSummary(f.staff,filters,{pool,now}),{code:'NOT_FOUND'});
});
test('analytics use actual first staff/resolve events with sample counts and unknown missing metrics',async()=>{
 const f=await fixture(),ticket=await f.ticket(),other=await f.ticket(),now=()=>new Date('2026-10-08T12:00:00Z');
 await pool.query("update public.tickets set created_at='2026-10-07T18:00:00Z' where id=any($1::uuid[])",[[ticket,other]]);
 const conversation=(await pool.query('select conversation_id from public.tickets where id=$1',[ticket])).rows[0].conversation_id;
 await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,sender_staff_id,message_type,content,created_at) values($1,$2,'STAFF',$3,'TEXT','NEVER_PUBLIC','2026-10-07T18:01:00Z'),($1,$2,'STAFF',$3,'TEXT','NEVER_PUBLIC','2026-10-07T18:02:00Z'),($1,$2,'STAFF',$3,'TEXT','NEVER_PUBLIC','2040-01-01T00:00:00Z')",[conversation,ticket,f.staff]);
 await pool.query("insert into public.ticket_history(ticket_id,action,actor_type,actor_id,created_at) values($1,'RESOLVED','STAFF',$2,'2026-10-07T18:03:00Z'),($1,'RESOLVED','STAFF',$2,'2026-10-07T18:05:00Z')",[ticket,f.staff]);
 const result=await readOperationsAnalytics(f.staff,{from:'2026-10-08',to:'2026-10-08'},{pool,now});assert.deepEqual(result.firstStaffResponse,{samples:1,averageSeconds:60});assert.deepEqual(result.resolution,{samples:1,averageSeconds:180});assert.equal(result.aiResolutionRate,null);assert.equal(result.distribution[0].count,2);assert(!JSON.stringify(result).includes('NEVER_PUBLIC'));
 const empty=await readOperationsAnalytics(f.staff,{from:'2026-10-09',to:'2026-10-09'},{pool,now});assert.deepEqual(empty.resolution,{samples:0,averageSeconds:null});
});
test('usage preserves unknown token/cost observations and settings do not infer worker liveness',async()=>{
 const f=await fixture(),now=()=>new Date('2026-10-08T12:00:00Z'),filters={from:'2026-10-08',to:'2026-10-08'};
 for(const actor of [f.staff,f.admin]){await assert.rejects(readOperationsUsage(actor,filters,{pool,now}),{code:'FORBIDDEN'});await assert.rejects(readOperationsSettings(actor,{pool}),{code:'FORBIDDEN'});}
 const provider=(await pool.query("insert into private.ai_providers(name,adapter,base_url,api_key_encrypted) values($1,'OPENAI','https://api.openai.com/v1',$2) returning id",[randomUUID(),'v1.'+'x'.repeat(80)])).rows[0].id;
 const model=(await pool.query("insert into private.ai_models(provider_id,model_id,display_name) values($1,'metrics-test','Metrics test') returning id",[provider])).rows[0].id;
 await pool.query("insert into private.ai_usage_logs(provider_id,model_id,request_type,latency_ms,input_tokens,output_tokens,estimated_cost,status,fallback_used,created_at) values($1,$2,'TEST',100,12,20,0,'SUCCESS',false,'2026-10-07T18:00:00Z'),($1,$2,'TEST',300,null,null,null,'ERROR',true,'2026-10-07T18:01:00Z'),($1,$2,'TEST',300,999,999,999,'ERROR',true,'2040-01-01T00:00:00Z')",[provider,model]);
 const result=await readOperationsUsage(f.superAdmin,filters,{pool,now}),item=result.models.find(m=>m.modelName==='Metrics test');assert(item);assert.deepEqual(item.totals.inputTokens,{knownTotal:12,unknownCalls:1});assert.deepEqual(item.totals.outputTokens,{knownTotal:20,unknownCalls:1});assert.equal(item.totals.cost.unknownCalls,1);assert.equal(Number(item.totals.cost.knownTotal),0);assert.equal(item.totals.calls,2);assert.equal(item.totals.meanLatencyMs,200);assert(!JSON.stringify(result).includes(provider));assert(!JSON.stringify(result).includes(model));
 const settings=await readOperationsSettings(f.superAdmin,{pool});assert.equal(settings.workerLiveness,'UNKNOWN');assert.equal(settings.database,'OBSERVED_OK');assert(!JSON.stringify(settings).includes('postgresql'));assert(!JSON.stringify(settings).includes('NEVER_PUBLIC'));
});

test('analytics count only scoped immutable confirmed outcomes within Bangkok bounds and observed time',async()=>{
 const f=await fixture(),now=()=>new Date('2026-10-08T12:00:00Z'),filters={from:'2026-10-08',to:'2026-10-08'};
 const outcome=async(kind:'USER_CONFIRMED_SOLVED'|'USER_CONFIRMED_ESCALATED',department:string|null=f.a,risk='GENERAL',at='2026-10-08T12:00:00Z')=>{
  const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[f.session])).rows[0].id;
  const message=(await pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Synthetic outcome') returning id",[conversation])).rows[0].id;
  const event=(await pool.query("insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status) values('STUDENT',$1,$2,$3,'OTHER','DONE') returning id",[randomUUID(),'0'.repeat(64),'v1.'+'x'.repeat(60)])).rows[0].id;
  const ticket=kind==='USER_CONFIRMED_ESCALATED'?(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status,sensitive_level) values($1,$2,$3,'Synthetic outcome','HUMAN','WAITING_STAFF',$4) returning id",[f.session,conversation,department,risk])).rows[0].id:null;
  await pool.query(`insert into private.ai_support_outcomes(conversation_id,line_session_id,last_message_id,confirmation_event_id,state_digest,kind,department_id,sensitive_level,ticket_id,observed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[conversation,f.session,message,event,'a'.repeat(64),kind,department,risk,ticket,at]);
 };
 await outcome('USER_CONFIRMED_SOLVED',f.a,'GENERAL','2026-10-07T17:00:00Z');await outcome('USER_CONFIRMED_ESCALATED');
 await outcome('USER_CONFIRMED_SOLVED',f.a,'SENSITIVE');await outcome('USER_CONFIRMED_SOLVED',f.a,'RESTRICTED');await outcome('USER_CONFIRMED_SOLVED',f.b);await outcome('USER_CONFIRMED_SOLVED',null);
 await outcome('USER_CONFIRMED_SOLVED',f.a,'GENERAL','2026-10-07T16:59:59Z');await outcome('USER_CONFIRMED_SOLVED',f.a,'GENERAL','2026-10-08T12:00:01Z');await outcome('USER_CONFIRMED_SOLVED',f.a,'GENERAL','2026-10-08T17:00:00Z');
 const own=await readOperationsAnalytics(f.staff,filters,{pool,now});assert.equal(own.aiResolutionRate,50);assert.deepEqual(own.aiOutcomes,{confirmedSolved:1,confirmedEscalated:1,samples:2});
 assert.equal((await readOperationsAnalytics(f.sensitive,filters,{pool,now})).aiOutcomes.samples,3);
 assert.equal((await readOperationsAnalytics(f.admin,filters,{pool,now})).aiOutcomes.samples,2);
 assert.equal((await readOperationsAnalytics(f.superAdmin,{...filters,department:f.a},{pool,now})).aiResolutionRate,75);
 assert.equal((await readOperationsAnalytics(f.superAdmin,filters,{pool,now})).aiOutcomes.samples,6);
 assert.equal((await readOperationsAnalytics(f.staff,{...filters,department:f.b},{pool,now})).aiResolutionRate,null);
 assert(!JSON.stringify(own).includes(f.session));assert(!JSON.stringify(own).includes('Synthetic outcome'));
 await pool.query('delete from public.staff_department_grants where staff_id=$1',[f.admin]);assert.equal((await readOperationsAnalytics(f.admin,filters,{pool,now})).aiOutcomes.samples,0);
});
