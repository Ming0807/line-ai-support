-- Run against the local Supabase database only. Every fixture row is rolled back.
begin;

-- Supply the same nine departments as supabase/seed.sql so the fixture also works after --no-seed replay.
insert into public.departments (code, name_th, name_en) values
 ('IT','เทคโนโลยีสารสนเทศ','Information Technology'),
 ('REGISTRAR','งานทะเบียน','Registrar'),
 ('STUDENT_AFFAIRS','กิจการนักศึกษา','Student Affairs'),
 ('LIBRARY','ห้องสมุด','Library'),
 ('DORMITORY','หอพัก','Dormitory'),
 ('FINANCE','การเงิน','Finance'),
 ('ACADEMIC_AFFAIRS','วิชาการ','Academic Affairs'),
 ('FACILITY','อาคารและสถานที่','Facility'),
 ('ADMIN','ผู้ดูแลระบบ','Administration')
on conflict (code) do nothing;

insert into auth.users (id, email) values
 ('10000000-0000-4000-8000-000000000001', 'it-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000002', 'it-sensitive-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000003', 'it-restricted-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000004', 'library-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000005', 'admin-no-grant-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000006', 'admin-it-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000007', 'super-admin-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000008', 'inactive-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000009', 'it-admin-permissions-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000010', 'it-no-profile-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000011', 'admin-home-no-grant-test@example.invalid');

insert into public.staff_profiles (id, department_id, display_name, role, active, can_view_sensitive, can_view_restricted) values
 ('10000000-0000-4000-8000-000000000001', (select id from public.departments where code='IT'), 'IT staff', 'STAFF', true, false, false),
 ('10000000-0000-4000-8000-000000000002', (select id from public.departments where code='IT'), 'IT sensitive', 'STAFF', true, true, false),
 ('10000000-0000-4000-8000-000000000003', (select id from public.departments where code='IT'), 'IT restricted', 'SUPERVISOR', true, false, true),
 ('10000000-0000-4000-8000-000000000004', (select id from public.departments where code='LIBRARY'), 'Library staff', 'STAFF', true, false, false),
 ('10000000-0000-4000-8000-000000000005', null, 'Admin without grants', 'ADMIN', true, true, true),
 ('10000000-0000-4000-8000-000000000006', null, 'Admin with IT grant', 'ADMIN', true, false, false),
 ('10000000-0000-4000-8000-000000000007', null, 'Super Admin', 'SUPER_ADMIN', true, false, false),
 ('10000000-0000-4000-8000-000000000008', (select id from public.departments where code='IT'), 'Inactive IT', 'STAFF', false, true, true),
 ('10000000-0000-4000-8000-000000000009', null, 'Admin with permissions', 'ADMIN', true, true, true),
 ('10000000-0000-4000-8000-000000000011', (select id from public.departments where code='IT'), 'Admin with home, no grant', 'ADMIN', true, false, false);

-- Browser-visible grants must be self-only, and only an active caller's grants are useful.
insert into public.staff_department_grants (staff_id, department_id) values
 ('10000000-0000-4000-8000-000000000006', (select id from public.departments where code='IT')),
 ('10000000-0000-4000-8000-000000000009', (select id from public.departments where code='IT')),
 ('10000000-0000-4000-8000-000000000008', (select id from public.departments where code='IT'));

insert into public.line_sessions (id, anonymous_code) values
 ('20000000-0000-4000-8000-000000000001', 'Anonymous #M1-RLS');

insert into public.conversations (id, line_session_id, topic) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','IT general'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','IT sensitive'),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','IT restricted'),
 ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','Library general'),
 ('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','Library sensitive'),
 ('30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001','Cross-department thread');

insert into public.tickets (id, line_session_id, conversation_id, department_id, problem_summary, sensitive_level) values
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',(select id from public.departments where code='IT'),'IT general','GENERAL'),
 ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',(select id from public.departments where code='IT'),'IT sensitive','SENSITIVE'),
 ('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',(select id from public.departments where code='IT'),'IT restricted','RESTRICTED'),
 ('40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004',(select id from public.departments where code='LIBRARY'),'Library general','GENERAL'),
 ('40000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000005',(select id from public.departments where code='LIBRARY'),'Library sensitive','SENSITIVE'),
 ('40000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000006',(select id from public.departments where code='IT'),'Mixed thread IT ticket','GENERAL'),
 ('40000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000006',(select id from public.departments where code='LIBRARY'),'Mixed thread Library ticket','GENERAL');

