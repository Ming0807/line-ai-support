-- ADV-05C-3A: a new matching chunk participates in complete catalog selection.
-- Keep this lock-only; ordinary chunk writes do not advance the incident epoch.
create function private.lock_rag_selection_catalog() returns trigger
 language plpgsql volatile security invoker set search_path='' as $$
begin
 -- Direct callers may already own row locks. Never wait for catalog here.
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('knowledge-structured-selection-catalog:v1',0)) then
  raise exception using errcode='40001',message='STRUCTURED_SELECTION_RETRY';
 end if;
 return null;
end;
$$;
create trigger rag_selection_catalog before insert or update or delete or truncate on public.knowledge_chunks
 for each statement execute function private.lock_rag_selection_catalog();
revoke all on function private.lock_rag_selection_catalog() from public,anon,authenticated,service_role;
grant execute on function private.lock_rag_selection_catalog() to service_role;
