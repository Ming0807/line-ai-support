import type {PoolClient} from 'pg';
import {knowledgeScopeSchema} from './retrieval';
import type {KnowledgeScope} from './types';
import {knowledgeRuleSelectionSQL} from './rule-selection-sql';
import {validateStructuredQuery,assessStructuredQuery,matchesStructuredPayload,type StructuredQuery} from './structured-query';
import {getStructuredRegistryEntry} from './structured-registry';
import {decryptStructuredRowEvidence} from './structured-row-envelope';
import {buildRuleProof} from './rule-proof';
import {validateStructuredEvidence,validateStructuredEvidenceList,type StructuredEvidence} from './structured-citations';
import {canonicalDigest} from '../imports/structured-mapping-contract';
import {isValidKnowledgeDate} from './metadata-filter';
import {decodeStoredImportSourceMetadata} from '../imports/import-staging';

const selectors={
 academic_calendar_events:{table:'public.academic_calendar_events',equal:{academic_year:'integer',semester:'text',student_type:'text',event_type:'text',title:'text'},extra:"(not($18::jsonb?'occurs_on') or r.start_date<=($18->>'occurs_on')::date and coalesce(r.end_date,r.start_date)>=($18->>'occurs_on')::date) and (not($18::jsonb?'start_date_from') or r.start_date>=($18->>'start_date_from')::date) and (not($18::jsonb?'start_date_to') or r.start_date<=($18->>'start_date_to')::date)"},
 tuition_fees:{table:'public.tuition_fees',equal:{academic_year:'integer',program_name:'text',major_name:'text',student_group:'text',study_type:'text',currency:'text'},extra:"(not($18::jsonb?'fee_amount_min') or r.fee_amount >= ($18->>'fee_amount_min')::numeric) and (not($18::jsonb?'fee_amount_max') or r.fee_amount <= ($18->>'fee_amount_max')::numeric) and (not($18::jsonb?'effective_on') or r.effective_from<=($18->>'effective_on')::date and (r.effective_to is null or r.effective_to>=($18->>'effective_on')::date))"},
 transfer_courses:{table:'public.transfer_courses',equal:{source_program:'text',source_course_code:'text',target_program:'text',target_course_code:'text'},extra:"(not($18::jsonb?'source_credits_min') or r.source_credits>=($18->>'source_credits_min')::numeric) and (not($18::jsonb?'source_credits_max') or r.source_credits<=($18->>'source_credits_max')::numeric) and (not($18::jsonb?'target_credits_min') or r.target_credits>=($18->>'target_credits_min')::numeric) and (not($18::jsonb?'target_credits_max') or r.target_credits<=($18->>'target_credits_max')::numeric)"},
 university_services:{table:'public.university_services',equal:{service_code:'text',name:'text',location:'text'},extra:'true'},
 university_systems:{table:'public.university_systems',equal:{code:'text',name:'text'},extra:'true'},
 service_forms:{table:'public.service_forms',equal:{name:'text',form_url:'text'},extra:'true'},
 announcements:{table:'public.announcements',equal:{title:'text'},extra:"(not($18::jsonb?'effective_at') or r.effective_from<=($18->>'effective_at')::timestamptz and (r.effective_to is null or r.effective_to>=($18->>'effective_at')::timestamptz)) and (not($18::jsonb?'priority_min') or r.priority>=($18->>'priority_min')::integer) and (not($18::jsonb?'priority_max') or r.priority<=($18->>'priority_max')::integer)"},
} as const;
/** Identifiers/operators come only from the constant source map. Every requested value is a parameter. */
export function buildStructuredSelector(input:unknown){
 const query=validateStructuredQuery(input),source=selectors[query.dataset];
 const equal=Object.entries(source.equal).map(([field,type])=>`(not($18::jsonb?'${field}') or r.${field} is not distinct from ($18->>'${field}')::${type})`);
 return {table:source.table,predicate:[...equal,source.extra].join(' and '),filters:query.filters};
}
export interface StructuredSearchRequest {query:StructuredQuery;scope:KnowledgeScope}
export type StructuredSearchResult={status:'READY';evidence:StructuredEvidence[]}|{status:'EMPTY'|'UNAVAILABLE'|'CONTEXT_INCOMPLETE'}|{status:'CLARIFICATION_REQUIRED';missing:string[]};
interface StoredRow extends Record<string,unknown>{
 row_id:string;document_id:string;live_revision:number;title:string;family_code:string;academic_year:number|null;authority_level:number;
 document_family_id:string;base_id:string;version_stream:string;rule_revision:string;evaluation_date:string;typed_matches:boolean;
 job_id:string;proof_job_id:string;published_document_revision:number;proof_document_revision:number;source_checksum:string;proof_source_checksum:string;
 extraction_digest:string;proof_extraction_digest:string;mapping_digest:string;proof_mapping_digest:string;plan_digest:string;proof_plan_digest:string;
 review_revision:number;proof_review_revision:number;job_revision:number;proof_job_revision:number;extraction_revision:number;proof_extraction_revision:number;
 payload_digest:string;proof_payload_digest:string;registry_version:string;mapper_version:string;source_format:string;table_index:number;row_index:number;
 table_first_row:number;source_row:number;coordinate_kind:string;evidence_encrypted:string;original_metadata_encrypted:string;proof_payload:unknown;document_source_url:string|null;
 group_members:{documentId:string;revision:number}[];group_effects:{sourceDocumentId:string;targetDocumentId:string;relationType:'AMENDS'|'CANCELS';revision:number}[];
}

