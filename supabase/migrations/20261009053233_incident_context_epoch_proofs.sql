-- ADV-02B-2A fixed private infrastructure. Normal activation follows runtime gates.
create table private.structured_selection_epoch (
 id integer primary key check(id=1),revision bigint not null check(revision>=0),
 updated_at timestamptz not null default clock_timestamp()
);
insert into private.structured_selection_epoch(id,revision) values(1,0);
create table private.incident_context_proofs (
 ticket_id uuid primary key references public.tickets(id),ticket_revision integer not null check(ticket_revision>=0),
 support_binding_digest text check(support_binding_digest ~ '^[a-f0-9]{64}$'),
 state text not null check(state in ('READY','BLOCKED')),requires_catalog boolean not null,
 catalog_revision bigint check(catalog_revision>=0),evaluation_date date,
 proof_encrypted text check(proof_encrypted like 'v1.%' and length(proof_encrypted) between 40 and 524288),
 captured_at timestamptz not null default clock_timestamp(),
 check((requires_catalog and catalog_revision is not null and evaluation_date is not null)
  or (not requires_catalog and catalog_revision is null and evaluation_date is null)),
 check((state='BLOCKED' and proof_encrypted is null) or
  (state='READY' and ((support_binding_digest is not null and proof_encrypted is not null) or
   (support_binding_digest is null and proof_encrypted is null and not requires_catalog))))
);
create index incident_context_catalog_idx on private.incident_context_proofs(ticket_id) where requires_catalog;
alter table private.incident_detection_jobs add column context_epoch bigint check(context_epoch>=0);
alter table private.incident_detection_jobs add column context_evaluation_date date;
alter table private.incident_detection_jobs add constraint incident_job_context_pair
 check((context_epoch is null)=(context_evaluation_date is null));
alter table private.structured_selection_epoch enable row level security;
alter table private.incident_context_proofs enable row level security;
revoke all on private.structured_selection_epoch,private.incident_context_proofs from public,anon,authenticated,service_role;
grant select on private.structured_selection_epoch to service_role;
grant update(revision,updated_at) on private.structured_selection_epoch to service_role;
grant select,insert on private.incident_context_proofs to service_role;
grant update(ticket_revision,support_binding_digest,state,requires_catalog,catalog_revision,evaluation_date,proof_encrypted,captured_at)
 on private.incident_context_proofs to service_role;

create function private.guard_structured_epoch() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'UPDATE' or new.id<>old.id or new.revision<>old.revision+1 then
  raise exception using errcode='23514',message='CATALOG_EPOCH_INVALID';
 end if;
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('knowledge-structured-selection-catalog:v1',0)) then
  raise exception using errcode='40001',message='STRUCTURED_SELECTION_RETRY';
 end if;
 new.updated_at=pg_catalog.clock_timestamp();return new;
end;
$$;
create trigger structured_epoch_monotone before update or delete on private.structured_selection_epoch
for each row execute function private.guard_structured_epoch();

create or replace function private.lock_structured_selection_catalog() returns trigger
language plpgsql security invoker set search_path='' as $$
declare next_epoch bigint;evaluation date;
begin
 -- Existing service publication takes this lock BEFORE source/row locks.
 -- Direct writers fail retryably instead of waiting after already-held locks.
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('knowledge-structured-selection-catalog:v1',0)) then
  raise exception using errcode='40001',message='STRUCTURED_SELECTION_RETRY';
 end if;
 update private.structured_selection_epoch set revision=revision+1 returning revision into next_epoch;
 if next_epoch is null then raise exception using errcode='23514',message='CATALOG_EPOCH_UNAVAILABLE';end if;
 evaluation=(pg_catalog.clock_timestamp() at time zone 'Asia/Bangkok')::date;
 -- Includes positive, negative and BLOCKED lookups; no incident or conversation lock.
 update private.incident_detection_jobs j set expected_revision=t.revision,status='PENDING',attempts=0,
  available_at=pg_catalog.clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null,
  context_epoch=next_epoch,context_evaluation_date=evaluation
 from public.tickets t join private.incident_context_proofs p on p.ticket_id=t.id and p.requires_catalog
 where j.ticket_id=t.id and t.status not in ('RESOLVED','CLOSED','CANCELLED');
 return null;
