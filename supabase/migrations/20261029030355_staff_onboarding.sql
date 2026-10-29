create table private.staff_applications(
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null unique references auth.users(id) on delete cascade,
 auth_identity_id uuid references auth.identities(id) on delete set null,
 line_subject_hash text not null unique check(line_subject_hash~'^[a-f0-9]{64}$'),
 line_subject_encrypted text not null,
 applicant_name text not null check(length(btrim(applicant_name)) between 1 and 120),
 staff_code text not null check(length(btrim(staff_code)) between 1 and 64),
 requested_department_id uuid not null references public.departments(id),
 approved_department_id uuid references public.departments(id),
 status text not null default 'PENDING' check(status in('PENDING','APPROVED','REJECTED','SUSPENDED')),
 revision integer not null default 0 check(revision>=0),
 submitted_at timestamptz not null default clock_timestamp(),
 reviewed_at timestamptz,reviewed_by uuid references public.staff_profiles(id) on delete set null,
 decision_reason text check(decision_reason is null or length(btrim(decision_reason)) between 1 and 2000),
 updated_at timestamptz not null default clock_timestamp(),
 check((status='PENDING' and approved_department_id is null and reviewed_at is null and reviewed_by is null and decision_reason is null)
  or(status='APPROVED' and approved_department_id is not null and reviewed_at is not null)
  or(status='REJECTED' and approved_department_id is null and reviewed_at is not null and decision_reason is not null)
  or(status='SUSPENDED' and approved_department_id is not null and reviewed_at is not null and decision_reason is not null))
);
create index staff_applications_identity_idx on private.staff_applications(auth_identity_id) where auth_identity_id is not null;
create index staff_applications_requested_department_idx on private.staff_applications(requested_department_id);
create index staff_applications_approved_department_idx on private.staff_applications(approved_department_id) where approved_department_id is not null;
create index staff_applications_reviewer_idx on private.staff_applications(reviewed_by) where reviewed_by is not null;
create index staff_applications_status_list_idx on private.staff_applications(status,submitted_at desc,id);
create index staff_applications_list_idx on private.staff_applications(submitted_at desc,id);
-- A repeated personnel claim requires review of the existing account, never an automatic merge.
create unique index staff_applications_approved_code_idx on private.staff_applications(staff_code) where status in('APPROVED','SUSPENDED');

create table private.staff_application_actions(
 actor_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 application_id uuid not null references private.staff_applications(id) on delete cascade,
 action text not null check(action in('SUBMIT','APPROVE','REJECT','SUSPEND','SYNC_IDENTITY')),
 request_digest text not null check(request_digest~'^[a-f0-9]{64}$'),
 response jsonb not null check(jsonb_typeof(response)='object' and octet_length(response::text)<=16384),
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
create index staff_application_actions_application_idx on private.staff_application_actions(application_id,created_at);

alter table private.staff_applications enable row level security;
alter table private.staff_application_actions enable row level security;
revoke all on private.staff_applications,private.staff_application_actions from public,anon,authenticated;
grant select,insert,update on private.staff_applications to service_role;
grant select,insert on private.staff_application_actions to service_role;

create function private.guard_staff_application_update() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.auth_user_id,new.line_subject_hash,new.line_subject_encrypted,new.applicant_name,new.staff_code,new.requested_department_id,new.submitted_at)
  is distinct from(old.id,old.auth_user_id,old.line_subject_hash,old.line_subject_encrypted,old.applicant_name,old.staff_code,old.requested_department_id,old.submitted_at) then
  raise exception using errcode='23514',message='STAFF_APPLICATION_SOURCE_IMMUTABLE';
 end if;
 if new.status is distinct from old.status and not((old.status='PENDING' and new.status in('APPROVED','REJECTED'))
  or(old.status='APPROVED' and new.status='SUSPENDED')) then
  raise exception using errcode='23514',message='STAFF_APPLICATION_TRANSITION_INVALID';
 end if;
 new.revision:=old.revision+1;new.updated_at:=clock_timestamp();return new;
end $$;
create trigger staff_application_update before update on private.staff_applications
 for each row execute function private.guard_staff_application_update();
revoke all on function private.guard_staff_application_update() from public,anon,authenticated;
grant execute on function private.guard_staff_application_update() to service_role;

create function private.guard_staff_application_action_update() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='23514',message='STAFF_APPLICATION_ACTION_IMMUTABLE';end $$;
create trigger staff_application_action_update before update on private.staff_application_actions
 for each row execute function private.guard_staff_application_action_update();
revoke all on function private.guard_staff_application_action_update() from public,anon,authenticated;
grant execute on function private.guard_staff_application_action_update() to service_role;

-- Deleting a linked Auth identity revokes only its OAuth-backed OA binding.
-- Existing challenge-backed rows remain NULL and retain their independent proof.
alter table private.staff_line_identities add column auth_identity_id uuid unique references auth.identities(id) on delete cascade;
