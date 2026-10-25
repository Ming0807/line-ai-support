-- SOL-04A: bounded operator attestation, never vendor billing/quota evidence.
create table private.ai_free_account_grants (
 provider_id uuid primary key references private.ai_providers(id) on delete cascade,
 network_revision integer not null check(network_revision>=0),
 base_url text not null check(length(base_url) between 1 and 200),
 models text[] not null check(cardinality(models)<=8),
 state text not null check(state in ('ACTIVE','REVOKED')),
 confirmed_at timestamptz not null,
 expires_at timestamptz,
 revoked_at timestamptz,
 actor_id uuid not null references public.staff_profiles(id),
 revision integer not null default 0 check(revision>=0),
 updated_at timestamptz not null default clock_timestamp(),
 check((state='ACTIVE' and cardinality(models)>=1 and revoked_at is null and expires_at is not null and expires_at>confirmed_at
  and expires_at<=confirmed_at+interval '30 days')
  or(state='REVOKED' and revoked_at is not null and expires_at is null))
);
create index ai_free_account_grants_actor_idx on private.ai_free_account_grants(actor_id);
alter table private.ai_free_account_grants enable row level security;
revoke all on private.ai_free_account_grants from public,anon,authenticated,service_role;
grant select,insert,update on private.ai_free_account_grants to service_role;