end;
$$;
-- Exact search also reads these private persisted proof/source dependencies.
create trigger structured_selection_catalog before insert or update or delete or truncate on private.structured_row_provenance
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on private.structured_publication_effects
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on private.knowledge_import_publications
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog_lifecycle before insert or delete or truncate on private.knowledge_import_jobs
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog_source before update of checksum,source_metadata_encrypted,publication_status on private.knowledge_import_jobs
for each statement execute function private.lock_structured_selection_catalog();

create or replace function private.queue_incident_detection() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status not in ('RESOLVED','CLOSED','CANCELLED') then
  insert into private.incident_detection_jobs(ticket_id,expected_revision) values(new.id,new.revision)
   on conflict(ticket_id) do update set expected_revision=excluded.expected_revision,status='PENDING',attempts=0,
    available_at=pg_catalog.clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null,
    context_epoch=null,context_evaluation_date=null;
 end if;
 return new;
end;
$$;
create function private.queue_incident_support_copy() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into private.incident_detection_jobs(ticket_id,expected_revision)
  select id,revision from public.tickets where id=new.ticket_id and conversation_id=new.conversation_id
   and line_session_id=new.line_session_id and status not in ('RESOLVED','CLOSED','CANCELLED')
 on conflict(ticket_id) do update set expected_revision=excluded.expected_revision,status='PENDING',attempts=0,
  available_at=pg_catalog.clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null,
  context_epoch=null,context_evaluation_date=null;
 return new;
end;
$$;
create trigger incident_support_copy_added after insert on private.ticket_support_contexts
for each row execute function private.queue_incident_support_copy();

create function private.refresh_incident_context_jobs() returns integer language plpgsql security invoker set search_path='' as $$
declare refreshed integer;
begin
 with stamp as materialized (
  select revision epoch,(pg_catalog.statement_timestamp() at time zone 'Asia/Bangkok')::date evaluation
  from private.structured_selection_epoch where id=1
 ), stale as materialized (
  select j.ticket_id,t.revision,s.epoch,s.evaluation from private.incident_detection_jobs j
  join public.tickets t on t.id=j.ticket_id and t.status not in ('RESOLVED','CLOSED','CANCELLED')
  join private.incident_context_proofs p on p.ticket_id=t.id and p.requires_catalog cross join stamp s
  where (p.catalog_revision<>s.epoch or p.evaluation_date<>s.evaluation)
   and (j.context_epoch is distinct from s.epoch or j.context_evaluation_date is distinct from s.evaluation)
   and (j.status<>'PROCESSING' or j.lease_until<=pg_catalog.clock_timestamp())
  order by j.ticket_id limit 100 for update of j skip locked
 ), changed as (
  update private.incident_detection_jobs j set expected_revision=s.revision,status='PENDING',attempts=0,
   available_at=pg_catalog.clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null,
   context_epoch=s.epoch,context_evaluation_date=s.evaluation from stale s where j.ticket_id=s.ticket_id returning j.ticket_id
 ) select count(*)::integer into refreshed from changed;
 return refreshed;
end;
$$;
revoke all on function private.guard_structured_epoch(),private.queue_incident_support_copy(),private.refresh_incident_context_jobs()
 from public,anon,authenticated;
grant execute on function private.guard_structured_epoch(),private.queue_incident_support_copy(),private.refresh_incident_context_jobs()
 to service_role;
-- Fixed one-time requeue for retained active tickets; no network or history deletion.
insert into private.incident_detection_jobs(ticket_id,expected_revision)
 select id,revision from public.tickets where status not in ('RESOLVED','CLOSED','CANCELLED')
 on conflict(ticket_id) do update set expected_revision=excluded.expected_revision,status='PENDING',attempts=0,
  available_at=clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null,
  context_epoch=null,context_evaluation_date=null;
