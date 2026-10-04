import { getDatabasePool, transaction } from '../database/pool';
import type { Pool } from 'pg';
import type { IngressEvent } from '../line/receive-webhook';

export async function persistWebhookEvents(events:IngressEvent[],pool:Pool=getDatabasePool()):Promise<void> {
 await transaction(async client=>{
  // Hold each enqueue lane until commit, so a later sequence cannot become visible before an earlier one.
  // Lock every batch lane in the same order to prevent deadlocks between overlapping multi-user batches.
  const lanes=[...new Set(events.filter(event=>event.userHash!==null)
   .map(event=>`inbox:${event.channel}:${event.userHash}`))].sort();
  for(const lane of lanes) await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[lane]);
  for(const event of events) await client.query(
   `insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind)
    values ($1,$2,$3,$4,$5) on conflict (channel,event_id) do nothing`,
   [event.channel,event.eventId,event.userHash,event.payloadEncrypted,event.eventKind??'UNKNOWN']);
 },pool);
}
