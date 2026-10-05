-- Additive backend support. Existing immutable DB originals remain readable.
alter table private.knowledge_import_jobs drop constraint knowledge_import_jobs_backend_check;
alter table private.knowledge_import_jobs add constraint knowledge_import_jobs_backend_check check(backend in ('PRIVATE_DATABASE','PRIVATE_STORAGE'));
alter table private.knowledge_import_jobs alter column original_ciphertext drop not null;
alter table private.knowledge_import_jobs drop constraint knowledge_import_envelope_size;
alter table private.knowledge_import_jobs add constraint knowledge_import_envelope_size check(
 (backend='PRIVATE_DATABASE' and original_ciphertext is not null and octet_length(original_ciphertext)=byte_length+33)
 or (backend='PRIVATE_STORAGE' and original_ciphertext is null));

-- Reserve before HTTP. Failed/losing uploads retain their immutable recovery metadata.
create table private.knowledge_original_uploads (
 job_id uuid primary key,original_id uuid not null unique,creator_id uuid not null references public.staff_profiles(id),
 checksum text not null check(checksum ~ '^[a-f0-9]{64}$'),format text not null check(format in ('PDF','DOCX','XLSX','CSV','HTML')),
 byte_length integer not null check(byte_length between 1 and 20971520),key_version integer not null check(key_version=1),
 source_metadata_encrypted text not null check(length(source_metadata_encrypted) between 40 and 43800),
 status text not null default 'RESERVED' check(status in ('RESERVED','UPLOADED','LINKED','UNKNOWN')),
 linked_import_id uuid references private.knowledge_import_jobs(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 constraint original_upload_link_state check((status='LINKED' and linked_import_id=job_id and linked_import_id is not null)
  or (status<>'LINKED' and linked_import_id is null))
);
create index original_upload_creator_idx on private.knowledge_original_uploads(creator_id);
create index original_upload_link_idx on private.knowledge_original_uploads(linked_import_id) where linked_import_id is not null;
create index original_upload_retained_idx on private.knowledge_original_uploads(created_at) where status<>'LINKED';
create function private.protect_original_upload_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if row(new.job_id,new.original_id,new.creator_id,new.checksum,new.format,new.byte_length,new.key_version,new.source_metadata_encrypted,new.created_at)
  is distinct from row(old.job_id,old.original_id,old.creator_id,old.checksum,old.format,old.byte_length,old.key_version,old.source_metadata_encrypted,old.created_at) then
  raise exception using errcode='23514',message='IMPORT_ORIGINAL_IMMUTABLE';
 end if;
 if old.status='LINKED' and row(new.status,new.linked_import_id) is distinct from row(old.status,old.linked_import_id) then
  raise exception using errcode='23514',message='IMPORT_ORIGINAL_IMMUTABLE';
 end if;
 return new;
end;
$$;
create trigger original_upload_receipt_immutable before update on private.knowledge_original_uploads
for each row execute function private.protect_original_upload_receipt();
alter table private.knowledge_original_uploads enable row level security;
revoke all on private.knowledge_original_uploads from public,anon,authenticated;
grant all on private.knowledge_original_uploads to service_role;
revoke all on function private.protect_original_upload_receipt() from public,anon,authenticated;
grant execute on function private.protect_original_upload_receipt() to service_role;
