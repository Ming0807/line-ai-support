import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {ToolRegistry,type ToolContext} from './tools';
import {transaction} from '../database/pool';
import {lockConversation,type DbClient} from '../tickets/authorization';
import {createEscalation} from '../tickets/create-ticket';
import {resolveDepartment} from '../tickets/route-department';
import {userEventSchema} from '../line/events';
import {decryptValue,encryptValue,hashLineUserId} from '../security/identity';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {searchKnowledge,knowledgeScopeSchema} from '../knowledge/retrieval';
import {structuredQuerySchema} from '../knowledge/structured-query';
import {searchStructured,type StructuredSearchRequest} from '../knowledge/structured-search';

export const structuredDatasetNames=['academic_calendar_events','tuition_fees','transfer_courses','university_services',
 'university_systems','service_forms','announcements'] as const;
export type StructuredDataset=typeof structuredDatasetNames[number];
const query=z.string().trim().min(1).max(2000);
const departmentCode=z.string().regex(/^[A-Z_]{2,40}$/);
const ticketArgs=z.object({departmentCode,summary:z.string().trim().min(1).max(1000)}).strict();
const ticketResult=z.object({id:z.uuid(),ticket_no:z.string().min(1).max(80)}).strict();

async function authorizeAIContext(client:DbClient,context:ToolContext){
 await lockConversation(client,context.conversationId);
 const allowed=await client.query(`select c.id from public.conversations c join public.line_sessions s on s.id=c.line_session_id
  where c.id=$1 and c.line_session_id=$2 and c.revision=$3 and c.mode='AI' and c.status in('ACTIVE','WAITING') and s.active
  and not exists(select 1 from public.tickets t where t.conversation_id=c.id and t.mode='HUMAN' and t.status not in('CLOSED','CANCELLED'))`,
 [context.conversationId,context.lineSessionId,context.conversationRevision]);
 if(allowed.rowCount!==1)throw new Error('AI_TOOL_CONTEXT_CHANGED');
}

export interface KnowledgeToolOptions {
 vector?:number[];fingerprint?:string;key?:string;
 structuredSearch?:(client:PoolClient,args:StructuredSearchRequest,context:ToolContext)=>Promise<unknown>;
}
/** The vector space is supplied by the backend embedding adapter, never model arguments. No network runs in these transactions. */
export function createKnowledgeToolRegistry(pool:Pool,options:KnowledgeToolOptions):ToolRegistry{
 const withContext=<T>(context:ToolContext,work:(client:PoolClient)=>Promise<T>)=>transaction(async client=>{
  await client.query("set local statement_timeout='5s'");await authorizeAIContext(client,context);return work(client);
 },pool);
 return new ToolRegistry()
  .register('search_knowledge',z.object({query,scope:knowledgeScopeSchema}).strict(),(args,context)=>withContext(context,async client=>{
   if(!options.vector||!options.fingerprint)throw new Error('KNOWLEDGE_EMBEDDING_REQUIRED');
   try{return await searchKnowledge(client,{scope:args.scope,vector:options.vector,fingerprint:options.fingerprint,limit:12});}
   catch(error){if(error instanceof Error&&error.message==='KNOWLEDGE_SCOPE_AMBIGUOUS')return {status:'SCOPE_AMBIGUOUS' as const};throw error;}
  }),
   'Search reviewed official public knowledge in the requested scope. The backend owns embeddings and eligibility filters.')
  .register('route_department',z.object({departmentCode}).strict(),(args,context)=>withContext(context,async client=>{
   const department=await resolveDepartment(client,args.departmentCode);return {code:args.departmentCode,name:department.name_th};
  }),'Resolve an active university department. This recommendation cannot create or change a ticket.')
  .register('search_structured',z.object({query:structuredQuerySchema,scope:knowledgeScopeSchema}).strict(),(args,context)=>withContext(context,client=>{
   if(options.structuredSearch)return options.structuredSearch(client,args,context);
   if(!options.key)throw new Error('STRUCTURED_SEARCH_UNAVAILABLE');return searchStructured(client,args,options.key);
  }),'Search exact reviewed PUBLIC values through strict Query1 and fixed selectors. Missing context is clarification; unavailable schemas cannot return invented records.');
}

