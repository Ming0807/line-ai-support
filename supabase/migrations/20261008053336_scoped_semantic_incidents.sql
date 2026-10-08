-- ADV-02: fixed schema only; detections use private local E5 vectors and fresh ticket revisions.
create table public.incidents (
 id uuid primary key default gen_random_uuid(),
 department_id uuid not null references public.departments(id),
 title text not null check(length(title) between 1 and 200),
 category text not null check(length(category) between 1 and 100),
 status text not null default 'DETECTED' check(status in ('DETECTED','INVESTIGATING','MONITORING','RESOLVED','CLOSED')),
 severity text not null check(severity in ('MEDIUM','HIGH','CRITICAL')),
 sensitive_level text not null check(sensitive_level in ('GENERAL','SENSITIVE','RESTRICTED')),
 report_count integer not null check(report_count between 2 and 500),
 distinct_session_count integer not null check(distinct_session_count between 2 and report_count),
 revision integer not null default 0 check(revision>=0),
 first_report_at timestamptz not null,last_report_at timestamptz not null check(last_report_at>=first_report_at),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index incidents_department_status_idx on public.incidents(department_id,status,created_at desc,id);
create table public.incident_tickets (
 incident_id uuid not null references public.incidents(id),
 ticket_id uuid primary key references public.tickets(id),
 ticket_revision integer not null check(ticket_revision>=0),
 similarity_score double precision not null check(similarity_score between 0 and 1),
 created_at timestamptz not null default clock_timestamp()
);
create index incident_tickets_incident_idx on public.incident_tickets(incident_id,ticket_id);
create table private.incident_action_receipts (
 actor_id uuid not null references public.staff_profiles(id),incident_id uuid not null references public.incidents(id),
 request_id uuid not null,payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 result_revision integer not null check(result_revision>=0),
 impact_verification_encrypted text check(impact_verification_encrypted is null or impact_verification_encrypted like 'v1.%'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,incident_id,request_id)
);
create index incident_receipts_incident_idx on private.incident_action_receipts(incident_id);
create table private.incident_ticket_vectors (
 ticket_id uuid primary key references public.tickets(id),
 ticket_revision integer not null check(ticket_revision>=0),
 embedding extensions.vector(384) not null,
 embedding_fingerprint text not null check(embedding_fingerprint ~ '^[a-f0-9]{64}$'),
 system_code text check(system_code is null or system_code ~ '^[A-Za-z0-9_:-]{1,100}$'),
 location_code text check(location_code is null or location_code ~ '^[A-Za-z0-9_:-]{1,100}$'),
 captured_at timestamptz not null default clock_timestamp()
);
create table private.incident_rules (
 id integer primary key check(id=1),
 min_reports integer not null check(min_reports between 2 and 100),
 min_distinct_sessions integer not null check(min_distinct_sessions between 2 and min_reports),
 window_minutes integer not null check(window_minutes between 1 and 1440),
 min_similarity double precision not null check(min_similarity between 0.5 and 1),
 revision integer not null default 0 check(revision>=0),
 updated_by uuid references public.staff_profiles(id),updated_at timestamptz not null default clock_timestamp()
);
create index incident_rules_actor_idx on private.incident_rules(updated_by);
insert into private.incident_rules(id,min_reports,min_distinct_sessions,window_minutes,min_similarity) values(1,5,5,15,.85);
create table private.incident_detection_jobs (
 ticket_id uuid primary key references public.tickets(id),expected_revision integer not null check(expected_revision>=0),
 status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','DONE','SUPPRESSED','DEAD')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 available_at timestamptz not null default clock_timestamp(),lease_token uuid,lease_until timestamptz,
 last_error_code text check(last_error_code is null or last_error_code in ('EMBEDDING_UNAVAILABLE','CONTEXT_CHANGED','PROCESSING_FAILED')),
 check((status='PROCESSING' and lease_token is not null and lease_until is not null) or (status<>'PROCESSING' and lease_token is null and lease_until is null))
);
create index incident_jobs_ready_idx on private.incident_detection_jobs(available_at,ticket_id) where status='PENDING';
create function private.queue_incident_detection() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status not in ('RESOLVED','CLOSED','CANCELLED') then
  insert into private.incident_detection_jobs(ticket_id,expected_revision) values(new.id,new.revision)
   on conflict(ticket_id) do update set expected_revision=excluded.expected_revision,status='PENDING',attempts=0,
    available_at=clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null;
 end if;
 return new;
end;
$$;
create trigger queue_incident_detection after insert or update of revision on public.tickets
for each row execute function private.queue_incident_detection();
create function private.claim_incident_detection() returns setof private.incident_detection_jobs language sql security invoker set search_path='' as $$
 with claim as (
  select ticket_id from private.incident_detection_jobs where attempts<5 and
   ((status='PENDING' and available_at<=clock_timestamp()) or (status='PROCESSING' and lease_until<=clock_timestamp()))
   order by available_at,ticket_id for update skip locked limit 1
 ) update private.incident_detection_jobs j set status='PROCESSING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
 from claim c where c.ticket_id=j.ticket_id returning j.*;
$$;
alter table public.incidents enable row level security;
alter table public.incident_tickets enable row level security;
alter table private.incident_ticket_vectors enable row level security;
alter table private.incident_rules enable row level security;
alter table private.incident_detection_jobs enable row level security;
alter table private.incident_action_receipts enable row level security;
revoke all on public.incidents,public.incident_tickets,private.incident_ticket_vectors,private.incident_rules,private.incident_detection_jobs from public,anon,authenticated,service_role;
grant select,insert,update on public.incidents,public.incident_tickets,private.incident_ticket_vectors,private.incident_rules,private.incident_detection_jobs to service_role;
revoke all on private.incident_action_receipts from public,anon,authenticated,service_role;
grant select,insert on private.incident_action_receipts to service_role;
revoke all on function private.queue_incident_detection(),private.claim_incident_detection() from public,anon,authenticated;
grant execute on function private.queue_incident_detection(),private.claim_incident_detection() to service_role;
-- Retained active tickets are queued once for bounded background enrichment; no LINE/provider work in SQL.
insert into private.incident_detection_jobs(ticket_id,expected_revision)
 select id,revision from public.tickets where status not in ('RESOLVED','CLOSED','CANCELLED');
