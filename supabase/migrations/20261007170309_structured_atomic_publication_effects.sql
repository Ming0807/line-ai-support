-- STR-01C-2 additive, owned-disposable verification only (DEC-051).
alter table private.knowledge_import_publications alter column embedding_fingerprint drop not null;
alter table private.knowledge_import_publications add constraint publication_mode_embedding check(
 (storage_mode='STRUCTURED' and embedding_fingerprint is null) or
 (storage_mode in ('RAG','BOTH') and embedding_fingerprint is not null));
alter table private.knowledge_import_publications add constraint publication_effect_identity unique(job_id,document_id,storage_mode);

create table private.structured_publication_effects(
 job_id uuid primary key,
 document_id uuid not null unique,
 storage_mode text not null check(storage_mode in ('STRUCTURED','BOTH')),
 dataset_code text not null check(dataset_code in ('academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements')),
 published_document_revision integer not null check(published_document_revision=0),
 source_format text not null check(source_format in ('PDF','DOCX','XLSX','CSV','HTML')),
 extraction_digest text not null check(extraction_digest ~ '^[a-f0-9]{64}$'),
 mapping_digest text not null check(mapping_digest ~ '^[a-f0-9]{64}$'),
 structured_plan_digest text not null check(structured_plan_digest ~ '^[a-f0-9]{64}$'),
 acknowledgment_digest text not null check(acknowledgment_digest ~ '^[a-f0-9]{64}$'),
 registry_version text not null check(registry_version='structured-v1'),
 mapper_version text not null check(mapper_version='structured-mapper-v1'),
 row_count integer not null check(row_count between 1 and 2000),
 chunk_count integer not null check(chunk_count between 0 and 2000),
 chunk_plan_digest text check(chunk_plan_digest ~ '^[a-f0-9]{64}$'),
 row_manifest jsonb not null check(jsonb_typeof(row_manifest)='array' and jsonb_array_length(row_manifest)=row_count),
 chunk_manifest jsonb not null check(jsonb_typeof(chunk_manifest)='array' and jsonb_array_length(chunk_manifest)=chunk_count),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(job_id,document_id,storage_mode) references private.knowledge_import_publications(job_id,document_id,storage_mode),
 check(octet_length(row_manifest::text)+octet_length(chunk_manifest::text)<=33554432),
 check((storage_mode='STRUCTURED' and chunk_count=0 and chunk_plan_digest is null) or
  (storage_mode='BOTH' and chunk_count>0 and chunk_plan_digest is not null))
);
create index structured_effect_receipt_idx on private.structured_publication_effects(job_id,document_id,storage_mode);
alter table private.structured_publication_effects enable row level security;
revoke all on private.structured_publication_effects from public,anon,authenticated,service_role;
grant select,insert on private.structured_publication_effects to service_role;

create function private.protect_structured_effect() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 raise exception using errcode='23514',message='STRUCTURED_EFFECT_IMMUTABLE';
end;
$$;
create trigger structured_effect_immutable before update or delete on private.structured_publication_effects
for each row execute function private.protect_structured_effect();

create or replace function private.guard_structured_provenance() returns trigger
language plpgsql security invoker set search_path='' as $$
declare source public.documents%rowtype;historical boolean;
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='STRUCTURED_PROVENANCE_IMMUTABLE';end if;
 select * into source from public.documents where id=new.document_id for share;
 historical=source.status='SUPERSEDED' and not source.is_current and exists(
  select 1 from private.knowledge_import_publications p where p.job_id=new.job_id and p.document_id=new.document_id
   and p.storage_mode in ('STRUCTURED','BOTH') and p.action='ADD_HISTORICAL'
   and p.job_revision=new.job_revision and p.extraction_revision=new.extraction_revision and p.review_revision=new.review_revision
   and p.source_checksum=new.source_checksum);
 if source.id is null or source.checksum<>new.source_checksum or source.revision<>new.published_document_revision
  or (source.status<>'ACTIVE' and not historical) or source.approval_status<>'APPROVED' or not source.extraction_reviewed or source.requires_review then
  raise exception using errcode='23514',message='STRUCTURED_SOURCE_BINDING_INVALID';
 end if;
 return new;
end;
$$;

