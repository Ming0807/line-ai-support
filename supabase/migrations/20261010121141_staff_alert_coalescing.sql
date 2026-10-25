-- Ordinary alert deadlines live before transport; they never occupy a FIFO lane.
-- An incident may enter CRITICAL more than once. Membership/metadata edits do not create new episodes.
alter table public.incidents add column critical_alert_epoch bigint not null default 0 check(critical_alert_epoch>=0);
create function private.advance_incident_critical_alert_epoch() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.critical_alert_epoch:=case when new.severity='CRITICAL' then 1 else 0 end;
 else
  new.critical_alert_epoch:=old.critical_alert_epoch;
  if new.severity='CRITICAL' and (old.severity<>'CRITICAL'
   or (old.status not in('DETECTED','INVESTIGATING','MONITORING') and new.status in('DETECTED','INVESTIGATING','MONITORING'))) then
   new.critical_alert_epoch:=old.critical_alert_epoch+1;
  end if;
 end if;
 return new;
end $$;
create trigger incident_critical_alert_epoch before insert or update on public.incidents for each row execute function private.advance_incident_critical_alert_epoch();
revoke all on function private.advance_incident_critical_alert_epoch() from public,anon,authenticated;
grant execute on function private.advance_incident_critical_alert_epoch() to service_role;
alter table private.incident_rules add column alert_debounce_seconds smallint not null default 30
 check(alert_debounce_seconds between 0 and 300);
create table private.staff_alert_events (
 id uuid primary key default gen_random_uuid(),
 source_kind text not null check(source_kind in('NEW_CASE','CRITICAL_INCIDENT')),
 ticket_id uuid not null references public.tickets(id),
 incident_id uuid references public.incidents(id),
 source_revision bigint not null check(source_revision>=0),
 assignment_epoch bigint not null check(assignment_epoch>=0),
 staff_id uuid not null references public.staff_profiles(id),
 binding_hash text not null check(binding_hash~'^[a-f0-9]{64}$'),
 captured_at timestamptz not null, due_at timestamptz not null,
 status text not null default 'PENDING' check(status in('PENDING','QUEUED','SUPPRESSED')),
 outbox_id uuid references private.message_outbox(id), suppression_code text,
 completed_at timestamptz,
 check((source_kind='NEW_CASE' and incident_id is null) or (source_kind='CRITICAL_INCIDENT' and incident_id is not null)),
 check(due_at>=captured_at and due_at<=captured_at+interval '300 seconds'),
 check((status='PENDING' and outbox_id is null and suppression_code is null and completed_at is null)
  or (status='QUEUED' and outbox_id is not null and suppression_code is null and completed_at is not null)
  or (status='SUPPRESSED' and outbox_id is null and suppression_code in('ALERT_CONTEXT_CHANGED','STAFF_ALERT_ACCESS_CHANGED') and completed_at is not null))
);
create unique index staff_alert_case_source_unique on private.staff_alert_events(ticket_id,source_revision,staff_id) where source_kind='NEW_CASE';
create unique index staff_alert_critical_source_unique on private.staff_alert_events(incident_id,staff_id,source_revision) where source_kind='CRITICAL_INCIDENT';
create index staff_alert_pending_due_idx on private.staff_alert_events(due_at,id) where status='PENDING';
create index staff_alert_pending_recipient_idx on private.staff_alert_events(staff_id,binding_hash,ticket_id) where status='PENDING';
create index staff_alert_outbox_idx on private.staff_alert_events(outbox_id) where outbox_id is not null;
create index staff_alert_incident_idx on private.staff_alert_events(incident_id) where incident_id is not null;

