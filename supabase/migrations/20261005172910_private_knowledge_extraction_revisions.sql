-- Private append-only draft history. No document publication or browser access.
create table private.knowledge_import_revisions (
 job_id uuid not null references private.knowledge_import_jobs(id) on delete cascade,
 revision integer not null check(revision between 1 and 1000000000),base_revision integer,
 actor_id uuid not null references public.staff_profiles(id),kind text not null check(kind in ('PARSED','EDITED')),
 extraction_checksum text not null check(extraction_checksum ~ '^[a-f0-9]{64}$'),
 extraction_encrypted text not null check(length(extraction_encrypted) between 40 and 44739344),
 analysis_encrypted text not null check(length(analysis_encrypted) between 40 and 87500),
 review_encrypted text check(length(review_encrypted) between 40 and 1398200),
 created_at timestamptz not null default clock_timestamp(),primary key(job_id,revision),
 foreign key(job_id,base_revision) references private.knowledge_import_revisions(job_id,revision),
 constraint knowledge_import_revision_kind check(
  (kind='PARSED' and base_revision is null and review_encrypted is null) or
  (kind='EDITED' and base_revision>=1 and base_revision<revision and review_encrypted is not null))
);
create index knowledge_import_revision_actor_idx on private.knowledge_import_revisions(actor_id);
create index knowledge_import_revision_base_idx on private.knowledge_import_revisions(job_id,base_revision) where base_revision is not null;
create function private.protect_knowledge_import_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 raise exception using errcode='23514',message='IMPORT_REVISION_IMMUTABLE';
end;
$$;
create trigger knowledge_import_revision_immutable before update on private.knowledge_import_revisions
for each row execute function private.protect_knowledge_import_revision();
alter table private.knowledge_import_revisions enable row level security;
revoke all on private.knowledge_import_revisions from public,anon,authenticated,service_role;
grant select,insert on private.knowledge_import_revisions to service_role;
revoke all on function private.protect_knowledge_import_revision() from public,anon,authenticated;
grant execute on function private.protect_knowledge_import_revision() to service_role;
