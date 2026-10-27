-- Routing observability for the student inbox lane: one structured row per routing stage attempt.
-- Context counts and fixed reason codes only: never message text, user hashes, tokens or prompts.
create table private.inbox_routing_observations (
 id uuid primary key default gen_random_uuid(),
 inbox_event_id uuid,
 line_session_id uuid,
 stage text not null check(stage in ('PREFLIGHT','CLASSIFY','DECISION')),
 status text not null check(status in ('SUCCESS','SKIPPED','TIMEOUT','ERROR')),
 reason_code text check(reason_code is null or reason_code ~ '^[A-Z0-9_]{1,48}$'),
 candidates integer check(candidates between 0 and 10000),
 latency_ms integer not null check(latency_ms between 0 and 3600000),
 created_at timestamptz not null default clock_timestamp()
);
-- Deliberately no foreign keys: this audit trail survives inbox/ledger retention and pruning.
create index inbox_routing_created_idx on private.inbox_routing_observations(created_at desc);
create index inbox_routing_event_idx on private.inbox_routing_observations(inbox_event_id);
-- The operator feed reads only outcomes, so non-success rows get their own covering index.
create index inbox_routing_outcome_idx on private.inbox_routing_observations(created_at desc)
 where status in ('SKIPPED','TIMEOUT','ERROR');
alter table private.inbox_routing_observations enable row level security;
revoke all on private.inbox_routing_observations from public,anon,authenticated;
grant all on private.inbox_routing_observations to service_role;
