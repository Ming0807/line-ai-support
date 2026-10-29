import type {DbClient} from '../tickets/authorization';

/** An explicit choice can route an older pending message now; use that current intent event. */
export function routedInputEventSql(alias:string):string{
 if(!/^[a-z][a-z0-9_]*$/u.test(alias))throw new Error('INVALID_SQL_ALIAS');
 return `coalesce(case when ${alias}.metadata->>'routing_input_event_id' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
  then (${alias}.metadata->>'routing_input_event_id')::uuid end,${alias}.source_event_id)`;
}

/** State revision is not an input revision. Every model result also needs this source fence. */
export async function isLatestConversationInput(c:DbClient,input:{sessionId:string;conversationId:string;messageId:string}):Promise<boolean>{
 return (await c.query(`select m.id from public.messages m
  join public.conversations conv on conv.id=m.conversation_id and conv.line_session_id=$1
  left join private.webhook_inbox source on source.id=${routedInputEventSql('m')}
  where m.id=$3 and m.conversation_id=$2 and m.sender_type='USER' and m.message_type='TEXT'
   and coalesce(m.metadata->>'routing_status','ROUTED') not in('PENDING','ROUTE_CONTROL')
   and (source.id is null or source.channel='STUDENT')
   and not exists(select 1 from public.messages newer
    left join private.webhook_inbox later_source on later_source.id=${routedInputEventSql('newer')}
    where newer.conversation_id=m.conversation_id and newer.id<>m.id and newer.sender_type='USER'
     and coalesce(newer.metadata->>'routing_status','ROUTED') not in('PENDING','ROUTE_CONTROL')
     and ((source.event_seq is not null and later_source.event_seq>source.event_seq)
      or ((source.event_seq is null or later_source.event_seq is null)
       and (newer.created_at,newer.id)>(m.created_at,m.id))))`,[input.sessionId,input.conversationId,input.messageId])).rowCount===1;
}

export async function isLatestAIOutboxInput(c:DbClient,input:{idempotencyKey:string;sessionId:string|null;conversationId:string|null}):Promise<boolean>{
 if(!input.sessionId||!input.conversationId)return false;
 const source=(await c.query(`select message_id from private.ai_jobs where 'ai-job:'||id::text=$1
  and line_session_id=$2 and conversation_id=$3 and status='DONE'`,[input.idempotencyKey,input.sessionId,input.conversationId])).rows[0];
 return !!source&&await isLatestConversationInput(c,{sessionId:input.sessionId,conversationId:input.conversationId,messageId:source.message_id});
}

/** Defer an unknown topic without spending a delivery attempt or cancelling another topic. */
export async function hasUnroutedAIOutboxInput(c:DbClient,input:{idempotencyKey:string;sessionId:string|null;conversationId:string|null}):Promise<boolean>{
 if(!input.sessionId||!input.conversationId)return false;
 return (await c.query(`select 1 from private.ai_jobs j join public.messages m on m.id=j.message_id
  join private.line_identities identity on identity.line_session_id=j.line_session_id
  left join private.webhook_inbox source on source.id=${routedInputEventSql('m')}
  where 'ai-job:'||j.id::text=$1 and j.line_session_id=$2 and j.conversation_id=$3 and j.status='DONE'
   and exists(select 1 from private.webhook_inbox pending where pending.channel='STUDENT'
    and pending.user_hash=identity.user_hash and pending.event_kind='MESSAGE' and pending.status in('PENDING','PROCESSING')
    and case when source.event_seq is not null then pending.event_seq>source.event_seq else pending.received_at>m.created_at end)`,
 [input.idempotencyKey,input.sessionId,input.conversationId])).rowCount===1;
}
