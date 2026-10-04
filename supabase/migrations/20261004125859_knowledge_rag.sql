-- Model purpose is explicit; existing configurations continue as generation models.
alter table private.ai_models add column purpose text not null default 'GENERATION'
 check(purpose in ('GENERATION','EMBEDDING'));
alter table private.ai_models add column embedding_dimensions integer;
alter table private.ai_models add constraint ai_model_purpose_dimensions check(
 (purpose='GENERATION' and embedding_dimensions is null) or
 (purpose='EMBEDDING' and embedding_dimensions between 1 and 4096 and embedding_dimensions is not null
  and not supports_tools and not supports_json and not supports_vision)
);
create index ai_models_purpose_priority_idx on private.ai_models(purpose,provider_id,priority,id) where enabled;

create extension if not exists vector with schema extensions;

create table public.document_families (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check(code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
 name text not null check(length(name) between 1 and 200),
 category text not null check(length(category) between 1 and 80),
 default_storage_mode text not null default 'RAG' check(default_storage_mode in ('RAG','STRUCTURED','BOTH')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create table public.documents (
 id uuid primary key default gen_random_uuid(),document_family_id uuid not null references public.document_families(id),
 department_id uuid references public.departments(id),title text not null check(length(title) between 1 and 500),
 document_type text not null default 'GUIDE' check(length(document_type) between 1 and 80),
 version_name text not null check(length(version_name) between 1 and 200),
 version_stream text not null check(length(version_stream) between 1 and 120),
 academic_year integer check(academic_year between 2400 and 3000),
 semester text check(length(semester) between 1 and 40),audience text not null default 'ALL' check(length(audience) between 1 and 80),
 student_type text not null default 'ALL' check(length(student_type) between 1 and 80),
 program_code text check(length(program_code) between 1 and 80),curriculum_code text check(length(curriculum_code) between 1 and 80),
 cohort integer check(cohort between 2400 and 3000),published_at date,effective_from date,effective_to date,
 status text not null default 'PENDING_REVIEW' check(status in ('DRAFT','PENDING_REVIEW','ACTIVE','SUPERSEDED','EXPIRED','ARCHIVED','REJECTED')),
 is_current boolean not null default false,
 authority_level integer not null default 70 check(authority_level between 0 and 100),
 approval_status text not null default 'PENDING' check(approval_status in ('PENDING','APPROVED','REJECTED')),
 approved_by uuid references public.staff_profiles(id),approved_at timestamptz,
 official_source boolean not null default false,extraction_reviewed boolean not null default false,requires_review boolean not null default true,
 visibility text not null default 'PUBLIC' check(visibility in ('PUBLIC','INTERNAL','RESTRICTED')),archive_only boolean not null default false,
 source_url text check(length(source_url) between 1 and 2000),source_page_url text check(length(source_page_url) between 1 and 2000),
 storage_path text check(length(storage_path) between 1 and 1000),mime_type text not null default 'application/pdf' check(length(mime_type) between 1 and 100),
 checksum text not null check(checksum ~ '^[a-f0-9]{64}$'),
 supersedes_document_id uuid references public.documents(id),revision integer not null default 0 check(revision>=0),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(effective_to is null or (effective_from is not null and effective_to>=effective_from)),
 check(not is_current or status='ACTIVE'),
 check(approval_status<>'APPROVED' or approved_at is not null),
 check(status not in ('ACTIVE','SUPERSEDED','EXPIRED') or
  (approval_status='APPROVED' and extraction_reviewed and not requires_review and effective_from is not null)),
 check(supersedes_document_id is null or supersedes_document_id<>id),
 unique(document_family_id,version_stream,checksum)
);
-- Streams distinguish parallel audience/cohort rules from a replacement's year.
create unique index documents_one_current_stream_idx on public.documents(document_family_id,version_stream) where is_current;
create index documents_family_scope_idx on public.documents(document_family_id,academic_year,audience,student_type);
create index documents_current_eligibility_idx on public.documents(document_family_id,effective_from,effective_to,authority_level desc)
 where status='ACTIVE' and is_current and approval_status='APPROVED' and visibility='PUBLIC' and official_source and extraction_reviewed and not requires_review and not archive_only;
create index documents_department_idx on public.documents(department_id);
create index documents_approved_by_idx on public.documents(approved_by);
create index documents_supersedes_idx on public.documents(supersedes_document_id);

create table public.document_relationships (
 id uuid primary key default gen_random_uuid(),source_document_id uuid not null references public.documents(id),
 target_document_id uuid not null references public.documents(id),
 relation_type text not null check(relation_type in ('SUPERSEDES','AMENDS','ATTACHMENT_OF','RELATED_TO','CANCELS')),
 created_at timestamptz not null default clock_timestamp(),check(source_document_id<>target_document_id),
 unique(source_document_id,target_document_id,relation_type)
);
create index document_relationships_target_idx on public.document_relationships(target_document_id);

create table public.knowledge_chunks (
 id uuid primary key default gen_random_uuid(),document_id uuid not null references public.documents(id),
 chunk_index integer not null check(chunk_index between 0 and 1999),page_number integer check(page_number between 1 and 100000),
 section_title text check(length(section_title) between 1 and 180),content text not null check(length(content) between 1 and 6000),
 requires_review boolean not null default false,
 embedding extensions.vector,embedding_dimensions integer check(embedding_dimensions between 1 and 4096),
 embedding_fingerprint text check(embedding_fingerprint ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(document_id,chunk_index),
 check((embedding is null and embedding_dimensions is null and embedding_fingerprint is null) or
  (embedding is not null and embedding_dimensions is not null and embedding_fingerprint is not null
   and extensions.vector_dims(embedding)=embedding_dimensions and extensions.vector_norm(embedding)>0))
);
-- Canonical applicability lives on documents: no stale denormalized flags on chunks.
create index knowledge_chunks_embedding_scope_idx on public.knowledge_chunks(embedding_fingerprint,embedding_dimensions,document_id)
 where embedding is not null and not requires_review;

alter table public.document_families enable row level security;
alter table public.documents enable row level security;
alter table public.document_relationships enable row level security;
alter table public.knowledge_chunks enable row level security;
revoke all on public.document_families,public.documents,public.document_relationships,public.knowledge_chunks from public,anon,authenticated;
grant all on public.document_families,public.documents,public.document_relationships,public.knowledge_chunks to service_role;
