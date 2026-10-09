-- Fixed infrastructure observations; no queue contents or process identities.
create table private.worker_observations (
 worker text primary key check(worker in ('INBOX','OUTBOX','AI','INCIDENT')),
 observed_at timestamptz not null default clock_timestamp()
);
alter table private.worker_observations enable row level security;
revoke all on private.worker_observations from public,anon,authenticated,service_role;
grant select,insert on private.worker_observations to service_role;
grant update(observed_at) on private.worker_observations to service_role;