insert into public.messages (conversation_id, ticket_id, sender_type, content) values
 ('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','USER','IT general message'),
 ('30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','USER','IT sensitive message'),
 ('30000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000003','USER','IT restricted message'),
 ('30000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000004','USER','Library general message'),
 ('30000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000005','USER','Library sensitive message'),
 ('30000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000006','USER','Mixed IT message'),
 ('30000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000007','USER','Mixed Library message');

insert into public.ticket_history (ticket_id, action, actor_type, actor_id) values
 ('40000000-0000-4000-8000-000000000001','fixture','STAFF','10000000-0000-4000-8000-000000000001'),
 ('40000000-0000-4000-8000-000000000002','fixture','SYSTEM',null),
 ('40000000-0000-4000-8000-000000000003','fixture','SYSTEM',null),
 ('40000000-0000-4000-8000-000000000004','fixture','SYSTEM',null),
 ('40000000-0000-4000-8000-000000000005','fixture','SYSTEM',null),
 ('40000000-0000-4000-8000-000000000006','fixture','SYSTEM',null),
 ('40000000-0000-4000-8000-000000000007','fixture','SYSTEM',null);

-- The schema must reject incomplete or contradictory audit actor identities.
do $$ begin
  begin
    insert into public.ticket_history (ticket_id, action, actor_type, actor_id)
    values ('40000000-0000-4000-8000-000000000001','invalid actor','STAFF',null);
    raise exception 'STAFF ticket_history row without actor_id was accepted';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.ticket_history (ticket_id, action, actor_type, actor_id)
    values ('40000000-0000-4000-8000-000000000001','invalid actor','SYSTEM','10000000-0000-4000-8000-000000000001');
    raise exception 'non-STAFF ticket_history row with actor_id was accepted';
  exception when check_violation then
    null;
  end;
end $$;

-- IT STAFF: general IT only; no other department or sensitivity class.
-- A normal development database can retain additional departments. Capture the
-- complete server-visible directory before impersonation, rather than assuming
-- the nine seed rows are its entire population. This setting is transaction-local.
select set_config('fixture.expected_department_count', (select count(*)::text from public.departments), true);
-- SUPER_ADMIN must see the entire retained population, including earlier data.
select set_config('fixture.expected_ticket_count', (select count(*)::text from public.tickets), true);
select set_config('fixture.expected_conversation_count', (select count(*)::text from public.conversations), true);
select set_config('fixture.expected_message_count', (select count(*)::text from public.messages), true);
select set_config('fixture.expected_history_count', (select count(*)::text from public.ticket_history), true);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ begin
  if (select count(*) from public.tickets) <> 2 then raise exception 'IT STAFF general-only scope failed'; end if;
  if (select count(*) from public.tickets where sensitive_level='SENSITIVE') <> 0 then raise exception 'IT STAFF saw sensitive ticket'; end if;
  if (select count(*) from public.tickets where sensitive_level='RESTRICTED') <> 0 then raise exception 'IT STAFF saw restricted ticket'; end if;
  if (select count(*) from public.conversations) <> 1 then raise exception 'IT STAFF conversation scope failed'; end if;
  if (select count(*) from public.conversations where id='30000000-0000-4000-8000-000000000006') <> 0 then raise exception 'Conversation with unauthorized ticket was exposed'; end if;
  if (select count(*) from public.line_sessions) <> 1 then raise exception 'Session should be visible with one scoped ticket'; end if;
  if (select count(*) from public.messages) <> 2 then raise exception 'IT STAFF message scope failed'; end if;
  if (select count(*) from public.ticket_history) <> 2 then raise exception 'IT STAFF audit scope failed'; end if;
  if (select count(*) from public.departments) <> current_setting('fixture.expected_department_count')::integer then raise exception 'Active staff department directory visibility failed'; end if;
  if (select count(*) from public.staff_profiles) <> 1 then raise exception 'Staff profile is not self-only'; end if;
  if (select count(*) from public.staff_department_grants) <> 0 then raise exception 'Staff saw another caller department grant'; end if;
  if exists (select 1 from unnest(array['departments','staff_profiles','staff_department_grants','line_sessions','conversations','tickets','messages','ticket_history']) t(table_name) where has_table_privilege(current_user,'public.'||table_name,'INSERT,UPDATE,DELETE')) then raise exception 'Authenticated can write an exposed public table'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'Authenticated can access a private table'; end if;
  if has_function_privilege(current_user,'private.claim_inbox(text)','EXECUTE') then raise exception 'Authenticated can claim private inbox work'; end if;
  if has_sequence_privilege(current_user,'public.tickets_ticket_seq_seq','USAGE,SELECT,UPDATE') then raise exception 'Authenticated can access ticket sequence'; end if;
