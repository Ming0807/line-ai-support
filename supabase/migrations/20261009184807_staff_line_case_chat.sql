-- Fixed Staff chat infrastructure; no student profiles or document-dependent DDL.
alter table public.tickets add column staff_line_epoch bigint not null default 0 check(staff_line_epoch>=0);

create table private.staff_line_case_context (
 staff_id uuid primary key references public.staff_profiles(id),
 ticket_id uuid not null references public.tickets(id),
 assignment_epoch bigint not null check(assignment_epoch>=0),binding_hash text not null,
 selection_id uuid not null,source_event_seq bigint not null check(source_event_seq>0),
 expires_at timestamptz not null,viewed_through_seq bigint not null default 0 check(viewed_through_seq>=0)
);
create index staff_case_context_ticket_idx on private.staff_line_case_context(ticket_id);
create table private.staff_chat_commands (
 token_hash text primary key,staff_id uuid not null references public.staff_profiles(id),binding_hash text not null,
 ticket_id uuid references public.tickets(id),action text not null check(action in('OPEN','MINE','DEPARTMENT','STOP','ACK','RESOLVE','CONFIRM_RESOLVE')),
 assignment_epoch bigint,selection_id uuid,read_through_seq bigint not null default 0 check(read_through_seq>=0),
 page integer not null default 1 check(page between 1 and 10000),expires_at timestamptz not null,consumed_at timestamptz,
 constraint staff_chat_command_target check((action in('OPEN','ACK','RESOLVE','CONFIRM_RESOLVE') and ticket_id is not null and assignment_epoch is not null and assignment_epoch>=0)
  or (action in('MINE','DEPARTMENT','STOP') and ticket_id is null))
);
create index staff_chat_commands_staff_idx on private.staff_chat_commands(staff_id,expires_at);
create index staff_chat_commands_ticket_idx on private.staff_chat_commands(ticket_id);
create table private.staff_chat_message_order (
 message_id uuid primary key references public.messages(id),ticket_id uuid not null references public.tickets(id),
 message_seq bigint generated always as identity unique
);
create index staff_chat_message_ticket_seq_idx on private.staff_chat_message_order(ticket_id,message_seq);
create table private.staff_chat_read_cursors (
 staff_id uuid not null references public.staff_profiles(id),ticket_id uuid not null references public.tickets(id),
 read_through_seq bigint not null check(read_through_seq>=0),primary key(staff_id,ticket_id)
);
create index staff_chat_read_ticket_idx on private.staff_chat_read_cursors(ticket_id);
create table private.staff_chat_delivery_guards (
 outbox_id uuid primary key references private.message_outbox(id),staff_id uuid not null references public.staff_profiles(id),
 binding_hash text,purpose text not null default 'CASE' check(purpose in('CASE','CONTROL','QUEUE'))
);
create index staff_chat_delivery_staff_idx on private.staff_chat_delivery_guards(staff_id);
create table private.staff_chat_delivery_cases (
 outbox_id uuid not null references private.staff_chat_delivery_guards(outbox_id),
 ticket_id uuid not null references public.tickets(id),assignment_epoch bigint not null check(assignment_epoch>=0),
 primary key(outbox_id,ticket_id)
);
create index staff_chat_delivery_ticket_idx on private.staff_chat_delivery_cases(ticket_id);

insert into private.staff_chat_message_order(message_id,ticket_id)
 select id,ticket_id from public.messages where sender_type='USER' and ticket_id is not null order by created_at,id;
create function private.order_staff_chat_message() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.sender_type='USER' and new.ticket_id is not null then
  insert into private.staff_chat_message_order(message_id,ticket_id) values(new.id,new.ticket_id) on conflict(message_id) do nothing;
 end if;
 return new;
end $$;
create trigger staff_chat_message_order after insert or update of ticket_id on public.messages
 for each row execute function private.order_staff_chat_message();

create function private.guard_staff_chat_access() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('staff-chat:access',0)) then
  raise exception using errcode='40001',message='STAFF_CHAT_ACCESS_BUSY';
 end if;
 return null;
end $$;
create trigger staff_chat_profile_access before insert or update or delete or truncate on public.staff_profiles
 for each statement execute function private.guard_staff_chat_access();
create trigger staff_chat_grants_access before insert or update or delete or truncate on public.staff_department_grants
 for each statement execute function private.guard_staff_chat_access();
create trigger staff_chat_binding_access before insert or update or delete or truncate on private.staff_line_identities
 for each statement execute function private.guard_staff_chat_access();

create function private.advance_staff_line_epoch() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.staff_line_epoch:=old.staff_line_epoch;
 if new.assigned_staff_id is distinct from old.assigned_staff_id or new.department_id is distinct from old.department_id
  or new.sensitive_level is distinct from old.sensitive_level or new.mode is distinct from old.mode
  or (new.status is distinct from old.status and (new.status in('RESOLVED','CLOSED','CANCELLED') or old.status in('RESOLVED','CLOSED','CANCELLED'))) then
  if not pg_try_advisory_xact_lock(hashtextextended('conversation:'||old.conversation_id::text,0)) then
   raise exception using errcode='40001',message='STAFF_CHAT_TICKET_BUSY';
  end if;
  new.staff_line_epoch:=old.staff_line_epoch+1;
  update private.staff_line_case_context set expires_at=least(expires_at,clock_timestamp()) where ticket_id=old.id;
 end if;
 return new;
end $$;
create trigger staff_chat_assignment_epoch before update on public.tickets
 for each row execute function private.advance_staff_line_epoch();

