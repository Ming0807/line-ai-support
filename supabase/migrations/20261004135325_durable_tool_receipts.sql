create table private.ai_tool_receipts (
 confirmation_event_id uuid primary key references private.webhook_inbox(id),
 line_session_id uuid not null references public.line_sessions(id),conversation_id uuid not null,
 tool_name text not null check(tool_name='create_ticket'),
 request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
 result_encrypted text not null check(result_encrypted like 'v1.%' and length(result_encrypted) between 40 and 10000),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(conversation_id,line_session_id) references public.conversations(id,line_session_id)
);
create index ai_tool_receipts_session_idx on private.ai_tool_receipts(line_session_id);
create index ai_tool_receipts_conversation_idx on private.ai_tool_receipts(conversation_id);
alter table private.ai_tool_receipts enable row level security;
revoke all on private.ai_tool_receipts from public,anon,authenticated;
grant all on private.ai_tool_receipts to service_role;
