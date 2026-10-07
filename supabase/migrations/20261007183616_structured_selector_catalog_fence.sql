-- Freeze the complete exact selector, including families without a previous hit.
-- Readers share this lock; all eligibility/typed-row writers acquire it first.
create function private.lock_structured_selection_catalog() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 -- Service writers take the blocking catalog lock before any family/document/row lock.
 -- A direct SQL writer might already hold a row lock: fail retryably, never wait
 -- for the catalog and form a catalog -> row -> catalog deadlock.
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('knowledge-structured-selection-catalog:v1',0)) then
  raise exception using errcode='40001',message='STRUCTURED_SELECTION_RETRY';
 end if;
 return null;
end;
$$;
create trigger structured_selection_catalog before insert or update or delete or truncate on public.document_families
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on public.documents
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on public.document_relationships
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on public.departments
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on public.academic_calendar_events
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on public.tuition_fees
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on public.transfer_courses
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on public.university_services
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on public.university_systems
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on public.service_forms
for each statement execute function private.lock_structured_selection_catalog();
create trigger structured_selection_catalog before insert or update or delete or truncate on public.announcements
for each statement execute function private.lock_structured_selection_catalog();
revoke all on function private.lock_structured_selection_catalog() from public,anon,authenticated;
grant execute on function private.lock_structured_selection_catalog() to service_role;
