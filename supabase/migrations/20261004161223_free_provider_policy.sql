-- Additive policy correction: existing registries remain FREE_ONLY by default.
-- Keep all records/keys and private-schema grants/RLS unchanged.
alter table private.ai_providers
 add column cost_mode text not null default 'FREE_ONLY' check(cost_mode in ('FREE_ONLY','ALLOW_PAID'));
alter table private.ai_providers drop constraint ai_providers_adapter_check;
alter table private.ai_providers drop constraint ai_providers_base_url_check;
alter table private.ai_providers add constraint ai_provider_official_endpoint check(
 (adapter='OPENAI' and base_url in ('https://api.openai.com/v1','https://api.openai.com/v1/')) or
 (adapter='ZEN' and base_url in ('https://opencode.ai/zen/v1','https://opencode.ai/zen/v1/')) or
 (adapter='OPENROUTER' and base_url in ('https://openrouter.ai/api/v1','https://openrouter.ai/api/v1/'))
);
alter table private.ai_models drop constraint ai_models_model_id_check;
alter table private.ai_models add constraint ai_model_slug check(
 length(model_id)<=200 and model_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*(/[A-Za-z0-9][A-Za-z0-9_.:-]*)?$'
);
alter table private.ai_models
 add column pricing_status text not null default 'UNKNOWN' check(pricing_status in ('FREE','PAID','UNKNOWN')),
 add column pricing_checked_at timestamptz,
 add column pricing_provider_revision integer check(pricing_provider_revision>=0),
 add column pricing_model_revision integer check(pricing_model_revision>=0),
 add column api_format text check(api_format in ('CHAT','RESPONSES')),
 add constraint ai_pricing_observation_complete check(
  (pricing_checked_at is null and pricing_provider_revision is null and pricing_model_revision is null and pricing_status='UNKNOWN' and api_format is null)
  or (pricing_checked_at is not null and pricing_provider_revision is not null and pricing_model_revision is not null)
 );
