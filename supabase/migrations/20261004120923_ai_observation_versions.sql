-- Preserve the configuration snapshot that generated each observation.
alter table private.ai_usage_logs
 add column provider_revision integer not null default 0 check(provider_revision>=0),
 add column model_revision integer not null default 0 check(model_revision>=0);
alter table private.ai_errors
 add column provider_revision integer not null default 0 check(provider_revision>=0),
 add column model_revision integer not null default 0 check(model_revision>=0);
