alter table private.webhook_inbox add column event_seq bigint generated always as identity unique;
create index inbox_user_sequence_idx on private.webhook_inbox(channel,user_hash,event_seq) where status in ('PENDING','PROCESSING');
grant usage,select on sequence private.webhook_inbox_event_seq_seq to service_role;

create function private.claim_inbox(target_channel text) returns setof private.webhook_inbox
 language plpgsql security invoker set search_path='' as $$
begin
 update private.webhook_inbox set status='DEAD',last_error_code='LEASE_EXHAUSTED',lease_token=null,lease_until=null
 where channel=target_channel and attempts>=5 and
 (status='PENDING' or (status='PROCESSING' and lease_until<=clock_timestamp()));
 return query
 with next_job as (
  select w.id from private.webhook_inbox w
  where w.channel=target_channel and w.attempts<5 and w.available_at<=now()
   and (w.status='PENDING' or (w.status='PROCESSING' and w.lease_until<=clock_timestamp()))
   and not exists(select 1 from private.webhook_inbox earlier
    where earlier.channel=w.channel and earlier.user_hash=w.user_hash
    and earlier.event_seq<w.event_seq and earlier.status in ('PENDING','PROCESSING'))
  order by w.event_seq for update of w skip locked limit 1
 )
 update private.webhook_inbox w set status='PROCESSING',attempts=w.attempts+1,
  lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds'
 from next_job n where w.id=n.id returning w.*;
end $$;
revoke all on function private.claim_inbox(text) from public,anon,authenticated;
grant execute on function private.claim_inbox(text) to service_role;