create function private.assert_structured_publication_effects(target uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare p private.knowledge_import_publications%rowtype;e private.structured_publication_effects%rowtype;strict_payload_mismatch boolean;
begin
 select * into p from private.knowledge_import_publications where document_id=target;
 if not found then return;end if;
 if p.storage_mode='RAG' then
  if exists(select 1 from private.structured_row_provenance where document_id=target) then
   raise exception using errcode='23514',message='STRUCTURED_EFFECT_MODE_INVALID';
  end if;
  return;
 end if;
 select * into e from private.structured_publication_effects where document_id=target;
 if not found then raise exception using errcode='23514',message='STRUCTURED_EFFECT_REQUIRED';end if;
 if not exists(select 1 from private.knowledge_import_jobs j
   join private.knowledge_import_reviews r on r.job_id=j.id and r.review_revision=p.review_revision
   join public.documents d on d.id=target
   where j.id=p.job_id and j.revision=p.job_revision and j.checksum=p.source_checksum and j.format=e.source_format
    and j.publication_status='COMPLETED' and r.job_revision=p.job_revision and r.extraction_revision=p.extraction_revision
    and r.payload_hash=p.review_hash and d.checksum=p.source_checksum and d.document_family_id=p.family_id)
  or (p.storage_mode='STRUCTURED' and p.plan_digest<>e.structured_plan_digest)
  or (p.storage_mode='BOTH' and p.plan_digest<>e.chunk_plan_digest) then
  raise exception using errcode='23514',message='STRUCTURED_EFFECT_BINDING_INVALID';
 end if;
 if exists(select 1 from jsonb_array_elements(e.row_manifest) r where jsonb_typeof(r)<>'object'
   or not r ?& array['id','payloadDigest','payload'] or (select count(*) from jsonb_object_keys(r))<>3
   or jsonb_typeof(r->'payload') is distinct from 'object'
   or jsonb_typeof(r->'payloadDigest') is distinct from 'string' or (r->>'payloadDigest') !~ '^[a-f0-9]{64}$')
  or (select count(distinct r->>'id') from jsonb_array_elements(e.row_manifest) r)<>e.row_count
  or (select count(*) from private.structured_row_provenance where document_id=target)<>e.row_count
  or exists(select 1 from private.structured_row_provenance v
    left join jsonb_to_recordset(e.row_manifest) r(id uuid,"payloadDigest" text,payload jsonb) on r.id=v.id
    where v.document_id=target and (r.id is null or v.dataset_code<>e.dataset_code or v.payload_digest is distinct from r."payloadDigest"
     or v.job_id<>p.job_id or v.job_revision<>p.job_revision or v.extraction_revision<>p.extraction_revision or v.review_revision<>p.review_revision
     or v.source_checksum<>p.source_checksum or v.source_format<>e.source_format or v.published_document_revision<>e.published_document_revision
     or v.extraction_digest<>e.extraction_digest or v.mapping_digest<>e.mapping_digest or v.plan_digest<>e.structured_plan_digest
     or v.registry_version<>e.registry_version or v.mapper_version<>e.mapper_version)) then
  raise exception using errcode='23514',message='STRUCTURED_EFFECT_ROWS_INVALID';
 end if;
 with actual as (
select t.id,t.dataset_code,to_jsonb(t)-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from public.academic_calendar_events t where t.document_id=target
   union all select t.id,t.dataset_code,to_jsonb(t)-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from public.tuition_fees t where t.document_id=target
   union all select t.id,t.dataset_code,to_jsonb(t)-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from public.transfer_courses t where t.document_id=target
   union all select t.id,t.dataset_code,to_jsonb(t)-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from public.university_services t where t.document_id=target
   union all select t.id,t.dataset_code,to_jsonb(t)-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from public.university_systems t where t.document_id=target
   union all select t.id,t.dataset_code,to_jsonb(t)-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from public.service_forms t where t.document_id=target
   union all select t.id,t.dataset_code,to_jsonb(t)-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from public.announcements t where t.document_id=target
 ), expected as (
select r.id,to_jsonb(jsonb_populate_record(null::public.academic_calendar_events,r.payload))-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from jsonb_to_recordset(e.row_manifest) r(id uuid,payload jsonb) where e.dataset_code='academic_calendar_events'
   union all select r.id,to_jsonb(jsonb_populate_record(null::public.tuition_fees,r.payload))-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from jsonb_to_recordset(e.row_manifest) r(id uuid,payload jsonb) where e.dataset_code='tuition_fees'
   union all select r.id,to_jsonb(jsonb_populate_record(null::public.transfer_courses,r.payload))-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from jsonb_to_recordset(e.row_manifest) r(id uuid,payload jsonb) where e.dataset_code='transfer_courses'
   union all select r.id,to_jsonb(jsonb_populate_record(null::public.university_services,r.payload))-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from jsonb_to_recordset(e.row_manifest) r(id uuid,payload jsonb) where e.dataset_code='university_services'
   union all select r.id,to_jsonb(jsonb_populate_record(null::public.university_systems,r.payload))-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from jsonb_to_recordset(e.row_manifest) r(id uuid,payload jsonb) where e.dataset_code='university_systems'
   union all select r.id,to_jsonb(jsonb_populate_record(null::public.service_forms,r.payload))-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from jsonb_to_recordset(e.row_manifest) r(id uuid,payload jsonb) where e.dataset_code='service_forms'
   union all select r.id,to_jsonb(jsonb_populate_record(null::public.announcements,r.payload))-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'] payload from jsonb_to_recordset(e.row_manifest) r(id uuid,payload jsonb) where e.dataset_code='announcements'
 ), manifest as (select * from jsonb_to_recordset(e.row_manifest) r(id uuid,payload jsonb))
 select exists(select 1 from actual a full join expected x on a.id=x.id
  left join manifest m on m.id=x.id where a.id is null or x.id is null or a.dataset_code<>e.dataset_code
   or a.payload is distinct from x.payload
   or (select array_agg(key order by key) from jsonb_object_keys(m.payload) keys(key))
      is distinct from (select array_agg(key order by key) from jsonb_object_keys(a.payload) keys(key)))
 into strict_payload_mismatch;
 if strict_payload_mismatch then raise exception using errcode='23514',message='STRUCTURED_EFFECT_PAYLOAD_INVALID';end if;
 if exists(select 1 from jsonb_array_elements(e.chunk_manifest) c where jsonb_typeof(c)<>'object'
    or not c ?& array['index','page','section','content','locations','tokens'] or (select count(*) from jsonb_object_keys(c))<>6)
   or (select count(distinct c->>'index') from jsonb_array_elements(e.chunk_manifest) c)<>e.chunk_count
   or (select count(*) from public.knowledge_chunks where document_id=target)<>e.chunk_count
   or exists(select 1 from public.knowledge_chunks k
    left join jsonb_to_recordset(e.chunk_manifest) c(index integer,page integer,section text,content text,locations jsonb,tokens integer)
      on c.index=k.chunk_index where k.document_id=target and
      (c.index is null or k.content is distinct from c.content or k.page_number is distinct from c.page or k.section_title is distinct from c.section
       or k.source_locations is distinct from c.locations or k.passage_token_count is distinct from c.tokens
       or k.requires_review or k.embedding_dimensions is distinct from 384 or k.embedding_fingerprint is distinct from p.embedding_fingerprint
       or k.embedding_e5 is null or abs(extensions.vector_norm(k.embedding_e5)-1)>0.0001)) then
  raise exception using errcode='23514',message='STRUCTURED_EFFECT_CHUNKS_INVALID';
 end if;
end;
$$;
create function private.check_structured_effect_trigger() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform private.assert_structured_publication_effects(new.document_id);return null;
end;
$$;
create constraint trigger publication_requires_structured_effect after insert on private.knowledge_import_publications
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create constraint trigger structured_effect_complete after insert on private.structured_publication_effects
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create constraint trigger structured_effect_provenance after insert on private.structured_row_provenance
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create constraint trigger structured_effect_chunks after insert on public.knowledge_chunks
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create constraint trigger academic_calendar_events_effect_complete after insert on public.academic_calendar_events
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create constraint trigger tuition_fees_effect_complete after insert on public.tuition_fees
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create constraint trigger transfer_courses_effect_complete after insert on public.transfer_courses
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create constraint trigger university_services_effect_complete after insert on public.university_services
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create constraint trigger university_systems_effect_complete after insert on public.university_systems
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create constraint trigger service_forms_effect_complete after insert on public.service_forms
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create constraint trigger announcements_effect_complete after insert on public.announcements
deferrable initially deferred for each row execute function private.check_structured_effect_trigger();
create function private.protect_structured_chunks() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from private.structured_publication_effects where document_id=old.document_id) then
  raise exception using errcode='23514',message='STRUCTURED_EFFECT_CHUNKS_IMMUTABLE';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;
$$;
create trigger structured_chunks_immutable before update or delete on public.knowledge_chunks
for each row execute function private.protect_structured_chunks();
revoke all on function private.protect_structured_effect(),private.assert_structured_publication_effects(uuid),private.check_structured_effect_trigger(),private.protect_structured_chunks() from public,anon,authenticated;
grant execute on function private.protect_structured_effect(),private.assert_structured_publication_effects(uuid),private.check_structured_effect_trigger(),private.protect_structured_chunks() to service_role;
