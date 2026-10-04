alter table public.tickets add column revision integer not null default 0 check (revision>=0);
alter table public.conversations add column revision integer not null default 0 check (revision>=0);
alter table public.ticket_history add column history_seq bigint generated always as identity unique;
create index ticket_history_sequence_idx on public.ticket_history(ticket_id,history_seq);
revoke all on sequence public.ticket_history_history_seq_seq from public,anon,authenticated;
grant usage,select on sequence public.ticket_history_history_seq_seq to service_role;

create table private.activities (
 id uuid primary key default gen_random_uuid(),ticket_id uuid references public.tickets(id),
 actor_id uuid references public.staff_profiles(id),action text not null,
 metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default clock_timestamp()
);
create index activities_ticket_idx on private.activities(ticket_id,created_at);
create table private.ticket_action_receipts (
 staff_id uuid not null references public.staff_profiles(id),ticket_id uuid not null references public.tickets(id),
 action text not null,request_id uuid not null,payload_hash text not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(staff_id,ticket_id,action,request_id)
);
create index ticket_receipts_ticket_idx on private.ticket_action_receipts(ticket_id);
create table private.pending_route_choices (
 token_hash text primary key,line_session_id uuid not null references public.line_sessions(id),
 choice jsonb not null,candidate_snapshot jsonb not null,pending_message_id uuid references public.messages(id),
 expires_at timestamptz not null,consumed_at timestamptz,created_at timestamptz not null default clock_timestamp()
);
create index route_choices_session_idx on private.pending_route_choices(line_session_id,expires_at) where consumed_at is null;
create index route_choices_message_idx on private.pending_route_choices(pending_message_id);
create table private.staff_line_identities (
 staff_id uuid primary key references public.staff_profiles(id),user_hash text not null unique,
 user_id_encrypted text not null,active boolean not null default true,created_at timestamptz not null default clock_timestamp()
);
create table private.staff_action_tokens (
 token_hash text primary key,staff_id uuid not null references public.staff_profiles(id),ticket_id uuid not null references public.tickets(id),
 action text not null check(action in ('ACCEPT')),expected_revision integer not null,expires_at timestamptz not null,consumed_at timestamptz
);
create index staff_tokens_staff_idx on private.staff_action_tokens(staff_id,expires_at) where consumed_at is null;
create index staff_tokens_ticket_idx on private.staff_action_tokens(ticket_id);

alter table private.message_outbox drop constraint message_outbox_status_check;
alter table private.message_outbox add constraint message_outbox_status_check
 check(status in ('PENDING','PROCESSING','SENT','DEAD','SUPPRESSED','UNKNOWN'));
alter table private.message_outbox add column recipient_staff_id uuid references public.staff_profiles(id);
alter table private.message_outbox add column delivery_mode text not null default 'PUSH' check(delivery_mode in ('REPLY','PUSH'));
alter table private.message_outbox add column reply_deadline_at timestamptz;
alter table private.message_outbox add column expected_conversation_revision integer;
alter table private.message_outbox add column recipient_user_id_encrypted text;
alter table private.message_outbox add column processing_failures integer not null default 0 check(processing_failures>=0);
alter table private.message_outbox add column outbox_seq bigint generated always as identity unique;
alter table private.message_outbox add constraint outbox_target_check check(
 (channel='STUDENT' and line_session_id is not null and recipient_staff_id is null)
 or (channel='STAFF' and recipient_staff_id is not null and ticket_id is not null and line_session_id is null and conversation_id is null and delivery_mode='PUSH'));
alter table private.message_outbox add constraint outbox_channel_kind_check check(
 (channel='STUDENT' and kind in ('AI','STAFF','SYSTEM')) or (channel='STAFF' and kind='NOTIFICATION'));
alter table private.message_outbox add constraint outbox_conversation_session_fk
 foreign key(conversation_id,line_session_id) references public.conversations(id,line_session_id);
alter table private.message_outbox add constraint outbox_ticket_conversation_fk
 foreign key(ticket_id,conversation_id) references public.tickets(id,conversation_id);
create index outbox_staff_idx on private.message_outbox(recipient_staff_id);
create index outbox_lane_idx on private.message_outbox(channel,coalesce(line_session_id,recipient_staff_id),outbox_seq)
 where status in ('PENDING','PROCESSING');
grant usage,select on sequence private.message_outbox_outbox_seq_seq to service_role;

create function private.claim_outbox(target_channel text) returns setof private.message_outbox
 language plpgsql security invoker set search_path='' as $$
begin
 -- A lost Reply attempt is ambiguous: its single-use token must never be retried.
 update private.message_outbox set status='UNKNOWN',last_error_code='REPLY_LEASE_LOST',lease_token=null,lease_until=null,completed_at=clock_timestamp()
 where channel=target_channel and delivery_mode='REPLY' and attempts>0 and status='PROCESSING' and lease_until<=clock_timestamp();
 update private.message_outbox set status='DEAD',last_error_code='DELIVERY_EXHAUSTED',lease_token=null,lease_until=null,completed_at=clock_timestamp()
 where channel=target_channel and status in ('PENDING','PROCESSING')
 and (status='PENDING' or lease_until<=clock_timestamp())
 and (attempts>=5 or (first_attempt_at is not null and first_attempt_at<=clock_timestamp()-interval '24 hours'));
 return query
 with candidate as (
 select o.id from private.message_outbox o where o.channel=target_channel and o.attempts<5
 and o.available_at<=clock_timestamp() and (o.status='PENDING' or (o.status='PROCESSING' and o.lease_until<=clock_timestamp()))
 and not exists(select 1 from private.message_outbox prior where prior.channel=o.channel
 and coalesce(prior.line_session_id,prior.recipient_staff_id)=coalesce(o.line_session_id,o.recipient_staff_id)
 and prior.outbox_seq<o.outbox_seq and prior.status in ('PENDING','PROCESSING'))
 order by o.outbox_seq for update of o skip locked limit 1
 )
 update private.message_outbox o set status='PROCESSING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
 from candidate c where o.id=c.id returning o.*;
end $$;
revoke all on function private.claim_outbox(text) from public,anon,authenticated;
grant execute on function private.claim_outbox(text) to service_role;

alter table private.activities enable row level security;
alter table private.ticket_action_receipts enable row level security;
alter table private.pending_route_choices enable row level security;
alter table private.staff_line_identities enable row level security;
alter table private.staff_action_tokens enable row level security;
revoke all on private.activities,private.ticket_action_receipts,private.pending_route_choices,private.staff_line_identities,private.staff_action_tokens from public,anon,authenticated;
grant all on private.activities,private.ticket_action_receipts,private.pending_route_choices,private.staff_line_identities,private.staff_action_tokens to service_role;