create table private.staff_alert_deliveries (
 outbox_id uuid primary key references private.message_outbox(id),
 staff_id uuid not null references public.staff_profiles(id),
 binding_hash text not null check(binding_hash~'^[a-f0-9]{64}$'),
 incident_id uuid references public.incidents(id),
 kind text not null check(kind in('ALERT','DIGEST')),
 purpose text not null check(purpose in('NEW_CASES','CRITICAL_INCIDENT')),
 case_count integer not null check(case_count between 1 and 500),
 new_case_count integer not null check(new_case_count between 0 and case_count),
 alert_priority smallint not null default 0 check(alert_priority in(0,1)),
 proof_digest text not null check(proof_digest~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 check((kind='ALERT' and purpose='NEW_CASES' and case_count=1 and new_case_count=1)
  or (kind='DIGEST' and incident_id is not null and (purpose='CRITICAL_INCIDENT' or case_count>=2)))
);
create index staff_alert_delivery_staff_idx on private.staff_alert_deliveries(staff_id);
create index staff_alert_delivery_incident_idx on private.staff_alert_deliveries(incident_id) where incident_id is not null;
create table private.staff_alert_delivery_cases (
 outbox_id uuid not null references private.staff_alert_deliveries(outbox_id),
 ticket_id uuid not null references public.tickets(id),
 conversation_id uuid not null references public.conversations(id),
 ticket_revision bigint not null check(ticket_revision>=0),
 assignment_epoch bigint not null check(assignment_epoch>=0),
 primary key(outbox_id,ticket_id)
);
create index staff_alert_delivery_ticket_idx on private.staff_alert_delivery_cases(ticket_id);
create index staff_alert_delivery_conversation_idx on private.staff_alert_delivery_cases(conversation_id);
create function private.guard_staff_alert_event() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'UPDATE' then raise exception 'STAFF_ALERT_EVENT_RETAINED';end if;
 if old.status<>'PENDING' or new.status not in('QUEUED','SUPPRESSED')
  or (new.id,new.source_kind,new.ticket_id,new.incident_id,new.source_revision,new.assignment_epoch,new.staff_id,new.binding_hash,new.captured_at,new.due_at)
  is distinct from (old.id,old.source_kind,old.ticket_id,old.incident_id,old.source_revision,old.assignment_epoch,old.staff_id,old.binding_hash,old.captured_at,old.due_at) then
  raise exception 'STAFF_ALERT_EVENT_IMMUTABLE';end if;
 return new;
end $$;
create trigger staff_alert_event_guard before update or delete on private.staff_alert_events for each row execute function private.guard_staff_alert_event();
create trigger staff_alert_event_no_truncate before truncate on private.staff_alert_events for each statement execute function private.guard_staff_alert_event();
create function private.reject_staff_alert_mutation() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'STAFF_ALERT_DELIVERY_IMMUTABLE';end $$;
create trigger staff_alert_delivery_immutable before update or delete on private.staff_alert_deliveries for each row execute function private.reject_staff_alert_mutation();
create trigger staff_alert_delivery_case_immutable before update or delete on private.staff_alert_delivery_cases for each row execute function private.reject_staff_alert_mutation();
create trigger staff_alert_delivery_no_truncate before truncate on private.staff_alert_deliveries for each statement execute function private.reject_staff_alert_mutation();
create trigger staff_alert_delivery_case_no_truncate before truncate on private.staff_alert_delivery_cases for each statement execute function private.reject_staff_alert_mutation();
create function private.check_staff_alert_complete() returns trigger language plpgsql security invoker set search_path='' as $$
declare target uuid; h private.staff_alert_deliveries%rowtype;
begin
 if tg_table_name='staff_alert_events' then
  if new.status<>'QUEUED' then return null;end if;target:=new.outbox_id;
 else target:=new.outbox_id;end if;
 select * into h from private.staff_alert_deliveries where outbox_id=target;
 if not found or h.case_count<>(select count(*) from private.staff_alert_delivery_cases where outbox_id=target)
  or not exists(select 1 from private.message_outbox o where o.id=target and o.channel='STAFF' and o.kind=h.kind
   and o.recipient_staff_id=h.staff_id and o.alert_priority=h.alert_priority)
  or (h.alert_priority=1 and not exists(select 1 from private.staff_alert_delivery_cases c join public.tickets t on t.id=c.ticket_id
   where c.outbox_id=target and t.priority='CRITICAL') and not exists(select 1 from public.incidents i where i.id=h.incident_id
    and i.severity='CRITICAL' and i.status in('DETECTED','INVESTIGATING','MONITORING')))
  or h.new_case_count<>(select count(distinct ticket_id) from private.staff_alert_events where outbox_id=target and status='QUEUED' and source_kind='NEW_CASE')
  or not exists(select 1 from private.staff_alert_events where outbox_id=target and status='QUEUED')
  or (h.purpose='CRITICAL_INCIDENT' and not exists(select 1 from private.staff_alert_events e join public.incidents i on i.id=e.incident_id
   where e.outbox_id=target and e.status='QUEUED' and e.source_kind='CRITICAL_INCIDENT' and e.incident_id=h.incident_id
   and e.source_revision=i.critical_alert_epoch and i.severity='CRITICAL' and i.status in('DETECTED','INVESTIGATING','MONITORING')))
  or exists(select 1 from private.staff_alert_events e where e.outbox_id=target and
   (e.status<>'QUEUED' or e.staff_id<>h.staff_id or e.binding_hash<>h.binding_hash
    or (e.source_kind='NEW_CASE' and not exists(select 1 from private.staff_alert_delivery_cases c where c.outbox_id=target and c.ticket_id=e.ticket_id))
    or (e.source_kind='CRITICAL_INCIDENT' and (h.purpose<>'CRITICAL_INCIDENT' or e.incident_id is distinct from h.incident_id)))) then
  raise exception 'STAFF_ALERT_DELIVERY_INCOMPLETE';end if;
 return null;
end $$;
create constraint trigger staff_alert_header_complete after insert on private.staff_alert_deliveries deferrable initially deferred for each row execute function private.check_staff_alert_complete();
create constraint trigger staff_alert_cases_complete after insert on private.staff_alert_delivery_cases deferrable initially deferred for each row execute function private.check_staff_alert_complete();
create constraint trigger staff_alert_source_complete after update on private.staff_alert_events deferrable initially deferred for each row execute function private.check_staff_alert_complete();

alter table private.staff_alert_events enable row level security;
alter table private.staff_alert_deliveries enable row level security;
alter table private.staff_alert_delivery_cases enable row level security;
revoke all on private.staff_alert_events,private.staff_alert_deliveries,private.staff_alert_delivery_cases from public,anon,authenticated,service_role;
grant select,insert,update on private.staff_alert_events to service_role;
grant select,insert on private.staff_alert_deliveries,private.staff_alert_delivery_cases to service_role;
revoke all on function private.guard_staff_alert_event(),private.reject_staff_alert_mutation(),private.check_staff_alert_complete() from public,anon,authenticated;
grant execute on function private.guard_staff_alert_event(),private.reject_staff_alert_mutation(),private.check_staff_alert_complete() to service_role;

-- Access changes are sticky: restoring a permission/binding does not revive an old source or packet.
create function private.invalidate_staff_alert_access() returns trigger language plpgsql security invoker set search_path='' as $$
declare target uuid; previous_target uuid;
begin
 if tg_op='TRUNCATE' then
  update private.staff_alert_events set status='SUPPRESSED',suppression_code='STAFF_ALERT_ACCESS_CHANGED',completed_at=clock_timestamp() where status='PENDING';
  update private.message_outbox set status='SUPPRESSED',last_error_code='STAFF_ALERT_ACCESS_CHANGED',completed_at=clock_timestamp(),lease_token=null,lease_until=null
   where id in(select outbox_id from private.staff_alert_deliveries) and status in('PENDING','PROCESSING');
  return null;
 end if;
 if tg_table_name='staff_profiles' then target:=case when tg_op='DELETE' then old.id else new.id end;
 else target:=case when tg_op='DELETE' then old.staff_id else new.staff_id end;
  if tg_op='UPDATE' then previous_target:=old.staff_id;end if;
 end if;
 for target in select distinct v.id from (values(target),(previous_target)) v(id) where v.id is not null loop
  update private.staff_alert_events set status='SUPPRESSED',suppression_code='STAFF_ALERT_ACCESS_CHANGED',completed_at=clock_timestamp()
   where staff_id=target and status='PENDING';
  update private.message_outbox set status='SUPPRESSED',last_error_code='STAFF_ALERT_ACCESS_CHANGED',completed_at=clock_timestamp(),lease_token=null,lease_until=null
   where id in(select outbox_id from private.staff_alert_deliveries where staff_id=target) and status in('PENDING','PROCESSING');
 end loop;
 return null;
end $$;
create trigger staff_alert_profile_invalidate after update or delete on public.staff_profiles for each row execute function private.invalidate_staff_alert_access();
create trigger staff_alert_grants_invalidate after insert or update or delete on public.staff_department_grants for each row execute function private.invalidate_staff_alert_access();
create trigger staff_alert_binding_invalidate after update or delete on private.staff_line_identities for each row execute function private.invalidate_staff_alert_access();
create trigger staff_alert_profile_truncate_invalidate after truncate on public.staff_profiles for each statement execute function private.invalidate_staff_alert_access();
create trigger staff_alert_grants_truncate_invalidate after truncate on public.staff_department_grants for each statement execute function private.invalidate_staff_alert_access();
create trigger staff_alert_binding_truncate_invalidate after truncate on private.staff_line_identities for each statement execute function private.invalidate_staff_alert_access();
revoke all on function private.invalidate_staff_alert_access() from public,anon,authenticated;
grant execute on function private.invalidate_staff_alert_access() to service_role;

alter table private.message_outbox add column alert_priority smallint not null default 0 check(alert_priority in(0,1));
alter table private.message_outbox add constraint outbox_alert_priority_check check(alert_priority=0 or (channel='STAFF' and kind in('ALERT','DIGEST')));
alter table private.message_outbox drop constraint message_outbox_kind_check;
alter table private.message_outbox drop constraint outbox_channel_kind_check;
alter table private.message_outbox drop constraint outbox_target_check;
alter table private.message_outbox add constraint message_outbox_kind_check check(kind in('AI','STAFF','SYSTEM','NOTIFICATION','CHAT','CONTROL','BATCH','ALERT','DIGEST'));
alter table private.message_outbox add constraint outbox_channel_kind_check check(
 (channel='STUDENT' and kind in('AI','STAFF','SYSTEM','BATCH')) or (channel='STAFF' and kind in('NOTIFICATION','CHAT','CONTROL','ALERT','DIGEST')));
alter table private.message_outbox add constraint outbox_target_check check(
 (channel='STUDENT' and line_session_id is not null and recipient_staff_id is null)
 or (channel='STAFF' and recipient_staff_id is not null and line_session_id is null and conversation_id is null and delivery_mode='PUSH'
  and ((kind='CONTROL' and ticket_id is null) or (kind in('NOTIFICATION','CHAT','ALERT','DIGEST') and ticket_id is not null))));
create or replace function private.claim_outbox(target_channel text) returns setof private.message_outbox
 language plpgsql security invoker set search_path='' as $$
begin
 update private.message_outbox set status='UNKNOWN',last_error_code='REPLY_LEASE_LOST',lease_token=null,lease_until=null,completed_at=clock_timestamp()
 where channel=target_channel and delivery_mode='REPLY' and attempts>0 and status='PROCESSING' and lease_until<=clock_timestamp();
 update private.message_outbox set status='DEAD',last_error_code='DELIVERY_EXHAUSTED',lease_token=null,lease_until=null,completed_at=clock_timestamp()
 where channel=target_channel and status in('PENDING','PROCESSING') and (status='PENDING' or lease_until<=clock_timestamp())
 and (attempts>=attempt_limit or (first_attempt_at is not null and first_attempt_at<=clock_timestamp()-interval '24 hours'));
 return query with candidate as (
  select o.id from private.message_outbox o where o.channel=target_channel and o.attempts<o.attempt_limit
  and o.available_at<=clock_timestamp() and (o.status='PENDING' or (o.status='PROCESSING' and o.lease_until<=clock_timestamp()))
  and not exists(select 1 from private.message_outbox prior where prior.channel=o.channel
   and coalesce(prior.line_session_id,prior.recipient_staff_id)=coalesce(o.line_session_id,o.recipient_staff_id)
   and prior.outbox_seq<o.outbox_seq and prior.status in('PENDING','PROCESSING')
   and not(o.channel='STAFF' and o.kind in('ALERT','DIGEST') and o.alert_priority=1 and prior.status='PENDING' and prior.alert_priority=0
    and exists(select 1 from private.staff_alert_deliveries h left join public.incidents i on i.id=h.incident_id
     where h.outbox_id=o.id and h.staff_id=o.recipient_staff_id and h.kind=o.kind and h.alert_priority=1
      and not exists(select 1 from private.staff_alert_delivery_cases f left join public.tickets t on t.id=f.ticket_id
       left join public.conversations v on v.id=t.conversation_id where f.outbox_id=o.id and
        (t.id is null or (t.conversation_id=f.conversation_id and t.revision=f.ticket_revision and t.staff_line_epoch=f.assignment_epoch
         and t.mode='HUMAN' and v.mode='HUMAN' and v.active_ticket_id=t.id and v.status in('ACTIVE','WAITING')
         and t.status in('WAITING_STAFF','STAFF_HANDLING','WAITING_USER')
         and (not exists(select 1 from private.staff_alert_events e where e.outbox_id=o.id and e.source_kind='NEW_CASE' and e.ticket_id=t.id)
          or (t.status='WAITING_STAFF' and t.assigned_staff_id is null))) is not true))
      and (h.purpose='NEW_CASES' or (i.severity='CRITICAL' and i.status in('DETECTED','INVESTIGATING','MONITORING')
       and exists(select 1 from private.staff_alert_events e where e.outbox_id=o.id and e.status='QUEUED'
        and e.source_kind='CRITICAL_INCIDENT' and e.incident_id=i.id and e.source_revision=i.critical_alert_epoch)))
      and (exists(select 1 from public.tickets t where t.id=o.ticket_id and t.priority='CRITICAL')
       or (i.severity='CRITICAL' and i.status in('DETECTED','INVESTIGATING','MONITORING'))))
    and (prior.kind in('ALERT','DIGEST') or (prior.kind='NOTIFICATION' and exists(select 1 from public.tickets t where t.id=prior.ticket_id and t.priority<>'CRITICAL')
     and not exists(select 1 from public.incident_tickets m join public.incidents i on i.id=m.incident_id
      where m.ticket_id=prior.ticket_id and i.severity='CRITICAL' and i.status in('DETECTED','INVESTIGATING','MONITORING'))))))
  order by o.alert_priority desc,o.outbox_seq for update of o skip locked limit 1
 ) update private.message_outbox o set status='PROCESSING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
 from candidate c where o.id=c.id returning o.*;
end $$;
