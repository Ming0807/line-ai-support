import type {DbClient} from '../tickets/authorization';
import {routedInputEventSql} from './input-watermark';

interface InputRow {id:string;content:string;created_at:Date;metadata:Record<string,unknown>;event_seq:string|null;observed_at:Date;input_window_id:string|null}
interface HistoryRow {id:string;sender_type:'USER'|'AI';content:string;observed_at:Date}
/** CONV-SUPERSEDE-01 (DEC-206): earlier unanswered input carried into the current turn, bounded. */
export const CARRY_UNANSWERED_MAX_MESSAGES=10;
export const CARRY_UNANSWERED_MAX_AGE_MINUTES=10;
/**
 * Same-topic fragments remain separate durable messages; only their model projection is collected.
 * A turn also carries this conversation's earlier USER input that never received a reply: input observed
 * after the latest STAFF message or AI reply, at most ten messages and ten minutes before the turn. An AI
 * reply counts unless its outbox row is known not to reach LINE: PENDING/RETRY (the delivery fence will
 * suppress it as stale input), SUPPRESSED or DEAD. Then the newer job answers that input as well.
 */
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
 const head=turn[0];
 const carried=head?(await c.query<InputRow>(`select m.id,m.content,m.created_at,m.metadata,i.event_seq,
  coalesce(i.received_at,m.created_at) observed_at,i.input_window_id from public.messages m
  left join private.webhook_inbox i on i.id=${routedInputEventSql('m')}
  where m.conversation_id=$1 and not(m.id=any($2::uuid[])) and m.sender_type='USER' and m.message_type='TEXT'
   and (i.id is null or i.channel='STUDENT')
   and coalesce(m.metadata->>'routing_status','ROUTED') not in('PENDING','ROUTE_CONTROL')
   and case when i.event_seq is not null and $3::bigint is not null then i.event_seq<$3 else (m.created_at,m.id)<($4::timestamptz,$5::uuid) end
   and coalesce(i.received_at,m.created_at)>$6::timestamptz-make_interval(mins=>$7)
   and coalesce(i.received_at,m.created_at)>coalesce((select max(r.created_at) from public.messages r
    where r.conversation_id=m.conversation_id and r.created_at<=$6::timestamptz and(r.sender_type='STAFF' or(r.sender_type='AI' and not exists(
     select 1 from private.message_outbox o where o.conversation_id=r.conversation_id and o.channel='STUDENT' and o.kind='AI'
      and o.idempotency_key='ai-job:'||(r.metadata->>'ai_job_id') and o.status in('PENDING','RETRY','SUPPRESSED','DEAD'))))),'-infinity'::timestamptz)
  order by coalesce(i.received_at,m.created_at) desc,m.id desc limit $8`,
 [conversationId,turn.map(m=>m.id),head.event_seq,head.created_at,head.id,head.observed_at,CARRY_UNANSWERED_MAX_AGE_MINUTES,CARRY_UNANSWERED_MAX_MESSAGES])).rows.reverse():[];
 if(carried.length)turn.unshift(...carried);
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
