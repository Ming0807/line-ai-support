-- Fixed private audited batches; no category-wide recipient selection or network in SQL.
create table private.incident_reply_batches (
 id uuid primary key default gen_random_uuid(),incident_id uuid not null references public.incidents(id),
 staff_id uuid not null references public.staff_profiles(id),request_id uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),prepared_encrypted text not null,
 case_count smallint not null check(case_count between 1 and 100),
 recipient_count smallint not null check(recipient_count between 1 and case_count),
 created_at timestamptz not null default clock_timestamp(),unique(staff_id,request_id)
);
create index incident_reply_batch_incident_idx on private.incident_reply_batches(incident_id,created_at);
create table private.incident_reply_recipients (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references private.incident_reply_batches(id),
 recipient_code text not null check(recipient_code ~ '^R([1-9][0-9]?|100)$'),
 line_session_id uuid not null references public.line_sessions(id),
 outbox_id uuid not null unique references private.message_outbox(id),
 packet_digest text not null check(packet_digest ~ '^[a-f0-9]{64}$'),
 case_count smallint not null check(case_count between 1 and 100),
 unique(batch_id,recipient_code),unique(batch_id,line_session_id),unique(batch_id,id)
);
create index incident_reply_recipient_session_idx on private.incident_reply_recipients(line_session_id);
create table private.incident_reply_cases (
 batch_id uuid not null references private.incident_reply_batches(id),
 ticket_id uuid not null references public.tickets(id),recipient_id uuid not null,
 conversation_id uuid not null references public.conversations(id),
 ticket_code text not null check(length(ticket_code) between 1 and 100),
 reporter_label text not null check(length(reporter_label) between 1 and 200),
 staff_message_id uuid not null unique references public.messages(id),
 assignment_epoch bigint not null check(assignment_epoch>=0),
 primary key(batch_id,ticket_id),
 foreign key(batch_id,recipient_id) references private.incident_reply_recipients(batch_id,id)
);
create index incident_reply_case_ticket_idx on private.incident_reply_cases(ticket_id);
create index incident_reply_case_conversation_idx on private.incident_reply_cases(conversation_id);
create index incident_reply_case_recipient_idx on private.incident_reply_cases(batch_id,recipient_id);
create table private.incident_reply_retry_receipts (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references private.incident_reply_batches(id),
 staff_id uuid not null references public.staff_profiles(id),request_id uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 recipient_codes text[] not null check(cardinality(recipient_codes) between 1 and 100),
 created_at timestamptz not null default clock_timestamp(),unique(staff_id,request_id)
);
create index incident_reply_retry_batch_idx on private.incident_reply_retry_receipts(batch_id);

create function private.reject_incident_batch_mutation() returns trigger
 language plpgsql security invoker set search_path='' as $$begin raise exception 'INCIDENT_BATCH_IMMUTABLE';end $$;
create trigger incident_batch_immutable before update or delete on private.incident_reply_batches for each row execute function private.reject_incident_batch_mutation();
create trigger incident_recipient_immutable before update or delete on private.incident_reply_recipients for each row execute function private.reject_incident_batch_mutation();
create trigger incident_case_immutable before update or delete on private.incident_reply_cases for each row execute function private.reject_incident_batch_mutation();
create trigger incident_batch_no_truncate before truncate on private.incident_reply_batches for each statement execute function private.reject_incident_batch_mutation();
create trigger incident_recipient_no_truncate before truncate on private.incident_reply_recipients for each statement execute function private.reject_incident_batch_mutation();
create trigger incident_case_no_truncate before truncate on private.incident_reply_cases for each statement execute function private.reject_incident_batch_mutation();
create trigger incident_retry_immutable before update or delete on private.incident_reply_retry_receipts for each row execute function private.reject_incident_batch_mutation();
create trigger incident_retry_no_truncate before truncate on private.incident_reply_retry_receipts for each statement execute function private.reject_incident_batch_mutation();

-- Deferred completeness means a committed header can never describe a partial recipient set.
create function private.check_incident_batch_complete() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare target uuid; header private.incident_reply_batches%rowtype;
begin
 if tg_table_name='incident_reply_batches' then target:=new.id;else target:=new.batch_id;end if;
 select * into header from private.incident_reply_batches where id=target;
 if not found or header.case_count<>(select count(*) from private.incident_reply_cases where batch_id=target)
  or header.recipient_count<>(select count(*) from private.incident_reply_recipients where batch_id=target)
  or exists(select 1 from private.incident_reply_recipients r where r.batch_id=target
   and r.case_count<>(select count(*) from private.incident_reply_cases c where c.batch_id=target and c.recipient_id=r.id)) then
  raise exception 'INCIDENT_BATCH_INCOMPLETE';
 end if;
 return null;
end $$;
create constraint trigger incident_batch_complete after insert on private.incident_reply_batches deferrable initially deferred for each row execute function private.check_incident_batch_complete();
create constraint trigger incident_recipient_complete after insert on private.incident_reply_recipients deferrable initially deferred for each row execute function private.check_incident_batch_complete();
create constraint trigger incident_case_complete after insert on private.incident_reply_cases deferrable initially deferred for each row execute function private.check_incident_batch_complete();

alter table private.incident_reply_batches enable row level security;
alter table private.incident_reply_recipients enable row level security;
alter table private.incident_reply_cases enable row level security;
alter table private.incident_reply_retry_receipts enable row level security;
revoke all on private.incident_reply_batches,private.incident_reply_recipients,private.incident_reply_cases from public,anon,authenticated,service_role;
grant select,insert on private.incident_reply_batches,private.incident_reply_recipients,private.incident_reply_cases to service_role;
revoke all on private.incident_reply_retry_receipts from public,anon,authenticated,service_role;
grant select,insert on private.incident_reply_retry_receipts to service_role;
revoke all on function private.reject_incident_batch_mutation(),private.check_incident_batch_complete() from public,anon,authenticated;
grant execute on function private.reject_incident_batch_mutation(),private.check_incident_batch_complete() to service_role;

alter table private.message_outbox drop constraint message_outbox_kind_check;
alter table private.message_outbox drop constraint outbox_channel_kind_check;
alter table private.message_outbox add constraint message_outbox_kind_check check(kind in('AI','STAFF','SYSTEM','NOTIFICATION','CHAT','CONTROL','BATCH'));
alter table private.message_outbox add constraint outbox_channel_kind_check check(
 (channel='STUDENT' and kind in('AI','STAFF','SYSTEM','BATCH')) or (channel='STAFF' and kind in('NOTIFICATION','CHAT','CONTROL')));

-- Original automatic budget stays five. Each explicit reviewed batch retry grants
-- one additional attempt, up to ten; attempt counters and the24h window never reset.
alter table private.message_outbox add column attempt_limit smallint not null default 5 check(attempt_limit between 5 and 10);
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
   and prior.outbox_seq<o.outbox_seq and prior.status in('PENDING','PROCESSING'))
  order by o.outbox_seq for update of o skip locked limit 1
 ) update private.message_outbox o set status='PROCESSING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
 from candidate c where o.id=c.id returning o.*;
end $$;
