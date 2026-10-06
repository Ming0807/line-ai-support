-- Separate extraction availability from immutable reviewed publication completion.
alter table private.knowledge_import_jobs add column publication_status text not null default 'NOT_PUBLISHED'
 check(publication_status in ('NOT_PUBLISHED','COMPLETED'));
create table private.knowledge_import_publications (
 job_id uuid primary key references private.knowledge_import_jobs(id) on delete cascade,
 job_revision integer not null check(job_revision between 1 and 999999999),
 extraction_revision integer not null check(extraction_revision between 1 and job_revision),
 review_revision integer not null check(review_revision between 1 and 999999999),
 actor_id uuid not null references public.staff_profiles(id),
 document_id uuid not null unique references public.documents(id),
 family_id uuid not null references public.document_families(id),
 storage_mode text not null check(storage_mode in ('RAG','STRUCTURED','BOTH')),
 action text not null check(action in ('NEW_FAMILY','ADD_ADDITIONAL','REPLACE_CURRENT','ADD_HISTORICAL','AMEND_EXISTING')),
 relationship text check(relationship='CANCELS'),
 source_checksum text not null check(source_checksum ~ '^[a-f0-9]{64}$'),
 review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
 plan_digest text not null check(plan_digest ~ '^[a-f0-9]{64}$'),
 embedding_fingerprint text not null check(embedding_fingerprint ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(job_id,extraction_revision) references private.knowledge_import_revisions(job_id,revision),
 foreign key(job_id,review_revision) references private.knowledge_import_reviews(job_id,review_revision),
 check(relationship is null or action='ADD_ADDITIONAL')
);
create index knowledge_import_publication_actor_idx on private.knowledge_import_publications(actor_id);
create index knowledge_import_publication_family_idx on private.knowledge_import_publications(family_id);
create index knowledge_import_publication_extraction_idx on private.knowledge_import_publications(job_id,extraction_revision);
create index knowledge_import_publication_review_idx on private.knowledge_import_publications(job_id,review_revision);
create function private.protect_knowledge_import_publication() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 raise exception using errcode='23514',message='IMPORT_PUBLICATION_IMMUTABLE';
end;
$$;
create trigger knowledge_import_publication_immutable before update on private.knowledge_import_publications
for each row execute function private.protect_knowledge_import_publication();
create function private.protect_knowledge_import_completion() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.publication_status='COMPLETED' and new.publication_status<>old.publication_status then
  raise exception using errcode='23514',message='IMPORT_PUBLICATION_COMPLETION_IMMUTABLE';
 end if;
 if new.publication_status='COMPLETED' and not exists(select 1 from private.knowledge_import_publications p where p.job_id=new.id) then
  raise exception using errcode='23514',message='IMPORT_PUBLICATION_RECEIPT_REQUIRED';
 end if;
 return new;
end;
$$;
create trigger knowledge_import_completion_guard before update of publication_status on private.knowledge_import_jobs
for each row execute function private.protect_knowledge_import_completion();
alter table private.knowledge_import_publications enable row level security;
revoke all on private.knowledge_import_publications from public,anon,authenticated,service_role;
grant select,insert on private.knowledge_import_publications to service_role;
revoke all on function private.protect_knowledge_import_publication(),private.protect_knowledge_import_completion() from public,anon,authenticated;
grant execute on function private.protect_knowledge_import_publication(),private.protect_knowledge_import_completion() to service_role;
