-- Add only the installed standard compatible protocol. Existing official roots stay fixed.
-- Syntax checks cannot replace fresh public DNS validation and socket pinning in backend code.
-- Keys, models, FREE_ONLY defaults, RLS and grants are preserved.
alter table private.ai_providers drop constraint ai_provider_official_endpoint;
alter table private.ai_providers add constraint ai_provider_endpoint check(
 (adapter='OPENAI' and base_url in ('https://api.openai.com/v1','https://api.openai.com/v1/')) or
 (adapter='ZEN' and base_url in ('https://opencode.ai/zen/v1','https://opencode.ai/zen/v1/')) or
 (adapter='OPENROUTER' and base_url in ('https://openrouter.ai/api/v1','https://openrouter.ai/api/v1/')) or
 (adapter='COMPATIBLE' and length(base_url)<=2048
  and base_url ~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(/[A-Za-z0-9._~-]+)*$'
  and length(split_part(substring(base_url from 9),'/',1))<=253
  and split_part(substring(base_url from 9),'/',1) !~ '^[0-9]+(\.[0-9]+){1,3}$'
  and split_part(substring(base_url from 9),'/',1) !~ '(^|\.)(localhost|local|internal|test|invalid|example|arpa|onion|alt|example\.com|example\.net|example\.org)$'
  and base_url !~ '/\.{1,2}(/|$)' and base_url !~ '/(models|embeddings|chat/completions)$')
);
