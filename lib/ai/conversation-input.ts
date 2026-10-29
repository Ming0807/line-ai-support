import type {DbClient} from '../tickets/authorization';
import {routedInputEventSql} from './input-watermark';

interface InputRow {id:string;content:string;created_at:Date;metadata:Record<string,unknown>;event_seq:string|null;observed_at:Date;input_window_id:string|null}
interface HistoryRow {id:string;sender_type:'USER'|'AI';content:string;observed_at:Date}
/** Same-topic fragments remain separate durable messages; only their model projection is collected. */
export async function readConversationInput(c:DbClient,conversationId:string,messageId:string){
 const anchor=(await c.query<InputRow>(`select m.id,m.content,m.created_at,m.metadata,i.event_seq,
  coalesce(i.received_at,m.created_at) observed_at,i.input_window_id from public.messages m
  left join private.webhook_inbox i on i.id=${routedInputEventSql('m')}
  where m.id=$2 and m.conversation_id=$1 and m.sender_type='USER' and m.message_type='TEXT'
   and coalesce(m.metadata->>'routing_status','ROUTED') not in('PENDING','ROUTE_CONTROL')`,[conversationId,messageId])).rows[0];
 if(!anchor)return null;
 const turn=anchor.input_window_id?(await c.query<InputRow>(`select m.id,m.content,m.created_at,m.metadata,i.event_seq,
  coalesce(i.received_at,m.created_at) observed_at,i.input_window_id from public.messages m
  join private.webhook_inbox i on i.id=${routedInputEventSql('m')}
  where m.conversation_id=$1 and m.sender_type='USER' and m.message_type='TEXT' and i.channel='STUDENT'
   and i.input_window_id=$2 and i.event_seq<=$3
   and coalesce(m.metadata->>'routing_status','ROUTED') not in('PENDING','ROUTE_CONTROL')
  order by i.event_seq,m.id limit 1001`,[conversationId,anchor.input_window_id,anchor.event_seq])).rows:[anchor];
 // The ordinary admission limit is twenty messages/minute. Corrupt or privileged
 // oversized fixtures must not silently lose a tail or allocate an unbounded projection.
 if(!turn.length||turn.length>1000||!turn.some(m=>m.id===anchor.id))throw new Error('AI_INPUT_WINDOW_INVALID');
 const first=turn[0];
 const previous=(await c.query<HistoryRow>(`select m.id,m.sender_type,m.content,coalesce(i.received_at,m.created_at) observed_at
  from public.messages m left join private.webhook_inbox i on i.id=${routedInputEventSql('m')}
  where m.conversation_id=$1 and not(m.id=any($2::uuid[])) and m.message_type='TEXT' and
   ((m.sender_type='USER' and coalesce(m.metadata->>'routing_status','ROUTED') not in('PENDING','ROUTE_CONTROL')
      and case when i.event_seq is not null and $3::bigint is not null then i.event_seq<$3
       else m.created_at<$4 end)
    or(m.sender_type='AI' and m.created_at<$5 and exists(select 1 from private.message_outbox o
      where o.conversation_id=m.conversation_id and o.idempotency_key='ai-job:'||(m.metadata->>'ai_job_id')
       and o.channel='STUDENT' and o.kind='AI' and o.status='SENT' and o.completed_at<=$5)))
  order by coalesce(i.received_at,m.created_at) desc,m.id desc limit 8`,
 [conversationId,turn.map(m=>m.id),first.event_seq,first.observed_at,anchor.observed_at])).rows.reverse();
 return {question:turn.map(m=>m.content).join('\n'),metadata:anchor.metadata,
  history:previous.map(m=>({role:m.sender_type==='USER'?'user' as const:'assistant' as const,content:m.content})),
  source:{turn:turn.map(m=>({id:m.id,content:m.content,observedAt:m.observed_at.toISOString()})),
   previous:previous.filter(m=>m.sender_type==='USER').map(m=>({id:m.id,content:m.content,observedAt:m.observed_at.toISOString()}))}};
}
