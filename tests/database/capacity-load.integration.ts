import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer,type IncomingMessage,type Server} from 'node:http';
import {arch,cpus,freemem,platform,release,totalmem} from 'node:os';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {z} from 'zod';
import {generate} from '../../lib/ai/gateway';
import {createDurableTurnBudget} from '../../lib/ai/durable-turn-budget';
import {createAIStore} from '../../lib/ai/store';
import {createProviderRegistry} from '../../lib/ai/provider-registry';
import {createPriceReader} from '../../lib/ai/pricing';
import {classifyEventKind,type DirectUserEvent} from '../../lib/line/events';
import {applyTicketAction} from '../../lib/tickets/ticket-service';
import {TicketError} from '../../lib/tickets/authorization';
import {transaction} from '../../lib/database/pool';
import {createConversationReply} from '../../lib/ai/conversation-reply';
import type {AIResult} from '../../lib/ai/jobs';
import {runAICycle} from '../../lib/ai/run-worker';
import {processInboxEvent,type InboxJob} from '../../lib/queue/process-inbox';
import {persistWebhookEvents} from '../../lib/queue/inbox';
import {runInboxCycle} from '../../lib/queue/run-inbox';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {receiveLineWebhook} from '../../lib/line/receive-webhook';
import {decryptValue,encryptValue,hashLineUserId,hashStaffLineUserId} from '../../lib/security/identity';
import {hashOpaqueToken} from '../../lib/conversation/quick-reply';
import {classifyStudentInboxContext} from '../../lib/conversation/semantic-routing';
import {createPostgresContainerSampler,instrumentPoolAcquisition,type PoolAcquisitionSample,type PostgresContainerSnapshot} from '../../scripts/qa/owned-capacity-measurements';
import {
  CAPACITY_REQUIRED_FAULTS,
  CAPACITY_SCENARIOS,
  CAPACITY_TARGETS,
  assertControlledCapacityTransports,
  assertOwnedCapacityDatabaseName,
  deriveDrainBudgetMs,
  evaluateCapacityAcceptance,
  summarizeLatencySamples,
} from '../../scripts/qa/owned-capacity-contract';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assertOwnedCapacityDatabaseName(database);
const encryptionKey=Buffer.alloc(32,106).toString('base64');
const webhookSecret=`sol06-controlled-secret-${randomUUID()}`;
const syntheticLineToken='sol06-controlled-line-token';
const applicationName=`sol06-${randomUUID().replaceAll('-','').slice(0,10)}`;
const databaseOptions={host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',connectionTimeoutMillis:10_000,statement_timeout:15_000};
const sourceFiles=[
  'app/api/line/student/webhook/route.ts',
  'lib/line/receive-webhook.ts',
  'lib/queue/inbox.ts',
  'lib/queue/run-inbox.ts',
  'lib/queue/process-inbox.ts',
  'lib/conversation/student-processing.ts',
  'lib/database/pool.ts',
  'lib/ai/run-worker.ts',
  'lib/ai/gateway.ts',
  'lib/ai/cost-policy.ts',
  'lib/ai/account-free.ts',
  'lib/ai/account-free-admin.ts',
  'lib/ai/store.ts',
  'lib/ai/provider-registry.ts',
  'lib/ai/pricing.ts',
  'lib/ai/durable-turn-budget.ts',
  'lib/ai/providers/chat-completions.ts',
  'lib/ai/providers/compatible-chat-completions.ts',
  'lib/ai/jobs.ts',
  'lib/queue/run-outbox.ts',
  'lib/line/delivery.ts',
  'lib/queue/staff-inbox.ts',
  'lib/staff/line-binding.ts',
  'lib/staff/line-case-chat.ts',
  'lib/staff/line-case-context.ts',
  'lib/staff/line-chat-presentation.ts',
  'lib/staff/line-case-queue.ts',
  'lib/staff/line-case-snapshot.ts',
  'lib/staff/line-chat-delivery.ts',
  'lib/staff/knowledge-assistance-projection.ts',
  'lib/ai/support-state.ts',
  'lib/conversation/semantic-routing.ts',
  'lib/conversation/semantic-routing-provider.ts',
  'lib/tickets/ticket-service.ts',
  'scripts/qa/owned-capacity-contract.ts',
  'scripts/qa/owned-capacity-measurements.ts',
  'tests/database/capacity-load.integration.ts',
];

type SyntheticEvent={
  webhookEventId:string;
  type:'message';
  source:{type:'user';userId:string};
  message:{type:'text';id:string;text:string}|{type:'image';id:string};
  replyToken?:string;
  timestamp:number;
};
type ExpectedEvent={eventId:string;userId:string;text:string|null;answer:string|null;lineMessageId:string|null};
type InboxSnapshot={
  event_id:string;inbox_status:string;inbox_attempts:number;inbox_ms:number|null;
  user_message_count:number;user_content:string[];line_message_ids:string[];
  ai_job_id:string|null;ai_status:string|null;ai_attempts:number|null;
  outbox_id:string|null;outbox_status:string|null;outbox_attempts:number|null;outbox_ms:number|null;
  outbox_kind:string|null;pending_routing:boolean;
  ai_error:string|null;outbox_error:string|null;
  recipient_encrypted:string|null;e2e_ms:number|null;
};
type PostResult={eventIds:string[];ackMs:number;startedAtMs:number};
type QueueStats={claimed:number;failed:number};

type CapacityFixtureTracker={sessions:string[];conversations:string[];tickets:string[];staffIds:string[];authUserIds:string[];inboxIds:string[];departments:string[];incidents:string[];aiProviders:string[];aiModels:string[]};
type CapacityStaff={id:string;lineUserId:string;departmentId:string};
type CapacityCase={sessionId:string;studentLineUserId:string;conversationId:string;ticketId:string;ticketNo:string};
type CapacityStaffPayload={messages:{text:string;quickReply?:{items:{action:{label:string;data:string}}[]}}[]};

async function createCapacityStaff(pool:Pool,tracker:CapacityFixtureTracker,runId:string,label:string,role='STAFF'):Promise<CapacityStaff>{
  const id=randomUUID(),lineUserId=`U${randomUUID().replaceAll('-','')}`;
  const department=(await pool.query<{id:string}>("select id from public.departments where code='IT' and active limit 1")).rows[0];
  assert(department,'OWNED_IT_DEPARTMENT_REQUIRED_FOR_STAFF_CHAT_FIXTURES');
  await pool.query('insert into auth.users(id) values($1)',[id]);tracker.authUserIds.push(id);tracker.staffIds.push(id);
  await pool.query(`insert into public.staff_profiles(id,department_id,display_name,role,active,can_view_sensitive,can_view_restricted)
    values($1,$2,$3,$4,true,true,false)`,[id,department.id,`SOL-06 capacity staff ${runId} ${label}`,role]);
  await pool.query(`insert into private.staff_line_identities(staff_id,user_hash,user_id_encrypted)
    values($1,$2,$3)`,[id,hashStaffLineUserId(lineUserId,encryptionKey),encryptValue(lineUserId,encryptionKey)]);
  return {id,lineUserId,departmentId:department.id};
}

async function createCapacityCase(pool:Pool,tracker:CapacityFixtureTracker,runId:string,staff:CapacityStaff,label:string,
  options:{sensitivity?:'GENERAL'|'SENSITIVE'|'RESTRICTED';departmentId?:string}={}):Promise<CapacityCase>{
  const sessionId=randomUUID(),studentLineUserId=`U${randomUUID().replaceAll('-','')}`;
  tracker.sessions.push(sessionId);
  await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[sessionId,`SOL06_${runId}_${label}_${sessionId.slice(0,8)}`]);
  await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',
    [sessionId,hashLineUserId(studentLineUserId,encryptionKey),encryptValue(studentLineUserId,encryptionKey)]);
  const conversationId=(await pool.query(`insert into public.conversations(line_session_id,conversation_type,mode,status)
    values($1,'TICKET','HUMAN','ACTIVE') returning id`,[sessionId])).rows[0].id as string;
  tracker.conversations.push(conversationId);
  const ticket=(await pool.query(`insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status,
    sensitive_level,assigned_staff_id) values($1,$2,$3,$4,'HUMAN','STAFF_HANDLING',$5,$6) returning id,ticket_no`,
    [sessionId,conversationId,options.departmentId??staff.departmentId,`SOL-06 capacity ${runId} ${label}`,options.sensitivity??'GENERAL',staff.id])).rows[0] as {id:string;ticket_no:string};
  tracker.tickets.push(ticket.id);
  await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conversationId,ticket.id]);
  return {sessionId,studentLineUserId,conversationId,ticketId:ticket.id,ticketNo:ticket.ticket_no};
}

async function createCapacityDepartment(pool:Pool,tracker:CapacityFixtureTracker,runId:string,label:string):Promise<string>{
  const code=`SOL06_${runId}_${label}_${randomUUID().replaceAll('-','').slice(0,8).toUpperCase()}`;
  const id=(await pool.query<{id:string}>('insert into public.departments(code,name_th,name_en) values($1,$2,$3) returning id',
    [code,`SOL06 owned ${label}`,`SOL06 owned ${label} ${runId}`])).rows[0].id;
  tracker.departments.push(id);return id;
}

async function createCapacityGatewayProducer(pool:Pool,tracker:CapacityFixtureTracker,runId:string,
  faults:Map<string,ModelFaultRule>):Promise<NonNullable<Parameters<typeof runAICycle>[2]['produce']>>{
  const modelSlug=`sol06/controlled-free-${runId}`;
  const fallbackSlug=`sol06/controlled-fallback-${runId}`;
  const providerId=(await pool.query<{id:string}>(`insert into private.ai_providers(name,adapter,base_url,api_key_encrypted,cost_mode,enabled,priority)
    values($1,'OPENROUTER','https://openrouter.ai/api/v1',$2,'FREE_ONLY',true,0) returning id`,
    [`sol06-controlled-${runId}`,encryptValue('synthetic-sol06-only-key',encryptionKey)])).rows[0].id;
  const modelId=(await pool.query<{id:string}>(`insert into private.ai_models(provider_id,model_id,display_name,supports_json,supports_tools,enabled,priority,timeout_ms)
    values($1,$2,'SOL-06 controlled free gateway',true,false,true,0,1000) returning id`,[providerId,modelSlug])).rows[0].id;
  tracker.aiProviders.push(providerId);tracker.aiModels.push(modelId);
  const fallbackId=(await pool.query<{id:string}>(`insert into private.ai_models(provider_id,model_id,display_name,supports_json,supports_tools,enabled,priority,timeout_ms)
    values($1,$2,'SOL-06 controlled fallback',true,false,true,1,1000) returning id`,[providerId,fallbackSlug])).rows[0].id;
  tracker.aiModels.push(fallbackId);
  const persistedStore=createAIStore(pool);
  const store={...persistedStore,loadModels:async()=>{
    const configured=await persistedStore.loadModels(),selected=configured.filter(model=>[modelId,fallbackId].includes(model.id));
    assert.equal(selected.length,2,'GATEWAY_MUST_LOAD_ONLY_THE_OWNED_CONTROLLED_FREE_MODELS');return selected;
  }};
  const controlledFetch:typeof fetch=async(input,init)=>{
    const target=input instanceof Request?input.url:String(input),method=init?.method??'GET';
    assert(target==='https://openrouter.ai/api/v1/models'||target==='https://openrouter.ai/api/v1/chat/completions',
      'GATEWAY_AND_CATALOG_MUST_USE_ONLY_THE_CONTROLLED_OPENROUTER_ENDPOINT');
    if(target.endsWith('/models')){
      assert.equal(method,'GET');assert.equal(new Headers(init?.headers).has('authorization'),false,'PUBLIC_CATALOG_MUST_NOT_RECEIVE_A_PROVIDER_KEY');
      return Response.json({data:[modelSlug,fallbackSlug].map(id=>({id,pricing:{prompt:'0',completion:'0'}}))});
    }
    assert.equal(method,'POST');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-sol06-only-key');
    assert.equal((await pool.query("select count(*)::int n from pg_stat_activity where datname=current_database() and state='idle in transaction'")).rows[0].n,0,
      'ACTUAL_GATEWAY_HTTP_MUST_STAY_OUTSIDE_SQL_TRANSACTIONS');
    const body=JSON.parse(String(init?.body)) as {model:string;messages:{role:string;content:string}[];provider:{max_price?:{prompt:number;completion:number};require_parameters:boolean};response_format:{json_schema:{strict:boolean;schema:Record<string,unknown>}}};
    assert([modelSlug,fallbackSlug].includes(body.model));assert.deepEqual(body.provider,{max_price:{prompt:0,completion:0},require_parameters:true},
      'CONTROLLED_GATEWAY_REQUEST_MUST_ENFORCE_FREE_ONLY_PROVIDER_BUDGET');
    assert.equal(body.response_format.json_schema.strict,true,'CONTROLLED_GATEWAY_MUST_SEND_THE_INSTALLED_STRICT_RESPONSE_SCHEMA');
    const question=body.messages.filter(message=>message.role==='user').at(-1)?.content;
    assert(question,'CONTROLLED_GATEWAY_MUST_RECEIVE_THE_OWNED_USER_QUESTION');
    const rule=faults.get(question);
    if(body.model===modelSlug&&rule&&rule.remaining>0){
      rule.remaining--;
      if(rule.kind==='TIMEOUT')throw new DOMException('controlled timeout','TimeoutError');
      if(rule.kind==='HTTP_429_SIMULATED')return Response.json({error:{message:'controlled rate limit'}},{status:429});
      if(rule.kind==='HTTP_5XX_SIMULATED')return Response.json({error:{message:'controlled server failure'}},{status:503});
      if(rule.kind==='INVALID_200')return Response.json({choices:[{index:0,message:{role:'assistant',content:'not-json'},finish_reason:'stop'}]});
      return Response.json({choices:[{index:0,message:{role:'assistant',content:'{"answer":"truncated'},finish_reason:'length'}]});
    }
    return Response.json({choices:[{index:0,message:{role:'assistant',content:JSON.stringify({answer:`Controlled actual gateway response: ${question}`})},finish_reason:'stop'}],
      usage:{prompt_tokens:2,completion_tokens:4}});
  };
  const adapters=createProviderRegistry({fetchImpl:controlledFetch}),priceReader=createPriceReader({fetchImpl:controlledFetch});
  return async(snapshot,signal)=>{
    assert(snapshot.leaseToken,'ACTUAL_GATEWAY_REQUIRES_THE_OWNED_AI_LEASE');
    const response=await generate({taskType:'ANSWER',messages:[{role:'user',content:snapshot.question}],
      responseSchema:z.strictObject({answer:z.string().min(1)}),responseName:'answer',timeoutMs:5_000,conversationId:snapshot.conversationId,signal},
      {store,key:encryptionKey,adapters,priceReader,turnBudget:createDurableTurnBudget(pool,{kind:'AI',id:snapshot.jobId,leaseToken:snapshot.leaseToken},encryptionKey)});
    assert(response.output,'ACTUAL_GATEWAY_MUST_RETURN_THE_STRICT_OWNED_RESPONSE_OBJECT');
    return {kind:'CLARIFY',text:response.output.answer};
  };
}

async function insertCapacityInbox(pool:Pool,tracker:CapacityFixtureTracker,channel:'STUDENT'|'STAFF',event:DirectUserEvent,label:string):Promise<InboxJob>{
  const leaseToken=randomUUID(),eventId=`sol06-${label}-${randomUUID()}`;
  const row=(await pool.query(`insert into private.webhook_inbox(channel,event_id,event_kind,user_hash,payload_encrypted,status,lease_token,lease_until,attempts)
    values($1,$2,$3,$4,$5,'PROCESSING',$6,clock_timestamp()+interval '60 seconds',1) returning *`,
    [channel,eventId,classifyEventKind(event),hashLineUserId(event.source.userId,encryptionKey),encryptValue(JSON.stringify(event),encryptionKey),leaseToken])).rows[0];
  tracker.inboxIds.push(row.id);
  return {id:row.id,channel,lease_token:row.lease_token,payload_encrypted:row.payload_encrypted,user_hash:row.user_hash,attempts:row.attempts};
}

async function processCapacityInbox(pool:Pool,tracker:CapacityFixtureTracker,channel:'STUDENT'|'STAFF',event:DirectUserEvent,label:string):Promise<string>{
  const job=await insertCapacityInbox(pool,tracker,channel,event,label);
  const routingAdvice=channel==='STUDENT'?await classifyStudentInboxContext(pool,job,encryptionKey,async input=>{
    assert.equal(input.contexts.length,1,'CONTROLLED_STAFF_SCENARIO_REQUIRES_EXACTLY_ONE_OWNED_STUDENT_CONTEXT');
    assert.equal(input.contexts[0].mode,'HUMAN');return {decision:'CONTINUE',candidateCode:input.contexts[0].code,confidence:1};
  }):null;
  await transaction(client=>processInboxEvent(client,job,encryptionKey,{aiEnabled:false,routingAdvice:routingAdvice??undefined}),pool);
  return job.id;
}

function staffText(userId:string,text:string):DirectUserEvent{
  return {type:'message',source:{type:'user',userId},message:{type:'text',id:`sol06-${randomUUID()}`,text}};
}

function staffPostback(userId:string,data:string):DirectUserEvent{
  return {type:'postback',source:{type:'user',userId},postback:{data}};
}

async function capacityStaffPayload(pool:Pool,eventId:string):Promise<CapacityStaffPayload>{
  const row=(await pool.query<{payload_encrypted:string}>(`select payload_encrypted from private.message_outbox where idempotency_key=$1`,[`staff-chat:${eventId}`])).rows[0];
  assert(row,'OWNED_STAFF_CHAT_CONTROL_OUTBOX_REQUIRED');
  return JSON.parse(decryptValue(row.payload_encrypted,encryptionKey)) as CapacityStaffPayload;
}

