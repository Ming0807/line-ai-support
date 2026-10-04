-- Explicit department scope for administrators; browser clients cannot grant access.
create table public.staff_department_grants (
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  department_id uuid not null references public.departments(id),
  created_at timestamptz not null default now(),
  primary key (staff_id, department_id)
);
create index staff_department_grants_department_idx on public.staff_department_grants(department_id);
alter table public.staff_department_grants enable row level security;
revoke all on public.staff_department_grants from public, anon, authenticated;
grant select on public.staff_department_grants to authenticated;
grant all on public.staff_department_grants to service_role;
create policy grants_self_read on public.staff_department_grants
  for select to authenticated using (staff_id=(select auth.uid()) and (select private.is_active_staff()));

create or replace function private.can_access_scope(dept uuid, sensitivity text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.staff_profiles s
    where s.id=(select auth.uid()) and s.active
      and (s.role='SUPER_ADMIN'
        or (s.role='ADMIN' and exists (
          select 1 from public.staff_department_grants g where g.staff_id=s.id and g.department_id=dept
        ))
        or (s.role in ('STAFF','SUPERVISOR') and s.department_id=dept))
      and (sensitivity='GENERAL' or s.role='SUPER_ADMIN'
        or (sensitivity='SENSITIVE' and s.can_view_sensitive)
        or (sensitivity='RESTRICTED' and s.can_view_restricted))
  )
$$;
revoke all on function private.can_access_scope(uuid,text) from public, anon, authenticated;
grant execute on function private.can_access_scope(uuid,text) to authenticated, service_role;

alter table public.ticket_history add constraint ticket_history_actor_consistency
  check ((actor_type='STAFF') = (actor_id is not null));
