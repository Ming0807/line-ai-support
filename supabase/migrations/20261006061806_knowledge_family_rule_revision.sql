-- A family-wide fence for publication effects; legacy document/chunk evidence is retained.
alter table public.document_families
 add column rule_revision bigint not null default 0 check(rule_revision>=0);