async function openCapacityCase(pool:Pool,tracker:CapacityFixtureTracker,staff:CapacityStaff,ticket:CapacityCase,runId:string):Promise<void>{
  const menuId=await processCapacityInbox(pool,tracker,'STAFF',staffText(staff.lineUserId,'งานของฉัน'),`${runId}-menu-${ticket.ticketNo}`);
  const menu=await capacityStaffPayload(pool,menuId);
  const button=menu.messages.flatMap(message=>message.quickReply?.items??[]).find(item=>item.action.label===`เปิด ${ticket.ticketNo}`);
  assert(button,`EXACT_OWNED_OPEN_BUTTON_REQUIRED_FOR_${ticket.ticketNo}`);
  await processCapacityInbox(pool,tracker,'STAFF',staffPostback(staff.lineUserId,button.action.data),`${runId}-open-${ticket.ticketNo}`);
  const selected=(await pool.query<{ticket_id:string;expires_at:Date}>(`select ticket_id,expires_at from private.staff_line_case_context where staff_id=$1`,[staff.id])).rows[0];
  assert(selected,'EXPLICIT_STAFF_OPEN_MUST_CREATE_CASE_SELECTION');
  assert.equal(selected.ticket_id,ticket.ticketId,'STAFF_SELECTION_MUST_MATCH_THE_EXACT_CASE_BUTTON');
}

