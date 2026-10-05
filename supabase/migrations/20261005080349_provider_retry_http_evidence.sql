-- CHECK treats NULL as allowed; retry evidence must explicitly prove an HTTP response.
alter table private.ai_model_observations drop constraint ai_model_observation_retry_evidence;
alter table private.ai_model_observations add constraint ai_model_observation_retry_evidence check (
 (retry_at is null and retry_observed_at is null) or
 (retry_at is not null and retry_observed_at is not null and http_status is not null and error_code is not null
  and (http_status=429 or http_status between 500 and 599) and result='ERROR'
  and ((http_status=429 and error_code='RATE_LIMITED') or (http_status between 500 and 599 and error_code='SERVER_ERROR'))
  and retry_at>=retry_observed_at and retry_at<=retry_observed_at+interval '24 hours'));
