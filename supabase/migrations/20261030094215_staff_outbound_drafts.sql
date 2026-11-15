-- Staff drafts are separate from Student-webhook attachments; no browser grants.
create table private.staff_outbound_attachments(
 id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references public.staff_profiles(id),
 ticket_id uuid not null,conversation_id uuid not null,line_session_id uuid not null,
 recipient_hash text not null check(recipient_hash~'^[a-f0-9]{64}$'),
 ticket_revision integer not null check(ticket_revision>=0),assignment_epoch bigint not null check(assignment_epoch>=0),
 request_id uuid not null,request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 name_encrypted text not null,mime_type text not null check(mime_type in('image/jpeg','image/png','application/pdf')),
 byte_length integer not null check(byte_length between 1 and 10485760),checksum text not null check(checksum~'^[a-f0-9]{64}$'),
 status text not null check(status in('UPLOADING','READY','FAILED')),
 failure_code text check(failure_code in('AUTHORITY_CHANGED','ATTEMPT_LIMIT','SOURCE_INTEGRITY')),
 attempts integer not null check(attempts between 1 and 3),lease_token uuid,lease_until timestamptz,object_id uuid not null,
 ready_at timestamptz,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(staff_id,ticket_id,request_id),
 foreign key(ticket_id,conversation_id) references public.tickets(id,conversation_id),
 foreign key(conversation_id,line_session_id) references public.conversations(id,line_session_id),
 check((status='UPLOADING' and lease_token is not null and lease_until is not null) or
  (status<>'UPLOADING' and lease_token is null and lease_until is null)),
 check(status<>'UPLOADING' or object_id=lease_token),
 check((status='READY')=(ready_at is not null)),check((status='FAILED')=(failure_code is not null))
);
create index staff_outbound_ticket_idx on private.staff_outbound_attachments(ticket_id,conversation_id);
create index staff_outbound_conversation_idx on private.staff_outbound_attachments(conversation_id,line_session_id);
alter table private.staff_outbound_attachments enable row level security;
revoke all on private.staff_outbound_attachments from public,anon,authenticated;
grant select,insert,update on private.staff_outbound_attachments to service_role;

create function private.guard_staff_outbound_attachment() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.status<>'UPLOADING' or new.attempts<>1 or new.lease_token is null or new.lease_until is null or
   new.lease_until<=clock_timestamp() or new.lease_until>clock_timestamp()+interval '90 seconds' or
   new.object_id is distinct from new.lease_token or new.ready_at is not null or new.failure_code is not null then
   raise exception using errcode='23514',message='STAFF_OUTBOUND_INITIAL_STATE_INVALID';
  end if;
  return new;
 end if;
 if (new.id,new.staff_id,new.ticket_id,new.conversation_id,new.line_session_id,new.recipient_hash,new.ticket_revision,new.assignment_epoch,
  new.request_id,new.request_hash,new.name_encrypted,new.mime_type,new.byte_length,new.checksum,new.created_at)
  is distinct from (old.id,old.staff_id,old.ticket_id,old.conversation_id,old.line_session_id,old.recipient_hash,old.ticket_revision,old.assignment_epoch,
  old.request_id,old.request_hash,old.name_encrypted,old.mime_type,old.byte_length,old.checksum,old.created_at) then
  raise exception using errcode='23514',message='STAFF_OUTBOUND_SOURCE_IMMUTABLE';
 end if;
 if old.status<>'UPLOADING' then raise exception using errcode='23514',message='STAFF_OUTBOUND_TERMINAL';end if;
 if new.failure_code='ATTEMPT_LIMIT' and (old.attempts<>3 or old.lease_until>clock_timestamp()) then
  raise exception using errcode='23514',message='STAFF_OUTBOUND_ATTEMPT_INVALID';end if;
 if new.attempts<old.attempts or new.attempts>old.attempts+1 or
  (new.attempts=old.attempts and new.object_id is distinct from old.object_id) or
  (new.attempts=old.attempts and new.status='UPLOADING' and new.lease_until>old.lease_until) or
  (new.attempts=old.attempts+1 and (new.status<>'UPLOADING' or new.object_id=old.object_id or old.lease_until>clock_timestamp() or
   new.lease_until<=clock_timestamp() or new.lease_until>clock_timestamp()+interval '90 seconds')) then
  raise exception using errcode='23514',message='STAFF_OUTBOUND_ATTEMPT_INVALID';
 end if;
 new.updated_at:=clock_timestamp();return new;
end $$;
create trigger staff_outbound_guard before insert or update on private.staff_outbound_attachments
 for each row execute function private.guard_staff_outbound_attachment();
revoke all on function private.guard_staff_outbound_attachment() from public,anon,authenticated;
grant execute on function private.guard_staff_outbound_attachment() to service_role;
