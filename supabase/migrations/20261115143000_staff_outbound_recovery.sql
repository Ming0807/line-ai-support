-- CHAT-MEDIA-02D: a process crash between reservation and finalization can leave an expired
-- UPLOADING draft. Reconciliation reports it as FAILED/UPLOAD_INTERRUPTED; it never deletes
-- the private object and never extends or reclaims a lease.
alter table private.staff_outbound_attachments
 drop constraint staff_outbound_attachments_failure_code_check,
 add constraint staff_outbound_attachments_failure_code_check
  check(failure_code in('AUTHORITY_CHANGED','ATTEMPT_LIMIT','SOURCE_INTEGRITY','UPLOAD_INTERRUPTED'));

create index staff_outbound_uploading_lease_idx on private.staff_outbound_attachments(lease_until)
 where status='UPLOADING';

create or replace function private.guard_staff_outbound_attachment() returns trigger language plpgsql security invoker set search_path='' as $$
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
 -- Only an expired attempt may be reported as interrupted, and it keeps its attempt/object identity.
 if new.failure_code='UPLOAD_INTERRUPTED' and (old.lease_until>clock_timestamp() or
  new.attempts<>old.attempts or new.object_id is distinct from old.object_id) then
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
revoke all on function private.guard_staff_outbound_attachment() from public,anon,authenticated;
grant execute on function private.guard_staff_outbound_attachment() to service_role;
