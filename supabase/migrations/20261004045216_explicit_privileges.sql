-- Replay correctly even on projects that auto-grant Data API privileges.
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to authenticated,service_role;
revoke all on all tables in schema private from public,anon,authenticated;
grant all on all tables in schema private to service_role;
grant usage,select on all sequences in schema private to service_role;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_active_staff(),private.can_access_scope(uuid,text),private.can_access_ticket(uuid),private.can_access_conversation(uuid) to authenticated,service_role;
grant execute on function private.claim_inbox(text) to service_role;
revoke all on public.departments,public.staff_profiles,public.line_sessions,public.conversations,public.tickets,public.messages,public.ticket_history from anon,authenticated;
grant select on public.departments,public.staff_profiles,public.line_sessions,public.conversations,public.tickets,public.messages,public.ticket_history to authenticated;
grant all on public.departments,public.staff_profiles,public.line_sessions,public.conversations,public.tickets,public.messages,public.ticket_history to service_role;
revoke all on all sequences in schema public from anon,authenticated;
grant usage,select on sequence public.tickets_ticket_seq_seq to service_role;
