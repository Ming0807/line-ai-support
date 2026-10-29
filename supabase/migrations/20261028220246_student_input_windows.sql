-- CLI unavailable locally; UTC prefix obtained from the clock tool.
create table private.student_input_windows(
 id uuid primary key default gen_random_uuid(),user_hash text not null,
 first_event_seq bigint not null check(first_event_seq>0),last_event_seq bigint not null,
 first_received_at timestamptz not null,last_received_at timestamptz not null,ready_at timestamptz not null,
 sealed_at timestamptz,degraded boolean not null default false,
 notice_state text not null default 'PENDING' check(notice_state in('PENDING','QUEUED','UNDELIVERABLE')),
 notice_outbox_id uuid references private.message_outbox(id) on delete set null,
 notice_at timestamptz,notice_retry_at timestamptz not null default clock_timestamp(),
 check(last_event_seq>=first_event_seq and last_received_at>=first_received_at),
 check(ready_at>=last_received_at and ready_at<=first_received_at+interval '3 seconds'),
 check(not degraded or sealed_at is not null)
);
create index student_input_windows_open_idx on private.student_input_windows(user_hash,last_event_seq desc) where sealed_at is null;
create index student_input_windows_ready_idx on private.student_input_windows(ready_at,id) where sealed_at is null;
create index student_input_windows_notice_idx on private.student_input_windows(notice_retry_at,id) where degraded and notice_state='PENDING';
create index student_input_windows_notice_outbox_idx on private.student_input_windows(notice_outbox_id) where notice_outbox_id is not null;
alter table private.student_input_windows enable row level security;
revoke all on private.student_input_windows from public,anon,authenticated;
grant select,insert,update,delete on private.student_input_windows to service_role;

alter table private.webhook_inbox add column input_window_id uuid references private.student_input_windows(id) on delete set null;
create index inbox_input_window_idx on private.webhook_inbox(input_window_id,status) where input_window_id is not null;

create function private.assign_student_input_window() returns trigger
language plpgsql security invoker set search_path='' as $$
declare selected_window uuid;
begin
 if new.channel<>'STUDENT' or new.event_kind<>'MESSAGE' or new.user_hash is null then return new;end if;
 -- The normal ingress already holds all enqueue lanes in sorted order before inserting.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inbox:STUDENT:'||new.user_hash,0));
 select id into selected_window from private.student_input_windows
  where user_hash=new.user_hash and sealed_at is null and last_received_at<=new.received_at
   and ready_at>new.received_at and first_received_at+interval '3 seconds'>new.received_at
  order by last_event_seq desc limit 1 for update;
 if selected_window is null then
  insert into private.student_input_windows(user_hash,first_event_seq,last_event_seq,first_received_at,last_received_at,ready_at)
   values(new.user_hash,new.event_seq,new.event_seq,new.received_at,new.received_at,new.received_at+interval '1200 milliseconds')
   returning id into selected_window;
 else
  update private.student_input_windows set last_event_seq=greatest(last_event_seq,new.event_seq),
   last_received_at=new.received_at,ready_at=least(new.received_at+interval '1200 milliseconds',first_received_at+interval '3 seconds')
   where id=selected_window;
 end if;
 update private.webhook_inbox set input_window_id=selected_window where id=new.id;
 return new;
end $$;
revoke all on function private.assign_student_input_window() from public,anon,authenticated;
grant execute on function private.assign_student_input_window() to service_role;
create trigger student_input_window_after_insert after insert on private.webhook_inbox
 for each row execute function private.assign_student_input_window();

create function private.seal_student_input_windows() returns void
language plpgsql security invoker set search_path='' as $$
declare candidate_ids uuid[];lane record;
begin
 select pg_catalog.array_agg(candidate.id) into candidate_ids from(
  select w.id from private.student_input_windows w where w.sealed_at is null and w.ready_at<=clock_timestamp()
   and not exists(select 1 from private.webhook_inbox i where i.input_window_id=w.id and i.status in('PENDING','PROCESSING'))
  order by w.ready_at,w.id limit 100
 ) candidate;
 -- Ingress takes the user lane BEFORE the window row. Never invert that order
 -- or seal across an insertion whose AFTER trigger has not become visible yet.
 for lane in select distinct w.user_hash from private.student_input_windows w
  where w.id=any(candidate_ids) order by w.user_hash loop
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('inbox:STUDENT:'||lane.user_hash,0)) then continue;end if;
  with ready as(
   select w.id from private.student_input_windows w where w.id=any(candidate_ids) and w.user_hash=lane.user_hash
    and w.sealed_at is null and w.ready_at<=clock_timestamp()
    and not exists(select 1 from private.webhook_inbox i where i.input_window_id=w.id and i.status in('PENDING','PROCESSING'))
   order by w.ready_at,w.id for update skip locked
  ) update private.student_input_windows w set sealed_at=clock_timestamp(),
    degraded=exists(select 1 from private.webhook_inbox i where i.input_window_id=w.id and i.status='DEAD')
   from ready where w.id=ready.id;
 end loop;
 update private.ai_jobs j set status='SUPPRESSED',lease_token=null,lease_until=null,
  completed_at=clock_timestamp(),last_error_code='CONTEXT_CHANGED'
 from public.messages m join private.webhook_inbox i on i.id=coalesce(
  case when m.metadata->>'routing_input_event_id' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
   then(m.metadata->>'routing_input_event_id')::uuid end,m.source_event_id)
  join private.student_input_windows w on w.id=i.input_window_id
 where j.message_id=m.id and j.status='PENDING' and w.degraded;
end $$;
revoke all on function private.seal_student_input_windows() from public,anon,authenticated;
grant execute on function private.seal_student_input_windows() to service_role;

create or replace function private.claim_ai_job() returns setof private.ai_jobs
language plpgsql security invoker set search_path='' as $$
begin
 perform private.seal_student_input_windows();
 update private.ai_jobs set status='DEAD',lease_token=null,lease_until=null,last_error_code='LEASE_EXPIRED',completed_at=clock_timestamp()
  where status='PROCESSING' and lease_until<=clock_timestamp() and attempts>=5;
 return query
 with candidate as(
  select j.id from private.ai_jobs j join public.messages m on m.id=j.message_id
  left join private.webhook_inbox i on i.id=coalesce(
   case when m.metadata->>'routing_input_event_id' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
    then(m.metadata->>'routing_input_event_id')::uuid end,m.source_event_id)
  left join private.student_input_windows w on w.id=i.input_window_id
  where((j.status='PENDING' and j.available_at<=clock_timestamp()) or(j.status='PROCESSING' and j.lease_until<=clock_timestamp()))
   and j.attempts<5 and(w.id is null or(w.sealed_at is not null and not w.degraded))
   and not exists(select 1 from private.ai_jobs prior where prior.conversation_id=j.conversation_id and prior.job_seq<j.job_seq
    and prior.status in('PENDING','PROCESSING'))
  order by j.job_seq for update of j skip locked limit 1
 ) update private.ai_jobs j set status='PROCESSING',attempts=j.attempts+1,lease_token=gen_random_uuid(),
  lease_until=clock_timestamp()+interval '90 seconds' from candidate where candidate.id=j.id returning j.*;
end $$;
revoke all on function private.claim_ai_job() from public,anon,authenticated;
grant execute on function private.claim_ai_job() to service_role;