function controlledCapacityFetch(allowedRecipients:Set<string>,requests:LineRequest[]):typeof fetch{
  return async(url,init)=>{
    const target=url instanceof Request?url.url:String(url);
    assert(target==='https://api.line.me/v2/bot/message/push'||target==='https://api.line.me/v2/bot/message/reply',
      'CAPACITY_LINE_TRANSPORT_MUST_REMAIN_CONTROLLED');
    assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${syntheticLineToken}`,'SYNTHETIC_LINE_CREDENTIAL_REQUIRED');
    const body=JSON.parse(String(init?.body)) as {to?:string;replyToken?:string;messages:{text:string}[]};
    const to=body.to??null;
    assert(to&&allowedRecipients.has(to),'CONTROLLED_LINE_MUST_TARGET_ONLY_THIS_SCENARIO_FIXTURE');
    requests.push({url:target,to,replyToken:body.replyToken??null,text:body.messages.map(message=>message.text).join(''),
      retryKey:new Headers(init?.headers).get('x-line-retry-key'),messageCount:body.messages.length});
    return new Response(null,{status:200});
  };
}

async function queueCapacityStaffReply(pool:Pool,tracker:CapacityFixtureTracker,staff:CapacityStaff,ticket:CapacityCase,runId:string,text:string):Promise<string>{
  await openCapacityCase(pool,tracker,staff,ticket,runId);
  await processCapacityInbox(pool,tracker,'STAFF',staffText(staff.lineUserId,text),`${runId}-reply-${ticket.ticketNo}`);
  const row=(await pool.query<{id:string}>(`select id from private.message_outbox where channel='STUDENT' and kind='STAFF' and ticket_id=$1
    and status in('PENDING','PROCESSING') order by outbox_seq desc limit 1`,[ticket.ticketId])).rows[0];
  assert(row,`QUEUED_OWNED_STAFF_REPLY_REQUIRED_FOR_${ticket.ticketNo}`);return row.id;
}

async function suppressFixtureOutbox(pool:Pool,tracker:CapacityFixtureTracker,staffIds:readonly string[],keepIds:readonly string[]=[]):Promise<void>{
  await pool.query(`update private.message_outbox set status='SUPPRESSED',last_error_code='SOL06_FIXTURE_CLEANUP',lease_token=null,lease_until=null,
    completed_at=coalesce(completed_at,clock_timestamp()) where status in('PENDING','PROCESSING')
    and (line_session_id=any($1::uuid[]) or recipient_staff_id=any($2::uuid[])) and not(id=any($3::uuid[]))`,
    [tracker.sessions,staffIds,keepIds]);
}

async function runCapacityStaffScenarios(pool:Pool,outboxPool:Pool,tracker:CapacityFixtureTracker,runId:string):Promise<{
  scenarios:Record<string,string>;selectionTTL:Record<string,unknown>;queuedSwitch:Record<string,unknown>;incomingStudent:Record<string,unknown>;
}> {
  const scenarios:Record<string,string>={H:'NOT_IMPLEMENTED',I:'NOT_IMPLEMENTED',J:'NOT_IMPLEMENTED'};
  let selectionTTL:Record<string,unknown>={status:'NOT_RUN'};
  let queuedSwitch:Record<string,unknown>={status:'NOT_RUN'};
  let incomingStudent:Record<string,unknown>={status:'NOT_RUN'};

  const ttlStaff=await createCapacityStaff(pool,tracker,runId,'ttl');
  const ttlTicket=await createCapacityCase(pool,tracker,runId,ttlStaff,'ttl');
  await openCapacityCase(pool,tracker,ttlStaff,ttlTicket,`${runId}-ttl`);
  await pool.query("update private.staff_line_case_context set expires_at=clock_timestamp()+interval '3 seconds' where staff_id=$1",[ttlStaff.id]);
  const ttlBefore=(await pool.query<{expires_at:Date}>('select expires_at from private.staff_line_case_context where staff_id=$1',[ttlStaff.id])).rows[0].expires_at;
  await processCapacityInbox(pool,tracker,'STAFF',staffText(ttlStaff.lineUserId,'/cases'),`${runId}-ttl-staff-activity`);
  const studentEvent:DirectUserEvent={type:'message',source:{type:'user',userId:ttlTicket.studentLineUserId},
    message:{type:'text',id:`sol06-${randomUUID()}`,text:'Student message during the original selected window'}};
  const studentInboxId=await processCapacityInbox(pool,tracker,'STUDENT',studentEvent,`${runId}-ttl-student-activity`);
  const ttlAfterActivity=(await pool.query<{expires_at:Date;ticket_id:string}>(`select expires_at,ticket_id from private.staff_line_case_context where staff_id=$1`,[ttlStaff.id])).rows[0];
  assert.equal(ttlAfterActivity.expires_at.getTime(),ttlBefore.getTime(),'STUDENT_AND_STAFF_ACTIVITY_MUST_NOT_RENEW_THE_ABSOLUTE_SELECTION_TTL');
  assert.equal(ttlAfterActivity.ticket_id,ttlTicket.ticketId);
  const systemOutbox=(await pool.query<{id:string}>(`select id from private.message_outbox where idempotency_key=$1`,[`student-response:${studentInboxId}`])).rows[0];
  assert(systemOutbox,'STUDENT_ACTIVITY_MUST_CREATE_THE_OWNED_SYSTEM_RECEIPT');
  const systemRequests:LineRequest[]=[];
  const systemSent=await runOutboxCycle(outboxPool,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},
    fetchImpl:controlledCapacityFetch(new Set([ttlTicket.studentLineUserId,ttlStaff.lineUserId]),systemRequests)});
  assert(systemRequests.some(request=>request.to===ttlTicket.studentLineUserId),'SYSTEM_ACTIVITY_MUST_USE_THE_CONTROLLED_LINE_TRANSPORT');
  assert.equal((await pool.query<{expires_at:Date}>('select expires_at from private.staff_line_case_context where staff_id=$1',[ttlStaff.id])).rows[0].expires_at.getTime(),
    ttlBefore.getTime(),'SYSTEM_DELIVERY_MUST_NOT_RENEW_THE_SELECTION_TTL');
  await processCapacityInbox(pool,tracker,'STAFF',staffText(ttlStaff.lineUserId,'TTL original selected reply'),`${runId}-ttl-reply`);
  const ttlOutboxId=(await pool.query<{id:string}>(`select id from private.message_outbox where channel='STUDENT' and kind='STAFF' and ticket_id=$1
    and status in('PENDING','PROCESSING') order by outbox_seq desc limit 1`,[ttlTicket.ticketId])).rows[0]?.id;
  assert(ttlOutboxId,'TTL_BOUND_REPLY_MUST_BE_QUEUED_WHILE_SELECTION_IS_CURRENT');
  const storedTTL=(await pool.query<{payload_encrypted:string}>(`select payload_encrypted from private.message_outbox where id=$1`,[ttlOutboxId])).rows[0];
  const storedPayload=JSON.parse(decryptValue(storedTTL.payload_encrypted,encryptionKey)) as {selectionExpiresAt?:string};
  assert.equal(Date.parse(storedPayload.selectionExpiresAt??''),ttlBefore.getTime(),'QUEUED_REPLY_MUST_CAPTURE_THE_ORIGINAL_SELECTION_EXPIRY');
  await pool.query('select pg_sleep(greatest(0,extract(epoch from $1::timestamptz-clock_timestamp()))+0.02)',[ttlBefore]);
  const staffMessageCountBefore=(await pool.query<{count:number}>(`select count(*)::int count from public.messages where ticket_id=$1 and sender_type='STAFF'`,[ttlTicket.ticketId])).rows[0].count;
  await processCapacityInbox(pool,tracker,'STAFF',staffText(ttlStaff.lineUserId,'Late reply after original selection expiry'),`${runId}-ttl-expired-reply`);
  const staffMessageCountAfter=(await pool.query<{count:number}>(`select count(*)::int count from public.messages where ticket_id=$1 and sender_type='STAFF'`,[ttlTicket.ticketId])).rows[0].count;
  assert.equal(staffMessageCountAfter,staffMessageCountBefore,'EXPIRED_SELECTION_MUST_REJECT_NEW_STAFF_TEXT_AT_PROCESSING');
  await pool.query('update private.message_outbox set available_at=clock_timestamp() where id=$1 and status=\'PENDING\'',[ttlOutboxId]);
  await suppressFixtureOutbox(pool,tracker,[ttlStaff.id],[ttlOutboxId]);
  const expiredRequests:LineRequest[]=[];
  await runOutboxCycle(outboxPool,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},
    fetchImpl:controlledCapacityFetch(new Set([ttlTicket.studentLineUserId,ttlStaff.lineUserId]),expiredRequests)});
  const ttlFinal=(await pool.query<{status:string;last_error_code:string|null}>(`select status,last_error_code from private.message_outbox where id=$1`,[ttlOutboxId])).rows[0];
  assert.equal(ttlFinal.status,'SUPPRESSED','EXPIRED_CAPTURED_SELECTION_MUST_REJECT_QUEUED_REPLY_AT_DISPATCH');
  assert(!expiredRequests.some(request=>request.to===ttlTicket.studentLineUserId),'EXPIRED_SELECTION_MUST_NEVER_REACH_THE_STUDENT');
  const ttlCase=(await pool.query<{ticket_status:string;conversation_status:string}>(`select t.status ticket_status,c.status conversation_status from public.tickets t
    join public.conversations c on c.id=t.conversation_id where t.id=$1`,[ttlTicket.ticketId])).rows[0];
  assert.notEqual(ttlCase.ticket_status,'CLOSED','SELECTION_EXPIRY_MUST_NOT_CLOSE_THE_CASE');
  assert.notEqual(ttlCase.conversation_status,'CLOSED','SELECTION_EXPIRY_MUST_NOT_CLOSE_THE_CONVERSATION');
  scenarios.H='PASS';selectionTTL={status:'PASS',ticketId:ttlTicket.ticketId,originalExpiresAt:ttlBefore.toISOString(),
    systemReceiptSent:systemRequests.some(request=>request.to===ttlTicket.studentLineUserId),staffActivityProcessed:true,
    studentActivityInboxId:studentInboxId,processingRejectedLateStaffText:staffMessageCountAfter===staffMessageCountBefore,
    dispatchStatus:ttlFinal.status,dispatchError:ttlFinal.last_error_code,ticketStatus:ttlCase.ticket_status,conversationStatus:ttlCase.conversation_status,
    systemCycleSent:systemSent.sent};

  const switchStaff=await createCapacityStaff(pool,tracker,runId,'switch');
  const first=await createCapacityCase(pool,tracker,runId,switchStaff,'switch-t1');
  const second=await createCapacityCase(pool,tracker,runId,switchStaff,'switch-t2');
  const firstOutboxId=await queueCapacityStaffReply(pool,tracker,switchStaff,first,`${runId}-switch-t1`,'Reply queued only for T1');
  const firstPayload=JSON.parse(decryptValue((await pool.query<{payload_encrypted:string}>(`select payload_encrypted from private.message_outbox where id=$1`,[firstOutboxId])).rows[0].payload_encrypted,
    encryptionKey)) as {selectionExpiresAt?:string};
  const t1Deadline=firstPayload.selectionExpiresAt;
  const t1Selection=(await pool.query<{selection_id:string}>(`select selection_id from private.staff_line_case_context where staff_id=$1`,[switchStaff.id])).rows[0].selection_id;
  await openCapacityCase(pool,tracker,switchStaff,second,`${runId}-switch-t2`);
  const selectedT2=(await pool.query<{ticket_id:string;selection_id:string;expires_at:Date}>(`select ticket_id,selection_id,expires_at from private.staff_line_case_context where staff_id=$1`,[switchStaff.id])).rows[0];
  assert.equal(selectedT2.ticket_id,second.ticketId,'EXPLICIT_SWITCH_MUST_SELECT_T2');
  assert.notEqual(t1Selection,selectedT2.selection_id,'EXPLICIT_SWITCH_MUST_CREATE_A_NEW_SELECTION_ID');
  const switchingStudent:DirectUserEvent={type:'message',source:{type:'user',userId:first.studentLineUserId},
    message:{type:'text',id:`sol06-${randomUUID()}`,text:'Incoming USER belongs to T1 during the switch'}};
  const incomingInboxId=await processCapacityInbox(pool,tracker,'STUDENT',switchingStudent,`${runId}-switch-student`);
  const routed=(await pool.query<{ticket_id:string|null;content:string}>(`select m.ticket_id,m.content from public.messages m where m.source_event_id=$1 and m.sender_type='USER'`,[incomingInboxId])).rows[0];
  assert.equal(routed.ticket_id,first.ticketId,'INCOMING_USER_MUST_APPEND_TO_THE_EXACT_OWNED_T1_CASE');
  const notification=(await pool.query<{id:string;kind:string;recipient_staff_id:string}>(`select id,kind,recipient_staff_id from private.message_outbox
    where idempotency_key like 'user-reply:%' and ticket_id=$1 and channel='STAFF' order by outbox_seq desc limit 1`,[first.ticketId])).rows[0];
  assert(notification,'T1_USER_ACTIVITY_MUST_CREATE_ITS_OWN_SCOPED_STAFF_NOTIFICATION');
  assert.equal(notification.recipient_staff_id,switchStaff.id,'T1_NOTIFICATION_MUST_TARGET_ITS_ASSIGNED_STAFF');
  const selectionAfterUser=(await pool.query<{ticket_id:string;selection_id:string}>(`select ticket_id,selection_id from private.staff_line_case_context where staff_id=$1`,[switchStaff.id])).rows[0];
  assert.deepEqual(selectionAfterUser,{ticket_id:second.ticketId,selection_id:selectedT2.selection_id},'INCOMING_USER_OR_NOTIFICATION_MUST_NOT_CHANGE_THE_ACTIVE_STAFF_RECIPIENT');
  await suppressFixtureOutbox(pool,tracker,[switchStaff.id],[firstOutboxId,notification.id]);
  const switchRequests:LineRequest[]=[];
  const switchDelivery=await runOutboxCycle(outboxPool,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},
    fetchImpl:controlledCapacityFetch(new Set([first.studentLineUserId,second.studentLineUserId,switchStaff.lineUserId]),switchRequests)});
  const t1Delivery=switchRequests.find(request=>request.to===first.studentLineUserId&&request.text.includes('Reply queued only for T1'));
  assert(t1Delivery,'QUEUED_T1_REPLY_MUST_REMAIN_ADDRESSED_TO_T1_AFTER_SWITCH');
  assert(!switchRequests.some(request=>request.to===second.studentLineUserId&&request.text.includes('Reply queued only for T1')),
    'QUEUED_T1_REPLY_MUST_NEVER_RETARGET_T2');
  assert(switchRequests.some(request=>request.to===switchStaff.lineUserId&&request.text.includes('Incoming USER belongs to T1')),
    'T1_NOTIFICATION_MUST_REACH_ONLY_THE_ASSIGNED_STAFF_VIA_CONTROLLED_TRANSPORT');
  const t1Final=(await pool.query<{status:string}>(`select status from private.message_outbox where id=$1`,[firstOutboxId])).rows[0];
  assert.equal(t1Final.status,'SENT');
  const selectionAfterDispatch=(await pool.query<{ticket_id:string;selection_id:string}>(`select ticket_id,selection_id from private.staff_line_case_context where staff_id=$1`,[switchStaff.id])).rows[0];
  assert.deepEqual(selectionAfterDispatch,{ticket_id:second.ticketId,selection_id:selectedT2.selection_id},'DISPATCH_AND_NOTIFICATION_MUST_LEAVE_T2_SELECTED');
  scenarios.I='PASS';queuedSwitch={status:'PASS',t1TicketId:first.ticketId,t2TicketId:second.ticketId,t1OutboxId:firstOutboxId,
    capturedT1SelectionExpiresAt:t1Deadline,selectedTicketAfterQueue:second.ticketId,deliveryStatus:t1Final.status,
    deliveryRecipient:t1Delivery.to,wrongT2Delivery:false};
  scenarios.J='PASS';incomingStudent={status:'PASS',incomingInboxId,routedTicketId:routed.ticket_id,userText:routed.content,
    staffNotificationOutboxId:notification.id,staffNotificationRecipient:switchStaff.id,selectedTicketAfterNotification:second.ticketId,
    selectedTicketAfterDispatch:selectionAfterDispatch.ticket_id,sentRequests:switchRequests.length,cycle:switchDelivery};
  return {scenarios,selectionTTL,queuedSwitch,incomingStudent};
}

async function dispatchCapacityReplyAfterMutation(pool:Pool,outboxPool:Pool,tracker:CapacityFixtureTracker,runId:string,kind:string,
  mutate:(staff:CapacityStaff,ticket:CapacityCase)=>Promise<void>):Promise<Record<string,unknown>>{
  const staff=await createCapacityStaff(pool,tracker,runId,kind);
  const ticket=await createCapacityCase(pool,tracker,runId,staff,kind);
  const outboxId=await queueCapacityStaffReply(pool,tracker,staff,ticket,`${runId}-${kind}`,'Must be suppressed after authority changes');
  await mutate(staff,ticket);
  await suppressFixtureOutbox(pool,tracker,[staff.id],[outboxId]);
  const requests:LineRequest[]=[];
  await runOutboxCycle(outboxPool,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},
    fetchImpl:controlledCapacityFetch(new Set([ticket.studentLineUserId,staff.lineUserId]),requests)});
  const row=(await pool.query<{status:string;last_error_code:string|null}>(`select status,last_error_code from private.message_outbox where id=$1`,[outboxId])).rows[0];
  assert.equal(row.status,'SUPPRESSED',`${kind.toUpperCase()}_MUST_SUPPRESS_QUEUED_STUDENT_DELIVERY`);
  assert(!requests.some(request=>request.to===ticket.studentLineUserId),`${kind.toUpperCase()}_MUST_NOT_SEND_AFTER_AUTHORITY_CHANGE`);
  return {status:'PASS',mutation:kind,ticketId:ticket.ticketId,outboxId,dispatchStatus:row.status,dispatchError:row.last_error_code,controlledRequests:requests.length};
}

async function runCapacityRequiredFaults(pool:Pool,outboxPool:Pool,tracker:CapacityFixtureTracker,runId:string):Promise<{
  faults:Record<string,string>;evidence:Record<string,unknown>;heldLock:Record<string,unknown>;
}> {
  const faults:Record<string,string>={stale_forged_cross_user_postback:'NOT_IMPLEMENTED',close_during_dispatch:'NOT_IMPLEMENTED',
    reassign_during_dispatch:'NOT_IMPLEMENTED',unlink_during_dispatch:'NOT_IMPLEMENTED',department_scope_change_during_dispatch:'NOT_IMPLEMENTED',
    sensitivity_change_during_dispatch:'NOT_IMPLEMENTED',revoked_staff:'NOT_IMPLEMENTED',held_session_lock_fairness:'NOT_IMPLEMENTED'};
  const evidence:Record<string,unknown>={};
  let heldLock:Record<string,unknown>={status:'NOT_RUN'};

  const owner=await createCapacityStaff(pool,tracker,runId,'postback-owner');
  const other=await createCapacityStaff(pool,tracker,runId,'postback-other');
  const ownedCase=await createCapacityCase(pool,tracker,runId,owner,'postback-owner');
  await openCapacityCase(pool,tracker,owner,ownedCase,`${runId}-postback-owner`);
  const casesInbox=await processCapacityInbox(pool,tracker,'STAFF',staffText(owner.lineUserId,'งานของฉัน'),`${runId}-postback-menu`);
  const menu=await capacityStaffPayload(pool,casesInbox);
  const validButton=menu.messages.flatMap(message=>message.quickReply?.items??[]).find(item=>item.action.label===`เปิด ${ownedCase.ticketNo}`);
  assert(validButton,'STALE_POSTBACK_FIXTURE_MUST_HAVE_A_REAL_OWNED_BUTTON');
  const commandToken=/^yru:staff:chat:([A-Za-z0-9_-]{43})$/u.exec(validButton.action.data)?.[1];
  assert(commandToken,'REAL_STAFF_COMMAND_TOKEN_REQUIRED');
  await processCapacityInbox(pool,tracker,'STAFF',staffPostback(other.lineUserId,validButton.action.data),`${runId}-postback-cross-user`);
  const tokenHash=hashOpaqueToken(commandToken,encryptionKey,'staff-chat-command');
    const command=(await pool.query<{staff_id:string;consumed_at:Date|null}>(`select staff_id,consumed_at from private.staff_chat_commands where token_hash=$1`,[tokenHash])).rows[0];
  assert(command,'CROSS_USER_POSTBACK_MUST_REFERENCE_THE_ORIGINAL_PRIVATE_COMMAND');
  assert.equal(command.staff_id,owner.id);assert.equal(command.consumed_at,null,'CROSS_USER_POSTBACK_MUST_NOT_CONSUME_ANOTHER_STAFF_MEMBER_COMMAND');
  assert.equal((await pool.query<{count:number}>(`select count(*)::int count from private.staff_line_case_context where staff_id=$1 and ticket_id=$2`,[other.id,ownedCase.ticketId])).rows[0].count,0,
    'FORGED_OR_CROSS_USER_POSTBACK_MUST_NOT_CREATE_A_CASE_SELECTION');
  assert.equal((await pool.query<{count:number}>(`select count(*)::int count from public.messages where ticket_id=$1 and sender_type='STAFF'`,[ownedCase.ticketId])).rows[0].count,0,
    'FORGED_OR_CROSS_USER_POSTBACK_MUST_NOT_CREATE_A_STAFF_REPLY');
  const selectionBefore=(await pool.query('select ticket_id,selection_id from private.staff_line_case_context where staff_id=$1',[owner.id])).rows[0];
  await processCapacityInbox(pool,tracker,'STAFF',staffPostback(owner.lineUserId,`yru:staff:chat:${Buffer.alloc(32,32).toString('base64url')}`),`${runId}-postback-forged`);
  await pool.query("update private.staff_chat_commands set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1",[tokenHash]);
  await processCapacityInbox(pool,tracker,'STAFF',staffPostback(owner.lineUserId,validButton.action.data),`${runId}-postback-expired`);
  assert.deepEqual((await pool.query('select ticket_id,selection_id from private.staff_line_case_context where staff_id=$1',[owner.id])).rows[0],selectionBefore,
    'FORGED_AND_EXPIRED_POSTBACKS_MUST_NOT_CHANGE_CASE_AUTHORITY');
  const staleMenuId=await processCapacityInbox(pool,tracker,'STAFF',staffText(owner.lineUserId,'งานของฉัน'),`${runId}-postback-revision-menu`);
  const staleButton=(await capacityStaffPayload(pool,staleMenuId)).messages.flatMap(message=>message.quickReply?.items??[]).find(item=>item.action.label===`เปิด ${ownedCase.ticketNo}`);
  assert(staleButton);await pool.query('update public.tickets set assigned_staff_id=$2,revision=revision+1 where id=$1',[ownedCase.ticketId,other.id]);
  await processCapacityInbox(pool,tracker,'STAFF',staffPostback(owner.lineUserId,staleButton.action.data),`${runId}-postback-stale-revision`);
  assert.deepEqual((await pool.query('select ticket_id,selection_id from private.staff_line_case_context where staff_id=$1',[owner.id])).rows[0],selectionBefore,
    'STALE_ASSIGNMENT_POSTBACK_MUST_NOT_GRANT_A_NEW_SELECTION');
  faults.stale_forged_cross_user_postback='PASS';
  evidence.staleForgedCrossUserPostback={status:'PASS',ownerId:owner.id,otherStaffId:other.id,commandConsumed:false,otherSelectionCount:0,staffReplyCount:0};

  const closed=await dispatchCapacityReplyAfterMutation(pool,outboxPool,tracker,runId,'close',async(staff,ticket)=>{
    let revision=(await pool.query<{revision:number}>(`select revision from public.tickets where id=$1`,[ticket.ticketId])).rows[0].revision;
    await transaction(client=>applyTicketAction(client,staff.id,ticket.ticketId,'RESOLVE',{revision,requestId:randomUUID()},encryptionKey),pool);
    revision=(await pool.query<{revision:number}>(`select revision from public.tickets where id=$1`,[ticket.ticketId])).rows[0].revision;
    await transaction(client=>applyTicketAction(client,staff.id,ticket.ticketId,'CLOSE',{revision,requestId:randomUUID()},encryptionKey),pool);
  });
  faults.close_during_dispatch='PASS';evidence.closeDuringDispatch=closed;

  const reassigned=await dispatchCapacityReplyAfterMutation(pool,outboxPool,tracker,runId,'reassign',async(staff,ticket)=>{
    const supervisor=await createCapacityStaff(pool,tracker,runId,'reassign-supervisor','SUPERVISOR');
    const target=await createCapacityStaff(pool,tracker,runId,'reassign-target');
    const revision=(await pool.query<{revision:number}>(`select revision from public.tickets where id=$1`,[ticket.ticketId])).rows[0].revision;
    await transaction(client=>applyTicketAction(client,supervisor.id,ticket.ticketId,'REASSIGN',{revision,requestId:randomUUID(),assigneeId:target.id},encryptionKey),pool);
    assert.notEqual((await pool.query<{assigned_staff_id:string}>(`select assigned_staff_id from public.tickets where id=$1`,[ticket.ticketId])).rows[0].assigned_staff_id,staff.id,
      'REASSIGN_MUTATION_MUST_CHANGE_CURRENT_OWNER');
  });
  faults.reassign_during_dispatch='PASS';evidence.reassignDuringDispatch=reassigned;

  const unlinked=await dispatchCapacityReplyAfterMutation(pool,outboxPool,tracker,runId,'unlink',async(staff)=>{
    await processCapacityInbox(pool,tracker,'STAFF',{type:'unfollow',source:{type:'user',userId:staff.lineUserId}},`${runId}-unlink-event`);
  });
  faults.unlink_during_dispatch='PASS';evidence.unlinkDuringDispatch=unlinked;

  const departmentChanged=await dispatchCapacityReplyAfterMutation(pool,outboxPool,tracker,runId,'department-scope',async(staff)=>{
    const otherDepartment=await createCapacityDepartment(pool,tracker,runId,'scope');
    await pool.query('update public.staff_profiles set department_id=$2 where id=$1',[staff.id,otherDepartment]);
  });
  faults.department_scope_change_during_dispatch='PASS';evidence.departmentScopeChange=departmentChanged;

  const sensitivityChanged=await dispatchCapacityReplyAfterMutation(pool,outboxPool,tracker,runId,'sensitivity',async(_staff,ticket)=>{
    await pool.query("update public.tickets set sensitive_level='SENSITIVE' where id=$1",[ticket.ticketId]);
  });
  faults.sensitivity_change_during_dispatch='PASS';evidence.sensitivityChange=sensitivityChanged;

  const revoked=await dispatchCapacityReplyAfterMutation(pool,outboxPool,tracker,runId,'revoked-staff',async(staff)=>{
    await pool.query('update public.staff_profiles set active=false where id=$1',[staff.id]);
  });
  faults.revoked_staff='PASS';evidence.revokedStaff=revoked;

  const fairStaff=await createCapacityStaff(pool,tracker,runId,'held-lock');
  const busyCase=await createCapacityCase(pool,tracker,runId,fairStaff,'held-lock-busy');
  const quietCase=await createCapacityCase(pool,tracker,runId,fairStaff,'held-lock-quiet');
  const busyOutboxId=await queueCapacityStaffReply(pool,tracker,fairStaff,busyCase,`${runId}-held-lock-busy`,'Held case reply');
  const quietOutboxId=await queueCapacityStaffReply(pool,tracker,fairStaff,quietCase,`${runId}-held-lock-quiet`,'Quiet case reply');
  await suppressFixtureOutbox(pool,tracker,[fairStaff.id],[busyOutboxId,quietOutboxId]);
  const blockerPool=makePool(`${applicationName}-held-lock-blocker`,1);
  const blocker=await blockerPool.connect();
  const busyRequests:LineRequest[]=[],quietRequests:LineRequest[]=[];
  let busyCycle:Promise<{claimed:number;sent:number;failed:number}>|undefined;
  try{
    await blocker.query('select pg_advisory_lock(hashtextextended($1,0))',[`conversation:${busyCase.conversationId}`]);
    busyCycle=runOutboxCycle(outboxPool,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},
      fetchImpl:controlledCapacityFetch(new Set([busyCase.studentLineUserId,fairStaff.lineUserId]),busyRequests)});
    const deadline=Date.now()+3000;let claimed=false;
    while(Date.now()<deadline){
      const state=(await pool.query<{status:string}>(`select status from private.message_outbox where id=$1`,[busyOutboxId])).rows[0];
      if(state.status==='PROCESSING'){claimed=true;break;}
      await delay(20);
    }
    assert(claimed,'HELD_SESSION_LOCK_CASE_MUST_BE_LEASED_BEFORE_THE_FAIRNESS_PROBE');
    const quietCycle=await runOutboxCycle(outboxPool,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},
      fetchImpl:controlledCapacityFetch(new Set([quietCase.studentLineUserId,fairStaff.lineUserId]),quietRequests)});
    assert(quietRequests.some(request=>request.to===quietCase.studentLineUserId&&request.text.includes('Quiet case reply')),
      'A_HELD_SESSION_LOCK_MUST_NOT_STARVE_AN_INDEPENDENT_READY_SESSION');
    assert.equal(busyRequests.length,0,'HELD_SESSION_LOCK_REQUEST_MUST_WAIT_FOR_ITS_OWN_SESSION');
    await blocker.query('select pg_advisory_unlock(hashtextextended($1,0))',[`conversation:${busyCase.conversationId}`]);
    const completed=await busyCycle;
    assert(completed?.sent===1&&busyRequests.some(request=>request.to===busyCase.studentLineUserId&&request.text.includes('Held case reply')),
      'HELD_SESSION_LOCK_CASE_MUST_RESUME_AFTER_RELEASE');
    const statuses=(await pool.query<{id:string;status:string}>(`select id,status from private.message_outbox where id=any($1::uuid[]) order by id`,[[busyOutboxId,quietOutboxId]])).rows;
    assert(statuses.every(row=>row.status==='SENT'),'BOTH_READY_SESSIONS_MUST_EVENTUALLY_COMPLETE');
    faults.held_session_lock_fairness='PASS';
    heldLock={status:'PASS',busyTicketId:busyCase.ticketId,quietTicketId:quietCase.ticketId,quietSentBeforeRelease:true,
      busySentAfterRelease:true,quietCycle,busyCycle:completed};
  }finally{
    await blocker.query('select pg_advisory_unlock_all()').catch(()=>undefined);blocker.release();
    if(busyCycle)await busyCycle.catch(()=>undefined);
    await blockerPool.end();
  }
  evidence.heldSessionLockFairness=heldLock;
  return {faults,evidence,heldLock};
}

function makePool(application:string,max:number):Pool{
  return new Pool({...databaseOptions,max,idleTimeoutMillis:2_000,application_name:application});
}

async function verifyOwnedDatabase(pool:Pool):Promise<{database:string;owner:string;marker:string}>{
  const result=await pool.query<{database_name:string;database_owner:string;marker:string;marker_count:number}>(`
    select current_database() database_name,pg_get_userbyid(d.datdba) database_owner,
      shobj_description(d.oid,'pg_database') marker,
      (select count(*)::int from pg_database x where shobj_description(x.oid,'pg_database')=shobj_description(d.oid,'pg_database')) marker_count
    from pg_database d where d.datname=current_database()`);
  const row=result.rows[0];
  assert(row,'CURRENT_DATABASE_IDENTITY_REQUIRED');
  assert.equal(row.database_name,database,'CONNECTED_DATABASE_MUST_MATCH_EXACT_OWNED_NAME');
  assert.equal(row.database_owner,'postgres','OWNED_DATABASE_OWNER_REQUIRED');
  assert.match(row.marker,/^sol-owned-[a-f0-9-]{36}$/u,'UNIQUE_REPLAY_OWNER_MARKER_REQUIRED');
  assert.equal(row.marker_count,1,'REPLAY_OWNER_MARKER_MUST_BE_UNIQUE');
  return {database:row.database_name,owner:row.database_owner,marker:row.marker};
}

function makeEvent(label:string,options:{userId?:string;text?:string;replyToken?:string}={}):SyntheticEvent{
  const id=randomUUID().replaceAll('-','');
  const userId=options.userId??`U${randomUUID().replaceAll('-','')}`;
  return {webhookEventId:`sol06-${label}-${id.slice(0,20)}`,type:'message',source:{type:'user',userId},
    message:{type:'text',id:`m${id}`,text:options.text??`sol06:${label}:${id.slice(0,12)}`},
    ...(options.replyToken?{replyToken:options.replyToken}:{}),timestamp:Date.now()};
}

function eventText(event:SyntheticEvent):string|null{return event.message.type==='text'?event.message.text:null;}
function answerFor(text:string):string{return `Controlled synthetic acknowledgement: ${text}`;}

function registerExpected(events:readonly SyntheticEvent[],expectedById:Map<string,ExpectedEvent>,expectedByUser:Map<string,Set<string>>):void{
  for(const event of events){
    const text=eventText(event),answer=text===null?null:answerFor(text);
    expectedById.set(event.webhookEventId,{eventId:event.webhookEventId,userId:event.source.userId,text,answer,
      lineMessageId:event.message.id});
    const answers=expectedByUser.get(event.source.userId)??new Set<string>();
    if(answer)answers.add(answer);
    expectedByUser.set(event.source.userId,answers);
  }
}

function serializeLog(args:unknown[]):string{return args.map(value=>typeof value==='string'?value:JSON.stringify(value)).join(' ');}

async function readRequestBody(request:IncomingMessage):Promise<Buffer>{
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of request){
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=bytes.length;
    if(size>1_048_576)throw new Error('CONTROLLED_REQUEST_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function startControlledIngress(pool:Pool):Promise<{server:Server;origin:string;close:()=>Promise<void>}>{
  let origin='http://127.0.0.1';
  let failNextPersist=false,dropNextAck=false;
  const server=createServer((incoming,response)=>{
    void (async()=>{
      if(incoming.method!=='POST'){response.statusCode=405;response.end();return;}
      let bytes:Buffer;
      try{bytes=await readRequestBody(incoming);}catch{response.statusCode=413;response.end();return;}
      const signature=incoming.headers['x-line-signature'];
      const injected=incoming.headers['x-sol06-inject'];
      const request=new Request(`${origin}${incoming.url??'/'}`,{
        method:'POST',headers:{'x-line-signature':typeof signature==='string'?signature:''},body:bytes as unknown as BodyInit,
      });
      const result=await receiveLineWebhook(request,{
        channel:'STUDENT',secret:webhookSecret,encryptionKey,
        persist:async events=>{
          if(injected==='persist-unavailable'||failNextPersist){failNextPersist=false;throw new Error('CONTROLLED_DATABASE_UNAVAILABLE');}
          await persistWebhookEvents(events,pool);
        },
      });
      const body=await result.text();
      if((injected==='drop-ack-after-persist'||dropNextAck)&&result.status===200){dropNextAck=false;response.destroy();return;}
      response.statusCode=result.status;
      response.setHeader('content-type',result.headers.get('content-type')??'application/json');
      response.end(body);
    })().catch(()=>{if(!response.destroyed){response.statusCode=500;response.end('{"ok":false}');}});
  });
  return new Promise((resolvePromise,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      server.removeListener('error',reject);
      const address=server.address();
      if(!address||typeof address==='string'){reject(new Error('LOOPBACK_ADDRESS_REQUIRED'));return;}
      origin=`http://127.0.0.1:${address.port}`;
      resolvePromise({server,origin,close:async()=>{
        server.closeAllConnections();
        if(server.listening)await new Promise<void>((resolveClose,rejectClose)=>server.close(error=>error?rejectClose(error):resolveClose()));
      }});
    });
  });
}

