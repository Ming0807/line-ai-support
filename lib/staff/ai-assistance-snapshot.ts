import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '../database/pool';
import {loadActor,lockConversation} from '../tickets/authorization';
import type {AISnapshot} from '../ai/run-worker';
import {knowledgeStructuredCatalogLock} from '../knowledge/delivery-fence';
import {projectAssistSource,AssistError} from './ai-assistance-contracts';

export interface StaffAssistanceSnapshot {
 source:ReturnType<typeof projectAssistSource>;serialized:string;digest:string;revision:number;
 knowledge:AISnapshot|null;
}
/** Authorized reads only. HTTP must run after this transaction has committed. */
export async function withStaffAssistanceSnapshot<T>(actorId:string,id:string,revision:number,pool:Pool,
 work:(client:PoolClient,snapshot:StaffAssistanceSnapshot)=>Promise<T>,options:{knowledgeCatalog?:boolean}={}):Promise<T>{
 return transaction(async c=>{
  await c.query("set local statement_timeout='5s';set local lock_timeout='2s'");
  if(options.knowledgeCatalog)await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);
  const actor=await loadActor(c,actorId);
  const located=(await c.query('select conversation_id from public.tickets t where id=$1 and private.can_access_scope(t.department_id,t.sensitive_level)',[id])).rows[0];
  if(!located)throw new AssistError('NOT_FOUND');await lockConversation(c,located.conversation_id);
  const ticket=(await c.query(`select t.*,c.mode as conversation_mode,c.status as conversation_status,c.revision as conversation_revision
   from public.tickets t join public.conversations c on c.id=t.conversation_id
   where t.id=$1 and private.can_access_scope(t.department_id,t.sensitive_level) for share of t,c`,[id])).rows[0];
  if(!ticket)throw new AssistError('NOT_FOUND');
  if(ticket.revision!==revision||ticket.mode!=='HUMAN'||ticket.conversation_mode!=='HUMAN'||
   !['WAITING_STAFF','STAFF_HANDLING','WAITING_USER'].includes(ticket.status)||!['ACTIVE','WAITING'].includes(ticket.conversation_status))throw new AssistError('CONFLICT');
  const messages=(await c.query(`select id,sender_type,message_type,content,created_at from public.messages
   where conversation_id=$1 and (ticket_id=$2 or ticket_id is null) order by created_at desc,id desc limit 33`,[ticket.conversation_id,id])).rows.reverse();
  const departments=(await c.query('select code,name_th as name from public.departments where active order by code limit 33 for share')).rows;
  if(departments.length>32)throw new AssistError('UNAVAILABLE');
  const source=projectAssistSource({summary:ticket.problem_summary,category:ticket.category,priority:ticket.priority,messages,departments});
  const serialized=JSON.stringify(source);if(serialized.length>19000)throw new AssistError('UNAVAILABLE');
  const digest=createHash('sha256').update(JSON.stringify({actor,ticket,messages,departments})).digest('hex');
  const users=messages.filter(m=>m.sender_type==='USER'&&m.message_type==='TEXT'&&typeof m.content==='string'&&m.content.trim());
  const latest=users.at(-1);
  const knowledge:AISnapshot|null=latest?{jobId:id,sessionId:ticket.line_session_id,conversationId:ticket.conversation_id,
   messageId:latest.id,revision:ticket.conversation_revision,question:latest.content,
   history:users.slice(0,-1).slice(-4).map(m=>({role:'user' as const,content:m.content.slice(0,750)}))}:null;
  return work(c,{source,serialized,digest,revision:ticket.revision,knowledge});
 },pool);
}
