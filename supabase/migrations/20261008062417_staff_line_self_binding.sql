create table private.staff_binding_challenges (
 token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
 staff_id uuid not null references public.staff_profiles(id),
 request_id uuid not null,
 token_encrypted text not null check (token_encrypted like 'v1.%'),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 consumed_user_hash text check (consumed_user_hash ~ '^[a-f0-9]{64}$'),
 invalidated_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 unique (staff_id,request_id),
 check ((consumed_at is null) = (consumed_user_hash is null))
);
create index staff_binding_pending_idx on private.staff_binding_challenges(staff_id,expires_at)
 where consumed_at is null and invalidated_at is null;
alter table private.staff_binding_challenges enable row level security;
revoke all on private.staff_binding_challenges from public,anon,authenticated;
grant select,insert,update,delete on private.staff_binding_challenges to service_role;

create function private.guard_staff_binding_challenge() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if (new.token_hash,new.staff_id,new.request_id,new.token_encrypted,new.created_at)
  is distinct from (old.token_hash,old.staff_id,old.request_id,old.token_encrypted,old.created_at)
  or (old.invalidated_at is not null and new.invalidated_at is distinct from old.invalidated_at)
  or (old.consumed_at is not null and (new.consumed_at,new.consumed_user_hash) is distinct from (old.consumed_at,old.consumed_user_hash)) then
  raise exception using errcode='23514',message='STAFF_BINDING_IMMUTABLE';
 end if;
 return new;
end $$;
revoke all on function private.guard_staff_binding_challenge() from public,anon,authenticated;
grant execute on function private.guard_staff_binding_challenge() to service_role;
create trigger staff_binding_challenge_guard before update on private.staff_binding_challenges
 for each row execute function private.guard_staff_binding_challenge();
