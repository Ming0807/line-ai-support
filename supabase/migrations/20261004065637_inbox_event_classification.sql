-- No content, tokens or LINE IDs are exposed by this internal rate-limit metadata.
alter table private.webhook_inbox add column event_kind text not null default 'UNKNOWN'
 check (event_kind in ('MESSAGE','FOLLOW','UNFOLLOW','OTHER','UNKNOWN'));
-- Timestamp accepted insertion time after the per-user enqueue lock is acquired.
alter table private.webhook_inbox alter column received_at set default clock_timestamp();
create index inbox_message_rate_idx on private.webhook_inbox(channel,user_hash,received_at,event_seq)
 where event_kind='MESSAGE';