end $$;

-- STAFF sensitivity flags are independent: sensitive does not imply restricted.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.tickets) <> 3 then raise exception 'IT STAFF sensitive permission failed'; end if;
  if (select count(*) from public.tickets where sensitive_level='RESTRICTED') <> 0 then raise exception 'Sensitive permission implied restricted permission'; end if;
  if (select count(*) from public.messages) <> 3 then raise exception 'Sensitive message permission failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
  if (select count(*) from public.tickets) <> 3 then raise exception 'IT SUPERVISOR restricted-only permission failed'; end if;
  if (select count(*) from public.tickets where sensitive_level='SENSITIVE') <> 0 then raise exception 'Restricted permission implied sensitive permission'; end if;
end $$;

-- A home department scopes regular staff, even when other teams' rows share the same session.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
do $$ begin
  if (select count(*) from public.tickets) <> 2 then raise exception 'Library department scope failed'; end if;
  if (select count(*) from public.conversations) <> 1 then raise exception 'Library conversation scope failed'; end if;
  if (select count(*) from public.messages) <> 2 then raise exception 'Library message scope failed'; end if;
  if (select count(*) from public.ticket_history) <> 2 then raise exception 'Library audit scope failed'; end if;
end $$;

-- ADMIN has no implicit all-department access, even with home department absent and flags set.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
do $$ begin
  if (select count(*) from public.tickets) <> 0 then raise exception 'Admin without department grants saw tickets'; end if;
  if (select count(*) from public.line_sessions) <> 0 then raise exception 'Ungrant Admin saw sessions'; end if;
  if (select count(*) from public.staff_department_grants) <> 0 then raise exception 'Admin saw another caller grants'; end if;
end $$;

-- An explicit IT grant authorizes IT GENERAL only; the two permission bits remain independent.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
do $$ begin
  if (select count(*) from public.tickets) <> 2 then raise exception 'Admin explicit department grant failed'; end if;
  if (select count(*) from public.tickets where department_id=(select id from public.departments where code='LIBRARY')) <> 0 then raise exception 'Admin grant leaked another department'; end if;
  if (select count(*) from public.staff_department_grants) <> 1 then raise exception 'Admin own grant visibility failed'; end if;
  if has_table_privilege(current_user,'public.staff_department_grants','INSERT,UPDATE,DELETE') then raise exception 'Authenticated can modify department grants'; end if;
end $$;

-- SUPER_ADMIN can see every department and both sensitivity classes regardless of permission bits.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000007',true);
do $$ begin
  if (select count(*) from public.tickets) <> current_setting('fixture.expected_ticket_count')::integer then raise exception 'SUPER_ADMIN did not see all departments and sensitivity levels'; end if;
  if (select count(*) from public.conversations) <> current_setting('fixture.expected_conversation_count')::integer then raise exception 'SUPER_ADMIN conversation visibility failed'; end if;
  if (select count(*) from public.messages) <> current_setting('fixture.expected_message_count')::integer then raise exception 'SUPER_ADMIN message visibility failed'; end if;
  if (select count(*) from public.ticket_history) <> current_setting('fixture.expected_history_count')::integer then raise exception 'SUPER_ADMIN audit visibility failed'; end if;
end $$;

-- ADMIN with an IT grant and both explicit flags sees IT restricted and sensitive rows only.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000009',true);
do $$ begin
  if (select count(*) from public.tickets) <> 4 then raise exception 'Admin sensitive/restricted permissions failed'; end if;
  if (select count(*) from public.tickets where department_id=(select id from public.departments where code='LIBRARY')) <> 0 then raise exception 'Admin flags bypassed department grants'; end if;
  if (select count(*) from public.staff_department_grants) <> 1 then raise exception 'Permission Admin own grant visibility failed'; end if;
end $$;

-- Inactive staff retains only its own profile; no department, grant, or scoped data access.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000008',true);
do $$ begin
  if (select count(*) from public.staff_profiles) <> 1 then raise exception 'Inactive staff cannot read own profile'; end if;
  if (select count(*) from public.departments) <> 0 then raise exception 'Inactive staff saw departments'; end if;
  if (select count(*) from public.staff_department_grants) <> 0 then raise exception 'Inactive staff saw grants'; end if;
  if (select count(*) from public.tickets) <> 0 then raise exception 'Inactive staff saw tickets'; end if;
  if (select count(*) from public.line_sessions) <> 0 then raise exception 'Inactive staff saw sessions'; end if;