alter table private.message_outbox drop constraint outbox_target_check;
alter table private.message_outbox drop constraint outbox_channel_kind_check;
alter table private.message_outbox drop constraint message_outbox_kind_check;
alter table private.message_outbox add constraint message_outbox_kind_check check(kind in('AI','STAFF','SYSTEM','NOTIFICATION','CHAT','CONTROL'));
alter table private.message_outbox add constraint outbox_target_check check(
 (channel='STUDENT' and line_session_id is not null and recipient_staff_id is null)
 or (channel='STAFF' and recipient_staff_id is not null and line_session_id is null and conversation_id is null and delivery_mode='PUSH'
  and ((kind='CONTROL' and ticket_id is null) or (kind in('NOTIFICATION','CHAT') and ticket_id is not null))));
alter table private.message_outbox add constraint outbox_channel_kind_check check(
 (channel='STUDENT' and kind in('AI','STAFF','SYSTEM')) or (channel='STAFF' and kind in('NOTIFICATION','CHAT','CONTROL')));

alter table private.staff_line_case_context enable row level security;
alter table private.staff_chat_commands enable row level security;
alter table private.staff_chat_message_order enable row level security;
alter table private.staff_chat_read_cursors enable row level security;
alter table private.staff_chat_delivery_guards enable row level security;
alter table private.staff_chat_delivery_cases enable row level security;
revoke all on private.staff_line_case_context,private.staff_chat_commands,private.staff_chat_message_order,
 private.staff_chat_read_cursors,private.staff_chat_delivery_guards,private.staff_chat_delivery_cases from public,anon,authenticated;
grant select,insert,update on private.staff_line_case_context,private.staff_chat_commands,private.staff_chat_read_cursors to service_role;
grant select,insert on private.staff_chat_message_order,private.staff_chat_delivery_guards,private.staff_chat_delivery_cases to service_role;
grant usage,select on sequence private.staff_chat_message_order_message_seq_seq to service_role;
revoke all on sequence private.staff_chat_message_order_message_seq_seq from public,anon,authenticated;
revoke all on function private.order_staff_chat_message(),private.guard_staff_chat_access(),private.advance_staff_line_epoch() from public,anon,authenticated;
grant execute on function private.order_staff_chat_message(),private.guard_staff_chat_access(),private.advance_staff_line_epoch() to service_role;

-- Sticky invalidation prevents revoke/restore or unlink/rebind ABA reviving queued content or controls.
create function private.invalidate_staff_chat_access() returns trigger language plpgsql security invoker set search_path='' as $$
declare target uuid; previous_target uuid;
begin
 if tg_table_name='staff_profiles' then
  target:=case when tg_op='DELETE' then old.id else new.id end;
 else
  target:=case when tg_op='DELETE' then old.staff_id else new.staff_id end;
  if tg_op='UPDATE' then previous_target:=old.staff_id; end if;
 end if;
 for target in select distinct v.id from (values(target),(previous_target)) as v(id) where v.id is not null loop
  update private.staff_line_case_context set expires_at=least(expires_at,clock_timestamp()) where staff_id=target;
  update private.staff_chat_commands set consumed_at=coalesce(consumed_at,clock_timestamp()) where staff_id=target and consumed_at is null;
  update private.staff_action_tokens set consumed_at=coalesce(consumed_at,clock_timestamp()) where staff_id=target and consumed_at is null;
  update private.message_outbox set status='SUPPRESSED',last_error_code='STAFF_CHAT_ACCESS_CHANGED',completed_at=clock_timestamp(),lease_token=null,lease_until=null
   where id in(select outbox_id from private.staff_chat_delivery_guards where staff_id=target) and status in('PENDING','PROCESSING');
 end loop;
 return null;
end $$;
create trigger staff_chat_profile_invalidate after update or delete on public.staff_profiles
 for each row execute function private.invalidate_staff_chat_access();
create trigger staff_chat_grants_invalidate after insert or update or delete on public.staff_department_grants
 for each row execute function private.invalidate_staff_chat_access();
create trigger staff_chat_binding_invalidate after update or delete on private.staff_line_identities
 for each row execute function private.invalidate_staff_chat_access();
revoke all on function private.invalidate_staff_chat_access() from public,anon,authenticated;
grant execute on function private.invalidate_staff_chat_access() to service_role;

create function private.invalidate_all_staff_chat_access() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update private.staff_line_case_context set expires_at=least(expires_at,clock_timestamp());
 update private.staff_chat_commands set consumed_at=coalesce(consumed_at,clock_timestamp()) where consumed_at is null;
 update private.staff_action_tokens set consumed_at=coalesce(consumed_at,clock_timestamp()) where consumed_at is null;
 update private.message_outbox set status='SUPPRESSED',last_error_code='STAFF_CHAT_ACCESS_CHANGED',completed_at=clock_timestamp(),lease_token=null,lease_until=null
  where id in(select outbox_id from private.staff_chat_delivery_guards) and status in('PENDING','PROCESSING');
 return null;
end $$;
create trigger staff_chat_profile_truncate after truncate on public.staff_profiles for each statement execute function private.invalidate_all_staff_chat_access();
create trigger staff_chat_grants_truncate after truncate on public.staff_department_grants for each statement execute function private.invalidate_all_staff_chat_access();
create trigger staff_chat_binding_truncate after truncate on private.staff_line_identities for each statement execute function private.invalidate_all_staff_chat_access();
revoke all on function private.invalidate_all_staff_chat_access() from public,anon,authenticated;
grant execute on function private.invalidate_all_staff_chat_access() to service_role;
