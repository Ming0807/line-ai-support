-- Network identity is separate from presentation/order revisions. Old evidence is retained.
alter table private.ai_providers add column network_revision integer not null default 0 check(network_revision>=0);
alter table private.ai_models
 add column network_revision integer not null default 0 check(network_revision>=0),
 add column cooldown_until timestamptz,
 add column cooldown_observed_at timestamptz,
 add column cooldown_provider_network_revision integer check(cooldown_provider_network_revision>=0),
 add column cooldown_model_network_revision integer check(cooldown_model_network_revision>=0),
 add constraint ai_model_cooldown_evidence check (
  (cooldown_until is null and cooldown_observed_at is null and cooldown_provider_network_revision is null and cooldown_model_network_revision is null)
  or (cooldown_until is not null and cooldown_observed_at is not null and cooldown_provider_network_revision is not null and cooldown_model_network_revision is not null
   and cooldown_until>=cooldown_observed_at and cooldown_until<=cooldown_observed_at+interval '24 hours'));
alter table private.ai_model_observations
 add column retry_at timestamptz,
 add column retry_observed_at timestamptz,
 add constraint ai_model_observation_retry_evidence check (
  (retry_at is null and retry_observed_at is null) or
  (retry_at is not null and retry_observed_at is not null and (http_status=429 or http_status between 500 and 599)
   and result='ERROR' and error_code in ('RATE_LIMITED','SERVER_ERROR')
   and retry_at>=retry_observed_at and retry_at<=retry_observed_at+interval '24 hours'));
alter table private.ai_model_observations drop constraint ai_model_observations_error_code_check;
alter table private.ai_model_observations add constraint ai_model_observations_error_code_check
 check(error_code in ('TIMEOUT','CANCELLED','RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','AUTH_ERROR','INVALID_OUTPUT','INVALID_REQUEST','PROVIDER_UNAVAILABLE','PAID_BLOCKED','PRICE_UNKNOWN','CAPABILITY_UNSUPPORTED','COOLDOWN'));
-- Existing private table RLS and grants remain in force; no new public objects.