end $$;

-- Authenticated identity without a staff profile gets no staff data or helper access.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000010',true);
do $$ begin
  if (select count(*) from public.staff_profiles) <> 0 then raise exception 'Auth user without staff profile saw profiles'; end if;
  if (select count(*) from public.departments) <> 0 then raise exception 'Auth user without staff profile saw departments'; end if;
  if (select count(*) from public.tickets) <> 0 then raise exception 'Auth user without staff profile saw tickets'; end if;
  if (select count(*) from public.staff_department_grants) <> 0 then raise exception 'Auth user without staff profile saw grants'; end if;
end $$;

-- Add a Library-only session after count-based cases so earlier totals remain unchanged.
reset role;
insert into public.line_sessions (id, anonymous_code)
values ('20000000-0000-4000-8000-000000000002','Anonymous #M1-LIBRARY-ONLY');
insert into public.conversations (id, line_session_id, topic)
values ('30000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000002','Library-only privacy boundary');
insert into public.tickets (id, line_session_id, conversation_id, department_id, problem_summary, sensitive_level)
values ('40000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000007',(select id from public.departments where code='LIBRARY'),'Library-only general ticket','GENERAL');
insert into public.messages (conversation_id, ticket_id, sender_type, content)
values ('30000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000008','USER','Library-only message');
insert into public.ticket_history (ticket_id, action, actor_type, actor_id)
values ('40000000-0000-4000-8000-000000000008','fixture','SYSTEM',null);

-- IT identities cannot infer Library-only session, conversation, ticket, message, or history access.
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ begin
  if exists (select 1 from public.line_sessions where id='20000000-0000-4000-8000-000000000002') then raise exception 'IT STAFF saw Library-only session'; end if;
  if exists (select 1 from public.conversations where id='30000000-0000-4000-8000-000000000007') then raise exception 'IT STAFF saw Library-only conversation'; end if;
  if exists (select 1 from public.tickets where id='40000000-0000-4000-8000-000000000008') then raise exception 'IT STAFF saw Library-only ticket'; end if;
  if exists (select 1 from public.messages where ticket_id='40000000-0000-4000-8000-000000000008') then raise exception 'IT STAFF saw Library-only message'; end if;
  if exists (select 1 from public.ticket_history where ticket_id='40000000-0000-4000-8000-000000000008') then raise exception 'IT STAFF saw Library-only history'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
  if exists (select 1 from public.line_sessions where id='20000000-0000-4000-8000-000000000002') then raise exception 'IT sensitive STAFF saw Library-only session'; end if;
  if exists (select 1 from public.conversations where id='30000000-0000-4000-8000-000000000007') then raise exception 'IT sensitive STAFF saw Library-only conversation'; end if;
  if exists (select 1 from public.tickets where id='40000000-0000-4000-8000-000000000008') then raise exception 'IT sensitive STAFF saw Library-only ticket'; end if;
  if exists (select 1 from public.messages where ticket_id='40000000-0000-4000-8000-000000000008') then raise exception 'IT sensitive STAFF saw Library-only message'; end if;
  if exists (select 1 from public.ticket_history where ticket_id='40000000-0000-4000-8000-000000000008') then raise exception 'IT sensitive STAFF saw Library-only history'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
  if exists (select 1 from public.line_sessions where id='20000000-0000-4000-8000-000000000002') then raise exception 'IT restricted STAFF saw Library-only session'; end if;
  if exists (select 1 from public.conversations where id='30000000-0000-4000-8000-000000000007') then raise exception 'IT restricted STAFF saw Library-only conversation'; end if;
  if exists (select 1 from public.tickets where id='40000000-0000-4000-8000-000000000008') then raise exception 'IT restricted STAFF saw Library-only ticket'; end if;
  if exists (select 1 from public.messages where ticket_id='40000000-0000-4000-8000-000000000008') then raise exception 'IT restricted STAFF saw Library-only message'; end if;
  if exists (select 1 from public.ticket_history where ticket_id='40000000-0000-4000-8000-000000000008') then raise exception 'IT restricted STAFF saw Library-only history'; end if;
end $$;

