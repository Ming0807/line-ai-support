import type {PoolClient} from 'pg';
import {z} from 'zod';
import {isValidKnowledgeDate} from './metadata-filter';
import type {KnowledgeEvidence,KnowledgeScope} from './types';
import {LOCAL_EMBEDDING_FINGERPRINT} from './embedding-space';
import {buildRuleProof} from './rule-proof';

const nullableCode=z.string().min(1).max(80).nullable();
const nullableYear=z.number().int().min(2400).max(3000).nullable();
export const knowledgeScopeSchema=z.object({historical:z.boolean(),academicYear:nullableYear,
 asOfDate:z.string().refine(isValidKnowledgeDate).nullable(),familyCodes:z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/)).max(20),
 departmentCode:nullableCode,audience:nullableCode,studentType:nullableCode,semester:z.string().min(1).max(40).nullable(),
 programCode:nullableCode,curriculumCode:nullableCode,cohort:nullableYear}).strict()
 .refine(s=>s.historical?(s.academicYear!==null||s.asOfDate!==null):s.asOfDate===null);
const requestSchema=z.object({scope:knowledgeScopeSchema,vector:z.array(z.number().finite().min(-3.402823466e38).max(3.402823466e38)).min(1).max(4096)
 .refine(v=>v.some(n=>n!==0)),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),threshold:z.number().finite().min(-1).max(1).default(0.65),
 limit:z.number().int().min(1).max(12).default(8)}).strict();
export interface KnowledgeSearchRequest {scope:KnowledgeScope;vector:number[];fingerprint:string;threshold?:number;limit?:number}
interface RuleGroup {
 familyId:string;baseDocumentId:string;versionStream:string;ruleRevision:string;evaluationDate:string;
 memberCount:number;usableCount:number;
 members:{documentId:string;revision:number}[];
 effects:{sourceDocumentId:string;targetDocumentId:string;relationType:'AMENDS'|'CANCELS';revision:number}[];
 chunks:(KnowledgeEvidence&{memberRank:number})[];
}

