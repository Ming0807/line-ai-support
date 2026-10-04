import type { PoolClient } from 'pg';
import type { DirectUserEvent } from '../line/events';
import { encryptValue, hashLineUserId } from '../security/identity';
import type { InboxJob } from './process-inbox';

/**
 * Persist one valid Staff text event to private encrypted intake.
 * The caller owns the lease transaction and completes the inbox row afterward.
 */
export async function persistStaffInboxEvent(
  client: Pick<PoolClient, 'query'>,
  job: Pick<InboxJob, 'id' | 'user_hash'>,
  event: DirectUserEvent,
  key: string,
): Promise<string | null> {
  if (event.type !== 'message' || !job.user_hash) return 'UNSUPPORTED_EVENT';

  const expectedHash = hashLineUserId(event.source.userId, key);
  if (job.user_hash !== expectedHash) throw new Error('IDENTITY_MISMATCH');

  const current = await client.query(
    `select received_at,event_seq from private.webhook_inbox
      where id=$1 and channel='STAFF' and user_hash=$2 and event_kind='MESSAGE'`,
    [job.id, job.user_hash],
  );
  if (current.rowCount !== 1) throw new Error('STAFF_SOURCE_EVENT_MISMATCH');

  const recent = await client.query(
    `select count(*)::int as count from private.webhook_inbox prior
      where prior.channel='STAFF' and prior.user_hash=$1 and prior.event_kind='MESSAGE'
        and prior.received_at>$2::timestamptz-interval '1 minute'
        and prior.received_at<=$2::timestamptz and prior.event_seq<$3`,
    [job.user_hash, current.rows[0].received_at, current.rows[0].event_seq],
  );
  if (recent.rows[0].count >= 20) return 'RATE_LIMITED';
  if (event.message.type !== 'text') return 'UNSUPPORTED_EVENT';

  await client.query(
    `insert into private.staff_inbound_messages
       (source_event_id,user_hash,line_message_id,content_encrypted)
     values ($1,$2,$3,$4) on conflict do nothing`,
    [job.id, job.user_hash, event.message.id, encryptValue(event.message.text, key)],
  );
  return null;
}