-- The Library caller sees every exact row tied to its scoped ticket.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
do $$ begin
  if (select count(*) from public.line_sessions where id='20000000-0000-4000-8000-000000000002') <> 1 then raise exception 'Library cannot see its own session'; end if;
  if (select count(*) from public.conversations where id='30000000-0000-4000-8000-000000000007') <> 1 then raise exception 'Library cannot see its own conversation'; end if;
  if (select count(*) from public.tickets where id='40000000-0000-4000-8000-000000000008') <> 1 then raise exception 'Library cannot see its own ticket'; end if;
  if (select count(*) from public.messages where ticket_id='40000000-0000-4000-8000-000000000008') <> 1 then raise exception 'Library cannot see its own message'; end if;
  if (select count(*) from public.ticket_history where ticket_id='40000000-0000-4000-8000-000000000008') <> 1 then raise exception 'Library cannot see its own history'; end if;
end $$;

-- Inactive and missing-profile identities remain closed across all scoped tables after the new rows exist.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000008',true);
do $$ begin
  if (select count(*) from public.staff_profiles) <> 1 then raise exception 'Inactive staff lost own-profile visibility'; end if;
  if exists (select 1 from public.line_sessions where id='20000000-0000-4000-8000-000000000002') then raise exception 'Inactive staff saw scoped session'; end if;
  if exists (select 1 from public.conversations where id='30000000-0000-4000-8000-000000000007') then raise exception 'Inactive staff saw scoped conversation'; end if;
  if exists (select 1 from public.tickets where id='40000000-0000-4000-8000-000000000008') then raise exception 'Inactive staff saw scoped ticket'; end if;
  if exists (select 1 from public.messages where ticket_id='40000000-0000-4000-8000-000000000008') then raise exception 'Inactive staff saw scoped message'; end if;
  if exists (select 1 from public.ticket_history where ticket_id='40000000-0000-4000-8000-000000000008') then raise exception 'Inactive staff saw scoped history'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000010',true);
do $$ begin
  if exists (select 1 from public.line_sessions where id='20000000-0000-4000-8000-000000000002') then raise exception 'Auth user without profile saw scoped session'; end if;
  if exists (select 1 from public.conversations where id='30000000-0000-4000-8000-000000000007') then raise exception 'Auth user without profile saw scoped conversation'; end if;
  if exists (select 1 from public.tickets where id='40000000-0000-4000-8000-000000000008') then raise exception 'Auth user without profile saw scoped ticket'; end if;
  if exists (select 1 from public.messages where ticket_id='40000000-0000-4000-8000-000000000008') then raise exception 'Auth user without profile saw scoped message'; end if;
  if exists (select 1 from public.ticket_history where ticket_id='40000000-0000-4000-8000-000000000008') then raise exception 'Auth user without profile saw scoped history'; end if;
end $$;

-- ADMIN home department does not replace an explicit grant.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',true);
do $$ begin
  if exists (select 1 from public.tickets where id='40000000-0000-4000-8000-000000000001') then raise exception 'Admin home department bypassed required grant'; end if;
  if exists (select 1 from public.tickets where id='40000000-0000-4000-8000-000000000008') then raise exception 'Admin home department saw Library ticket'; end if;
end $$;

-- Anonymous has no table, helper, or sequence access.
reset role;
set local role anon;
do $$ begin
  if exists (select 1 from unnest(array['departments','staff_profiles','staff_department_grants','line_sessions','conversations','tickets','messages','ticket_history']) t(table_name) where has_table_privilege(current_user,'public.'||table_name,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'Anon can access an exposed public table'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'Anon can access a private table'; end if;
  if has_function_privilege(current_user,(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='can_access_ticket'),'EXECUTE') then raise exception 'Anon can call private RLS helper'; end if;
  if has_function_privilege(current_user,(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='claim_inbox'),'EXECUTE') then raise exception 'Anon can claim private inbox work'; end if;
  if has_sequence_privilege(current_user,'public.tickets_ticket_seq_seq','USAGE,SELECT,UPDATE') then raise exception 'Anon can access ticket sequence'; end if;
end $$;

reset role;
-- Durable inbox remains server-only, idempotent, and transactionally rolled back with this fixture.
insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted)
values ('STUDENT','m1-rls-event','fixture-hash','encrypted-fixture');
insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted)
values ('STUDENT','m1-rls-event','fixture-hash','encrypted-fixture')
on conflict (channel,event_id) do nothing;
do $$ begin
  if (select count(*) from private.webhook_inbox where event_id='m1-rls-event') <> 1 then raise exception 'Webhook duplicate delivery was not deduplicated'; end if;
end $$;

rollback;
select 'foundation RLS/privacy checks passed' as result;
