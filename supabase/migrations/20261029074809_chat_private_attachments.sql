-- Hash-only tombstones also cover an unsend delivered before its original message.
create table private.chat_media_revocations(
 user_hash text not null check(user_hash~'^[a-f0-9]{64}$'),
 line_message_hash text not null check(line_message_hash~'^[a-f0-9]{64}$'),
 source_event_id uuid not null references private.webhook_inbox(id),
 revoked_at timestamptz not null default clock_timestamp(),
 primary key(user_hash,line_message_hash)
);
create index chat_media_revocations_event_idx on private.chat_media_revocations(source_event_id);
alter table private.chat_media_revocations enable row level security;
revoke all on private.chat_media_revocations from public,anon,authenticated;
grant select,insert on private.chat_media_revocations to service_role;

create table private.chat_attachments(
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null unique references public.messages(id) on delete cascade,
 source_event_id uuid not null references private.webhook_inbox(id),
 kind text not null check(kind in('IMAGE','FILE')),
 source_encrypted text not null,
 status text not null default 'PENDING' check(status in('PENDING','PROCESSING','READY','FAILED')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 available_at timestamptz not null default clock_timestamp(),lease_token uuid,lease_until timestamptz,
 object_id uuid,mime_type text check(mime_type in('image/jpeg','image/png','application/pdf')),
 byte_length integer check(byte_length between 1 and 10485760),checksum text check(checksum~'^[a-f0-9]{64}$'),
 error_code text check(error_code in('INVALID_ATTACHMENT','TOO_LARGE','UNSUPPORTED_TYPE','UNAVAILABLE','NOT_FOUND','SOURCE_CHANGED','LEASE_EXPIRED')),
 revoked_at timestamptz,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((status='PROCESSING')=(lease_token is not null and lease_until is not null)),
 check((status='READY')=(object_id is not null and mime_type is not null and byte_length is not null and checksum is not null)),
 check(status<>'READY' or error_code is null),check(status<>'FAILED' or error_code is not null),
 check(revoked_at is null or status in('READY','FAILED'))
);
create index chat_attachments_source_idx on private.chat_attachments(source_event_id);
create index chat_attachments_claim_idx on private.chat_attachments(available_at,created_at,id) where status in('PENDING','PROCESSING');
alter table private.chat_attachments enable row level security;
revoke all on private.chat_attachments from public,anon,authenticated;
grant select,insert,update on private.chat_attachments to service_role;

create function private.guard_chat_attachment_update() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.message_id,new.source_event_id,new.kind,new.source_encrypted,new.created_at)
  is distinct from(old.id,old.message_id,old.source_event_id,old.kind,old.source_encrypted,old.created_at) then
  raise exception using errcode='23514',message='CHAT_ATTACHMENT_SOURCE_IMMUTABLE';
 end if;
 if old.revoked_at is not null then raise exception using errcode='23514',message='CHAT_ATTACHMENT_REVOKED';end if;
 if old.status in('READY','FAILED') and not(new.revoked_at is not null and
  (to_jsonb(new)-'revoked_at'-'updated_at')=(to_jsonb(old)-'revoked_at'-'updated_at')) then
  raise exception using errcode='23514',message='CHAT_ATTACHMENT_TERMINAL';end if;
 if new.attempts<old.attempts or new.attempts>old.attempts+1 then raise exception using errcode='23514',message='CHAT_ATTACHMENT_ATTEMPT_INVALID';end if;
 new.updated_at:=clock_timestamp();return new;
end $$;
create trigger chat_attachment_guard before update on private.chat_attachments for each row execute function private.guard_chat_attachment_update();
create function private.mark_chat_attachment_changed() returns trigger language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
 select ticket_id into target from public.messages where id=new.message_id;
 if target is not null then insert into private.inbox_refresh_pending(ticket_id) values(target)
  on conflict(ticket_id) do update set changed_at=clock_timestamp();end if;
 return new;
end $$;
create trigger chat_attachment_invalidation after insert or update of status,revoked_at on private.chat_attachments
 for each row execute function private.mark_chat_attachment_changed();
revoke all on function private.guard_chat_attachment_update(),private.mark_chat_attachment_changed() from public,anon,authenticated;
grant execute on function private.guard_chat_attachment_update(),private.mark_chat_attachment_changed() to service_role;

alter table private.worker_observations drop constraint worker_observations_worker_check;
alter table private.worker_observations add constraint worker_observations_worker_check check(worker in('INBOX','OUTBOX','AI','INCIDENT','MEDIA'));
