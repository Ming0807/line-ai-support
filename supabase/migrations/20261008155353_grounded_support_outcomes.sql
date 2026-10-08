-- Fixed support infrastructure; source facts remain encrypted and backend-owned.
alter table public.messages add constraint messages_support_owner_key unique(id,conversation_id);
alter table private.ai_jobs add constraint ai_jobs_support_source_key unique(id,conversation_id,message_id);
alter table private.message_outbox add constraint outbox_support_owner_key unique(id,conversation_id,line_session_id);
create table private.ai_support_state (
 conversation_id uuid primary key,line_session_id uuid not null,last_message_id uuid not null,ai_job_id uuid not null,
 conversation_revision integer not null check(conversation_revision>=0),
 source_digest text not null check(source_digest ~ '^[a-f0-9]{64}$'),
 directory_digest text not null check(directory_digest ~ '^[a-f0-9]{64}$'),
 state_digest text not null check(state_digest ~ '^[a-f0-9]{64}$'),
 context_encrypted text not null check(context_encrypted like 'v1.%' and length(context_encrypted) between 40 and 100000),
 guidance_outbox_id uuid,department_id uuid references public.departments(id),
 sensitive_level text not null check(sensitive_level in ('GENERAL','SENSITIVE','RESTRICTED')),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(conversation_id,line_session_id) references public.conversations(id,line_session_id),
 foreign key(last_message_id,conversation_id) references public.messages(id,conversation_id),
 foreign key(ai_job_id,conversation_id,last_message_id) references private.ai_jobs(id,conversation_id,message_id),
 foreign key(guidance_outbox_id,conversation_id,line_session_id) references private.message_outbox(id,conversation_id,line_session_id)
);
create index support_state_session_idx on private.ai_support_state(line_session_id);
create index support_state_owner_idx on private.ai_support_state(conversation_id,line_session_id);
create index support_state_message_idx on private.ai_support_state(last_message_id,conversation_id);
create index support_state_job_idx on private.ai_support_state(ai_job_id,conversation_id,last_message_id);
create index support_state_guidance_idx on private.ai_support_state(guidance_outbox_id,conversation_id,line_session_id) where guidance_outbox_id is not null;
create index support_state_department_idx on private.ai_support_state(department_id) where department_id is not null;
create table private.ticket_support_contexts (
 ticket_id uuid primary key,conversation_id uuid not null,line_session_id uuid not null,
 source_digest text not null check(source_digest ~ '^[a-f0-9]{64}$'),
 state_digest text not null check(state_digest ~ '^[a-f0-9]{64}$'),
 context_encrypted text not null check(context_encrypted like 'v1.%' and length(context_encrypted) between 40 and 100000),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(ticket_id,conversation_id) references public.tickets(id,conversation_id),
 foreign key(conversation_id,line_session_id) references public.conversations(id,line_session_id)
);
create index ticket_support_ticket_idx on private.ticket_support_contexts(ticket_id,conversation_id);
create index ticket_support_conversation_idx on private.ticket_support_contexts(conversation_id,line_session_id);
create index ticket_support_session_idx on private.ticket_support_contexts(line_session_id);
create table private.ai_support_outcomes (
 conversation_id uuid primary key,line_session_id uuid not null,last_message_id uuid not null,
 confirmation_event_id uuid not null unique references private.webhook_inbox(id),
 state_digest text not null check(state_digest ~ '^[a-f0-9]{64}$'),
 kind text not null check(kind in ('USER_CONFIRMED_SOLVED','USER_CONFIRMED_ESCALATED')),
 department_id uuid references public.departments(id),
 sensitive_level text not null check(sensitive_level in ('GENERAL','SENSITIVE','RESTRICTED')),
 ticket_id uuid,observed_at timestamptz not null default clock_timestamp(),
 foreign key(conversation_id,line_session_id) references public.conversations(id,line_session_id),
 foreign key(last_message_id,conversation_id) references public.messages(id,conversation_id),
 foreign key(ticket_id,conversation_id) references public.tickets(id,conversation_id),
 check((kind='USER_CONFIRMED_SOLVED' and ticket_id is null) or (kind='USER_CONFIRMED_ESCALATED' and ticket_id is not null))
);
create index support_outcome_session_idx on private.ai_support_outcomes(line_session_id);
create index support_outcome_owner_idx on private.ai_support_outcomes(conversation_id,line_session_id);
create index support_outcome_message_idx on private.ai_support_outcomes(last_message_id,conversation_id);
create index support_outcome_ticket_idx on private.ai_support_outcomes(ticket_id,conversation_id) where ticket_id is not null;
create index support_outcome_scope_time_idx on private.ai_support_outcomes(department_id,sensitive_level,observed_at);
create index support_outcome_time_idx on private.ai_support_outcomes(observed_at);
create function private.reject_support_receipt_mutation() returns trigger
 language plpgsql security invoker set search_path='' as $$begin raise exception 'SUPPORT_RECEIPT_IMMUTABLE';end $$;
revoke all on function private.reject_support_receipt_mutation() from public,anon,authenticated;
grant execute on function private.reject_support_receipt_mutation() to service_role;
create trigger immutable_ticket_support before update or delete on private.ticket_support_contexts for each row execute function private.reject_support_receipt_mutation();
create trigger immutable_support_outcome before update or delete on private.ai_support_outcomes for each row execute function private.reject_support_receipt_mutation();
alter table private.ai_support_state enable row level security;
alter table private.ticket_support_contexts enable row level security;
alter table private.ai_support_outcomes enable row level security;
revoke all on private.ai_support_state,private.ticket_support_contexts,private.ai_support_outcomes from public,anon,authenticated;
grant select,insert,update,delete on private.ai_support_state to service_role;
grant select,insert on private.ticket_support_contexts,private.ai_support_outcomes to service_role;
