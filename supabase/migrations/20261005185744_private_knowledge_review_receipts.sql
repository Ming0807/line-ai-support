-- Independent immutable review drafts. Saving does not publish or change extraction.
create table private.knowledge_import_reviews (
 job_id uuid not null references private.knowledge_import_jobs(id) on delete cascade,
 review_revision integer not null check(review_revision between 1 and 1000000000),
 job_revision integer not null check(job_revision between 1 and 1000000000),
 extraction_revision integer not null check(extraction_revision between 1 and job_revision),
 actor_id uuid not null references public.staff_profiles(id),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 review_encrypted text not null check(length(review_encrypted) between 40 and 1398200),
 created_at timestamptz not null default clock_timestamp(),primary key(job_id,review_revision),
 foreign key(job_id,extraction_revision) references private.knowledge_import_revisions(job_id,revision)
);
create index knowledge_import_review_actor_idx on private.knowledge_import_reviews(actor_id);
create index knowledge_import_review_extraction_idx on private.knowledge_import_reviews(job_id,extraction_revision);
create function private.protect_knowledge_import_review() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 raise exception using errcode='23514',message='IMPORT_REVIEW_IMMUTABLE';
end;
$$;
create trigger knowledge_import_review_immutable before update on private.knowledge_import_reviews
for each row execute function private.protect_knowledge_import_review();
alter table private.knowledge_import_reviews enable row level security;
revoke all on private.knowledge_import_reviews from public,anon,authenticated,service_role;
grant select,insert on private.knowledge_import_reviews to service_role;
revoke all on function private.protect_knowledge_import_review() from public,anon,authenticated;
grant execute on function private.protect_knowledge_import_review() to service_role;
