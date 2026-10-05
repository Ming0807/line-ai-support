-- Source staging only: no active documents, chunks, publication or browser privileges.
create table private.knowledge_import_jobs (
 id uuid primary key,original_id uuid not null unique,creator_id uuid not null references public.staff_profiles(id),
 checksum text not null unique check(checksum ~ '^[a-f0-9]{64}$'),
 format text not null check(format in ('PDF','DOCX','XLSX','CSV','HTML')),
 backend text not null default 'PRIVATE_DATABASE' check(backend='PRIVATE_DATABASE'),
 byte_length integer not null check(byte_length between 1 and 20971520),
 key_version integer not null default 1 check(key_version=1),
 original_ciphertext bytea not null,
 source_metadata_encrypted text not null check(length(source_metadata_encrypted) between 40 and 43800),
 status text not null default 'READY' check(status in ('READY','FAILED')),
 revision integer not null default 0 check(revision between 0 and 1000000000),
 error_code text check(error_code in ('IMPORT_PARSE_INVALID','IMPORT_PARSER_UNAVAILABLE','IMPORT_PARSE_TIMEOUT','IMPORT_SOURCE_INVALID')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 constraint knowledge_import_envelope_size check(octet_length(original_ciphertext)=byte_length+33),
 constraint knowledge_import_failure_state check((status='READY' and error_code is null) or (status='FAILED' and error_code is not null))
);
create index knowledge_import_creator_idx on private.knowledge_import_jobs(creator_id);
create index knowledge_import_created_idx on private.knowledge_import_jobs(created_at desc,id desc);

-- A later extraction edit changes its own revision; it cannot rewrite immutable originals.
create function private.protect_knowledge_import_original() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if row(new.id,new.original_id,new.creator_id,new.checksum,new.format,new.backend,new.byte_length,new.key_version,
  new.original_ciphertext,new.source_metadata_encrypted,new.created_at)
  is distinct from row(old.id,old.original_id,old.creator_id,old.checksum,old.format,old.backend,old.byte_length,old.key_version,
  old.original_ciphertext,old.source_metadata_encrypted,old.created_at) then
  raise exception using errcode='23514',message='IMPORT_ORIGINAL_IMMUTABLE';
 end if;
 return new;
end;
$$;
create trigger knowledge_import_original_immutable before update on private.knowledge_import_jobs
for each row execute function private.protect_knowledge_import_original();
alter table private.knowledge_import_jobs enable row level security;
revoke all on private.knowledge_import_jobs from public,anon,authenticated;
grant all on private.knowledge_import_jobs to service_role;
revoke all on function private.protect_knowledge_import_original() from public,anon,authenticated;
grant execute on function private.protect_knowledge_import_original() to service_role;