/** Caller owns its transaction. Provider HTTP must finish before calling this. */
export async function searchKnowledge(
 client:PoolClient,input:KnowledgeSearchRequest,today?:string,
):Promise<KnowledgeEvidence[]> {
 const parsed=requestSchema.safeParse(input);
 if(!parsed.success||(today!==undefined&&!isValidKnowledgeDate(today)))throw new Error('KNOWLEDGE_SCOPE_INVALID');
 const {scope:s,vector,fingerprint,threshold,limit}=parsed.data;
 const localE5=fingerprint===LOCAL_EMBEDDING_FINGERPRINT;
 if(localE5&&vector.length!==384)throw new Error('KNOWLEDGE_SCOPE_INVALID');
 // Fixed source-owned identifiers only; never a caller-provided column or SQL fragment.
 const embeddingColumn=localE5?'embedding_e5':'embedding';
 const queryVectorType=localE5?'extensions.vector(384)':'extensions.vector';
 // This is a caller-owned transaction. A pg callback timeout alone does not cancel SQL.
 await client.query(`select set_config('statement_timeout',case when current_setting('statement_timeout')='0' then '4000'
  else least(4000,(extract(epoch from current_setting('statement_timeout')::interval)*1000)::integer)::text end,true)`);
 const query={text:`with request_date as materialized (
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
  select 1 from potential_effects parent join bases b on b.id=parent.base_id
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
 ), scored_chunks as materialized (
  select m.base_id,c.id chunk_id,c.page_number,c.section_title,c.content,c.source_locations,d.id document_id,d.revision document_revision,
   d.title,b.family_code,d.academic_year,d.authority_level,coalesce(d.source_url,d.source_page_url) source_url,
   case when $2::text is not null and dept.code=$2 then 1 else 0 end department_relevance,
   d.approved_at,1-(c.${embeddingColumn} operator(extensions.<=>) $15::${queryVectorType}) similarity
  from members m join groups b on b.id=m.base_id join public.documents d on d.id=m.document_id
  left join public.departments dept on dept.id=d.department_id
  join public.knowledge_chunks c on c.document_id=m.document_id
  where not c.requires_review and c.${embeddingColumn} is not null and c.embedding_fingerprint=$13 and c.embedding_dimensions=$14
 ), ranked_chunks as materialized (
  select *,row_number() over(partition by base_id,document_id order by similarity desc,chunk_id) member_rank from scored_chunks
 ), relevant_groups as (
  select b.*,stats.usable_count,stats.authority,stats.similarity,stats.department_relevance group_department_relevance,stats.approved_at group_freshness
  from groups b join lateral(select count(distinct document_id)::int usable_count,max(authority_level) authority,max(similarity) similarity,max(department_relevance) department_relevance,max(approved_at) approved_at
   from scored_chunks where base_id=b.id) stats on stats.similarity >= $16
  order by stats.authority desc,stats.department_relevance desc,stats.similarity desc,stats.approved_at desc nulls last,b.id limit 13
 ), group_results as (
  select b.document_family_id "familyId",b.id "baseDocumentId",b.version_stream "versionStream",b.rule_revision "ruleRevision",b.evaluation_date::text "evaluationDate",
   row_number() over(order by b.authority desc,b.group_department_relevance desc,b.similarity desc,b.group_freshness desc nulls last,b.id) group_order,
   (select count(*)::int from members where base_id=b.id) "memberCount",b.usable_count "usableCount",
   (select jsonb_agg(x order by x."documentId") from(select document_id "documentId",revision from members where base_id=b.id order by document_id limit 201) x) members,
   coalesce((select jsonb_agg(x order by x."sourceDocumentId",x."targetDocumentId",x."relationType") from(select source_document_id "sourceDocumentId",target_document_id "targetDocumentId",relation_type "relationType",revision
    from potential_effects where base_id=b.id and not unresolved_scope order by source_document_id,target_document_id,relation_type limit 401) x),'[]'::jsonb) effects,
   coalesce((select jsonb_agg(jsonb_build_object('chunkId',x.chunk_id,'documentId',x.document_id,'documentRevision',x.document_revision,'title',x.title,'familyCode',x.family_code,
    'academicYear',x.academic_year,'authorityLevel',x.authority_level,'pageNumber',x.page_number,'sectionTitle',x.section_title,'content',x.content,'sourceUrl',x.source_url,'sourceLocations',x.source_locations,'similarity',x.similarity,'memberRank',x.member_rank::int)
    order by (x.member_rank=1) desc,x.authority_level desc,x.department_relevance desc,x.similarity desc,x.approved_at desc nulls last,x.document_id,x.chunk_id)
    from(select * from ranked_chunks where base_id=b.id order by (member_rank=1) desc,authority_level desc,department_relevance desc,similarity desc,approved_at desc nulls last,document_id,chunk_id limit $17) x),'[]'::jsonb) chunks
  from relevant_groups b order by b.authority desc,b.group_department_relevance desc,b.similarity desc,b.group_freshness desc nulls last,b.id
 )
 select ambiguous,exists(select 1 from unsupported_effects) unsupported,
  coalesce((select jsonb_agg(to_jsonb(group_results)-'group_order' order by group_order) from group_results),'[]'::jsonb) groups from scope_ambiguity`,
 values:[s.familyCodes,s.departmentCode,s.audience,s.studentType,s.semester,s.programCode,s.curriculumCode,s.cohort,
  s.historical,today??null,s.academicYear,s.asOfDate,fingerprint,vector.length,JSON.stringify(vector),threshold,limit],query_timeout:5000};
 const result=await client.query<{ambiguous:boolean;unsupported:boolean;groups:RuleGroup[]}>(query);
 if(result.rows[0].ambiguous)throw new Error('KNOWLEDGE_SCOPE_AMBIGUOUS');
 if(result.rows[0].unsupported)throw new Error('KNOWLEDGE_CONTEXT_INCOMPLETE');
 const selected:{group:RuleGroup;proof:ReturnType<typeof buildRuleProof>}[]=[];
 let requiredCount=0;
 for(const group of result.rows[0].groups){
  if(group.memberCount>limit||group.memberCount!==group.usableCount||group.members.length>200||group.effects.length>400)throw new Error('KNOWLEDGE_CONTEXT_INCOMPLETE');
  if(requiredCount+group.memberCount>limit)break;
  const {familyId,baseDocumentId,versionStream,ruleRevision,evaluationDate,members,effects}=group;
  const proof=buildRuleProof({familyId,baseDocumentId,versionStream,ruleRevision,evaluationDate,members,effects});
  selected.push({group,proof});requiredCount+=group.memberCount;
 }
 const evidence:KnowledgeEvidence[]=[],extras:KnowledgeEvidence[]=[];
 for(const {group,proof} of selected)for(const {memberRank,...row} of group.chunks){
  const item={...row,ruleProof:structuredClone(proof)};
  if(memberRank===1)evidence.push(item);else extras.push(item);
 }
 return [...evidence,...extras.slice(0,limit-evidence.length)];
}