/** Caller owns the verified inbox transaction. Confirmation is a consumed, owned opaque ESCALATE choice, never an AI argument. */
export function createTicketToolRegistry(client:DbClient,key:string,confirmationEventId?:string):ToolRegistry{
 return new ToolRegistry().register('create_ticket',ticketArgs,async(args,context)=>{
  if(!confirmationEventId||!z.uuid().safeParse(confirmationEventId).success)throw new Error('AI_TOOL_CONFIRMATION_REQUIRED');
  await lockConversation(client,context.conversationId);
  const source=(await client.query(`select e.payload_encrypted,e.user_hash,i.user_hash expected_hash from private.webhook_inbox e
   join private.line_identities i on i.line_session_id=$2 where e.id=$1 and e.channel='STUDENT'`,[confirmationEventId,context.lineSessionId])).rows[0];
  if(!source||source.user_hash!==source.expected_hash)throw new Error('AI_TOOL_CONFIRMATION_INVALID');
  const event=userEventSchema.safeParse(JSON.parse(decryptValue(source.payload_encrypted,key)));
  if(!event.success||event.data.type!=='postback'||hashLineUserId(event.data.source.userId,key)!==source.expected_hash)throw new Error('AI_TOOL_CONFIRMATION_INVALID');
  const requestFingerprint=createHash('sha256').update(JSON.stringify({tool:'create_ticket',context,args})).digest('hex');
  const previous=(await client.query('select * from private.ai_tool_receipts where confirmation_event_id=$1',[confirmationEventId])).rows[0];
  if(previous){
   if(previous.line_session_id!==context.lineSessionId||previous.conversation_id!==context.conversationId||previous.request_fingerprint!==requestFingerprint)
    throw new Error('AI_TOOL_RECEIPT_CONFLICT');
   return ticketResult.parse(JSON.parse(decryptValue(previous.result_encrypted,key)));
  }
  await authorizeAIContext(client,context);
  const token=/^yru:choice:([A-Za-z0-9_-]{43})$/.exec(event.data.postback.data)?.[1];
  if(!token)throw new Error('AI_TOOL_CONFIRMATION_INVALID');
  const choice=(await client.query(`select choice,candidate_snapshot from private.pending_route_choices
   where token_hash=$1 and line_session_id=$2 and consumed_at is not null and expires_at>clock_timestamp() for update`,
  [hashOpaqueToken(token,key),context.lineSessionId])).rows[0];
  if(!choice||choice.choice.action!=='ESCALATE'||choice.choice.conversationId!==context.conversationId||choice.choice.departmentCode!==args.departmentCode||
   !Array.isArray(choice.candidate_snapshot)||!choice.candidate_snapshot.some((candidate:{id?:string;revision?:number})=>candidate.id===context.conversationId&&candidate.revision===context.conversationRevision))
   throw new Error('AI_TOOL_CONFIRMATION_INVALID');
  const result=ticketResult.parse(await createEscalation(client,{sessionId:context.lineSessionId,conversationId:context.conversationId,
   departmentCode:args.departmentCode,summary:args.summary},key));
  await client.query(`insert into private.ai_tool_receipts(confirmation_event_id,line_session_id,conversation_id,tool_name,request_fingerprint,result_encrypted)
   values($1,$2,$3,'create_ticket',$4,$5)`,[confirmationEventId,context.lineSessionId,context.conversationId,requestFingerprint,encryptValue(JSON.stringify(result),key)]);
  return result;
 },'Create a HUMAN ticket only after the backend verifies explicit student confirmation. Model arguments cannot supply confirmation or ownership.');
}
