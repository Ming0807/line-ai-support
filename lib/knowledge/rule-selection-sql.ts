/** Shared source-owned eligibility/effect selection. Parameter slots1..12 retain the legacy RAG contract. */
export const knowledgeRuleSelectionSQL=`with request_date as materialized (
  select coalesce($12::date,$10::date,(statement_timestamp() at time zone 'Asia/Bangkok')::date) evaluation_date
 ), eligible_documents as materialized (
  select d.*,f.code as family_code,row_number() over(partition by d.document_family_id,d.version_stream
   order by d.effective_from desc,d.approved_at desc,d.id) as version_rank,f.rule_revision::text rule_revision,
   rd.evaluation_date,
   case when $2::text is not null and dept.code=$2 then 1 else 0 end department_relevance
  from public.documents d join public.document_families f on f.id=d.document_family_id
  left join public.departments dept on dept.id=d.department_id
  cross join request_date rd
  where d.approval_status='APPROVED' and d.official_source and d.extraction_reviewed and not d.requires_review
   and d.visibility='PUBLIC' and not d.archive_only and d.effective_from is not null
   and not exists(select 1 from public.document_relationships r where r.source_document_id=d.id and r.relation_type in ('AMENDS','CANCELS'))
   and (cardinality($1::text[])=0 or f.code=any($1::text[]))
   and ($2::text is null or d.department_id is null or dept.code=$2)
   and (d.audience='ALL' or d.audience=$3::text) and (d.student_type='ALL' or d.student_type=$4::text)
   and (d.semester is null or d.semester=$5::text) and (d.program_code is null or d.program_code=$6::text)
   and (d.curriculum_code is null or d.curriculum_code=$7::text) and (d.cohort is null or d.cohort=$8::integer)
   and ((not $9::boolean and d.status='ACTIVE' and d.is_current
     and d.effective_from<=rd.evaluation_date
     and (d.effective_to is null or d.effective_to>=rd.evaluation_date)
     and ($11::integer is null or d.academic_year is null or d.academic_year=$11))
    or ($9::boolean and d.status in ('ACTIVE','SUPERSEDED','EXPIRED')
     and ($11::integer is null or d.academic_year=$11)
     and ($12::date is null or (d.effective_from<=$12 and (d.effective_to is null or d.effective_to>=$12)))))
 ), base_ambiguity as (
  select exists(select 1 from eligible_documents where $9::boolean and $12::date is null
   group by document_family_id,version_stream having count(*)>1) as ambiguous
 ), bases as materialized (
  select * from eligible_documents where not $9::boolean or $12::date is null or version_rank=1
 ), potential_effects as materialized (
  select b.id base_id,r.source_document_id,r.target_document_id,r.relation_type,d.revision,
   ($3::text is null and d.audience<>'ALL' or $4::text is null and d.student_type<>'ALL'
    or $5::text is null and d.semester is not null or $6::text is null and d.program_code is not null
    or $7::text is null and d.curriculum_code is not null or $8::integer is null and d.cohort is not null) unresolved_scope
  from bases b join public.document_relationships r on
   (r.relation_type='AMENDS' and r.target_document_id=b.id) or
   (r.relation_type='CANCELS' and (r.target_document_id=b.id or exists(select 1 from public.document_relationships a
    where a.relation_type='AMENDS' and a.target_document_id=b.id and a.source_document_id=r.target_document_id)))
  join public.documents d on d.id=r.source_document_id
  left join public.departments dept on dept.id=d.department_id
  where d.document_family_id=b.document_family_id and d.version_stream=b.version_stream
   and d.academic_year is not distinct from b.academic_year
   and d.approval_status='APPROVED' and d.official_source and d.extraction_reviewed and not d.requires_review
   and d.visibility='PUBLIC' and not d.archive_only and d.effective_from is not null
   and (d.status='ACTIVE' or $9::boolean and d.status in ('SUPERSEDED','EXPIRED'))
   and ($2::text is null or d.department_id is null or dept.code=$2)
   and ($3::text is null or d.audience='ALL' or d.audience=$3)
   and ($4::text is null or d.student_type='ALL' or d.student_type=$4)
   and ($5::text is null or d.semester is null or d.semester=$5)
   and ($6::text is null or d.program_code is null or d.program_code=$6)
   and ($7::text is null or d.curriculum_code is null or d.curriculum_code=$7)
   and ($8::integer is null or d.cohort is null or d.cohort=$8)
   and ($9::boolean and $12::date is null or d.effective_from<=b.evaluation_date and (d.effective_to is null or d.effective_to>=b.evaluation_date))
 ), unsupported_effects as (
  select b.id base_id from potential_effects parent join bases b on b.id=parent.base_id
  join public.document_relationships r on r.target_document_id=parent.source_document_id
   and (r.relation_type='AMENDS' or r.relation_type='CANCELS' and parent.relation_type='CANCELS')
  join public.documents d on d.id=r.source_document_id left join public.departments dept on dept.id=d.department_id
  where d.document_family_id=b.document_family_id and d.version_stream=b.version_stream and d.academic_year is not distinct from b.academic_year
   and d.approval_status='APPROVED' and d.official_source and d.extraction_reviewed and not d.requires_review
   and d.visibility='PUBLIC' and not d.archive_only and d.effective_from is not null
   and (d.status='ACTIVE' or $9::boolean and d.status in ('SUPERSEDED','EXPIRED'))
   and ($2::text is null or d.department_id is null or dept.code=$2)
   and ($3::text is null or d.audience='ALL' or d.audience=$3) and ($4::text is null or d.student_type='ALL' or d.student_type=$4)
   and ($5::text is null or d.semester is null or d.semester=$5) and ($6::text is null or d.program_code is null or d.program_code=$6)
   and ($7::text is null or d.curriculum_code is null or d.curriculum_code=$7) and ($8::integer is null or d.cohort is null or d.cohort=$8)
   and ($9::boolean and $12::date is null or d.effective_from<=b.evaluation_date and (d.effective_to is null or d.effective_to>=b.evaluation_date))
 ), scope_ambiguity as (
  select (select ambiguous from base_ambiguity) or exists(select 1 from potential_effects
   where unresolved_scope or $9::boolean and $12::date is null) ambiguous
 ), groups as materialized (
  select * from bases b where not exists(select 1 from potential_effects e
   where e.base_id=b.id and e.relation_type='CANCELS' and e.target_document_id=b.id and not e.unresolved_scope)
 ), members as materialized (
  select b.id base_id,b.id document_id,b.revision from groups b
  union
  select b.id,e.source_document_id,e.revision from groups b join potential_effects e on e.base_id=b.id
   where e.relation_type='AMENDS' and not e.unresolved_scope and not exists(select 1 from potential_effects cancel
    where cancel.base_id=b.id and cancel.relation_type='CANCELS' and cancel.target_document_id=e.source_document_id and not cancel.unresolved_scope)
 )`;
