-- Keep SQL syntax guard aligned with the endpoint parser's case-insensitive
-- final protocol-route rejection. Do not rewrite migration 18 already applied.
alter table private.ai_providers add constraint ai_provider_endpoint_route_case
 check(adapter<>'COMPATIBLE' or base_url !~* '/(models|embeddings|chat/completions)$');
