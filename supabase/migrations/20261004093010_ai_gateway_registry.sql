create table private.ai_providers (
 id uuid primary key default gen_random_uuid(),name text not null unique check(length(name) between 1 and 100),
 adapter text not null check(adapter='OPENAI'),
 base_url text not null check(base_url in ('https://api.openai.com/v1','https://api.openai.com/v1/')),
 api_key_encrypted text not null check(api_key_encrypted like 'v1.%' and length(api_key_encrypted) between 40 and 20000),
 enabled boolean not null default true,priority integer not null default 100 check(priority between 0 and 1000),
 health_status text not null default 'UNKNOWN' check(health_status in ('HEALTHY','DEGRADED','RATE_LIMITED','OFFLINE','UNKNOWN')),
 last_health_check timestamptz,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index ai_providers_enabled_priority_idx on private.ai_providers(priority,id) where enabled;
create table private.ai_models (
 id uuid primary key default gen_random_uuid(),provider_id uuid not null references private.ai_providers(id),
 model_id text not null check(model_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),display_name text not null check(length(display_name) between 1 and 100),
 supports_tools boolean not null default false,supports_json boolean not null default true,supports_vision boolean not null default false,
 enabled boolean not null default true,priority integer not null default 100 check(priority between 0 and 1000),
 timeout_ms integer not null default 20000 check(timeout_ms between 1000 and 45000),
 input_price_per_million numeric(14,6) check(input_price_per_million>=0),output_price_per_million numeric(14,6) check(output_price_per_million>=0),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(provider_id,model_id)
);
create index ai_models_enabled_priority_idx on private.ai_models(provider_id,priority,id) where enabled;
create table private.ai_usage_logs (
 id uuid primary key default gen_random_uuid(),provider_id uuid not null references private.ai_providers(id),
 model_id uuid not null references private.ai_models(id),request_type text not null check(request_type ~ '^[A-Z_]{1,32}$'),
 conversation_id uuid references public.conversations(id),ticket_id uuid references public.tickets(id),
 latency_ms integer not null check(latency_ms>=0),input_tokens integer check(input_tokens>=0),output_tokens integer check(output_tokens>=0),
 estimated_cost numeric(18,8) check(estimated_cost>=0),status text not null check(status in ('SUCCESS','ERROR')),
 fallback_used boolean not null default false,created_at timestamptz not null default clock_timestamp()
);
create index ai_usage_created_idx on private.ai_usage_logs(created_at desc);
create index ai_usage_provider_idx on private.ai_usage_logs(provider_id,created_at desc);
create index ai_usage_model_idx on private.ai_usage_logs(model_id);
create index ai_usage_conversation_idx on private.ai_usage_logs(conversation_id);
create index ai_usage_ticket_idx on private.ai_usage_logs(ticket_id);
create table private.ai_errors (
 id uuid primary key default gen_random_uuid(),provider_id uuid not null references private.ai_providers(id),
 model_id uuid not null references private.ai_models(id),
 error_type text not null check(error_type in ('TIMEOUT','CANCELLED','RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','AUTH_ERROR','INVALID_OUTPUT','INVALID_REQUEST','PROVIDER_UNAVAILABLE')),
 http_status integer check(http_status between 100 and 599),message text not null,
 metadata jsonb not null default '{}'::jsonb check(metadata='{}'::jsonb),
 created_at timestamptz not null default clock_timestamp(),check(message=error_type)
);
create index ai_errors_provider_idx on private.ai_errors(provider_id,created_at desc);
create index ai_errors_model_idx on private.ai_errors(model_id);

alter table private.ai_providers enable row level security;
alter table private.ai_models enable row level security;
alter table private.ai_usage_logs enable row level security;
alter table private.ai_errors enable row level security;
revoke all on private.ai_providers,private.ai_models,private.ai_usage_logs,private.ai_errors from public,anon,authenticated;
grant all on private.ai_providers,private.ai_models,private.ai_usage_logs,private.ai_errors to service_role;
