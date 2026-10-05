-- Observations contain only normalized operational evidence, never payloads or credentials.
alter table private.ai_models add constraint ai_models_id_provider_unique unique(id,provider_id);
alter table private.ai_providers
 add column manual_window_started_at timestamptz,
 add column manual_window_count integer not null default 0 check(manual_window_count between 0 and 10),
 add constraint ai_provider_manual_window check(manual_window_started_at is not null or manual_window_count=0);

create table private.ai_model_observations (
 id uuid primary key default gen_random_uuid(),
 provider_id uuid not null references private.ai_providers(id),
 model_id uuid not null,
 provider_revision integer not null check(provider_revision>=0),model_revision integer not null check(model_revision>=0),
 purpose text not null check(purpose in ('GENERATION','EMBEDDING')),
 action text not null check(action in ('METADATA','GENERATION_TEST','EMBEDDING_TEST','RUNTIME')),
 result text not null check(result in ('SUCCESS','ERROR','BLOCKED','UNKNOWN')),
 error_code text check(error_code in ('TIMEOUT','CANCELLED','RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','AUTH_ERROR','INVALID_OUTPUT','INVALID_REQUEST','PROVIDER_UNAVAILABLE','PAID_BLOCKED','PRICE_UNKNOWN','CAPABILITY_UNSUPPORTED')),
 http_status integer check(http_status between 100 and 599),latency_ms integer not null check(latency_ms>=0),
 observed_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
 foreign key(model_id,provider_id) references private.ai_models(id,provider_id),
 check((action!='GENERATION_TEST' or purpose='GENERATION') and (action!='EMBEDDING_TEST' or purpose='EMBEDDING')),
 check((result='SUCCESS' and error_code is null) or (result in ('ERROR','BLOCKED') and error_code is not null) or result='UNKNOWN')
);
create index ai_model_observations_latest_idx on private.ai_model_observations(model_id,provider_revision,model_revision,observed_at desc,recorded_at desc,id);
create index ai_model_observations_provider_idx on private.ai_model_observations(provider_id,observed_at desc);

create table private.ai_provider_quota_observations (
 id uuid primary key default gen_random_uuid(),provider_id uuid not null references private.ai_providers(id),
 provider_revision integer not null check(provider_revision>=0),supported boolean not null,
 http_status integer check(http_status between 100 and 599),
 error_code text check(error_code in ('TIMEOUT','CANCELLED','RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','AUTH_ERROR','INVALID_OUTPUT','INVALID_REQUEST','PROVIDER_UNAVAILABLE')),
 observed_at timestamptz not null,counters jsonb not null check(jsonb_typeof(counters)='array' and jsonb_array_length(counters)<=16 and octet_length(counters::text)<=16000),
 recorded_at timestamptz not null default clock_timestamp(),
 check(supported or (http_status is null and error_code is null and counters='[]'::jsonb))
);
create index ai_provider_quota_latest_idx on private.ai_provider_quota_observations(provider_id,provider_revision,observed_at desc,recorded_at desc,id);

create table private.ai_provider_operations (
 provider_id uuid not null references private.ai_providers(id) on delete cascade,
 scope text not null check(scope='QUOTA' or scope ~ '^MODEL:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 lease_token uuid not null,expires_at timestamptz not null,last_started_at timestamptz not null,
 primary key(provider_id,scope)
);
alter table private.ai_model_observations enable row level security;
alter table private.ai_provider_quota_observations enable row level security;
alter table private.ai_provider_operations enable row level security;
revoke all on private.ai_model_observations,private.ai_provider_quota_observations,private.ai_provider_operations from public,anon,authenticated;
grant all on private.ai_model_observations,private.ai_provider_quota_observations,private.ai_provider_operations to service_role;
