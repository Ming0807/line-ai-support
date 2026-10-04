alter table private.ai_providers add column revision integer not null default 0 check(revision>=0);
alter table private.ai_models add column revision integer not null default 0 check(revision>=0);
alter table private.ai_models add constraint ai_model_provider_identity unique(provider_id,id);
alter table private.ai_usage_logs add constraint ai_usage_provider_model_fk
 foreign key(provider_id,model_id) references private.ai_models(provider_id,id);
alter table private.ai_errors add constraint ai_error_provider_model_fk
 foreign key(provider_id,model_id) references private.ai_models(provider_id,id);