/** Caller owns the authorized transaction. No network or key lookup occurs here. PUBLIC knowledge only. */
export async function searchStructured(client:PoolClient,input:StructuredSearchRequest,key:string,today?:string):Promise<StructuredSearchResult>{
 const query=validateStructuredQuery(input.query),scope=knowledgeScopeSchema.parse(input.scope),assessment=assessStructuredQuery(query);
 if(assessment.status!=='READY')return assessment;
 if(today!==undefined&&!isValidKnowledgeDate(today))throw new Error('STRUCTURED_QUERY_INVALID');
 const installed=(await client.query("select to_regclass('private.structured_publication_effects') is not null and to_regclass('private.structured_row_provenance') is not null and to_regprocedure('private.lock_structured_selection_catalog()') is not null and (select count(*)=7 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements') and c.relkind='r') ready")).rows[0]?.ready;
 if(!installed)return {status:'UNAVAILABLE'};
 await client.query("select set_config('statement_timeout',case when current_setting('statement_timeout')='0' then '4000' else least(4000,(extract(epoch from current_setting('statement_timeout')::interval)*1000)::integer)::text end,true)");
 const selector=buildStructuredSelector(query),fields=getStructuredRegistryEntry(query.dataset).fields.map(field=>field.name);
 const fieldKeys=fields.map(field=>`'${field}'`).join(',');
 // Selection, complete effect flags and limit+1 matching rows share one PostgreSQL statement snapshot.
 const sqlQuery={text:`${knowledgeRuleSelectionSQL},
 bindings as (select $13::text,$14::integer,$15::text,$16::real,$17::integer),
 matched as materialized (
  select r.id row_id,d.id document_id,d.revision live_revision,d.title,b.family_code,d.academic_year,d.authority_level,
   b.document_family_id,b.id base_id,b.version_stream,b.rule_revision,b.evaluation_date,
   (select jsonb_agg(jsonb_build_object('documentId',document_id,'revision',revision) order by document_id) from(select document_id,revision from members where base_id=b.id order by document_id limit 201) selected_members) group_members,
   coalesce((select jsonb_agg(jsonb_build_object('sourceDocumentId',source_document_id,'targetDocumentId',target_document_id,'relationType',relation_type,'revision',revision) order by source_document_id,target_document_id,relation_type) from(select source_document_id,target_document_id,relation_type,revision from potential_effects where base_id=b.id and not unresolved_scope order by source_document_id,target_document_id,relation_type limit 401) selected_effects),'[]'::jsonb) group_effects,
   v.*,e.mapping_digest proof_mapping_digest,e.structured_plan_digest proof_plan_digest,e.acknowledgment_digest,
   e.published_document_revision proof_document_revision,receipt.source_checksum proof_source_checksum,e.extraction_digest proof_extraction_digest,
   receipt.job_id proof_job_id,receipt.review_revision proof_review_revision,receipt.job_revision proof_job_revision,receipt.extraction_revision proof_extraction_revision,
   j.source_metadata_encrypted original_metadata_encrypted,coalesce(d.source_url,d.source_page_url) document_source_url,m.payload proof_payload,m."payloadDigest" proof_payload_digest,
   (to_jsonb(r)-array['id','document_id','dataset_code','department_id','active','is_current','created_at','updated_at'])=
    (select jsonb_object_agg(field,to_jsonb(expected)->field) from jsonb_populate_record(null::${selector.table},m.payload) expected cross join unnest(array[${fieldKeys}]) keys(field)) typed_matches
  from groups b join members member on member.base_id=b.id join public.documents d on d.id=member.document_id
  join ${selector.table} r on r.document_id=d.id
  join private.structured_row_provenance v on v.id=r.id and v.document_id=d.id and v.dataset_code=$19
  join private.structured_publication_effects e on e.document_id=d.id and e.dataset_code=$19
  join private.knowledge_import_publications receipt on receipt.job_id=e.job_id and receipt.document_id=e.document_id and receipt.storage_mode=e.storage_mode
  join private.knowledge_import_jobs j on j.id=e.job_id and j.publication_status='COMPLETED' and j.checksum=receipt.source_checksum
  cross join lateral jsonb_to_recordset(e.row_manifest) m(id uuid,payload jsonb,"payloadDigest" text)
  where m.id=r.id and ${selector.predicate}
  order by d.authority_level desc,d.approved_at desc nulls last,d.id,r.id limit $20
 )
 select exists(select 1 from potential_effects where base_id in(select base_id from matched) and (unresolved_scope or $9::boolean and $12::date is null)) or
  exists(select 1 from eligible_documents where $9::boolean and $12::date is null and (document_family_id,version_stream) in(select document_family_id,version_stream from matched) group by document_family_id,version_stream having count(*)>1) ambiguous,
  exists(select 1 from unsupported_effects where base_id in(select base_id from matched)) or exists(select 1 from matched where jsonb_array_length(group_members)>1) incomplete,
  coalesce((select jsonb_agg(to_jsonb(matched)) from matched),'[]'::jsonb) rows`,
 values:[scope.familyCodes,scope.departmentCode,scope.audience,scope.studentType,scope.semester,scope.programCode,scope.curriculumCode,scope.cohort,scope.historical,today??null,scope.academicYear,scope.asOfDate,null,null,null,null,null,JSON.stringify(selector.filters),query.dataset,query.limit+1],query_timeout:5000};
 const result=await client.query<{ambiguous:boolean;incomplete:boolean;rows:StoredRow[]}>(sqlQuery);
 const selected=result.rows[0];
 if(selected.ambiguous)return {status:'CLARIFICATION_REQUIRED',missing:['document_scope_or_historical_date']};
 if(selected.incomplete||selected.rows.length>query.limit)return {status:'CONTEXT_INCOMPLETE'};
 if(selected.rows.length===0)return {status:'EMPTY'};
 try{
  const evidence:StructuredEvidence[]=[];
  for(const row of selected.rows){
   if(!row.typed_matches||row.job_id!==row.proof_job_id||row.published_document_revision!==row.proof_document_revision||row.source_checksum!==row.proof_source_checksum||row.extraction_digest!==row.proof_extraction_digest||row.mapping_digest!==row.proof_mapping_digest||row.plan_digest!==row.proof_plan_digest||row.review_revision!==row.proof_review_revision||row.job_revision!==row.proof_job_revision||row.extraction_revision!==row.proof_extraction_revision||row.payload_digest!==row.proof_payload_digest)throw new Error('STRUCTURED_ROW_EVIDENCE_INVALID');
   const context={schemaVersion:1,dataset:query.dataset,registryVersion:row.registry_version,mapperVersion:row.mapper_version,rowId:row.row_id,documentId:row.document_id,documentRevision:row.published_document_revision,jobId:row.job_id,jobRevision:row.job_revision,extractionRevision:row.extraction_revision,reviewRevision:row.review_revision,sourceFormat:row.source_format,sourceChecksum:row.source_checksum,extractionDigest:row.extraction_digest,mappingDigest:row.mapping_digest,payloadDigest:row.payload_digest,planDigest:row.plan_digest,tableIndex:row.table_index,rowIndex:row.row_index,tableFirstRow:row.table_first_row,sourceRow:row.source_row,coordinateKind:row.coordinate_kind};
   const decoded=decryptStructuredRowEvidence(row.evidence_encrypted,context,key);
   const original=decodeStoredImportSourceMetadata({jobId:row.job_id,checksum:row.source_checksum,encrypted:row.original_metadata_encrypted},key);
   if(decoded.sourceUrl!==original.sourceUrl||canonicalDigest('structured-payload-v1',{dataset:query.dataset,payload:decoded.payload})!==canonicalDigest('structured-payload-v1',{dataset:query.dataset,payload:row.proof_payload})||!matchesStructuredPayload(query,decoded.payload))throw new Error('STRUCTURED_ROW_EVIDENCE_INVALID');
   // Complete effects include canceled amendments; active extra members require text clarification above.
   const ruleProof=buildRuleProof({familyId:row.document_family_id,baseDocumentId:row.base_id,versionStream:row.version_stream,ruleRevision:row.rule_revision,evaluationDate:row.evaluation_date,members:row.group_members,effects:row.group_effects});
   const {sourceFormat:_format,...reference}=context;void _format;
   evidence.push(validateStructuredEvidence({rowId:row.row_id,dataset:query.dataset,payload:decoded.payload,reference:{...reference,documentRevision:row.live_revision,sourceLocation:decoded.sourceLocation,ruleProof},title:row.title,familyCode:row.family_code,academicYear:row.academic_year,authorityLevel:row.authority_level,sourceUrl:row.document_source_url}));
  }
  if(query.dataset==='tuition_fees'&&!Object.hasOwn(query.filters,'currency')&&new Set(evidence.map(row=>(row.payload as {currency:string}).currency)).size>1)return {status:'CLARIFICATION_REQUIRED',missing:['currency']};
  return {status:'READY',evidence:validateStructuredEvidenceList(evidence)};
 }catch{return {status:'CONTEXT_INCOMPLETE'};}
}
