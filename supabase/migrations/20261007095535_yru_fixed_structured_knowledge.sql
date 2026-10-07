-- STR-01A-1: fixed schema component; normal/remote application and runtime readiness remain gated.
-- Immutable source/review identity, not a replacement for future authenticated atomic publication proof.
create function private.structured_text_valid(value text,maximum integer) returns boolean
language sql immutable security invoker set search_path='' as $$
 select value is null or (length(value) between 1 and maximum and value ~ '[^[:space:]]'
  and value !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]');
$$;
create function private.structured_timestamp_valid(value timestamptz) returns boolean
language sql immutable security invoker set search_path='' as $$
 select value is null or (value>=timestamptz '1800-01-01T00:00:00Z' and value<timestamptz '2401-01-01T00:00:00Z'
  and date_trunc('milliseconds',value at time zone 'UTC')=value at time zone 'UTC');
$$;

alter table private.knowledge_import_jobs add constraint structured_original_identity unique(id,checksum,format);
alter table private.knowledge_import_reviews add constraint structured_review_identity unique(job_id,review_revision,job_revision,extraction_revision);

create table private.structured_row_provenance (
 id uuid primary key,
 document_id uuid not null references public.documents(id),
 dataset_code text not null check(dataset_code in ('academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements')),
 published_document_revision integer not null check(published_document_revision>=0),
 job_id uuid not null,job_revision integer not null check(job_revision between 1 and 1000000000),
 extraction_revision integer not null check(extraction_revision between 1 and job_revision),
 review_revision integer not null check(review_revision between 1 and 1000000000),
 source_checksum text not null check(source_checksum ~ '^[a-f0-9]{64}$'),
 source_format text not null check(source_format in ('PDF','DOCX','XLSX','CSV','HTML')),
 extraction_digest text not null check(extraction_digest ~ '^[a-f0-9]{64}$'),
 mapping_digest text not null check(mapping_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text not null check(payload_digest ~ '^[a-f0-9]{64}$'),
 plan_digest text not null check(plan_digest ~ '^[a-f0-9]{64}$'),
 registry_version text not null check(registry_version='structured-v1'),
 mapper_version text not null check(mapper_version='structured-mapper-v1'),
 table_index integer not null check(table_index between 0 and 999),
 row_index integer not null check(row_index between 0 and 9999),
 table_first_row integer not null check(table_first_row between 1 and 1048576),
 source_row integer not null check(source_row between 1 and 1048576),
 coordinate_kind text not null check(coordinate_kind in ('WORKSHEET_CELL','CSV_RECORD','EXTRACTED_LOGICAL')),
 evidence_encrypted text not null check(length(evidence_encrypted) between 40 and 1398200),
 created_at timestamptz not null default clock_timestamp(),
 unique(id,document_id,dataset_code),
 unique(document_id,table_index,row_index),
 foreign key(job_id,source_checksum,source_format) references private.knowledge_import_jobs(id,checksum,format),
 foreign key(job_id,review_revision,job_revision,extraction_revision) references private.knowledge_import_reviews(job_id,review_revision,job_revision,extraction_revision),
 check(source_row=table_first_row+row_index),
 check((source_format='XLSX' and coordinate_kind='WORKSHEET_CELL') or
  (source_format='CSV' and coordinate_kind='CSV_RECORD') or
  (source_format in ('PDF','DOCX','HTML') and coordinate_kind='EXTRACTED_LOGICAL' and source_row<=100000))
);
create index structured_provenance_review_idx on private.structured_row_provenance(job_id,review_revision,job_revision,extraction_revision);
create index structured_provenance_original_idx on private.structured_row_provenance(job_id,source_checksum,source_format);
alter table private.structured_row_provenance enable row level security;
revoke all on private.structured_row_provenance from public,anon,authenticated,service_role;
grant select,insert on private.structured_row_provenance to service_role;

create function private.guard_structured_provenance() returns trigger
language plpgsql security invoker set search_path='' as $$
declare source public.documents%rowtype;
begin
 if tg_op<>'INSERT' then
  raise exception using errcode='23514',message='STRUCTURED_PROVENANCE_IMMUTABLE';
 end if;
 select * into source from public.documents where id=new.document_id for share;
 if not found or source.checksum<>new.source_checksum or source.revision<>new.published_document_revision
  or source.status<>'ACTIVE' or source.approval_status<>'APPROVED' or not source.extraction_reviewed or source.requires_review then
  raise exception using errcode='23514',message='STRUCTURED_SOURCE_BINDING_INVALID';
 end if;
 return new;
end;
$$;
create trigger structured_provenance_guard before insert or update or delete on private.structured_row_provenance
for each row execute function private.guard_structured_provenance();

create table public.academic_calendar_events (
 id uuid primary key,
 document_id uuid not null references public.documents(id),
 dataset_code text generated always as ('academic_calendar_events'::text) stored,
 academic_year integer not null check(academic_year between 2400 and 3000),
 semester text not null check(private.structured_text_valid(semester,80)),
 student_type text not null check(private.structured_text_valid(student_type,80)),
 event_type text not null check(private.structured_text_valid(event_type,200)),
 title text not null check(private.structured_text_valid(title,500)),
 start_date date not null check(start_date between date '1800-01-01' and date '2400-12-31'),
 end_date date check(end_date between start_date and date '2400-12-31'),
 description text check(private.structured_text_valid(description,5000)),
 active boolean not null default false,is_current boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(id,document_id,dataset_code) references private.structured_row_provenance(id,document_id,dataset_code)
);
create index academic_calendar_events_document_idx on public.academic_calendar_events(document_id);
create index academic_calendar_events_provenance_idx on public.academic_calendar_events(id,document_id,dataset_code);
create index academic_calendar_events_exact_idx on public.academic_calendar_events(academic_year,semester,student_type,start_date);
alter table public.academic_calendar_events enable row level security;
revoke all on public.academic_calendar_events from public,anon,authenticated,service_role;
grant select,insert on public.academic_calendar_events to service_role;
grant update(active,is_current,updated_at) on public.academic_calendar_events to service_role;

create table public.tuition_fees (
 id uuid primary key,
 document_id uuid not null references public.documents(id),
 dataset_code text generated always as ('tuition_fees'::text) stored,
 academic_year integer not null check(academic_year between 2400 and 3000),
 program_name text not null check(private.structured_text_valid(program_name,500)),
 major_name text check(private.structured_text_valid(major_name,500)),
 student_group text not null check(private.structured_text_valid(student_group,200)),
 study_type text not null check(private.structured_text_valid(study_type,200)),
 fee_amount numeric not null check(fee_amount>=0 and fee_amount<=9999999999.99 and scale(fee_amount)<=2),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 effective_from date not null check(effective_from between date '1800-01-01' and date '2400-12-31'),
 effective_to date check(effective_to between effective_from and date '2400-12-31'),
 active boolean not null default false,is_current boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(id,document_id,dataset_code) references private.structured_row_provenance(id,document_id,dataset_code)
);
create index tuition_fees_document_idx on public.tuition_fees(document_id);
create index tuition_fees_provenance_idx on public.tuition_fees(id,document_id,dataset_code);
-- Keep wide multibyte labels below the B-tree tuple limit; remaining scope
-- dimensions are exact predicates, not concatenated wide index keys.
create index tuition_fees_exact_idx on public.tuition_fees(academic_year,program_name,effective_from);
alter table public.tuition_fees enable row level security;
revoke all on public.tuition_fees from public,anon,authenticated,service_role;
grant select,insert on public.tuition_fees to service_role;
grant update(active,is_current,updated_at) on public.tuition_fees to service_role;

create table public.transfer_courses (
 id uuid primary key,
 document_id uuid not null references public.documents(id),
 dataset_code text generated always as ('transfer_courses'::text) stored,
 source_program text not null check(private.structured_text_valid(source_program,500)),
 source_course_code text not null check(private.structured_text_valid(source_course_code,200)),
 source_course_name text not null check(private.structured_text_valid(source_course_name,500)),
 source_credits numeric not null check(source_credits>=0 and source_credits<=999.999 and scale(source_credits)<=3),
 target_program text not null check(private.structured_text_valid(target_program,500)),
 target_course_code text not null check(private.structured_text_valid(target_course_code,200)),
 target_course_name text not null check(private.structured_text_valid(target_course_name,500)),
 target_credits numeric not null check(target_credits>=0 and target_credits<=999.999 and scale(target_credits)<=3),
 conditions text check(private.structured_text_valid(conditions,5000)),
 active boolean not null default false,is_current boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(id,document_id,dataset_code) references private.structured_row_provenance(id,document_id,dataset_code)
);
create index transfer_courses_document_idx on public.transfer_courses(document_id);
create index transfer_courses_provenance_idx on public.transfer_courses(id,document_id,dataset_code);
create index transfer_courses_exact_idx on public.transfer_courses(source_course_code,target_course_code);
create index transfer_courses_target_code_idx on public.transfer_courses(target_course_code);
create index transfer_courses_source_program_idx on public.transfer_courses(source_program);
create index transfer_courses_target_program_idx on public.transfer_courses(target_program);
alter table public.transfer_courses enable row level security;
revoke all on public.transfer_courses from public,anon,authenticated,service_role;
grant select,insert on public.transfer_courses to service_role;
grant update(active,is_current,updated_at) on public.transfer_courses to service_role;

create table public.university_services (
 id uuid primary key,
 document_id uuid not null references public.documents(id),
 dataset_code text generated always as ('university_services'::text) stored,
 department_id uuid references public.departments(id),
 service_code text not null check(private.structured_text_valid(service_code,200)),
 name text not null check(private.structured_text_valid(name,500)),
 description text check(private.structured_text_valid(description,5000)),
 location text check(private.structured_text_valid(location,500)),
 opening_hours jsonb check(opening_hours is null or (jsonb_typeof(opening_hours)='string' and private.structured_text_valid(opening_hours #>> '{}',2000))),
 phone text check(private.structured_text_valid(phone,100)),
 email text check(private.structured_text_valid(email,254)),
 url text check(private.structured_text_valid(url,2000)),
 active boolean not null default false,is_current boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(id,document_id,dataset_code) references private.structured_row_provenance(id,document_id,dataset_code)
);
create index university_services_document_idx on public.university_services(document_id);
create index university_services_provenance_idx on public.university_services(id,document_id,dataset_code);
create index university_services_department_idx on public.university_services(department_id);
create index university_services_exact_idx on public.university_services(service_code);
alter table public.university_services enable row level security;
revoke all on public.university_services from public,anon,authenticated,service_role;
grant select,insert on public.university_services to service_role;
grant update(active,is_current,updated_at) on public.university_services to service_role;

create table public.university_systems (
 id uuid primary key,
 document_id uuid not null references public.documents(id),
 dataset_code text generated always as ('university_systems'::text) stored,
 department_id uuid references public.departments(id),
 code text not null check(private.structured_text_valid(code,200)),
 name text not null check(private.structured_text_valid(name,500)),
 description text check(private.structured_text_valid(description,5000)),
 url text not null check(private.structured_text_valid(url,2000)),
 support_url text check(private.structured_text_valid(support_url,2000)),
 active boolean not null default false,is_current boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(id,document_id,dataset_code) references private.structured_row_provenance(id,document_id,dataset_code)
);
create index university_systems_document_idx on public.university_systems(document_id);
create index university_systems_provenance_idx on public.university_systems(id,document_id,dataset_code);
create index university_systems_department_idx on public.university_systems(department_id);
create index university_systems_exact_idx on public.university_systems(code);
alter table public.university_systems enable row level security;
revoke all on public.university_systems from public,anon,authenticated,service_role;
grant select,insert on public.university_systems to service_role;
grant update(active,is_current,updated_at) on public.university_systems to service_role;

create table public.service_forms (
 id uuid primary key,
 document_id uuid not null references public.documents(id),
 dataset_code text generated always as ('service_forms'::text) stored,
 department_id uuid references public.departments(id),
 name text not null check(private.structured_text_valid(name,500)),
 description text check(private.structured_text_valid(description,5000)),
 form_url text not null check(private.structured_text_valid(form_url,2000)),
 requirements text check(private.structured_text_valid(requirements,5000)),
 active boolean not null default false,is_current boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(id,document_id,dataset_code) references private.structured_row_provenance(id,document_id,dataset_code)
);
create index service_forms_document_idx on public.service_forms(document_id);
create index service_forms_provenance_idx on public.service_forms(id,document_id,dataset_code);
create index service_forms_department_idx on public.service_forms(department_id);
create index service_forms_exact_idx on public.service_forms(name);
alter table public.service_forms enable row level security;
revoke all on public.service_forms from public,anon,authenticated,service_role;
grant select,insert on public.service_forms to service_role;
grant update(active,is_current,updated_at) on public.service_forms to service_role;

create table public.announcements (
 id uuid primary key,
 document_id uuid not null references public.documents(id),
 dataset_code text generated always as ('announcements'::text) stored,
 department_id uuid references public.departments(id),
 title text not null check(private.structured_text_valid(title,500)),
 summary text check(private.structured_text_valid(summary,5000)),
 publish_at timestamptz not null check(private.structured_timestamp_valid(publish_at)),
 effective_from timestamptz not null check(private.structured_timestamp_valid(effective_from)),
 effective_to timestamptz check(private.structured_timestamp_valid(effective_to) and effective_to>=effective_from),
 priority integer not null check(priority between 0 and 100),
 active boolean not null default false,is_current boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(id,document_id,dataset_code) references private.structured_row_provenance(id,document_id,dataset_code)
);
create index announcements_document_idx on public.announcements(document_id);
create index announcements_provenance_idx on public.announcements(id,document_id,dataset_code);
create index announcements_department_idx on public.announcements(department_id);
create index announcements_exact_idx on public.announcements(publish_at,priority desc);
alter table public.announcements enable row level security;
revoke all on public.announcements from public,anon,authenticated,service_role;
grant select,insert on public.announcements to service_role;
grant update(active,is_current,updated_at) on public.announcements to service_role;

create function private.guard_structured_row() returns trigger
language plpgsql security invoker set search_path='' as $$
declare source public.documents%rowtype;record_value jsonb;
begin
 if tg_op='DELETE' then
  raise exception using errcode='23514',message='STRUCTURED_ROW_IMMUTABLE';
 end if;
 -- PostgreSQL computes generated columns after BEFORE triggers. Its fixed discriminator
 -- cannot be supplied/changed by DML and is excluded from this source-value comparison.
 if tg_op='UPDATE' and (to_jsonb(new)-array['active','is_current','updated_at','dataset_code'])::text
   is distinct from (to_jsonb(old)-array['active','is_current','updated_at','dataset_code'])::text then
  raise exception using errcode='23514',message='STRUCTURED_ROW_IMMUTABLE';
 end if;
 -- INSERT locks source before a new row. UPDATE already holds a typed-row lock;
 -- taking a document lock there would invert document -> row lifecycle ordering.
 -- Canonical document eligibility remains authoritative, and a waiting document
 -- update refreshes projections after this row-only update releases its lock.
 if tg_op='INSERT' then
  select * into source from public.documents where id=new.document_id for share;
 else
  select * into source from public.documents where id=new.document_id;
 end if;
 if not found then
  raise exception using errcode='23503',message='STRUCTURED_DOCUMENT_REQUIRED';
 end if;
 record_value=to_jsonb(new);
 if record_value ? 'department_id' and (record_value->>'department_id')::uuid is distinct from source.department_id then
  raise exception using errcode='23514',message='STRUCTURED_DEPARTMENT_MISMATCH';
 end if;
 new.active=source.status='ACTIVE' and source.approval_status='APPROVED' and source.extraction_reviewed and not source.requires_review;
 new.is_current=source.is_current;
 if tg_op='UPDATE' then new.updated_at=clock_timestamp();end if;
 return new;
end;
$$;
create trigger academic_calendar_events_source_guard before insert or update or delete on public.academic_calendar_events
for each row execute function private.guard_structured_row();
create trigger tuition_fees_source_guard before insert or update or delete on public.tuition_fees
for each row execute function private.guard_structured_row();
create trigger transfer_courses_source_guard before insert or update or delete on public.transfer_courses
for each row execute function private.guard_structured_row();
create trigger university_services_source_guard before insert or update or delete on public.university_services
for each row execute function private.guard_structured_row();
create trigger university_systems_source_guard before insert or update or delete on public.university_systems
for each row execute function private.guard_structured_row();
create trigger service_forms_source_guard before insert or update or delete on public.service_forms
for each row execute function private.guard_structured_row();
create trigger announcements_source_guard before insert or update or delete on public.announcements
for each row execute function private.guard_structured_row();

create function private.require_structured_provenance_row() returns trigger
language plpgsql security invoker set search_path='' as $$
declare paired boolean=false;
begin
 case new.dataset_code
 when 'academic_calendar_events' then select exists(select 1 from public.academic_calendar_events where id=new.id and document_id=new.document_id) into paired;
 when 'tuition_fees' then select exists(select 1 from public.tuition_fees where id=new.id and document_id=new.document_id) into paired;
 when 'transfer_courses' then select exists(select 1 from public.transfer_courses where id=new.id and document_id=new.document_id) into paired;
 when 'university_services' then select exists(select 1 from public.university_services where id=new.id and document_id=new.document_id) into paired;
 when 'university_systems' then select exists(select 1 from public.university_systems where id=new.id and document_id=new.document_id) into paired;
 when 'service_forms' then select exists(select 1 from public.service_forms where id=new.id and document_id=new.document_id) into paired;
 when 'announcements' then select exists(select 1 from public.announcements where id=new.id and document_id=new.document_id) into paired;
 else paired=false;
 end case;
 if not paired then raise exception using errcode='23514',message='STRUCTURED_PROVENANCE_ROW_REQUIRED';end if;
 return null;
end;
$$;
create constraint trigger structured_provenance_requires_row after insert on private.structured_row_provenance
deferrable initially deferred for each row execute function private.require_structured_provenance_row();

create function private.guard_structured_document_source() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if row(new.checksum,new.department_id) is distinct from row(old.checksum,old.department_id)
  and exists(select 1 from private.structured_row_provenance where document_id=old.id) then
  raise exception using errcode='23514',message='STRUCTURED_DOCUMENT_SOURCE_IMMUTABLE';
 end if;
 return new;
end;
$$;
create trigger documents_structured_source_guard before update of checksum,department_id on public.documents
for each row execute function private.guard_structured_document_source();

create function private.sync_structured_document_lifecycle() returns trigger
language plpgsql security invoker set search_path='' as $$
declare source_active boolean=new.status='ACTIVE' and new.approval_status='APPROVED' and new.extraction_reviewed and not new.requires_review;
begin
 if row(new.status,new.approval_status,new.extraction_reviewed,new.requires_review,new.is_current)
  is not distinct from row(old.status,old.approval_status,old.extraction_reviewed,old.requires_review,old.is_current) then return null;end if;
 update public.academic_calendar_events set active=source_active,is_current=new.is_current,updated_at=clock_timestamp() where document_id=new.id;
 update public.tuition_fees set active=source_active,is_current=new.is_current,updated_at=clock_timestamp() where document_id=new.id;
 update public.transfer_courses set active=source_active,is_current=new.is_current,updated_at=clock_timestamp() where document_id=new.id;
 update public.university_services set active=source_active,is_current=new.is_current,updated_at=clock_timestamp() where document_id=new.id;
 update public.university_systems set active=source_active,is_current=new.is_current,updated_at=clock_timestamp() where document_id=new.id;
 update public.service_forms set active=source_active,is_current=new.is_current,updated_at=clock_timestamp() where document_id=new.id;
 update public.announcements set active=source_active,is_current=new.is_current,updated_at=clock_timestamp() where document_id=new.id;
 return null;
end;
$$;
create trigger documents_structured_lifecycle after update of status,approval_status,extraction_reviewed,requires_review,is_current on public.documents
for each row execute function private.sync_structured_document_lifecycle();

revoke all on function private.structured_text_valid(text,integer) from public,anon,authenticated;
grant execute on function private.structured_text_valid(text,integer) to service_role;
revoke all on function private.structured_timestamp_valid(timestamptz) from public,anon,authenticated;
grant execute on function private.structured_timestamp_valid(timestamptz) to service_role;
revoke all on function private.guard_structured_provenance() from public,anon,authenticated;
grant execute on function private.guard_structured_provenance() to service_role;
revoke all on function private.guard_structured_row() from public,anon,authenticated;
grant execute on function private.guard_structured_row() to service_role;
revoke all on function private.require_structured_provenance_row() from public,anon,authenticated;
grant execute on function private.require_structured_provenance_row() to service_role;
revoke all on function private.guard_structured_document_source() from public,anon,authenticated;
grant execute on function private.guard_structured_document_source() to service_role;
revoke all on function private.sync_structured_document_lifecycle() from public,anon,authenticated;
grant execute on function private.sync_structured_document_lifecycle() to service_role;
