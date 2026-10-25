-- AI-AGENT-01/AG-02B: reservations survive worker crashes; no provider I/O in SQL.
create table private.ai_turn_attempts (
 id uuid primary key default gen_random_uuid(),
 inbox_id uuid references private.webhook_inbox(id),
 ai_job_id uuid references private.ai_jobs(id),
 provider_id uuid not null, model_id uuid not null,
 provider_revision integer not null check(provider_revision>=0),
 model_revision integer not null check(model_revision>=0),
 provider_network_revision integer not null check(provider_network_revision>=0),
 model_network_revision integer not null check(model_network_revision>=0),
 status text not null default 'RESERVED' check(status in('RESERVED','SUCCESS','FAILED')),
 error_code text check(error_code in('TIMEOUT','CANCELLED','RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','AUTH_ERROR','INVALID_OUTPUT','INVALID_REQUEST','PROVIDER_UNAVAILABLE')),
 created_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 check(num_nonnulls(inbox_id,ai_job_id)=1),
 check((status='RESERVED' and error_code is null and finished_at is null)
  or(status='SUCCESS' and error_code is null and finished_at is not null)
  or(status='FAILED' and error_code is not null and finished_at is not null))
);
create index ai_turn_attempts_inbox_idx on private.ai_turn_attempts(inbox_id) where inbox_id is not null;
create index ai_turn_attempts_job_idx on private.ai_turn_attempts(ai_job_id) where ai_job_id is not null;
alter table private.ai_turn_attempts enable row level security;
revoke all on private.ai_turn_attempts from public,anon,authenticated;
grant select,insert,update on private.ai_turn_attempts to service_role;

create function private.guard_ai_turn_attempt() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status<>'RESERVED' or
  (new.id,new.inbox_id,new.ai_job_id,new.provider_id,new.model_id,new.provider_revision,new.model_revision,
   new.provider_network_revision,new.model_network_revision,new.created_at)
  is distinct from
  (old.id,old.inbox_id,old.ai_job_id,old.provider_id,old.model_id,old.provider_revision,old.model_revision,
   old.provider_network_revision,old.model_network_revision,old.created_at)
 then raise exception 'AI_TURN_ATTEMPT_IMMUTABLE'; end if;
 return new;
end $$;
revoke all on function private.guard_ai_turn_attempt() from public,anon,authenticated;
create trigger ai_turn_attempt_immutable before update on private.ai_turn_attempts
 for each row execute function private.guard_ai_turn_attempt();
