import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {Pool} from 'pg';
import {createModel,createProvider,getLastSuccessfulGeneration,updateModel,updateProvider} from '../../lib/ai/provider-admin';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:5,application_name:'provider-runtime-view-qa'});
after(()=>pool.end());

test('last successful generation is active-Super-Admin-only, usage-bound, redacted, and revision-aware',async()=>{
 const admin=randomUUID(),staff=randomUUID(),regularAdmin=randomUUID(),inactive=randomUUID(),users=[admin,staff,regularAdmin,inactive];
 const key=randomBytes(32).toString('base64'),options={pool,key},providerIds:string[]=[],usageIds:string[]=[];
 const studentUserId='U'+randomUUID().replaceAll('-',''),promptSentinel='PRIVATE_PROMPT_'+randomUUID();
 const apiKeys=[`runtime-view-a-${randomUUID()}`,`runtime-view-b-${randomUUID()}`];
 let sessionId='',conversationId='',ticketId='';
 try{
  await pool.query('insert into auth.users(id) select unnest($1::uuid[])',[users]);
  const departmentId=(await pool.query("select id from public.departments where code='IT' and active")).rows[0].id;
  await pool.query(`insert into public.staff_profiles(id,display_name,role,active,department_id)
   values($1,'Runtime view administrator','SUPER_ADMIN',true,null),($2,'Runtime view staff','STAFF',true,$4),
    ($3,'Regular runtime administrator','ADMIN',true,null),($5,'Inactive runtime administrator','SUPER_ADMIN',false,null)`,
   [admin,staff,regularAdmin,departmentId,inactive]);
  for(const forbidden of [staff,regularAdmin,inactive,randomUUID()])
   await assert.rejects(getLastSuccessfulGeneration(forbidden,options),{code:'FORBIDDEN'});
  assert.equal(await getLastSuccessfulGeneration(admin,options),null,'EMPTY_RUNTIME_VIEW_MUST_BE_NULL');

  sessionId=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',
   [`RUNTIME_VIEW_${randomUUID()}`])).rows[0].id;
  await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
   [sessionId,hashLineUserId(studentUserId,key),encryptValue(studentUserId,key)]);
  conversationId=(await pool.query("insert into public.conversations(line_session_id,conversation_type,mode) values($1,'TICKET','HUMAN') returning id",
   [sessionId])).rows[0].id;
  ticketId=(await pool.query(`insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status)
   values($1,$2,$3,'Runtime view private ticket','IT_SUPPORT','HUMAN','STAFF_HANDLING') returning id`,
   [sessionId,conversationId,departmentId])).rows[0].id;
  await pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT',$3)",
   [conversationId,ticketId,promptSentinel]);

  const providerConversation=await createProvider(admin,{name:`Runtime view conversation ${randomUUID()}`,adapter:'OPENAI',
   baseUrl:'https://api.openai.com/v1',priority:10,enabled:true,apiKey:apiKeys[0]},options);
  providerIds.push(providerConversation.id);
  const modelConversation=await createModel(admin,providerConversation.id,{modelId:'runtime-conversation-model',displayName:'Conversation generation',
   purpose:'GENERATION',embeddingDimensions:null,supportsTools:false,supportsJson:true,supportsVision:false,enabled:true,priority:10,
   timeoutMs:20000,inputPricePerMillion:null,outputPricePerMillion:null},options);

  const providerTicket=await createProvider(admin,{name:`Runtime view ticket ${randomUUID()}`,adapter:'OPENAI',
   baseUrl:'https://api.openai.com/v1',priority:20,enabled:true,apiKey:apiKeys[1]},options);
  providerIds.push(providerTicket.id);
  const modelTicket=await createModel(admin,providerTicket.id,{modelId:'runtime-ticket-model',displayName:'Ticket generation',purpose:'GENERATION',
   embeddingDimensions:null,supportsTools:false,supportsJson:true,supportsVision:false,enabled:true,priority:10,timeoutMs:20000,
   inputPricePerMillion:null,outputPricePerMillion:null},options);
  const modelEmbedding=await createModel(admin,providerTicket.id,{modelId:'runtime-probe-embedding',displayName:'Probe embedding',purpose:'EMBEDDING',
   embeddingDimensions:384,supportsTools:false,supportsJson:false,supportsVision:false,enabled:true,priority:20,timeoutMs:20000,
   inputPricePerMillion:null,outputPricePerMillion:null},options);

  const snapshots=(await pool.query(`select p.id provider_id,p.revision provider_revision,m.id model_id,m.revision model_revision
   from private.ai_providers p join private.ai_models m on m.provider_id=p.id where p.id=any($1::uuid[])`,[providerIds])).rows;
  const snapshot=(providerId:string,modelId:string)=>{
   const row=snapshots.find(value=>value.provider_id===providerId&&value.model_id===modelId);assert(row,'CONFIG_SNAPSHOT_MISSING');return row;
  };
  const writeUsage=async(value:{providerId:string;modelId:string;requestType:string;conversation?:string;ticket?:string;status:'SUCCESS'|'ERROR';
   fallback:boolean;createdAt:string;snapshot:typeof snapshots[number]})=>{
   const id=randomUUID();usageIds.push(id);
   await pool.query(`insert into private.ai_usage_logs(id,provider_id,model_id,request_type,conversation_id,ticket_id,latency_ms,input_tokens,
    output_tokens,estimated_cost,status,fallback_used,provider_revision,model_revision,created_at)
    values($1,$2,$3,$4,$5,$6,120,25,10,0.001,$7,$8,$9,$10,$11)`,
   [id,value.providerId,value.modelId,value.requestType,value.conversation??null,value.ticket??null,value.status,value.fallback,
    value.snapshot.provider_revision,value.snapshot.model_revision,value.createdAt]);
   return id;
  };
  await writeUsage({providerId:providerConversation.id,modelId:modelConversation.id,requestType:'KNOWLEDGE_SCOPE',conversation:conversationId,
   status:'SUCCESS',fallback:false,createdAt:'9999-01-01T00:00:00Z',snapshot:snapshot(providerConversation.id,modelConversation.id)});
  const selectedId=await writeUsage({providerId:providerTicket.id,modelId:modelTicket.id,requestType:'KNOWLEDGE_ANSWER',conversation:conversationId,
   ticket:ticketId,status:'SUCCESS',fallback:true,createdAt:'9999-01-02T00:00:00Z',snapshot:snapshot(providerTicket.id,modelTicket.id)});
  await writeUsage({providerId:providerTicket.id,modelId:modelTicket.id,requestType:'GENERATION_TEST',status:'SUCCESS',fallback:false,
   createdAt:'9999-01-03T00:00:00Z',snapshot:snapshot(providerTicket.id,modelTicket.id)});
  await writeUsage({providerId:providerTicket.id,modelId:modelTicket.id,requestType:'KNOWLEDGE_ANSWER',conversation:conversationId,ticket:ticketId,
   status:'ERROR',fallback:false,createdAt:'9999-01-04T00:00:00Z',snapshot:snapshot(providerTicket.id,modelTicket.id)});
  await writeUsage({providerId:providerTicket.id,modelId:modelEmbedding.id,requestType:'EMBEDDING_QUERY',conversation:conversationId,
   status:'SUCCESS',fallback:false,createdAt:'9999-01-05T00:00:00Z',snapshot:snapshot(providerTicket.id,modelEmbedding.id)});
  await pool.query(`insert into private.ai_model_observations(provider_id,model_id,provider_revision,model_revision,purpose,action,result,
   error_code,http_status,latency_ms,observed_at)
   values($1,$2,$3,$4,'GENERATION','GENERATION_TEST','SUCCESS',null,200,40,'9999-01-06T00:00:00Z')`,
   [providerTicket.id,modelTicket.id,snapshot(providerTicket.id,modelTicket.id).provider_revision,snapshot(providerTicket.id,modelTicket.id).model_revision]);

  const first=await getLastSuccessfulGeneration(admin,options);
  assert.deepEqual(first,{providerId:providerTicket.id,providerName:(await pool.query('select name from private.ai_providers where id=$1',[providerTicket.id])).rows[0].name,
   modelId:modelTicket.id,modelName:'Ticket generation',requestType:'KNOWLEDGE_ANSWER',observedAt:'9999-01-02T00:00:00.000Z',
   fallbackUsed:true,configurationChanged:false},'ONLY_THE_LATEST_SUCCESSFUL_CONVERSATION/TICKET-BOUND_GENERATION_CALL_IS_SHOWN');
  assert.deepEqual(Object.keys(first!).sort(),['configurationChanged','fallbackUsed','modelId','modelName','observedAt','providerId','providerName','requestType'].sort(),
   'RUNTIME_VIEW_MUST_HAVE_EXACT_ALLOWLIST_FIELDS');
  const serialized=JSON.stringify(first),encryptedKeys=(await pool.query('select api_key_encrypted from private.ai_providers where id=any($1::uuid[])',[providerIds])).rows;
  for(const privateValue of [key,promptSentinel,studentUserId,sessionId,conversationId,ticketId,selectedId,...usageIds,...apiKeys,...encryptedKeys.map(row=>row.api_key_encrypted)])
   assert(!serialized.includes(privateValue),'RUNTIME_VIEW_MUST_NOT_EXPOSE_PROMPTS_IDENTITIES_TICKETS_USAGE_IDS_OR_KEYS');

  const providerCurrent=(await pool.query('select revision from private.ai_providers where id=$1',[providerTicket.id])).rows[0].revision;
  await updateProvider(admin,providerTicket.id,{name:'Runtime view ticket provider updated',adapter:'OPENAI',baseUrl:'https://api.openai.com/v1',
   priority:20,enabled:true,apiKey:null,revision:providerCurrent},options);
  assert.equal((await getLastSuccessfulGeneration(admin,options))?.configurationChanged,true,'PROVIDER_REVISION_CHANGE_MUST_BE_FLAGGED');
  await updateModel(admin,providerTicket.id,modelTicket.id,{modelId:'runtime-ticket-model-v2',displayName:'Ticket generation updated',purpose:'GENERATION',
   embeddingDimensions:null,supportsTools:false,supportsJson:true,supportsVision:false,enabled:true,priority:10,timeoutMs:20000,
   inputPricePerMillion:null,outputPricePerMillion:null,revision:modelTicket.revision},options);
  const afterModelUpdate=await getLastSuccessfulGeneration(admin,options);
  assert.equal(afterModelUpdate?.configurationChanged,true,'MODEL_REVISION_CHANGE_MUST_BE_FLAGGED');
  assert.equal(afterModelUpdate?.modelName,'Ticket generation updated');
 }finally{
  if(providerIds.length){
   await pool.query('delete from private.ai_model_observations where provider_id=any($1::uuid[])',[providerIds]);
   await pool.query('delete from private.ai_provider_quota_observations where provider_id=any($1::uuid[])',[providerIds]);
   await pool.query('delete from private.ai_errors where provider_id=any($1::uuid[])',[providerIds]);
   await pool.query('delete from private.ai_usage_logs where provider_id=any($1::uuid[])',[providerIds]);
   await pool.query('delete from private.ai_models where provider_id=any($1::uuid[])',[providerIds]);
   await pool.query('delete from private.ai_providers where id=any($1::uuid[])',[providerIds]);
  }
  await pool.query('delete from private.activities where actor_id=any($1::uuid[])',[users]);
  if(conversationId){
   await pool.query('delete from private.staff_chat_message_order where message_id in(select id from public.messages where conversation_id=$1)',[conversationId]);
   await pool.query('delete from public.messages where conversation_id=$1',[conversationId]);
  }
  if(ticketId){
   await pool.query('delete from private.incident_detection_jobs where ticket_id=$1',[ticketId]);
   await pool.query('delete from public.tickets where id=$1',[ticketId]);
  }
  if(conversationId)await pool.query('delete from public.conversations where id=$1',[conversationId]);
  if(sessionId){await pool.query('delete from private.line_identities where line_session_id=$1',[sessionId]);await pool.query('delete from public.line_sessions where id=$1',[sessionId]);}
  await pool.query('delete from public.staff_profiles where id=any($1::uuid[])',[users]);
  await pool.query('delete from auth.users where id=any($1::uuid[])',[users]);
 }
});
