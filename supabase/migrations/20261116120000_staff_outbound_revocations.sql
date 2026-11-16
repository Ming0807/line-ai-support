-- CHAT-MEDIA-02G (DEC-202): Staff may withdraw a Student's access to a confirmed file. Additive and
-- append-only; one row per confirmed delivery. The draft, delivery and private object stay untouched,
-- so revocation never deletes data. The Student viewer denies access when a row exists.
create table private.staff_outbound_revocations(
 attachment_id uuid primary key references private.staff_outbound_deliveries(attachment_id),
 revoked_by uuid not null references public.staff_profiles(id),
 reason text not null default 'STAFF_REVOKED' check(reason in('STAFF_REVOKED')),
 created_at timestamptz not null default clock_timestamp()
);
alter table private.staff_outbound_revocations enable row level security;
revoke all on private.staff_outbound_revocations from public,anon,authenticated;
grant select,insert on private.staff_outbound_revocations to service_role;

create function private.guard_staff_outbound_revocation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='STAFF_OUTBOUND_REVOCATION_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger staff_outbound_revocation_guard before insert or update or delete on private.staff_outbound_revocations
 for each row execute function private.guard_staff_outbound_revocation();
revoke all on function private.guard_staff_outbound_revocation() from public,anon,authenticated;
grant execute on function private.guard_staff_outbound_revocation() to service_role;
