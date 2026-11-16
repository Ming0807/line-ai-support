-- CHAT-MEDIA-02F: a Staff confirmation binds one READY private draft to exactly one Staff message and
-- one STAFF outbox row created by the existing STAFF_REPLY transition. Additive and append-only; the
-- draft row itself stays immutable. Delivery truth remains the outbox status (only SENT may be viewed).
create table private.staff_outbound_deliveries(
 attachment_id uuid primary key references private.staff_outbound_attachments(id),
 staff_id uuid not null references public.staff_profiles(id),
 ticket_id uuid not null references public.tickets(id),
 request_id uuid not null,
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 message_id uuid not null unique references public.messages(id),
 outbox_id uuid not null unique references private.message_outbox(id),
 confirmed_revision integer not null check(confirmed_revision>=0),
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(staff_id,ticket_id,request_id)
);
create index staff_outbound_deliveries_ticket_idx on private.staff_outbound_deliveries(ticket_id);
alter table private.staff_outbound_deliveries enable row level security;
revoke all on private.staff_outbound_deliveries from public,anon,authenticated;
grant select,insert on private.staff_outbound_deliveries to service_role;

create function private.guard_staff_outbound_delivery() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='STAFF_OUTBOUND_DELIVERY_IMMUTABLE';
 end if;
 if not exists(select 1 from private.staff_outbound_attachments a
   join public.messages m on m.id=new.message_id
   join private.message_outbox o on o.id=new.outbox_id
   where a.id=new.attachment_id and a.status='READY' and a.staff_id=new.staff_id and a.ticket_id=new.ticket_id
    and m.ticket_id=a.ticket_id and m.conversation_id=a.conversation_id and m.sender_type='STAFF' and m.sender_staff_id=new.staff_id
    and o.ticket_id=a.ticket_id and o.conversation_id=a.conversation_id and o.line_session_id=a.line_session_id
    and o.kind='STAFF' and o.channel='STUDENT') then
  raise exception using errcode='23514',message='STAFF_OUTBOUND_DELIVERY_INVALID';
 end if;
 return new;
end $$;
create trigger staff_outbound_delivery_guard before insert or update or delete on private.staff_outbound_deliveries
 for each row execute function private.guard_staff_outbound_delivery();
revoke all on function private.guard_staff_outbound_delivery() from public,anon,authenticated;
grant execute on function private.guard_staff_outbound_delivery() to service_role;
