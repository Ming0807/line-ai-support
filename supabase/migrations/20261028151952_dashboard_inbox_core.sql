-- CHAT04/05. Append-only ordering metadata; public.messages remains the transcript.
-- UTC prefix generated from the execution clock; local Supabase CLI is unavailable.
create table private.inbox_message_order (
 message_id uuid primary key references public.messages(id) on delete cascade,
 ticket_id uuid not null,
 conversation_id uuid not null,
 message_seq bigint generated always as identity unique,
 foreign key(ticket_id,conversation_id) references public.tickets(id,conversation_id) on delete cascade
);
create index inbox_message_ticket_seq on private.inbox_message_order(ticket_id,message_seq);
create table private.inbox_read_cursors (
 staff_id uuid not null references public.staff_profiles(id) on delete cascade,
 ticket_id uuid not null references public.tickets(id) on delete cascade,
 read_through_seq bigint not null default 0 check(read_through_seq>=0),
 primary key(staff_id,ticket_id)
);
create index inbox_read_ticket on private.inbox_read_cursors(ticket_id,staff_id);
create table private.inbox_notes (
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references public.tickets(id) on delete cascade,
 staff_id uuid not null references public.staff_profiles(id),
 request_id uuid not null,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 content_encrypted text not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(staff_id,ticket_id,request_id)
);
create index inbox_notes_ticket_created on private.inbox_notes(ticket_id,created_at,id);
-- One durable invalidation per changed case, not one per message/recipient.
create table private.inbox_refresh_pending (
 ticket_id uuid primary key references public.tickets(id) on delete cascade,
 changed_at timestamptz not null default clock_timestamp(),
 notified_at timestamptz
);
create table private.inbox_refresh_recipients (
 staff_id uuid primary key references public.staff_profiles(id) on delete cascade,
 changed_at timestamptz not null default clock_timestamp(),
 notified_at timestamptz
);
alter table private.inbox_message_order enable row level security;
alter table private.inbox_read_cursors enable row level security;
alter table private.inbox_notes enable row level security;
alter table private.inbox_refresh_pending enable row level security;
alter table private.inbox_refresh_recipients enable row level security;
revoke all on private.inbox_message_order,private.inbox_read_cursors,private.inbox_notes,private.inbox_refresh_pending from public,anon,authenticated;
revoke all on private.inbox_refresh_recipients from public,anon,authenticated;
grant select,insert on private.inbox_message_order,private.inbox_notes to service_role;
grant select,insert,update on private.inbox_read_cursors,private.inbox_refresh_pending to service_role;
grant select,insert,update on private.inbox_refresh_recipients to service_role;
grant usage,select on sequence private.inbox_message_order_message_seq_seq to service_role;

insert into private.inbox_message_order(message_id,ticket_id,conversation_id)
 select id,ticket_id,conversation_id from public.messages where ticket_id is not null order by created_at,id;

create function private.track_inbox_message() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if new.ticket_id is null then return new;end if;
 -- Same lane as the verified inbox/ticket writers; sequence visibility follows commit order.
 perform pg_advisory_xact_lock(hashtextextended('conversation:'||new.conversation_id::text,0));
 insert into private.inbox_message_order(message_id,ticket_id,conversation_id)
  values(new.id,new.ticket_id,new.conversation_id) on conflict(message_id) do nothing;
 if not exists(select 1 from private.inbox_message_order o where o.message_id=new.id and o.ticket_id=new.ticket_id and o.conversation_id=new.conversation_id)
 then raise exception 'INBOX_MESSAGE_OWNERSHIP_CHANGED';end if;
 insert into private.inbox_refresh_pending(ticket_id) values(new.ticket_id)
  on conflict(ticket_id) do update set changed_at=clock_timestamp();
 return new;
end $$;
create trigger inbox_message_insert after insert on public.messages for each row execute function private.track_inbox_message();
create trigger inbox_message_attach after update of ticket_id,content on public.messages for each row execute function private.track_inbox_message();

create function private.mark_inbox_ticket_changed() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare member record;
begin
 if new.ticket_id is not null then
  insert into private.inbox_refresh_pending(ticket_id) values(new.ticket_id)
   on conflict(ticket_id) do update set changed_at=clock_timestamp();
 end if;
 if tg_table_name='message_outbox' then
 if new.kind='BATCH' then
  for member in select b.ticket_id from private.incident_reply_cases b join private.incident_reply_recipients r on r.id=b.recipient_id and r.batch_id=b.batch_id
   where r.outbox_id=new.id order by b.ticket_id
  loop
   insert into private.inbox_refresh_pending(ticket_id)values(member.ticket_id)
    on conflict(ticket_id)do update set changed_at=clock_timestamp();
  end loop;
 end if;
 end if;
 return new;
