import type {PoolClient} from 'pg';
import {z} from 'zod';
import {isValidKnowledgeDate} from './metadata-filter';
import type {KnowledgeEvidence,KnowledgeScope} from './types';
import {LOCAL_EMBEDDING_FINGERPRINT} from './embedding-space';

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
 const query={text:`with eligible_documents as materialized (
  select d.*,f.code as family_code,row_number() over(partition by d.document_family_id,d.version_stream
   order by d.effective_from desc,d.approved_at desc,d.id) as version_rank
  from public.documents d join public.document_families f on f.id=d.document_family_id
  left join public.departments dept on dept.id=d.department_id
  where d.approval_status='APPROVED' and d.official_source and d.extraction_reviewed and not d.requires_review
   and d.visibility='PUBLIC' and not d.archive_only and d.effective_from is not null
   and (cardinality($1::text[])=0 or f.code=any($1::text[]))
   and ($2::text is null or d.department_id is null or dept.code=$2)
   and (d.audience='ALL' or d.audience=$3::text) and (d.student_type='ALL' or d.student_type=$4::text)
   and (d.semester is null or d.semester=$5::text) and (d.program_code is null or d.program_code=$6::text)
   and (d.curriculum_code is null or d.curriculum_code=$7::text) and (d.cohort is null or d.cohort=$8::integer)
   and ((not $9::boolean and d.status='ACTIVE' and d.is_current
     and d.effective_from<=coalesce($10::date,(clock_timestamp() at time zone 'Asia/Bangkok')::date)
     and (d.effective_to is null or d.effective_to>=coalesce($10::date,(clock_timestamp() at time zone 'Asia/Bangkok')::date))
     and ($11::integer is null or d.academic_year is null or d.academic_year=$11))
    or ($9::boolean and d.status in ('ACTIVE','SUPERSEDED','EXPIRED')
     and ($11::integer is null or d.academic_year=$11)
     and ($12::date is null or (d.effective_from<=$12 and (d.effective_to is null or d.effective_to>=$12)))))
 ), scope_ambiguity as (
  select exists(select 1 from eligible_documents where $9::boolean and $12::date is null
   group by document_family_id,version_stream having count(*)>1) as ambiguous
 ), eligible_chunks as materialized (
  select c.id as chunk_id,c.page_number,c.section_title,c.content,c.${embeddingColumn} as embedding,d.id as document_id,d.revision as document_revision,
   d.title,d.family_code,d.academic_year,d.authority_level,coalesce(d.source_url,d.source_page_url) as source_url
  from eligible_documents d join public.knowledge_chunks c on c.document_id=d.id
  where (not $9::boolean or $12::date is null or d.version_rank=1) and not c.requires_review
   and c.${embeddingColumn} is not null and c.embedding_fingerprint=$13 and c.embedding_dimensions=$14
 ), ranked as (
  select *,1-(embedding operator(extensions.<=>) $15::${queryVectorType}) as similarity from eligible_chunks
 ), matches as (select chunk_id as "chunkId",document_id as "documentId",document_revision as "documentRevision",title,family_code as "familyCode",
  academic_year as "academicYear",authority_level as "authorityLevel",page_number as "pageNumber",section_title as "sectionTitle",content,
  source_url as "sourceUrl",similarity from ranked where similarity >= $16
  order by authority_level desc,similarity desc,document_id,chunk_id limit $17)
  select ambiguous,coalesce((select jsonb_agg(matches) from matches),'[]'::jsonb) as evidence from scope_ambiguity`,
 values:[s.familyCodes,s.departmentCode,s.audience,s.studentType,s.semester,s.programCode,s.curriculumCode,s.cohort,
  s.historical,today??null,s.academicYear,s.asOfDate,fingerprint,vector.length,JSON.stringify(vector),threshold,limit],query_timeout:5000};
 const result=await client.query<{ambiguous:boolean;evidence:KnowledgeEvidence[]}>(query);
 if(result.rows[0].ambiguous)throw new Error('KNOWLEDGE_SCOPE_AMBIGUOUS');
 return result.rows[0].evidence;
}
