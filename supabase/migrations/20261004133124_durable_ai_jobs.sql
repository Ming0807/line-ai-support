create table private.ai_jobs (
 id uuid primary key default gen_random_uuid(),job_seq bigint generated always as identity unique,
 line_session_id uuid not null references public.line_sessions(id),
 conversation_id uuid not null,message_id uuid not null unique references public.messages(id),
 expected_conversation_revision integer not null check(expected_conversation_revision>=0),
 request_encrypted text not null check(request_encrypted like 'v1.%' and length(request_encrypted) between 40 and 20000),
 result_encrypted text check(result_encrypted like 'v1.%' and length(result_encrypted) between 40 and 250000),
 status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','DONE','SUPPRESSED','DEAD')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 available_at timestamptz not null default clock_timestamp(),lease_token uuid,lease_until timestamptz,
 last_error_code text check(last_error_code in ('PROCESSING_FAILED','LEASE_EXPIRED','CONTEXT_CHANGED','EVIDENCE_CHANGED')),
 result_saved_at timestamptz,completed_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 foreign key(conversation_id,line_session_id) references public.conversations(id,line_session_id),
 check((status='PROCESSING' and lease_token is not null and lease_until is not null) or
  (status<>'PROCESSING' and lease_token is null and lease_until is null)),
 check((result_encrypted is null and result_saved_at is null) or (result_encrypted is not null and result_saved_at is not null))
);
create index ai_jobs_pending_idx on private.ai_jobs(available_at,job_seq) where status='PENDING';
create index ai_jobs_processing_idx on private.ai_jobs(lease_until) where status='PROCESSING';
create index ai_jobs_conversation_order_idx on private.ai_jobs(conversation_id,job_seq) where status in ('PENDING','PROCESSING');
create index ai_jobs_session_idx on private.ai_jobs(line_session_id);
alter table private.ai_jobs enable row level security;
revoke all on private.ai_jobs from public,anon,authenticated;
grant all on private.ai_jobs to service_role;
revoke all on sequence private.ai_jobs_job_seq_seq from public,anon,authenticated;
grant usage,select on sequence private.ai_jobs_job_seq_seq to service_role;

create function private.claim_ai_job() returns setof private.ai_jobs
 language plpgsql security invoker set search_path='' as $$
begin
 update private.ai_jobs set status='DEAD',lease_token=null,lease_until=null,last_error_code='LEASE_EXPIRED',completed_at=clock_timestamp()
  where status='PROCESSING' and lease_until<=clock_timestamp() and attempts>=5;
 return query
 with candidate as (
  select j.id from private.ai_jobs j
  where ((j.status='PENDING' and j.available_at<=clock_timestamp()) or
   (j.status='PROCESSING' and j.lease_until<=clock_timestamp())) and j.attempts<5
   and not exists(select 1 from private.ai_jobs prior where prior.conversation_id=j.conversation_id and prior.job_seq<j.job_seq
    and prior.status in ('PENDING','PROCESSING'))
  order by j.job_seq for update of j skip locked limit 1
 ) update private.ai_jobs j set status='PROCESSING',attempts=j.attempts+1,lease_token=gen_random_uuid(),
  lease_until=clock_timestamp()+interval '90 seconds' from candidate where candidate.id=j.id returning j.*;
end $$;
revoke all on function private.claim_ai_job() from public,anon,authenticated;
grant execute on function private.claim_ai_job() to service_role;