async function signedPost(origin:string,events:readonly unknown[],injection?:'persist-unavailable'|'drop-ack-after-persist'):Promise<{status:number;ackMs:number;startedAtMs:number}>{
  const body=Buffer.from(JSON.stringify({events}),'utf8');
  const signature=createHmac('sha256',webhookSecret).update(body).digest('base64');
  const startedAtMs=performance.now();
  const response=await fetch(`${origin}/api/line/student/webhook`,{method:'POST',headers:{
    'content-type':'application/json','x-line-signature':signature,...(injection?{'x-sol06-inject':injection}:{}),
  },body});
  const ackMs=performance.now()-startedAtMs;
  return {status:response.status,ackMs,startedAtMs};
}

async function signedPostAllowDisconnect(origin:string,event:SyntheticEvent):Promise<boolean>{
  try{
    const result=await signedPost(origin,[event],'drop-ack-after-persist');
    return result.status===200;
  }catch{return false;}
}

async function sendOne(origin:string,event:SyntheticEvent,expectedById:Map<string,ExpectedEvent>,expectedByUser:Map<string,Set<string>>,injection?:'persist-unavailable'|'drop-ack-after-persist'):Promise<PostResult>{
  registerExpected([event],expectedById,expectedByUser);
  const result=await signedPost(origin,[event],injection);
  assert.equal(result.status,200,'SIGNED_DURABLE_INGRESS_MUST_ACK_ONLY_AFTER_PERSIST');
  return {eventIds:[event.webhookEventId],ackMs:result.ackMs,startedAtMs:result.startedAtMs};
}

async function sendBatch(origin:string,events:readonly SyntheticEvent[],expectedById:Map<string,ExpectedEvent>,expectedByUser:Map<string,Set<string>>):Promise<PostResult>{
  registerExpected(events,expectedById,expectedByUser);
  const result=await signedPost(origin,events);
  assert.equal(result.status,200,'SIGNED_MULTI_EVENT_BATCH_MUST_PERSIST_BEFORE_ACK');
  return {eventIds:events.map(event=>event.webhookEventId),ackMs:result.ackMs,startedAtMs:result.startedAtMs};
}

async function sendScheduled(origin:string,events:readonly SyntheticEvent[],windowMs:number,expectedById:Map<string,ExpectedEvent>,expectedByUser:Map<string,Set<string>>):Promise<PostResult[]>{
  registerExpected(events,expectedById,expectedByUser);
  const start=performance.now();
  return Promise.all(events.map(async(event,index)=>{
    const scheduled=start+index*windowMs/events.length;
    const remaining=scheduled-performance.now();
    if(remaining>0)await delay(remaining);
    const result=await signedPost(origin,[event]);
    assert.equal(result.status,200,'LOAD_INGRESS_MUST_ACK_AFTER_DURABLE_PERSIST');
    return {eventIds:[event.webhookEventId],ackMs:result.ackMs,startedAtMs:result.startedAtMs};
  }));
}

function controlledClassifier(input:{question:string;contexts:{code:string}[]}){
  const candidate=input.contexts[0];
  return Promise.resolve(candidate
    ?{decision:'CONTINUE' as const,candidateCode:candidate.code,confidence:1}
    :{decision:'NEW' as const,candidateCode:null,confidence:1});
}

type ModelFault='TIMEOUT'|'HTTP_429_SIMULATED'|'HTTP_5XX_SIMULATED'|'INVALID_200'|'PARTIAL_OUTPUT';
type ModelFaultRule={kind:ModelFault;remaining:number};

function createControlledProducer(faults:Map<string,ModelFaultRule>,longAnswers:Map<string,string>){
  let calls=0;
  const produce=async(snapshot:Parameters<NonNullable<Parameters<typeof runAICycle>[2]['produce']>>[0]):Promise<AIResult>=>{
    calls++;
    const rule=faults.get(snapshot.question);
    if(rule&&rule.remaining>0){
      rule.remaining--;
      if(rule.kind==='INVALID_200'||rule.kind==='PARTIAL_OUTPUT')return null as unknown as AIResult;
      throw new Error(`CONTROLLED_${rule.kind}`);
    }
    const text=longAnswers.get(snapshot.question)??answerFor(snapshot.question);
    const result=createConversationReply(snapshot,text);
    if(!result)throw new Error('CONTROLLED_REPLY_REJECTED');
    return result;
  };
  return {produce,get calls(){return calls;}};
}

type LineRequest={url:string;to:string|null;replyToken:string|null;text:string;retryKey:string|null;messageCount:number};