end $$;
create trigger inbox_note_changed after insert on private.inbox_notes for each row execute function private.mark_inbox_ticket_changed();
create trigger inbox_delivery_changed after update of status on private.message_outbox for each row
 when(new.channel='STUDENT') execute function private.mark_inbox_ticket_changed();

create function private.mark_inbox_case_changed() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 insert into private.inbox_refresh_pending(ticket_id)values(new.id)
  on conflict(ticket_id)do update set changed_at=clock_timestamp();
 return new;
end $$;
create trigger inbox_case_changed after insert or update of status,assigned_staff_id,department_id,sensitive_level on public.tickets
 for each row execute function private.mark_inbox_case_changed();

-- No chat content/identity is broadcast. Every browser read still reloads current authorization.
create function private.flush_inbox_invalidations() returns integer
 language plpgsql security invoker set search_path='' as $$
declare item record;recipient record;sent integer=0;
begin
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return 0;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('inbox:realtime:flush',0)) then return 0;end if;
 -- Global pacing across worker processes; hints remain a best-effort accelerator.
 if exists(select 1 from private.inbox_refresh_recipients where notified_at>clock_timestamp()-interval '1 second') then return 0;end if;
 for item in select p.ticket_id from private.inbox_refresh_pending p
  where (p.notified_at is null or p.changed_at>p.notified_at)
   and (p.notified_at is null or p.notified_at<clock_timestamp()-interval '1 second')
  order by p.changed_at,p.ticket_id for update skip locked limit 25
 loop
  for recipient in select s.id from public.staff_profiles s join public.tickets t on t.id=item.ticket_id
   where s.active and (s.role='SUPER_ADMIN'
    or (s.role='ADMIN' and exists(select 1 from public.staff_department_grants g where g.staff_id=s.id and g.department_id=t.department_id))
    or(s.role in('STAFF','SUPERVISOR') and s.department_id=t.department_id))
    and(t.sensitive_level='GENERAL' or s.role='SUPER_ADMIN' or(t.sensitive_level='SENSITIVE' and s.can_view_sensitive) or(t.sensitive_level='RESTRICTED' and s.can_view_restricted))
   order by s.id
  loop
   insert into private.inbox_refresh_recipients(staff_id)values(recipient.id)
    on conflict(staff_id)do update set changed_at=clock_timestamp();
  end loop;
  update private.inbox_refresh_pending set notified_at=clock_timestamp() where ticket_id=item.ticket_id;
 end loop;
 for recipient in select p.staff_id from private.inbox_refresh_recipients p join public.staff_profiles s on s.id=p.staff_id and s.active
  where p.notified_at is null or p.changed_at>p.notified_at order by p.changed_at,p.staff_id for update of p skip locked limit 10
 loop
  execute 'select realtime.send($1,$2,$3,$4)' using '{"version":1}'::jsonb,'invalidate','staff:'||recipient.staff_id::text||':inbox',true;
  update private.inbox_refresh_recipients set notified_at=clock_timestamp() where staff_id=recipient.staff_id;sent=sent+1;
 end loop;
 return sent;
end $$;
revoke all on function private.track_inbox_message(),private.mark_inbox_ticket_changed(),private.mark_inbox_case_changed(),private.flush_inbox_invalidations() from public,anon,authenticated;
grant execute on function private.track_inbox_message(),private.mark_inbox_ticket_changed(),private.mark_inbox_case_changed(),private.flush_inbox_invalidations() to service_role;

-- The hosted Realtime schema is platform-owned; only add its permitted policy.
-- Owned unit databases intentionally do not bootstrap a fake Realtime service.
do $$begin
 if to_regclass('realtime.messages') is not null then
  execute $policy$create policy yru_staff_inbox_receive on realtime.messages for select to authenticated
   using(realtime.topic()='staff:'||(select auth.uid())::text||':inbox'
    and exists(select 1 from public.staff_profiles s where s.id=(select auth.uid()) and s.active))$policy$;
 end if;
end $$;
