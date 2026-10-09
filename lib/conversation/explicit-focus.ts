import {z} from 'zod';
import type {DbClient} from '../tickets/authorization';
import type {RouteCandidate} from './router';

const focusSchema=z.object({version:z.literal(1),anchorMessageId:z.uuid(),ticketId:z.uuid(),selectedAt:z.iso.datetime({offset:true})}).strict();
export type ExplicitHumanFocus=z.infer<typeof focusSchema>;
const ttlMs=10*60*1000;
const newTopicSchema=z.object({version:z.literal(1),selectedAt:z.iso.datetime({offset:true})}).strict();

/** One server-recorded NEW choice authorizes only the next USER message. */
export async function readExplicitNewTopic(client:DbClient,sessionId:string):Promise<boolean>{
 const latest=(await client.query(`select m.metadata,clock_timestamp() as server_now
  from public.messages m join public.conversations c on c.id=m.conversation_id
  where c.line_session_id=$1 and m.sender_type='USER' order by m.created_at desc,m.id desc limit 1`,[sessionId])).rows[0];
 const parsed=newTopicSchema.safeParse(latest?.metadata?.routing_new_topic);
 if(!parsed.success)return false;
 const age=new Date(latest.server_now).getTime()-Date.parse(parsed.data.selectedAt);
 return Number.isFinite(age)&&age>=0&&age<ttlMs;
}

export async function rememberExplicitNewTopic(client:DbClient,sessionId:string):Promise<void>{
 const result=await client.query(`update public.messages set metadata=(metadata-'routing_focus')||jsonb_build_object(
  'routing_new_topic',jsonb_build_object('version',1,'selectedAt',clock_timestamp())) where id=(
  select m.id from public.messages m join public.conversations c on c.id=m.conversation_id
  where c.line_session_id=$1 and m.sender_type='USER' order by m.created_at desc,m.id desc limit 1)`,[sessionId]);
 if(result.rowCount!==1)throw new Error('EXPLICIT_NEW_SOURCE_MISSING');
}

/** A deliberate USER choice, not the most recent ticket, is the only fallback authority. */
export async function readExplicitHumanFocus(client:DbClient,sessionId:string,candidates:RouteCandidate[]):Promise<(ExplicitHumanFocus&{conversationId:string})|null>{
 if(candidates.length>12||!candidates.some(c=>c.mode==='HUMAN'))return null;
 const latest=(await client.query(`select m.id,m.conversation_id,m.metadata,clock_timestamp() as server_now
  from public.messages m join public.conversations c on c.id=m.conversation_id
  where c.line_session_id=$1 and m.sender_type='USER' order by m.created_at desc,m.id desc limit 1`,[sessionId])).rows[0];
 const parsed=focusSchema.safeParse(latest?.metadata?.routing_focus);
 if(!parsed.success||latest.metadata.routing_status!=='ROUTED')return null;
 const focus=parsed.data,age=new Date(latest.server_now).getTime()-Date.parse(focus.selectedAt);
 if(!Number.isFinite(age)||age<0||age>=ttlMs)return null;
 if(!candidates.some(c=>c.conversationId===latest.conversation_id&&c.mode==='HUMAN'&&c.ticketId===focus.ticketId))return null;
 const anchor=(await client.query(`select m.metadata from public.messages m join public.conversations c on c.id=m.conversation_id
  where m.id=$1 and m.conversation_id=$2 and c.line_session_id=$3 and m.ticket_id=$4 and m.sender_type='USER'`,
 [focus.anchorMessageId,latest.conversation_id,sessionId,focus.ticketId])).rows[0];
 const original=focusSchema.safeParse(anchor?.metadata?.routing_focus);
 if(!original.success||original.data.anchorMessageId!==focus.anchorMessageId||original.data.ticketId!==focus.ticketId||original.data.selectedAt!==focus.selectedAt)return null;
 return {...focus,conversationId:latest.conversation_id};
}

export async function rememberExplicitHumanFocus(client:DbClient,sessionId:string,messageId:string,ticketId:string,inherited?:ExplicitHumanFocus):Promise<void>{
 const retained=inherited?focusSchema.parse({version:inherited.version,anchorMessageId:inherited.anchorMessageId,ticketId:inherited.ticketId,selectedAt:inherited.selectedAt}):null;
 const result=await client.query(`update public.messages m set metadata=m.metadata||jsonb_build_object('routing_focus',
  coalesce($4::jsonb,jsonb_build_object('version',1,'anchorMessageId',m.id,'ticketId',m.ticket_id,'selectedAt',clock_timestamp())))
  where m.id=$1 and m.ticket_id=$2 and m.sender_type='USER' and m.metadata->>'routing_status'='ROUTED'
  and exists(select 1 from public.conversations c where c.id=m.conversation_id and c.line_session_id=$3 and c.mode='HUMAN')
  and exists(select 1 from public.tickets t where t.id=m.ticket_id and t.line_session_id=$3 and t.mode='HUMAN' and t.status not in ('CLOSED','RESOLVED','CANCELLED'))`,[messageId,ticketId,sessionId,retained?JSON.stringify(retained):null]);
 if(result.rowCount!==1)throw new Error('EXPLICIT_FOCUS_SOURCE_CHANGED');
}

export async function clearExplicitHumanFocus(client:DbClient,sessionId:string):Promise<void>{
 await client.query(`update public.messages set metadata=metadata-'routing_focus'-'routing_new_topic' where id=(
  select m.id from public.messages m join public.conversations c on c.id=m.conversation_id
  where c.line_session_id=$1 and m.sender_type='USER' order by m.created_at desc,m.id desc limit 1)`,[sessionId]);
}