function createControlledLineFetch(expectedByUser:Map<string,Set<string>>,requests:LineRequest[],routingRecipients=new Set<string>(),proofPool?:Pool):typeof fetch{
  return async(url,init):Promise<Response>=>{
    const target=url instanceof Request?url.url:String(url);
    assert(target==='https://api.line.me/v2/bot/message/push'||target==='https://api.line.me/v2/bot/message/reply','LINE_TRANSPORT_MUST_STAY_ON_CONTROLLED_FETCH');
    assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${syntheticLineToken}`,'SYNTHETIC_LINE_CREDENTIAL_REQUIRED');
    const requestBody=JSON.parse(String(init?.body)) as {to?:string;replyToken?:string;messages:{text:string;quickReply?:{items:{action:{data:string}}[]}}[]};
    const text=requestBody.messages.map(message=>message.text).join('');
    const to=requestBody.to??null;
    const replyToken=requestBody.replyToken??null;
    if(to){
      const allowed=expectedByUser.get(to);
      assert(allowed,'LINE_RECIPIENT_MUST_BE_A_SYNTHETIC_OWNED_USER');
      if(allowed.size&&!allowed.has(text)){
       assert(routingRecipients.has(to)&&proofPool,'ONLY_DECLARED_NOISY_RECIPIENT_MAY_RECEIVE_ROUTING_CONTROL');
       assert.equal(text,'ข้อความนี้เป็นเรื่องใดครับ เลือกเรื่องเดิมหรือเริ่มเรื่องใหม่');
       const items=requestBody.messages[0]?.quickReply?.items;assert(items?.length,'OWNED_SERVER_CHOICES_REQUIRED');
       for(const item of items){
        const token=/^yru:choice:([A-Za-z0-9_-]{43})$/.exec(item.action.data)?.[1];assert(token);
        const receipt:{rowCount:number|null}=await proofPool.query(`select p.token_hash from private.pending_route_choices p
         join private.line_identities i on i.line_session_id=p.line_session_id join public.messages m on m.id=p.pending_message_id
         join public.conversations c on c.id=m.conversation_id and c.line_session_id=i.line_session_id
         where p.token_hash=$1 and i.user_hash=$2 and p.consumed_at is null and p.expires_at>clock_timestamp()
          and m.sender_type='USER' and m.metadata->>'routing_status'='PENDING'`,[hashOpaqueToken(token,encryptionKey),hashLineUserId(to,encryptionKey)]);
        assert.equal(receipt.rowCount,1,'CONTROL_PROMPT_MUST_BELONG_TO_EXACT_PENDING_INPUT_AND_USER');
       }
      }
    }
    requests.push({url:target,to,replyToken,text,retryKey:new Headers(init?.headers).get('x-line-retry-key'),messageCount:requestBody.messages.length});
    return new Response(null,{status:200});
  };
}

interface WorkerLoop {stop:()=>Promise<void>;errors:string[];}
function startWorkerLoop(name:string,cycle:()=>Promise<QueueStats>):WorkerLoop{
  let running=true;const controller=new AbortController(),errors:string[]=[];
  const run=(async()=>{
    while(running){
      let result:QueueStats;
      try{result=await cycle();if(result.failed)errors.push(`${name}:CYCLE_FAILED`);}
      catch{errors.push(`${name}:CYCLE_THROWN`);break;}
      if(!running)break;
      if(result.claimed===0||result.failed>0)await delay(1000,undefined,{signal:controller.signal}).catch(()=>undefined);
    }
  })();
  return {errors,stop:async()=>{running=false;controller.abort();await run;}};
}

async function readInboxSnapshot(pool:Pool,eventIds:readonly string[],allowRoutingPrompts=false):Promise<InboxSnapshot[]>{
  const result=await pool.query<InboxSnapshot>(`
    select i.event_id,i.status inbox_status,i.attempts inbox_attempts,
      coalesce(extract(epoch from(i.completed_at-i.received_at))*1000,0)::float8 inbox_ms,
      coalesce(m.user_message_count,0)::int user_message_count,coalesce(m.user_content,'{}'::text[]) user_content,
      coalesce(m.line_message_ids,'{}'::text[]) line_message_ids,j.id ai_job_id,j.status ai_status,j.attempts ai_attempts,
      o.id outbox_id,o.status outbox_status,o.attempts outbox_attempts,o.kind outbox_kind,coalesce(m.pending_routing,false) pending_routing,
      j.last_error_code ai_error,o.last_error_code outbox_error,
      coalesce(extract(epoch from(o.completed_at-i.received_at))*1000,0)::float8 outbox_ms,
      o.recipient_user_id_encrypted recipient_encrypted,
      coalesce(extract(epoch from(o.completed_at-i.received_at))*1000,0)::float8 e2e_ms
    from private.webhook_inbox i
    left join lateral(select count(*)::int user_message_count,array_agg(m.content order by m.created_at,m.id) user_content,
      array_agg(m.line_message_id order by m.created_at,m.id) line_message_ids,bool_or(m.metadata->>'routing_status'='PENDING') pending_routing
      from public.messages m where m.source_event_id=i.id and m.sender_type='USER') m on true
    left join lateral(select x.id,x.status,x.attempts,x.last_error_code from private.ai_jobs x join public.messages um on um.id=x.message_id
      where um.source_event_id=i.id and um.sender_type='USER' limit 1) j on true
    left join private.message_outbox o on o.idempotency_key='ai-job:'||j.id
     or ($2::boolean and j.id is null and o.idempotency_key='student-response:'||i.id and o.channel='STUDENT' and o.kind='SYSTEM')
    where i.channel='STUDENT' and i.event_id=any($1::text[]) order by i.event_seq`,[eventIds,allowRoutingPrompts]);
  return result.rows;
}

async function waitForDrain(pool:Pool,eventIds:readonly string[],budgetMs:number,allowRoutingPrompts=false):Promise<{drained:boolean;elapsedMs:number;rows:InboxSnapshot[]}>{
  const started=performance.now(),deadline=started+budgetMs;
  let rows:InboxSnapshot[]=[];
  while(performance.now()<deadline){
    rows=await readInboxSnapshot(pool,eventIds,allowRoutingPrompts);
    if(rows.length===eventIds.length&&rows.every(row=>row.inbox_status==='DONE'&&row.user_message_count===1&&row.outbox_status==='SENT'
     &&(row.ai_status==='DONE'||allowRoutingPrompts&&row.ai_status===null&&row.outbox_kind==='SYSTEM'&&row.pending_routing))){
      return {drained:true,elapsedMs:performance.now()-started,rows};
    }
    if(rows.some(row=>row.inbox_status==='DEAD'||row.ai_status==='DEAD'||row.outbox_status==='DEAD'))break;
    await delay(100);
  }
  rows=await readInboxSnapshot(pool,eventIds,allowRoutingPrompts);
  return {drained:false,elapsedMs:performance.now()-started,rows};
}

async function waitForFairDrain(pool:Pool,noisy:readonly SyntheticEvent[],quiet:readonly SyntheticEvent[],budgetMs:number){
 const ids=[...noisy,...quiet].map(event=>event.webhookEventId),quietIds=new Set(quiet.map(event=>event.webhookEventId));
 const lastNoise=noisy.at(-1)!.webhookEventId,started=performance.now();let rows:InboxSnapshot[]=[];
 while(performance.now()-started<budgetMs){
  rows=await readInboxSnapshot(pool,ids,true);
  const durable=rows.length===ids.length&&rows.every(row=>row.inbox_status==='DONE'&&row.user_message_count===1);
  const required=rows.filter(row=>quietIds.has(row.event_id)||row.event_id===lastNoise);
  const latestAndQuietSent=required.length===quiet.length+1&&required.every(row=>row.outbox_status==='SENT'&&
   (row.ai_status==='DONE'||row.event_id===lastNoise&&row.ai_status===null&&row.outbox_kind==='SYSTEM'&&row.pending_routing));
  const safeTerminal=rows.every(row=>row.outbox_status==='SENT'||!quietIds.has(row.event_id)&&row.event_id!==lastNoise&&
   (row.ai_status==='SUPPRESSED'&&row.ai_error==='CONTEXT_CHANGED'&&row.outbox_id===null||
    row.ai_status==='DONE'&&row.outbox_status==='SUPPRESSED'&&row.outbox_error==='EVIDENCE_CHANGED'));
  if(durable&&latestAndQuietSent&&safeTerminal)return {drained:true,elapsedMs:performance.now()-started,rows};
  await delay(100);
 }
 return {drained:false,elapsedMs:performance.now()-started,rows};
}

async function processOne(pool:Pool,event:SyntheticEvent):Promise<InboxSnapshot>{
  const result=await runInboxCycle(pool,encryptionKey,{aiEnabled:true,classify:controlledClassifier});
  assert.equal(result.failed,0,'CONTROLLED_INBOX_CYCLE_MUST_COMPLETE');
  assert.equal(result.completed,1,'ONE_OWNED_STUDENT_EVENT_MUST_COMPLETE');
  const rows=await readInboxSnapshot(pool,[event.webhookEventId]);
  assert.equal(rows.length,1,'OWNED_EVENT_MUST_BE_FOUND');
  return rows[0];
}

async function prepareAI(pool:Pool,event:SyntheticEvent):Promise<string>{
  const result=await runAICycle(pool,encryptionKey,{produce:controlledProducer.produce});
  assert.equal(result.failed,0,'CONTROLLED_AI_WORKER_MUST_NOT_FAIL');
  assert.equal(result.completed,1,'ONE_AI_JOB_MUST_COMPLETE');
  const row=(await pool.query<{id:string}>(`select j.id from private.ai_jobs j join public.messages m on m.id=j.message_id
    join private.webhook_inbox i on i.id=m.source_event_id where i.event_id=$1`,[event.webhookEventId])).rows[0];
  assert(row,'AI_JOB_MUST_BE_OWNED_BY_THE_EVENT');
  return row.id;
}

function makeMetricsSampler(pools:Pool[],monitor:Pool,applicationNames:string[]){
  let active=true,timer:ReturnType<typeof setTimeout>|undefined;
  const postgresContainer=createPostgresContainerSampler();
  const metrics={samples:0,maxPoolTotal:null as number|null,maxPoolWaiting:null as number|null,maxLockWaiters:null as number|null,
    maxOldestQueueAgeMs:null as number|null,pgActivityStatus:'NOT_SAMPLED' as string,
    pgActivitySamples:0,pgActivityFailures:0,peakRssBytes:process.memoryUsage.rss(),totalMemoryBytes:totalmem(),
    freeMemoryStartBytes:freemem(),freeMemoryEndBytes:freemem()};
  const sample=async()=>{
    if(!active)return;
    metrics.samples++;
    metrics.peakRssBytes=Math.max(metrics.peakRssBytes,process.memoryUsage.rss());
    metrics.maxPoolTotal=Math.max(metrics.maxPoolTotal??0,...pools.map(pool=>pool.totalCount));
    metrics.maxPoolWaiting=Math.max(metrics.maxPoolWaiting??0,...pools.map(pool=>pool.waitingCount));
    try{
      const result=await monitor.query<{lock_waiters:number;oldest_queue_age_ms:number}>(`
        select (select count(*)::int from pg_stat_activity where datname=current_database() and application_name=any($1::text[])
          and wait_event_type='Lock') lock_waiters,
          coalesce((select max(age_ms) from (
            select extract(epoch from(clock_timestamp()-received_at))*1000 age_ms from private.webhook_inbox where status in('PENDING','PROCESSING')
            union all select extract(epoch from(clock_timestamp()-created_at))*1000 from private.ai_jobs where status in('PENDING','PROCESSING')
            union all select extract(epoch from(clock_timestamp()-created_at))*1000 from private.message_outbox where status in('PENDING','PROCESSING')
          ) queue_ages),0)::float8 oldest_queue_age_ms`,[applicationNames]);
      metrics.maxLockWaiters=Math.max(metrics.maxLockWaiters??0,result.rows[0].lock_waiters);
      metrics.maxOldestQueueAgeMs=Math.max(metrics.maxOldestQueueAgeMs??0,result.rows[0].oldest_queue_age_ms);
      metrics.freeMemoryEndBytes=freemem();
      metrics.pgActivitySamples++;
      metrics.pgActivityStatus=metrics.pgActivityFailures?'PARTIAL':'AVAILABLE';
    }catch{metrics.pgActivityFailures++;metrics.pgActivityStatus=metrics.pgActivitySamples?'PARTIAL':'UNAVAILABLE_PG_ACTIVITY_QUERY';}
    if(active)timer=setTimeout(()=>void sample(),1000);
  };
  timer=setTimeout(()=>void sample(),0);
  return {metrics,postgresContainer,stop:async()=>{active=false;if(timer)clearTimeout(timer);await postgresContainer.stop();}};
}

function sourceHashes():Record<string,string>{
  return Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(resolve(process.cwd(),path))).digest('hex')]));
}

function summarizeAcquisitionDuration(samples:readonly PoolAcquisitionSample[]){
  const acquired=samples.filter(sample=>sample.outcome==='ACQUIRED');
  return acquired.length
    ?{status:'AVAILABLE',...summarizeLatencySamples(acquired.map(sample=>sample.durationMs))}
    :{status:'UNAVAILABLE_NO_ACQUISITIONS',count:0,quantilesMs:null};
}

function summarizePoolAcquisitions(samples:readonly PoolAcquisitionSample[]){
  const queued=samples.filter(sample=>sample.queuedAtRequest),unqueued=samples.filter(sample=>!sample.queuedAtRequest);
  const byPool=Object.fromEntries([...new Set(samples.map(sample=>sample.pool))].sort().map(name=>{
    const poolSamples=samples.filter(sample=>sample.pool===name),poolQueued=poolSamples.filter(sample=>sample.queuedAtRequest);
    return [name,{totalAttempts:poolSamples.length,acquired:poolSamples.filter(sample=>sample.outcome==='ACQUIRED').length,
      failed:poolSamples.filter(sample=>sample.outcome==='FAILED').length,queuedAtRequestAttempts:poolQueued.length,
      queuedAtRequestAcquired:poolQueued.filter(sample=>sample.outcome==='ACQUIRED').length,
      acquisitionDurationMs:summarizeAcquisitionDuration(poolSamples),
      queuedAcquisitionDurationMs:summarizeAcquisitionDuration(poolQueued),
      unqueuedAcquisitionDurationMs:summarizeAcquisitionDuration(poolSamples.filter(sample=>!sample.queuedAtRequest))}];
  }));
  const queuedAcquisition=summarizeAcquisitionDuration(queued);
  return {semantics:'Duration from pg.Pool.connect invocation through client acquisition; queued means the public pool counters showed an existing waiter or no idle client at the configured connection limit. Unqueued acquisition can include a new PostgreSQL connection handshake. This excludes SQL duration after checkout.',
    totalAttempts:samples.length,acquired:samples.filter(sample=>sample.outcome==='ACQUIRED').length,
    failed:samples.filter(sample=>sample.outcome==='FAILED').length,queuedAtRequestAttempts:queued.length,
    queuedAtRequestAcquired:queued.filter(sample=>sample.outcome==='ACQUIRED').length,
    acquisitionDurationMs:summarizeAcquisitionDuration(samples),queuedAcquisitionDurationMs:queuedAcquisition,
    unqueuedAcquisitionDurationMs:summarizeAcquisitionDuration(unqueued),byPool};
}

function createBarrier(parties:number):()=>Promise<void>{
  let arrived=0,release:(()=>void)|undefined;
  const waiting=new Promise<void>(resolvePromise=>{release=resolvePromise;});
  return async()=>{arrived++;if(arrived===parties)release?.();await waiting;};
}

async function runClaimRaces(pool:Pool,racePool:Pool,runId:string,tracker:CapacityFixtureTracker):Promise<{races:number;passed:number;elapsedMs:number;maxPoolWaiting:number}>{
  const raceCount=100,sessionId=randomUUID(),staffIds=[randomUUID(),randomUUID()],ticketIds:string[]=[],conversationIds:string[]=[];
  const department=(await pool.query<{id:string}>("select id from public.departments where code='IT' and active limit 1")).rows[0];
  assert(department,'OWNED_IT_DEPARTMENT_REQUIRED_FOR_TICKET_CLAIM_RACES');
  await pool.query('insert into auth.users(id) values($1),($2)',staffIds);
  tracker.authUserIds.push(...staffIds);tracker.staffIds.push(...staffIds);
  for(const [index,staffId] of staffIds.entries()){
    await pool.query("insert into public.staff_profiles(id,department_id,display_name,role,active) values($1,$2,$3,'STAFF',true)",[staffId,department.id,`SOL-06 race staff ${runId} ${index}`]);
  }
  await pool.query('insert into public.line_sessions(id,anonymous_code) values($1,$2)',[sessionId,`SOL06_RACE_${runId}_${sessionId}`]);
  tracker.sessions.push(sessionId);
  for(let index=0;index<raceCount;index++){
    const conversationId=randomUUID();conversationIds.push(conversationId);
    tracker.conversations.push(conversationId);
    await pool.query("insert into public.conversations(id,line_session_id,conversation_type) values($1,$2,'SUPPORT')",[conversationId,sessionId]);
    const ticket=(await pool.query(`insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary)
      values($1,$2,$3,$4) returning id`,[sessionId,conversationId,department.id,`SOL06 ${runId} synthetic claim race`])).rows[0];
    ticketIds.push(ticket.id);
    tracker.tickets.push(ticket.id);
  }
  const started=performance.now();
  const results=await Promise.all(ticketIds.map(async(ticketId)=>{
    const barrier=createBarrier(2);
    return Promise.all(staffIds.map(async staffId=>{
      await barrier();
      try{
        await transaction(client=>applyTicketAction(client,staffId,ticketId,'ACCEPT',{revision:0,requestId:randomUUID()},encryptionKey),racePool);
        return 'WON' as const;
      }catch(error){
        if(error instanceof TicketError&&error.code==='CONFLICT')return 'LOST' as const;
        throw error;
      }
    }));
  }));
  const elapsedMs=performance.now()-started;
  assert(results.every(pair=>pair.filter(result=>result==='WON').length===1&&pair.filter(result=>result==='LOST').length===1),
    'EACH_SAME_TICKET_BARRIER_RACE_MUST_HAVE_EXACTLY_ONE_WINNER');
  const state=(await pool.query<{ticket_count:number;history_count:number;assigned_count:number;human_count:number}>(`
    select count(*)::int ticket_count,count(*) filter(where t.assigned_staff_id is not null)::int assigned_count,
      count(*) filter(where t.mode='HUMAN' and c.mode='HUMAN')::int human_count,
      (select count(*)::int from public.ticket_history h where h.ticket_id=any($1::uuid[]) and h.action='ACCEPTED') history_count
    from public.tickets t join public.conversations c on c.id=t.conversation_id where t.id=any($1::uuid[])`,[ticketIds])).rows[0];
  assert.deepEqual(state,{ticket_count:raceCount,history_count:raceCount,assigned_count:raceCount,human_count:raceCount},'CLAIMS_MUST_HAVE_ONE_CANONICAL_HISTORY_AND_HUMAN_TRANSITION');
  return {races:raceCount,passed:results.filter(pair=>pair.length===2).length,elapsedMs,maxPoolWaiting:racePool.waitingCount};
}

const modelFaults=new Map<string,ModelFaultRule>();
const longAnswers=new Map<string,string>();
const controlledProducer=createControlledProducer(modelFaults,longAnswers);

test('SOL-06 owned controlled capacity harness reports A-J and fault coverage honestly',async(t)=>{
  const runId=applicationName.slice('sol06-'.length);
  const pools={
    ingress:makePool(`${applicationName}-ingress`,1),
    inbox:makePool(`${applicationName}-inbox`,1),
    ai:makePool(`${applicationName}-ai`,1),
    outbox:makePool(`${applicationName}-outbox`,2),
    monitor:makePool(`${applicationName}-monitor`,1),
    races:makePool(`${applicationName}-races`,8),
  };
  const allPools=[pools.ingress,pools.inbox,pools.ai,pools.outbox,pools.monitor,pools.races];
  const poolAcquisitionSamples:PoolAcquisitionSample[]=[];
  instrumentPoolAcquisition(pools.ingress,'ingress',1,poolAcquisitionSamples);
  instrumentPoolAcquisition(pools.inbox,'inbox',1,poolAcquisitionSamples);
  instrumentPoolAcquisition(pools.ai,'ai',1,poolAcquisitionSamples);
  instrumentPoolAcquisition(pools.outbox,'outbox',2,poolAcquisitionSamples);
  instrumentPoolAcquisition(pools.races,'claimRaces',8,poolAcquisitionSamples);
  const expectedById=new Map<string,ExpectedEvent>(),expectedByUser=new Map<string,Set<string>>(),lineRequests:LineRequest[]=[];
  const routingRecipients=new Set<string>(),runtimeLogs:string[]=[];
  const fixtureTracker:CapacityFixtureTracker={sessions:[],conversations:[],tickets:[],staffIds:[],authUserIds:[],inboxIds:[],departments:[],incidents:[],aiProviders:[],aiModels:[]};
  const savedInfo=console.info,savedError=console.error;
  console.info=(...args:unknown[])=>{runtimeLogs.push(serializeLog(args));};
  console.error=(...args:unknown[])=>{runtimeLogs.push(serializeLog(args));};
  let ingress:{server:Server;origin:string;close:()=>Promise<void>}|undefined;
  let metricSampler:ReturnType<typeof makeMetricsSampler>|undefined;
  const workerLoops:WorkerLoop[]=[];
  const actualLoad:Record<string,string>=Object.fromEntries(CAPACITY_SCENARIOS.map(id=>[id,'NOT_IMPLEMENTED']));
  const faultStatus:Record<string,string>=Object.fromEntries(CAPACITY_REQUIRED_FAULTS.map(id=>[id,'NOT_IMPLEMENTED']));
  const roundReports:Array<Record<string,unknown>>=[];
  let ownerIdentity:{database:string;owner:string;marker:string}|undefined;
  let pilot:Record<string,unknown>={status:'NOT_RUN'};
  let raceReport:Record<string,unknown>={status:'NOT_RUN'};
  let fairnessReport:Record<string,unknown>={status:'NOT_RUN'};
  let gateReport:Record<string,unknown>={status:'NOT_RUN'};
  const acknowledgedEventIds:string[]=[];
  let dbCleanupStatus='NOT_RUN';
  const cpuStart=process.cpuUsage(),cpuWallStart=performance.now(),rssStart=process.memoryUsage.rss();
  const host={platform:platform(),release:release(),arch:arch(),cpuCount:cpus().length,cpuModel:cpus()[0]?.model??'UNKNOWN',totalMemoryBytes:totalmem(),freeMemoryBytes:freemem()};
  let observedWindowFailure:string|null=null;
  try{
    ownerIdentity=await verifyOwnedDatabase(pools.ingress);
    if(process.env.YRU_CAPACITY_STAFF_DIAGNOSTIC==='true'){
      const staff=await runCapacityStaffScenarios(pools.monitor,pools.outbox,fixtureTracker,runId);
      const faults=await runCapacityRequiredFaults(pools.monitor,pools.outbox,fixtureTracker,runId);
      const races=await runClaimRaces(pools.monitor,pools.races,runId,fixtureTracker);
      process.stdout.write(`SOL06_STAFF_DIAGNOSTIC ${JSON.stringify({scope:'OWNED_STAFF_ONLY_NOT_A_CAPACITY_GATE',source:sourceHashes(),staff,faults,races})}\n`);
      return;
    }
    ingress=await startControlledIngress(pools.ingress);
    assertControlledCapacityTransports({ingressOrigin:ingress.origin,model:'IN_MEMORY_CONTROLLED',line:'CONTROLLED_FETCH'});
    const appNames=[`${applicationName}-ingress`,`${applicationName}-inbox`,`${applicationName}-ai`,`${applicationName}-outbox`,`${applicationName}-races`];
    metricSampler=makeMetricsSampler(allPools,pools.monitor,appNames);
    const controlledLineFetch=createControlledLineFetch(expectedByUser,lineRequests,routingRecipients,pools.monitor);
    workerLoops.push(startWorkerLoop('INBOX',()=>runInboxCycle(pools.inbox,encryptionKey,{aiEnabled:true,classify:controlledClassifier})));
    workerLoops.push(startWorkerLoop('AI',()=>runAICycle(pools.ai,encryptionKey,{produce:controlledProducer.produce})));
    workerLoops.push(startWorkerLoop('OUTBOX',()=>runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:controlledLineFetch})));
    await delay(50);

    const pilotEvents=Array.from({length:5},(_,index)=>makeEvent(`pilot-${index}`));
    const pilotPoolSampleStart=poolAcquisitionSamples.length;
    const pilotStarted=performance.now();
    const pilotAcks=await sendScheduled(ingress.origin,pilotEvents,250,expectedById,expectedByUser);
    const pilotDrain=await waitForDrain(pools.monitor,pilotEvents.map(event=>event.webhookEventId),deriveDrainBudgetMs({targetEvents:5,pilotCompletedEvents:5,pilotDrainMs:10_000}));
    const pilotDrainMs=performance.now()-pilotStarted;
    acknowledgedEventIds.push(...pilotEvents.map(event=>event.webhookEventId));
    assert(pilotDrain.drained,'CONTROLLED_SMALL_PILOT_MUST_DRAIN_BEFORE_CAPACITY_SHAPES');
    const drainBudgets=Object.fromEntries(CAPACITY_TARGETS.scenarios.map(scenario=>[
      scenario.id,deriveDrainBudgetMs({targetEvents:scenario.students,pilotCompletedEvents:pilotEvents.length,pilotDrainMs}),
    ]));
    pilot={status:'PASS',events:pilotEvents.length,arrivalWindowMs:250,ack:summarizeLatencySamples(pilotAcks.map(result=>result.ackMs)),
      drainMs:pilotDrain.elapsedMs,measuredCapacityEventsPerSecond:pilotEvents.length/(pilotDrainMs/1000),drainBudgetsMs:drainBudgets,
      dbPoolClientAcquisition:summarizePoolAcquisitions(poolAcquisitionSamples.slice(pilotPoolSampleStart))};
    process.stdout.write(`SOL06_PILOT ${JSON.stringify({scope:'DIAGNOSTIC_ONLY',pilot})}\n`);
    if(process.env.YRU_CAPACITY_PILOT_ONLY==='true')return;
    let loadStop=false;
    for(const scenario of CAPACITY_TARGETS.scenarios){
      const roundRows:Record<string,unknown>[]=[];
      let scenarioPassed=true;
      for(let round=1;round<=CAPACITY_TARGETS.repetitions;round++){
        const events=Array.from({length:scenario.students},(_,index)=>makeEvent(`${scenario.id}-${round}-${index}`));
        const poolSampleStart=poolAcquisitionSamples.length;
        const acks=await sendScheduled(ingress.origin,events,scenario.arrivalWindowMs,expectedById,expectedByUser);
        acknowledgedEventIds.push(...events.map(event=>event.webhookEventId));
        const acceptedAt=new Map(acks.map((ack,index)=>[events[index].webhookEventId,ack.startedAtMs+ack.ackMs]));
        const observedArrivalWindowMs=Math.max(...acks.map(ack=>ack.startedAtMs))-Math.min(...acks.map(ack=>ack.startedAtMs));
        if(observedArrivalWindowMs>scenario.arrivalWindowMs+200)observedWindowFailure=`${scenario.id}-${round}`;
        const drained=await waitForDrain(pools.monitor,events.map(event=>event.webhookEventId),drainBudgets[scenario.id]!);
        const ackSummary=summarizeLatencySamples(acks.map(result=>result.ackMs));
        const queueSamples=drained.rows.map(row=>row.inbox_ms??0);
        const endToEndSamples=drained.rows.map(row=>row.e2e_ms??0);
        const expectedRecipients=new Map(events.map(event=>[event.webhookEventId,event.source.userId]));
        const recipientHistoryExact=drained.rows.length===events.length&&drained.rows.every(row=>{
          const expected=expectedById.get(row.event_id);
          if(!expected||row.user_message_count!==1||row.user_content[0]!==expected.text||row.line_message_ids[0]!==expected.lineMessageId||
            !row.recipient_encrypted||!row.outbox_id)return false;
          return decryptValue(row.recipient_encrypted,encryptionKey)===expected.userId&&expectedRecipients.get(row.event_id)===expected.userId;
        });
        const ackTargetMet=ackSummary.p95Ms<=CAPACITY_TARGETS.acknowledgementP95Ms&&ackSummary.p99Ms<=CAPACITY_TARGETS.acknowledgementP99Ms;
        const exactDrain=drained.drained&&recipientHistoryExact&&drained.rows.every(row=>row.inbox_attempts===1&&row.ai_attempts===1&&row.outbox_attempts===1);
        scenarioPassed&&=ackTargetMet&&exactDrain&&!observedWindowFailure;
        const statuses={inbox:countStatuses(drained.rows.map(row=>row.inbox_status)),ai:countStatuses(drained.rows.map(row=>row.ai_status??'MISSING')),
          outbox:countStatuses(drained.rows.map(row=>row.outbox_status??'MISSING'))};
        const rowReport={scenario:scenario.id,round,events:events.length,requestedArrivalWindowMs:scenario.arrivalWindowMs,observedArrivalWindowMs,
          ack:ackSummary,drained:drained.drained,drainMs:drained.elapsedMs,drainBudgetMs:drainBudgets[scenario.id],
          queueLatency:summarizeLatencySamples(queueSamples),endToEnd:summarizeLatencySamples(endToEndSamples),
          dbPoolClientAcquisition:summarizePoolAcquisitions(poolAcquisitionSamples.slice(poolSampleStart)),
          throughputEventsPerSecond:events.length/(scenario.arrivalWindowMs/1000),attempts:{inbox:sumAttempts(drained.rows,'inbox_attempts'),
            ai:sumAttempts(drained.rows,'ai_attempts'),outbox:sumAttempts(drained.rows,'outbox_attempts')},statuses,
          deadLetters:countDeadLetters(statuses),ackTargetMet,exactDrain,recipientHistoryExact};
        roundRows.push(rowReport);roundReports.push(rowReport);
        process.stdout.write(`SOL06_ROUND ${JSON.stringify(rowReport)}\n`);
        if(!scenarioPassed){loadStop=true;break;}
        void acceptedAt;
      }
      actualLoad[scenario.id]=roundRows.length===CAPACITY_TARGETS.repetitions&&roundRows.every(row=>row.ackTargetMet===true&&row.exactDrain===true)?'PASS':roundRows.length?'FAIL':'NOT_RUN';
      if(loadStop){
        for(const remaining of CAPACITY_TARGETS.scenarios.filter(item=>!roundReports.some(row=>row.scenario===item.id)))actualLoad[remaining.id]='NOT_RUN';
        break;
      }
    }
    if(!loadStop)actualLoad.A=actualLoad.A;

    const orderedUserId=`U${randomUUID().replaceAll('-','')}`;
    const orderedEvents=[makeEvent('E-first',{userId:orderedUserId,text:'SOL06 ordering first'}),makeEvent('E-second',{userId:orderedUserId,text:'SOL06 ordering second'})];
    await sendBatch(ingress.origin,orderedEvents,expectedById,expectedByUser);
    const duplicateAck=await signedPost(ingress.origin,[...orderedEvents].reverse());
    assert.equal(duplicateAck.status,200,'REORDERED_DUPLICATE_EVENT_REDELIVERY_MUST_ACK');
    acknowledgedEventIds.push(...orderedEvents.map(event=>event.webhookEventId));
    const orderedDrain=await waitForDrain(pools.monitor,orderedEvents.map(event=>event.webhookEventId),deriveDrainBudgetMs({targetEvents:2,pilotCompletedEvents:5,pilotDrainMs:pilotDrainMs}));
    const orderedRows=await pools.monitor.query<{event_id:string;event_seq:string;content:string;conversation_id:string}>(`
      select i.event_id,i.event_seq::text,m.content,m.conversation_id from private.webhook_inbox i
      join public.messages m on m.source_event_id=i.id and m.sender_type='USER'
      where i.channel='STUDENT' and i.event_id=any($1::text[]) order by i.event_seq`,[orderedEvents.map(event=>event.webhookEventId)]);
    assert(orderedDrain.drained,'REORDERED_BATCH_MUST_DRAIN');
    assert.deepEqual(orderedRows.rows.map(row=>row.content),orderedEvents.map(event=>eventText(event)),'SAME_USER_EVENT_SEQUENCE_MUST_SURVIVE_REORDERED_REDELIVERY');
    assert.equal(new Set(orderedRows.rows.map(row=>row.conversation_id)).size,1,'SAME_USER_HISTORY_MUST_STAY_IN_ONE_CONVERSATION');
    const duplicateCount=await pools.monitor.query<{count:number}>(`select count(*)::int count from private.webhook_inbox where channel='STUDENT' and event_id=any($1::text[])`,[orderedEvents.map(event=>event.webhookEventId)]);
    assert.equal(duplicateCount.rows[0].count,2,'DUPLICATE_WEBHOOK_IDS_MUST_CREATE_ONE_INGRESS_ROW_EACH');
    const noiseUser=`U${randomUUID().replaceAll('-','')}`;
    const noisy=Array.from({length:20},(_,index)=>makeEvent(`E-noisy-${index}`,{userId:noiseUser,text:`SOL06 noisy ${index}`}));
    routingRecipients.add(noiseUser);
    const quiet=Array.from({length:3},(_,index)=>makeEvent(`E-quiet-${index}`,{text:`SOL06 quiet ${index}`}));
    const fairnessAcks=await Promise.all([sendBatch(ingress.origin,noisy,expectedById,expectedByUser),sendBatch(ingress.origin,quiet,expectedById,expectedByUser)]);
    acknowledgedEventIds.push(...noisy.map(event=>event.webhookEventId),...quiet.map(event=>event.webhookEventId));
    const fairnessEvents=[...noisy,...quiet];
    const fairnessDrain=await waitForFairDrain(pools.monitor,noisy,quiet,deriveDrainBudgetMs({targetEvents:fairnessEvents.length,pilotCompletedEvents:5,pilotDrainMs}));
    process.stdout.write(`SOL06_FAIRNESS_DIAGNOSTIC ${JSON.stringify({quiet:fairnessDrain.rows.filter(row=>quiet.some(event=>event.webhookEventId===row.event_id)),noisyStatuses:fairnessDrain.rows.filter(row=>noisy.some(event=>event.webhookEventId===row.event_id)).map(row=>({inbox:row.inbox_status,userMessages:row.user_message_count,ai:row.ai_status,outbox:row.outbox_status}))})}\n`);
    assert(fairnessDrain.drained,'NOISY_SENDER_MUST_NOT_STARVE_QUIET_SENDERS');
    assert(fairnessDrain.rows.every(row=>{
     const expected=expectedById.get(row.event_id);return expected&&row.user_content[0]===expected.text&&row.line_message_ids[0]===expected.lineMessageId;
    }),'ALL_NOISY_AND_QUIET_INPUT_HISTORY_MUST_REMAIN_EXACT');
    const quietIds=quiet.map(event=>event.webhookEventId);
    const quietRows=await readInboxSnapshot(pools.monitor,quietIds);
    fairnessReport={status:'PASS',noisyEvents:noisy.length,quietUsers:quiet.length,quietEvents:quiet.length,
      drainMs:fairnessDrain.elapsedMs,quietQueueLatency:summarizeLatencySamples(quietRows.map(row=>row.inbox_ms??0)),
      ingressAcks:fairnessAcks.map(item=>({events:item.eventIds.length,ackMs:item.ackMs}))};
    actualLoad.E=orderedDrain.drained&&fairnessDrain.drained?'PASS':'FAIL';

    for(const loop of workerLoops)await loop.stop();
    workerLoops.length=0;

    const leaseEvent=makeEvent('fault-lease-expiry');
    await sendOne(ingress.origin,leaseEvent,expectedById,expectedByUser);
    acknowledgedEventIds.push(leaseEvent.webhookEventId);
    const leased=(await pools.inbox.query<{id:string;attempts:number}>("select id,attempts from private.claim_inbox('STUDENT') where event_id=$1",[leaseEvent.webhookEventId])).rows[0];
    assert(leased,'LEASE_EXPIRY_FAULT_EVENT_MUST_BE_CLAIMED');
    await pools.inbox.query("update private.webhook_inbox set lease_until=clock_timestamp()-interval '1 millisecond' where id=$1",[leased.id]);
    const leaseRecovered=await runInboxCycle(pools.inbox,encryptionKey,{aiEnabled:true,classify:controlledClassifier});
    assert.equal(leaseRecovered.completed,1,'EXPIRED_INBOX_LEASE_MUST_RECOVER');
    const leaseRow=(await pools.monitor.query<{attempts:number;status:string}>("select attempts,status from private.webhook_inbox where event_id=$1",[leaseEvent.webhookEventId])).rows[0];
    assert.deepEqual(leaseRow,{attempts:2,status:'DONE'});
    await prepareAI(pools.ai,leaseEvent);
    const leaseDelivery=await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:createControlledLineFetch(expectedByUser,lineRequests)});
    assert.equal(leaseDelivery.sent,1);
    faultStatus.lease_expiry_recovery='PASS';

    const unavailableEvent=makeEvent('fault-persist-unavailable');
    registerExpected([unavailableEvent],expectedById,expectedByUser);
    const unavailable=await signedPost(ingress.origin,[unavailableEvent],'persist-unavailable');
    assert.equal(unavailable.status,503,'PERSISTENCE_FAILURE_MUST_NOT_BE_ACKNOWLEDGED');
    const missingBeforeRetry=await pools.monitor.query<{count:number}>("select count(*)::int count from private.webhook_inbox where channel='STUDENT' and event_id=$1",[unavailableEvent.webhookEventId]);
    assert.equal(missingBeforeRetry.rows[0].count,0,'FAILED_PERSISTENCE_MUST_LEAVE_NO_ACKABLE_ROW');
    await sendOne(ingress.origin,unavailableEvent,expectedById,expectedByUser);
    acknowledgedEventIds.push(unavailableEvent.webhookEventId);
    await processOne(pools.inbox,unavailableEvent);await prepareAI(pools.ai,unavailableEvent);
    await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:createControlledLineFetch(expectedByUser,lineRequests)});
    faultStatus.database_unavailable_before_persist='PASS';

    const commitAckEvent=makeEvent('fault-commit-before-ack');
    registerExpected([commitAckEvent],expectedById,expectedByUser);
    const connectionDropped=await signedPostAllowDisconnect(ingress.origin,commitAckEvent);
    assert.equal(connectionDropped,false,'CONNECTION_MUST_DROP_AFTER_PERSIST_BEFORE_ACK');
    const retry=await signedPost(ingress.origin,[commitAckEvent]);
    assert.equal(retry.status,200,'REDELIVERY_AFTER_AMBIGUOUS_ACK_MUST_SUCCEED');
    acknowledgedEventIds.push(commitAckEvent.webhookEventId);
    await processOne(pools.inbox,commitAckEvent);const commitAckJob=await prepareAI(pools.ai,commitAckEvent);
    await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:createControlledLineFetch(expectedByUser,lineRequests)});
    const effectCount=await pools.monitor.query<{inbox_count:number;user_count:number;job_count:number;outbox_count:number}>(`
      select (select count(*)::int from private.webhook_inbox where channel='STUDENT' and event_id=$1) inbox_count,
        (select count(*)::int from public.messages where source_event_id=(select id from private.webhook_inbox where event_id=$1) and sender_type='USER') user_count,
        (select count(*)::int from private.ai_jobs where id=$2) job_count,
        (select count(*)::int from private.message_outbox where idempotency_key='ai-job:'||$2) outbox_count`,[commitAckEvent.webhookEventId,commitAckJob]);
    assert.deepEqual(effectCount.rows[0],{inbox_count:1,user_count:1,job_count:1,outbox_count:1},'AMBIGUOUS_INGRESS_ACK_MUST_NOT_DUPLICATE_LOGICAL_EFFECTS');
    faultStatus.worker_crash_after_commit_before_ack='PASS';

    const faultCases:Array<{name:string;kind:ModelFault}>=([
      {name:'timeout',kind:'TIMEOUT'},{name:'429',kind:'HTTP_429_SIMULATED'},{name:'5xx',kind:'HTTP_5XX_SIMULATED'},
      {name:'invalid200',kind:'INVALID_200'},{name:'partial',kind:'PARTIAL_OUTPUT'},
    ]);
    const modelFaultReports:Record<string,unknown>[]=[];
    for(const fault of faultCases){
      const event=makeEvent(`fault-model-${fault.name}`);
      await sendOne(ingress.origin,event,expectedById,expectedByUser);acknowledgedEventIds.push(event.webhookEventId);
      await processOne(pools.inbox,event);
      modelFaults.set(eventText(event)!,{kind:fault.kind,remaining:1});
      const failed=await runAICycle(pools.ai,encryptionKey,{produce:controlledProducer.produce});
      assert.equal(failed.failed,1,`CONTROLLED_${fault.kind}_MUST_FAIL_ONE_WORKER_ATTEMPT`);
      const userMessage=(await pools.monitor.query<{id:string}>("select id from public.messages where source_event_id=(select id from private.webhook_inbox where event_id=$1) and sender_type='USER'",[event.webhookEventId])).rows[0];
      assert(userMessage,'FAILED_GENERATION_MUST_RETAIN_INPUT_HISTORY');
      const firstState=(await pools.monitor.query<{status:string;attempts:number}>("select status,attempts from private.ai_jobs where message_id=$1",[userMessage.id])).rows[0];
      assert.deepEqual(firstState,{status:'PENDING',attempts:1},'MODEL_FAILURE_MUST_RETRY_WITH_FINITE_JOB_ATTEMPT');
      await pools.ai.query("update private.ai_jobs set available_at=clock_timestamp() where message_id=$1 and status='PENDING'",[userMessage.id]);
      const recovered=await runAICycle(pools.ai,encryptionKey,{produce:controlledProducer.produce});
      assert.equal(recovered.completed,1,'CONTROLLED_MODEL_FAULT_MUST_RECOVER_WITHOUT_NEW_USER_INPUT');
      const completed=(await pools.monitor.query<{status:string;attempts:number}>("select status,attempts from private.ai_jobs where message_id=$1",[userMessage.id])).rows[0];
      assert.deepEqual(completed,{status:'DONE',attempts:2});
      await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:createControlledLineFetch(expectedByUser,lineRequests)});
      modelFaultReports.push({case:fault.name,status:'RECOVERED',workerAttempts:completed.attempts,transport:'IN_MEMORY_CONTROLLED',gatewayAttemptLedger:'NOT_EXERCISED'});
    }
    for(const fault of faultCases){
      const event=makeEvent(`fault-actual-gateway-${fault.name}`),faults=new Map<string,ModelFaultRule>();
      await sendOne(ingress.origin,event,expectedById,expectedByUser);acknowledgedEventIds.push(event.webhookEventId);
      await processOne(pools.inbox,event);faults.set(eventText(event)!,{kind:fault.kind,remaining:1});
      const produce=await createCapacityGatewayProducer(pools.ai,fixtureTracker,`${runId}-${fault.name}`,faults);
      const result=await runAICycle(pools.ai,encryptionKey,{produce});
      assert.equal(result.completed,1,'ACTUAL_CONTROLLED_GATEWAY_MUST_FALL_BACK_WITHIN_THE_OWNED_JOB');
      const state=(await pools.monitor.query(`select j.id,j.status,j.attempts,j.conversation_id,m.source_event_id from private.ai_jobs j
        join public.messages m on m.id=j.message_id join private.webhook_inbox i on i.id=m.source_event_id where i.event_id=$1`,[event.webhookEventId])).rows[0];
      assert.equal(state.attempts,1);assert.equal(state.status,'DONE');
      const attempts=(await pools.monitor.query('select status,error_code from private.ai_turn_attempts where inbox_id=$1 order by created_at,id',[state.source_event_id])).rows;
      assert.equal(attempts.length,2,'ACTUAL_GATEWAY_MUST_PERSIST_EXACTLY_TWO_BOUNDED_ATTEMPTS');
      assert.deepEqual(attempts.map(attempt=>attempt.status),['FAILED','SUCCESS']);
      const expectedError=fault.kind==='TIMEOUT'?'TIMEOUT':fault.kind==='HTTP_429_SIMULATED'?'RATE_LIMITED':fault.kind==='HTTP_5XX_SIMULATED'?'SERVER_ERROR':'INVALID_OUTPUT';
      assert.equal(attempts[0].error_code,expectedError);
      const usage=(await pools.monitor.query('select status,fallback_used from private.ai_usage_logs where conversation_id=$1 order by created_at,id',[state.conversation_id])).rows;
      assert.deepEqual(usage,[{status:'ERROR',fallback_used:false},{status:'SUCCESS',fallback_used:true}]);
      assert.equal((await pools.monitor.query('select count(*)::int n from public.tickets where conversation_id=$1',[state.conversation_id])).rows[0].n,0,
        'PROVIDER_FAILURE_MUST_NOT_CREATE_A_TICKET');
      const answer=`Controlled actual gateway response: ${eventText(event)}`;expectedByUser.get(event.source.userId)!.add(answer);
      assert.equal((await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:createControlledLineFetch(expectedByUser,lineRequests)})).sent,1);
      modelFaultReports.push({case:`actual_gateway_${fault.name}`,status:'PASS',workerAttempts:1,inferenceAttempts:2,attempts,usage,
        transport:'CONTROLLED_HTTP_THROUGH_PRODUCTION_ADAPTER',gatewayAttemptLedger:'DURABLE_OWNED_INBOX',paidFallback:false});
    }
    actualLoad.F='PASS';

    const retryEvent=makeEvent('fault-stable-push-retry');
    await sendOne(ingress.origin,retryEvent,expectedById,expectedByUser);acknowledgedEventIds.push(retryEvent.webhookEventId);
    await processOne(pools.inbox,retryEvent);const retryJob=await prepareAI(pools.ai,retryEvent);
    const retryOutbox=(await pools.monitor.query<{id:string;line_retry_key:string;line_session_id:string}>("select id,line_retry_key,line_session_id from private.message_outbox where idempotency_key=$1",[`ai-job:${retryJob}`])).rows[0];
    assert(retryOutbox,'CONTROLLED_PUSH_OUTBOX_REQUIRED');
    const retryRequests:LineRequest[]=[];
    const statuses=[503,429];
    for(const status of statuses){
      if(retryRequests.length)await pools.outbox.query('update private.message_outbox set available_at=clock_timestamp() where id=$1 and status=\'PENDING\'',[retryOutbox.id]);
      const result=await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:async(url,init)=>{
        const body=JSON.parse(String(init?.body)) as {to:string;messages:{text:string}[]};
        retryRequests.push({url:String(url),to:body.to,replyToken:null,text:body.messages.map(message=>message.text).join(''),
          retryKey:new Headers(init?.headers).get('x-line-retry-key'),messageCount:body.messages.length});
        return new Response(null,{status});
      }});
      assert.equal(result.failed,1);
    }
    const beforeWorkerRestart=(await pools.monitor.query<{status:string;attempts:number}>("select status,attempts from private.message_outbox where id=$1",[retryOutbox.id])).rows[0];
    assert.deepEqual(beforeWorkerRestart,{status:'PENDING',attempts:2},'FAILED_PUSH_RETRY_STATE_MUST_SURVIVE_WORKER_RESTART');
    const restartedWorkerScript=[
      "import {Pool} from 'pg';",
      "import {runOutboxCycle} from './lib/queue/run-outbox.ts';",
      "console.info=()=>{};console.error=()=>{};",
      "const pool=new Pool({host:'127.0.0.1',port:54422,database:process.env.SOL06_DATABASE,user:'postgres',password:'postgres',max:1,application_name:'sol06-restarted-worker'});",
      "const id=process.env.SOL06_OUTBOX_ID;await pool.query(\"update private.message_outbox set available_at=clock_timestamp() where id=$1 and status='PENDING'\",[id]);",
      "let captured;const stats=await runOutboxCycle(pool,process.env.SOL06_ENCRYPTION_KEY,{accessTokens:{STUDENT:process.env.SOL06_LINE_TOKEN,STAFF:process.env.SOL06_LINE_TOKEN},fetchImpl:async(url,init)=>{",
      "const body=JSON.parse(String(init?.body));captured={url:url instanceof Request?url.url:String(url),to:body.to??null,replyToken:body.replyToken??null,text:body.messages.map((message)=>message.text).join(''),retryKey:new Headers(init?.headers).get('x-line-retry-key'),messageCount:body.messages.length};return new Response(null,{status:200});}});",
      "await pool.end();process.stdout.write(JSON.stringify({stats,captured}));",
    ].join('\n');
    const restartedWorker=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',restartedWorkerScript],{
      cwd:process.cwd(),windowsHide:true,timeout:20_000,env:{...process.env,SOL06_DATABASE:database,SOL06_OUTBOX_ID:retryOutbox.id,
        SOL06_ENCRYPTION_KEY:encryptionKey,SOL06_LINE_TOKEN:syntheticLineToken},encoding:'utf8'})) as {stats:{claimed:number;sent:number;failed:number};captured:LineRequest};
    assert.deepEqual(restartedWorker.stats,{claimed:1,sent:1,failed:0},'FRESH_WORKER_PROCESS_MUST_RESUME_THE_PERSISTED_PUSH_RETRY');
    assert(restartedWorker.captured,'RESTARTED_WORKER_MUST_USE_THE_CONTROLLED_LINE_TRANSPORT');
    retryRequests.push(restartedWorker.captured);
    assert.equal(new Set(retryRequests.map(request=>request.retryKey)).size,1,'PUSH_RETRIES_MUST_KEEP_ONE_SUPPORTED_RETRY_KEY');
    assert(retryRequests.every(request=>request.to===expectedById.get(retryEvent.webhookEventId)?.userId),
      'PUSH_RETRIES_MUST_KEEP_THE_ORIGINAL_SYNTHETIC_RECIPIENT');
    const retryFinal=(await pools.monitor.query<{status:string;attempts:number}>("select status,attempts from private.message_outbox where id=$1",[retryOutbox.id])).rows[0];
    assert.deepEqual(retryFinal,{status:'SENT',attempts:3});
    faultStatus.restart_during_retry='PASS';

    const networkEvent=makeEvent('fault-push-timeout-before-acceptance');
    await sendOne(ingress.origin,networkEvent,expectedById,expectedByUser);acknowledgedEventIds.push(networkEvent.webhookEventId);
    await processOne(pools.inbox,networkEvent);const networkJob=await prepareAI(pools.ai,networkEvent);
    const networkOutbox=(await pools.monitor.query<{id:string}>("select id from private.message_outbox where idempotency_key=$1",[`ai-job:${networkJob}`])).rows[0];
    assert(networkOutbox);
    const beforeAcceptance=await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:async()=>{throw new Error('CONTROLLED_NETWORK_TIMEOUT');}});
    assert.equal(beforeAcceptance.failed,1);
    const retryable=(await pools.monitor.query<{status:string;attempts:number}>("select status,attempts from private.message_outbox where id=$1",[networkOutbox.id])).rows[0];
    assert.deepEqual(retryable,{status:'PENDING',attempts:1},'PUSH_TIMEOUT_MUST_REMAIN_VISIBLE_AND_RETRYABLE');
    await pools.outbox.query("update private.message_outbox set available_at=clock_timestamp() where id=$1",[networkOutbox.id]);
    assert.equal((await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:async()=>new Response(null,{status:200})})).sent,1);

    const acceptedEvent=makeEvent('fault-after-accept-before-outbox-commit');
    await sendOne(ingress.origin,acceptedEvent,expectedById,expectedByUser);acknowledgedEventIds.push(acceptedEvent.webhookEventId);
    await processOne(pools.inbox,acceptedEvent);const acceptedJob=await prepareAI(pools.ai,acceptedEvent);
    const acceptedOutbox=(await pools.monitor.query<{id:string}>("select id from private.message_outbox where idempotency_key=$1",[`ai-job:${acceptedJob}`])).rows[0];
    assert(acceptedOutbox);
    const afterAcceptCrash=await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:async()=>{
      await pools.monitor.query("update private.message_outbox set lease_until=clock_timestamp()-interval '1 second' where id=$1",[acceptedOutbox.id]);
      return new Response(null,{status:200});
    }});
    assert.equal(afterAcceptCrash.failed,1,'LEASE_LOSS_AFTER_CONTROLLED_HTTP_MUST_NOT_BE_RECORDED_AS_SENT');
    const uncertain=(await pools.monitor.query<{status:string;attempts:number}>("select status,attempts from private.message_outbox where id=$1",[acceptedOutbox.id])).rows[0];
    assert.deepEqual(uncertain,{status:'PROCESSING',attempts:1});
    const afterAcceptanceRequests:LineRequest[]=[];
    const retryAfterAcceptance=await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:async(url,init)=>{
      const body=JSON.parse(String(init?.body)) as {to:string;messages:{text:string}[]};
      afterAcceptanceRequests.push({url:String(url),to:body.to,replyToken:null,text:body.messages.map(message=>message.text).join(''),
        retryKey:new Headers(init?.headers).get('x-line-retry-key'),messageCount:body.messages.length});
      return new Response(null,{status:409});
    }});
    assert.equal(retryAfterAcceptance.sent,1,'SUPPORTED_DUPLICATE_RETRY_RESPONSE_MUST_FINALIZE_SENT');
    assert.equal(afterAcceptanceRequests.length,1);
    const acceptedAttemptKey=(await pools.monitor.query<{line_retry_key:string}>("select line_retry_key from private.message_outbox where id=$1",[acceptedOutbox.id])).rows[0].line_retry_key;
    assert.equal(afterAcceptanceRequests[0].retryKey,acceptedAttemptKey,'POST_HTTP_CRASH_RETRY_MUST_KEEP_STABLE_LINE_RETRY_ID');
    faultStatus.outbox_crash_after_http='PASS';

    const replyEvent=makeEvent('fault-ambiguous-reply',{replyToken:`sol06-reply-${randomUUID()}`});
    await sendOne(ingress.origin,replyEvent,expectedById,expectedByUser);acknowledgedEventIds.push(replyEvent.webhookEventId);
    await processOne(pools.inbox,replyEvent);const replyJob=await prepareAI(pools.ai,replyEvent);
    const replyOutbox=(await pools.monitor.query<{id:string}>("select id from private.message_outbox where idempotency_key=$1",[`ai-job:${replyJob}`])).rows[0];
    assert(replyOutbox);
    let replyCalls=0;
    await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:async(url)=>{
      replyCalls++;assert(String(url).endsWith('/reply'),'VALID_SHORT_LIVED_TOKEN_USES_REPLY_ENDPOINT');throw new Error('CONTROLLED_AMBIGUOUS_REPLY');
    }});
    const ambiguous=(await pools.monitor.query<{status:string;attempts:number}>("select status,attempts from private.message_outbox where id=$1",[replyOutbox.id])).rows[0];
    assert.deepEqual(ambiguous,{status:'UNKNOWN',attempts:1});assert.equal(replyCalls,1,'AMBIGUOUS_SINGLE_USE_REPLY_TOKEN_MUST_NOT_BE_REPLAYED');
    faultStatus.expired_reply_token='PASS';

    const expiredReply=makeEvent('fault-expired-reply-token',{replyToken:`sol06-expired-reply-${randomUUID()}`});
    await sendOne(ingress.origin,expiredReply,expectedById,expectedByUser);acknowledgedEventIds.push(expiredReply.webhookEventId);
    await pools.inbox.query("update private.webhook_inbox set received_at=clock_timestamp()-interval '90 seconds' where channel='STUDENT' and event_id=$1",[expiredReply.webhookEventId]);
    await processOne(pools.inbox,expiredReply);const expiredJob=await prepareAI(pools.ai,expiredReply);
    const expiredRequests:LineRequest[]=[];
    await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:async(url,init)=>{
      const body=JSON.parse(String(init?.body)) as {to:string;messages:{text:string}[]};
      expiredRequests.push({url:String(url),to:body.to??null,replyToken:null,text:body.messages.map(message=>message.text).join(''),
        retryKey:new Headers(init?.headers).get('x-line-retry-key'),messageCount:body.messages.length});
      return new Response(null,{status:200});
    }});
    assert(expiredRequests[0].url.endsWith('/push'),'EXPIRED_REPLY_TOKEN_MUST_FALL_BACK_TO_PUSH');
    assert(expiredRequests[0].retryKey,'EXPIRED_REPLY_FALLBACK_PUSH_MUST_HAVE_STABLE_RETRY_KEY');
    void expiredJob;

    const unicodeEvent=makeEvent('fault-unicode-packets');
    await sendOne(ingress.origin,unicodeEvent,expectedById,expectedByUser);acknowledgedEventIds.push(unicodeEvent.webhookEventId);
    await processOne(pools.inbox,unicodeEvent);
    const unicodeText='สวัสดี🧑‍💻'.repeat(1300);longAnswers.set(eventText(unicodeEvent)!,unicodeText);
    const unicodeJob=await prepareAI(pools.ai,unicodeEvent);
    const unicodeOutbox=(await pools.monitor.query<{id:string}>("select id from private.message_outbox where idempotency_key=$1",[`ai-job:${unicodeJob}`])).rows[0];
    assert(unicodeOutbox);
    const packetBodies:string[][]=[];
    const packetStatuses=[503,200];
    for(const status of packetStatuses){
      if(packetBodies.length)await pools.outbox.query("update private.message_outbox set available_at=clock_timestamp() where id=$1",[unicodeOutbox.id]);
      await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:async(_url,init)=>{
        const body=JSON.parse(String(init?.body)) as {messages:{text:string}[]};packetBodies.push(body.messages.map(message=>message.text));return new Response(null,{status});
      }});
    }
    assert(packetBodies[0].length>1,'UNICODE_RESPONSE_MUST_USE_MULTIPLE_LINE_PACKETS');
    assert.equal(packetBodies[0].join(''),unicodeText,'UNICODE_PACKET_BOUNDARIES_MUST_NOT_DROP_OR_DUPLICATE_TEXT');
    assert.deepEqual(packetBodies[1],packetBodies[0],'RETRY_MUST_KEEP_THE_COMPLETE_MULTIPACKET_PAYLOAD');
    faultStatus.unicode_multi_packet_partial_failure='PARTIAL';

    const imageEvent=makeEvent('fault-image-media');
    const imageId=randomUUID().replaceAll('-','');
    const image:SyntheticEvent={...imageEvent,message:{type:'image',id:`image-${imageId}`}};
    expectedByUser.set(image.source.userId,new Set());
    await sendOne(ingress.origin,image,expectedById,expectedByUser);acknowledgedEventIds.push(image.webhookEventId);
    const imageInbox=await processOne(pools.inbox,image);
    assert.equal(imageInbox.ai_job_id,null,'UNSUPPORTED_MEDIA_MUST_NOT_CALL_THE_MODEL');
    const imageRows=await pools.monitor.query<{message_type:string;content:string}>("select message_type,content from public.messages where source_event_id=(select id from private.webhook_inbox where event_id=$1) and sender_type='USER'",[image.webhookEventId]);
    assert.deepEqual(imageRows.rows,[{message_type:'IMAGE',content:'[ไฟล์แนบ]'}]);
    await runOutboxCycle(pools.outbox,encryptionKey,{accessTokens:{STUDENT:syntheticLineToken,STAFF:syntheticLineToken},fetchImpl:createControlledLineFetch(expectedByUser,lineRequests)});
    const groupEvent={webhookEventId:`sol06-group-${randomUUID()}`,type:'message',source:{type:'group',groupId:`C${randomUUID().replaceAll('-','')}`},
      message:{type:'text',id:`group-${randomUUID()}`,text:'synthetic group event'}};
    const roomEvent={webhookEventId:`sol06-room-${randomUUID()}`,type:'message',source:{type:'room',roomId:`R${randomUUID().replaceAll('-','')}`},
      message:{type:'text',id:`room-${randomUUID()}`,text:'synthetic room event'}};
    const groupRoom=await signedPost(ingress.origin,[groupEvent,roomEvent]);assert.equal(groupRoom.status,200);
    acknowledgedEventIds.push(groupEvent.webhookEventId,roomEvent.webhookEventId);
    const unsupportedGroup=await runInboxCycle(pools.inbox,encryptionKey,{aiEnabled:true,classify:controlledClassifier});
    const unsupportedRoom=await runInboxCycle(pools.inbox,encryptionKey,{aiEnabled:true,classify:controlledClassifier});
    assert.equal(unsupportedGroup.completed,1,'ONE_INBOX_CYCLE_MUST_CONSUME_ONE_GROUP_OR_ROOM_EVENT');
    assert.equal(unsupportedRoom.completed,1,'SECOND_INBOX_CYCLE_MUST_CONSUME_THE_OTHER_EVENT');
    const unsupportedRows=await pools.monitor.query<{event_id:string;status:string;last_error_code:string|null;user_hash:string|null}>(
      "select event_id,status,last_error_code,user_hash from private.webhook_inbox where event_id=any($1::text[]) order by event_id",[[groupEvent.webhookEventId,roomEvent.webhookEventId]]);
    assert.deepEqual(unsupportedRows.rows.map(row=>({event_id:row.event_id,status:row.status,last_error_code:row.last_error_code,user_hash:row.user_hash})),
      [groupEvent,roomEvent].map(event=>({event_id:event.webhookEventId,status:'DONE',last_error_code:'UNSUPPORTED_EVENT',user_hash:null})).sort((a,b)=>a.event_id.localeCompare(b.event_id)),
      'GROUP_AND_ROOM_EVENTS_MUST_BE_DONE_WITHOUT_A_STUDENT_IDENTITY');
    const unsupportedEffects=await pools.monitor.query<{user_messages:number;ai_jobs:number}>(`select
      (select count(*)::int from public.messages m join private.webhook_inbox i on i.id=m.source_event_id where i.event_id=any($1::text[]) and m.sender_type='USER') user_messages,
      (select count(*)::int from private.ai_jobs j join public.messages m on m.id=j.message_id join private.webhook_inbox i on i.id=m.source_event_id where i.event_id=any($1::text[])) ai_jobs`,
      [[groupEvent.webhookEventId,roomEvent.webhookEventId]]);
    assert.deepEqual(unsupportedEffects.rows[0],{user_messages:0,ai_jobs:0},'UNSUPPORTED_GROUP_AND_ROOM_EVENTS_MUST_NOT_CREATE_USER_OR_AI_EFFECTS');
    faultStatus.unsupported_media_group_room='PASS';
    const staffScenarios=await runCapacityStaffScenarios(pools.monitor,pools.outbox,fixtureTracker,runId);
    Object.assign(actualLoad,staffScenarios.scenarios);
    const requiredFaults=await runCapacityRequiredFaults(pools.monitor,pools.outbox,fixtureTracker,runId);
    Object.assign(faultStatus,requiredFaults.faults);

    const raceStarted=performance.now();
    const races=await runClaimRaces(pools.monitor,pools.races,runId,fixtureTracker);
    raceReport={status:'PASS',races:races.races,passed:races.passed,elapsedMs:races.elapsedMs,poolMax:8,poolWaitingAtEnd:races.maxPoolWaiting};
    actualLoad.D='PASS';
    faultStatus.secret_redacted_logs=runtimeLogs.some(line=>[webhookSecret,syntheticLineToken,encryptionKey].some(secret=>line.includes(secret)))?'FAIL':'PASS';
    assert.equal(faultStatus.secret_redacted_logs,'PASS','CONTROLLED_RUNTIME_LOGS_MUST_NOT_EXPOSE_KEYS_TOKENS_OR_ENCRYPTION_MATERIAL');
    actualLoad.G='PASS';
    actualLoad.E=orderedDrain.drained&&fairnessDrain.drained?'PASS':'FAIL';
    const allRows=await readInboxSnapshot(pools.monitor,acknowledgedEventIds);
    assert.equal(allRows.length,new Set(acknowledgedEventIds).size,'EVERY_ACKNOWLEDGED_EVENT_MUST_HAVE_ONE_ROW');
    const scenarioStatuses={...actualLoad};
    const contractStatus=evaluateCapacityAcceptance(scenarioStatuses,faultStatus);
    assert(metricSampler,'CAPACITY_METRICS_SAMPLER_MUST_BE_STARTED');
    await metricSampler.stop();
    const postgresContainerMetrics:PostgresContainerSnapshot=metricSampler.postgresContainer.snapshot();
    const poolAcquisitionMetrics=summarizePoolAcquisitions(poolAcquisitionSamples);
    const queuedAcquisitionFailures=poolAcquisitionMetrics.queuedAtRequestAttempts-poolAcquisitionMetrics.queuedAtRequestAcquired;
    const metricStatuses={
      postgresContainerCpuRam:postgresContainerMetrics.status,
      dbPoolClientAcquisitionQuantiles:poolAcquisitionMetrics.acquired===0?'UNAVAILABLE':poolAcquisitionMetrics.failed?'PARTIAL':'AVAILABLE',
      dbPoolQueuedAcquisitionQuantiles:poolAcquisitionMetrics.queuedAtRequestAcquired===0?'UNAVAILABLE':queuedAcquisitionFailures?'PARTIAL':'AVAILABLE',
    };
    const measurementGateStatus=Object.values(metricStatuses).every(status=>status==='AVAILABLE')?'AVAILABLE':'PARTIAL';
    const capacityStatus=contractStatus==='FAIL'?'FAIL':contractStatus==='PASS'&&measurementGateStatus==='AVAILABLE'?'PASS':'PARTIAL';
    const cpuDelta=process.cpuUsage(cpuStart),cpuElapsedMs=(performance.now()-cpuWallStart);
    const metrics=metricSampler.metrics;
    const aggregate={eventCount:acknowledgedEventIds.length,acknowledgedEvents:new Set(acknowledgedEventIds).size,
      statusCounts:{inbox:countStatuses(allRows.map(row=>row.inbox_status)),ai:countStatuses(allRows.map(row=>row.ai_status??'NOT_CREATED')),
        outbox:countStatuses(allRows.map(row=>row.outbox_status??'NOT_CREATED'))},
      attempts:{inbox:sumAttempts(allRows,'inbox_attempts'),ai:sumAttempts(allRows,'ai_attempts'),outbox:sumAttempts(allRows,'outbox_attempts')},
      deadLetters:allRows.filter(row=>row.inbox_status==='DEAD'||row.ai_status==='DEAD'||row.outbox_status==='DEAD').length};
    const incompleteMetrics=Object.entries(metricStatuses).filter(([,status])=>status!=='AVAILABLE').map(([name])=>name);
    gateReport={status:capacityStatus,scenarioStatuses,faultStatuses:faultStatus,
      unimplementedScenarios:Object.entries(scenarioStatuses).filter(([,status])=>status==='NOT_IMPLEMENTED'||status==='NOT_RUN').map(([id])=>id),
      partialScenarios:Object.entries(scenarioStatuses).filter(([,status])=>status==='PARTIAL').map(([id])=>id),unimplementedFaults:CAPACITY_REQUIRED_FAULTS.filter(name=>faultStatus[name]==='NOT_IMPLEMENTED'),
      partialFaults:CAPACITY_REQUIRED_FAULTS.filter(name=>faultStatus[name]==='PARTIAL'),measurementGateStatus,metricStatuses,incompleteMetrics,
      notMeasuredByDesign:['actual_LINE_delivery','actual_model_provider_latency']};
    const report={taskId:'SOL-06',status:capacityStatus,source:{head:readHead(),sha256:sourceHashes()},database:ownerIdentity,
      runtime:{node:process.version,host,workers:{webIngress:1,inboxCycleLoops:1,aiCycleLoops:1,outboxCycleLoops:1},poolLimits:{ingress:1,inbox:1,ai:1,outbox:2,monitor:1,claimRaces:8},
        actualWorkerLoopPollMsWhenIdle:1000},transports:{ingress:'SIGNED_LOOPBACK_HTTP',model:'IN_MEMORY_CONTROLLED',line:'CONTROLLED_FETCH',normalDatabaseUsed:false,liveProviderCalls:0,liveLineMessages:0},
      targets:CAPACITY_TARGETS,pilot,loadRounds:roundReports,scenarioStatuses,fairness:fairnessReport,claimRaces:raceReport,
      identityScenarios:{selectionTTL:staffScenarios.selectionTTL,queuedSwitch:staffScenarios.queuedSwitch,incomingStudent:staffScenarios.incomingStudent},
      mandatoryFaultEvidence:requiredFaults.evidence,
      modelFaults:modelFaultReports,aggregate,observations:{acknowledgementQuantilesPerRound:true,queueAndEndToEndQuantilesPerRound:true,
        maxPoolTotal:metrics.maxPoolTotal,maxPoolWaiting:metrics.maxPoolWaiting,maxObservedLockWaiters:metrics.maxLockWaiters,
        maxOldestQueueAgeMs:metrics.maxOldestQueueAgeMs,pgActivitySampler:metrics.pgActivityStatus,poolSamples:metrics.samples,
        harnessWorkerCpuUserMs:Math.round(cpuDelta.user/1000),harnessWorkerCpuSystemMs:Math.round(cpuDelta.system/1000),harnessElapsedMs:Math.round(cpuElapsedMs),
        harnessRssStartBytes:rssStart,harnessPeakRssBytes:metrics.peakRssBytes,hostTotalMemoryBytes:metrics.totalMemoryBytes,
        hostFreeMemoryStartBytes:metrics.freeMemoryStartBytes,hostFreeMemoryEndBytes:metrics.freeMemoryEndBytes,
        pgActivitySamples:metrics.pgActivitySamples,pgActivityFailures:metrics.pgActivityFailures,
        postgresContainerCpuRam:postgresContainerMetrics,dbPoolClientAcquisition:poolAcquisitionMetrics},gateReport};
    process.stdout.write(`SOL06_CAPACITY_REPORT ${JSON.stringify(report)}\n`);
    assert.equal(observedWindowFailure,null,'LOAD_ARRIVAL_WINDOW_MUST_MATCH_REQUESTED_TARGET');
    assert(capacityStatus!=='PASS'||measurementGateStatus==='AVAILABLE','CAPACITY_GATE_MUST_NOT_PASS_WITH_INCOMPLETE_REQUIRED_MEASUREMENTS');
    assert.notEqual(actualLoad.A,'FAIL','SCENARIO_A_MUST_MEET_TARGETS');
    assert.notEqual(actualLoad.B,'FAIL','SCENARIO_B_MUST_MEET_TARGETS');
    assert.notEqual(actualLoad.C,'FAIL','SCENARIO_C_MUST_MEET_TARGETS');
    assert.equal(new Set(lineRequests.map(request=>request.to).filter(Boolean)).size>0,true,'CONTROLLED_DELIVERY_MUST_CAPTURE_OWNED_RECIPIENTS');
    void raceStarted;
    t.diagnostic(`SOL-06 gate status=${capacityStatus}; missing scenarios/faults remain in structured report`);
  }catch(error){
    const reason=error instanceof Error?error.message.split('\n')[0].replace(/[^A-Za-z0-9_ :.-]/g,'').slice(0,160):'CONTROLLED_TEST_ERROR';
    if(metricSampler)await metricSampler.stop();
    process.stdout.write(`SOL06_PRIMARY_FAILURE ${JSON.stringify({reason,measurements:{
      postgresContainer:metricSampler?.postgresContainer.snapshot()??{status:'NOT_STARTED'},
      dbPoolClientAcquisition:summarizePoolAcquisitions(poolAcquisitionSamples),
    }})}\n`);throw error;
  }finally{
    for(const loop of workerLoops)await loop.stop().catch(()=>undefined);
    await metricSampler?.stop();
    if(ingress)await ingress.close().catch(()=>undefined);
    try{
      const eventUserHashes=[...new Set([...expectedById.values()].map(event=>hashLineUserId(event.userId,encryptionKey)))];
      const sessionsFromEvents=(await pools.monitor.query<{id:string}>(
        'select line_session_id id from private.line_identities where user_hash=any($1::text[])', [eventUserHashes])).rows.map(row=>row.id);
      const allSessions=[...new Set([...fixtureTracker.sessions,...sessionsFromEvents])];
      const ticketsFromSessions=(await pools.monitor.query<{id:string}>(
        'select id from public.tickets where line_session_id=any($1::uuid[])',[allSessions])).rows.map(row=>row.id);
      const ticketIds=[...new Set([...fixtureTracker.tickets,...ticketsFromSessions])];
      const conversationsFromSessions=(await pools.monitor.query<{id:string}>(
        'select id from public.conversations where line_session_id=any($1::uuid[])',[allSessions])).rows.map(row=>row.id);
      const conversations=[...new Set([...fixtureTracker.conversations,...conversationsFromSessions])];
      const staffIds=[...new Set(fixtureTracker.staffIds)];
      const ownedInboxIds=[...new Set([...fixtureTracker.inboxIds,...(await pools.monitor.query<{id:string}>(
        'select id from private.webhook_inbox where event_id=any($1::text[])',[acknowledgedEventIds])).rows.map(row=>row.id)])];
      const outboxIds=(await pools.monitor.query<{id:string}>(`select id from private.message_outbox where line_session_id=any($1::uuid[])
        or recipient_staff_id=any($2::uuid[]) or ticket_id=any($3::uuid[])`,[allSessions,staffIds,ticketIds])).rows.map(row=>row.id);
      const aiJobIds=(await pools.monitor.query<{id:string}>(`select id from private.ai_jobs where line_session_id=any($1::uuid[])
        or conversation_id=any($2::uuid[])`,[allSessions,conversations])).rows.map(row=>row.id);

      if(outboxIds.length){
        await pools.monitor.query('delete from private.delivery_attempts where outbox_id=any($1::uuid[])',[outboxIds]);
        await pools.monitor.query('delete from private.staff_chat_delivery_cases where outbox_id=any($1::uuid[])',[outboxIds]);
        await pools.monitor.query('delete from private.staff_chat_delivery_guards where outbox_id=any($1::uuid[])',[outboxIds]);
      }
      if(aiJobIds.length||ownedInboxIds.length)await pools.monitor.query(
        'delete from private.ai_turn_attempts where ai_job_id=any($1::uuid[]) or inbox_id=any($2::uuid[])',[aiJobIds,ownedInboxIds]);
      if(fixtureTracker.aiProviders.length){
        await pools.monitor.query('delete from private.ai_model_observations where provider_id=any($1::uuid[])',[fixtureTracker.aiProviders]);
        await pools.monitor.query('delete from private.ai_errors where provider_id=any($1::uuid[])',[fixtureTracker.aiProviders]);
        await pools.monitor.query('delete from private.ai_usage_logs where provider_id=any($1::uuid[])',[fixtureTracker.aiProviders]);
        await pools.monitor.query('delete from private.ai_models where id=any($1::uuid[])',[fixtureTracker.aiModels]);
        await pools.monitor.query('delete from private.ai_providers where id=any($1::uuid[])',[fixtureTracker.aiProviders]);
      }
      if(ticketIds.length||staffIds.length){
        await pools.monitor.query('delete from private.staff_alert_delivery_cases where ticket_id=any($1::uuid[])',[ticketIds]);
        await pools.monitor.query('delete from private.staff_alert_deliveries where staff_id=any($1::uuid[])',[staffIds]);
        await pools.monitor.query('delete from private.staff_alert_events where ticket_id=any($1::uuid[]) or staff_id=any($2::uuid[])',[ticketIds,staffIds]);
        await pools.monitor.query('delete from private.staff_chat_commands where ticket_id=any($1::uuid[]) or staff_id=any($2::uuid[])',[ticketIds,staffIds]);
        await pools.monitor.query('delete from private.staff_chat_read_cursors where ticket_id=any($1::uuid[]) or staff_id=any($2::uuid[])',[ticketIds,staffIds]);
        await pools.monitor.query('delete from private.staff_line_case_context where ticket_id=any($1::uuid[]) or staff_id=any($2::uuid[])',[ticketIds,staffIds]);
        await pools.monitor.query('delete from private.staff_action_tokens where ticket_id=any($1::uuid[]) or staff_id=any($2::uuid[])',[ticketIds,staffIds]);
        await pools.monitor.query('delete from private.ticket_action_receipts where ticket_id=any($1::uuid[]) or staff_id=any($2::uuid[])',[ticketIds,staffIds]);
        await pools.monitor.query('delete from private.activities where ticket_id=any($1::uuid[]) or actor_id=any($2::uuid[])',[ticketIds,staffIds]);
      }
      if(ticketIds.length){
        await pools.monitor.query('delete from private.incident_detection_jobs where ticket_id=any($1::uuid[])',[ticketIds]);
        await pools.monitor.query('delete from private.incident_ticket_vectors where ticket_id=any($1::uuid[])',[ticketIds]);
        await pools.monitor.query('delete from private.incident_context_proofs where ticket_id=any($1::uuid[])',[ticketIds]);
        await pools.monitor.query('delete from private.staff_chat_message_order where ticket_id=any($1::uuid[])',[ticketIds]);
        await pools.monitor.query('delete from public.incident_tickets where ticket_id=any($1::uuid[])',[ticketIds]);
        await pools.monitor.query('delete from public.ticket_history where ticket_id=any($1::uuid[])',[ticketIds]);
      }
      if(allSessions.length)await pools.monitor.query('delete from private.pending_route_choices where line_session_id=any($1::uuid[])',[allSessions]);
      if(outboxIds.length)await pools.monitor.query('delete from private.message_outbox where id=any($1::uuid[])',[outboxIds]);
      if(aiJobIds.length)await pools.monitor.query('delete from private.ai_jobs where id=any($1::uuid[])',[aiJobIds]);
      if(conversations.length||ticketIds.length||ownedInboxIds.length)await pools.monitor.query(`delete from public.messages where conversation_id=any($1::uuid[])
        or ticket_id=any($2::uuid[]) or source_event_id=any($3::uuid[])`,[conversations,ticketIds,ownedInboxIds]);
      if(ownedInboxIds.length){
        await pools.monitor.query('delete from private.staff_inbound_messages where source_event_id=any($1::uuid[])',[ownedInboxIds]);
        await pools.monitor.query('delete from private.webhook_inbox where id=any($1::uuid[])',[ownedInboxIds]);
      }
      if(conversations.length)await pools.monitor.query('update public.conversations set active_ticket_id=null where id=any($1::uuid[])',[conversations]);
      if(ticketIds.length)await pools.monitor.query('delete from public.tickets where id=any($1::uuid[])',[ticketIds]);
      if(conversations.length)await pools.monitor.query('delete from public.conversations where id=any($1::uuid[])',[conversations]);
      if(allSessions.length)await pools.monitor.query('delete from private.line_identities where line_session_id=any($1::uuid[])',[allSessions]);
      if(allSessions.length)await pools.monitor.query('delete from public.line_sessions where id=any($1::uuid[])',[allSessions]);
      if(staffIds.length)await pools.monitor.query('delete from private.staff_line_identities where staff_id=any($1::uuid[])',[staffIds]);
      if(staffIds.length)await pools.monitor.query('delete from public.staff_profiles where id=any($1::uuid[])',[staffIds]);
      if(fixtureTracker.authUserIds.length)await pools.monitor.query('delete from auth.users where id=any($1::uuid[])',[[...new Set(fixtureTracker.authUserIds)]]);
      if(fixtureTracker.departments.length)await pools.monitor.query('delete from public.departments where id=any($1::uuid[])',[fixtureTracker.departments]);

      const leftovers=(await pools.monitor.query<{sessions:number;tickets:number;conversations:number;staff:number;inbox:number;outbox:number;aiJobs:number}>(`select
        (select count(*)::int from public.line_sessions where id=any($1::uuid[])) sessions,
        (select count(*)::int from public.tickets where id=any($2::uuid[])) tickets,
        (select count(*)::int from public.conversations where id=any($3::uuid[])) conversations,
        (select count(*)::int from public.staff_profiles where id=any($4::uuid[])) staff,
        (select count(*)::int from private.webhook_inbox where id=any($5::uuid[])) inbox,
        (select count(*)::int from private.message_outbox where id=any($6::uuid[])) outbox,
        (select count(*)::int from private.ai_jobs where id=any($7::uuid[])) "aiJobs"`,
        [allSessions,ticketIds,conversations,staffIds,ownedInboxIds,outboxIds,aiJobIds])).rows[0];
      assert.deepEqual(leftovers,{sessions:0,tickets:0,conversations:0,staff:0,inbox:0,outbox:0,aiJobs:0},'EXACT_OWNED_FIXTURE_CLEANUP_MUST_LEAVE_NO_TRACKED_ROWS');
      dbCleanupStatus='FIXTURE_ROWS_CLEANED';
    }catch(error){dbCleanupStatus='FIXTURE_CLEANUP_FAILED';process.stdout.write(`SOL06_FIXTURE_CLEANUP ${JSON.stringify({status:dbCleanupStatus,code:error&&typeof error==='object'&&'code' in error?String(error.code):'ASSERTION',constraint:error&&typeof error==='object'&&'constraint' in error?String(error.constraint):null,
      protocol:error&&typeof error==='object'&&'code' in error&&error.code==='08P01'&&error instanceof Error?error.message:null})}\n`);}
    await Promise.allSettled(allPools.map(pool=>pool.end()));
    console.info=savedInfo;console.error=savedError;
    assert.equal(dbCleanupStatus,'FIXTURE_ROWS_CLEANED','OWNED_TEST_FIXTURES_MUST_BE_CLEANED_BEFORE_DISPOSABLE_DATABASE_DROP');
  }
  assert.equal(dbCleanupStatus,'FIXTURE_ROWS_CLEANED','OWNED_TEST_FIXTURES_MUST_BE_CLEANED_BEFORE_DISPOSABLE_DATABASE_DROP');
});

function countStatuses(values:readonly (string|null)[]):Record<string,number>{
  return values.reduce<Record<string,number>>((counts,value)=>{const key=value??'NULL';counts[key]=(counts[key]??0)+1;return counts;},{});
}

function sumAttempts(rows:readonly InboxSnapshot[],field:'inbox_attempts'|'ai_attempts'|'outbox_attempts'):number{
  return rows.reduce((sum,row)=>sum+Number(row[field]??0),0);
}

function countDeadLetters(statuses:Record<string,Record<string,number>>):number{
  return Object.values(statuses).reduce((sum,queue)=>sum+(queue.DEAD??0),0);
}

function readHead():string{
  try{return execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();}catch{return 'UNAVAILABLE';}
}
