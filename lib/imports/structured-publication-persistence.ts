import type {PoolClient} from 'pg';
import type {PreparedStructuredPublication} from './structured-publication-preparation';
import type {LocatedChunkPlan} from '../knowledge/located-plan-types';

/** Constant table/type/column contracts. No input is interpolated as an SQL identifier. */
const typedInserts={
 academic_calendar_events:`with context as(select $1::uuid document_id,$2::uuid department_id)
  insert into public.academic_calendar_events(id,document_id,academic_year,semester,student_type,event_type,title,start_date,end_date,description)
  select r.id,c.document_id,p.academic_year,p.semester,p.student_type,p.event_type,p.title,p.start_date,p.end_date,p.description from context c,jsonb_to_recordset($3::jsonb) r(id uuid,payload jsonb),
  lateral jsonb_populate_record(null::public.academic_calendar_events,r.payload) p`,
 tuition_fees:`with context as(select $1::uuid document_id,$2::uuid department_id)
  insert into public.tuition_fees(id,document_id,academic_year,program_name,major_name,student_group,study_type,fee_amount,currency,effective_from,effective_to)
  select r.id,c.document_id,p.academic_year,p.program_name,p.major_name,p.student_group,p.study_type,p.fee_amount,p.currency,p.effective_from,p.effective_to from context c,jsonb_to_recordset($3::jsonb) r(id uuid,payload jsonb),
  lateral jsonb_populate_record(null::public.tuition_fees,r.payload) p`,
 transfer_courses:`with context as(select $1::uuid document_id,$2::uuid department_id)
  insert into public.transfer_courses(id,document_id,source_program,source_course_code,source_course_name,source_credits,target_program,target_course_code,target_course_name,target_credits,conditions)
  select r.id,c.document_id,p.source_program,p.source_course_code,p.source_course_name,p.source_credits,p.target_program,p.target_course_code,p.target_course_name,p.target_credits,p.conditions from context c,jsonb_to_recordset($3::jsonb) r(id uuid,payload jsonb),
  lateral jsonb_populate_record(null::public.transfer_courses,r.payload) p`,
 university_services:`with context as(select $1::uuid document_id,$2::uuid department_id)
  insert into public.university_services(id,document_id,department_id,service_code,name,description,location,opening_hours,phone,email,url)
  select r.id,c.document_id,c.department_id,p.service_code,p.name,p.description,p.location,p.opening_hours,p.phone,p.email,p.url from context c,jsonb_to_recordset($3::jsonb) r(id uuid,payload jsonb),
  lateral jsonb_populate_record(null::public.university_services,r.payload) p`,
 university_systems:`with context as(select $1::uuid document_id,$2::uuid department_id)
  insert into public.university_systems(id,document_id,department_id,code,name,description,url,support_url)
  select r.id,c.document_id,c.department_id,p.code,p.name,p.description,p.url,p.support_url from context c,jsonb_to_recordset($3::jsonb) r(id uuid,payload jsonb),
  lateral jsonb_populate_record(null::public.university_systems,r.payload) p`,
 service_forms:`with context as(select $1::uuid document_id,$2::uuid department_id)
  insert into public.service_forms(id,document_id,department_id,name,description,form_url,requirements)
  select r.id,c.document_id,c.department_id,p.name,p.description,p.form_url,p.requirements from context c,jsonb_to_recordset($3::jsonb) r(id uuid,payload jsonb),
  lateral jsonb_populate_record(null::public.service_forms,r.payload) p`,
 announcements:`with context as(select $1::uuid document_id,$2::uuid department_id)
  insert into public.announcements(id,document_id,department_id,title,summary,publish_at,effective_from,effective_to,priority)
  select r.id,c.document_id,c.department_id,p.title,p.summary,p.publish_at,p.effective_from,p.effective_to,p.priority from context c,jsonb_to_recordset($3::jsonb) r(id uuid,payload jsonb),
  lateral jsonb_populate_record(null::public.announcements,r.payload) p`,
};
export function structuredEffectProof(prepared:PreparedStructuredPublication,plan:LocatedChunkPlan|null){
 const proof={dataset:prepared.dataset,documentRevision:prepared.documentRevision,sourceFormat:prepared.sourceFormat,
  extractionDigest:prepared.extractionDigest,mappingDigest:prepared.mappingDigest,structuredPlanDigest:prepared.planDigest,
  acknowledgmentDigest:prepared.acknowledgment.contentDigest,registryVersion:prepared.registryVersion,mapperVersion:prepared.mapperVersion,
  rowCount:prepared.rowCount,chunkCount:plan?.chunks.length??0,chunkPlanDigest:plan?.digest??null,
  rowManifest:prepared.rows.map(r=>({id:r.id,payloadDigest:r.payloadDigest,payload:r.payload})),
  chunkManifest:plan?.chunks.map(c=>({index:c.index,page:c.pageNumber,section:c.sectionTitle,content:c.content,locations:c.sourceLocations,tokens:c.passageTokenCount}))??[]};
 if(Buffer.byteLength(JSON.stringify(proof),'utf8')>32*1024*1024)throw new Error('STRUCTURED_EFFECT_PROOF_LIMIT');
 return proof;
}
export async function persistStructuredRows(client:PoolClient,prepared:PreparedStructuredPublication,departmentId:string){
 await client.query(`insert into private.structured_row_provenance(id,document_id,dataset_code,published_document_revision,job_id,job_revision,extraction_revision,review_revision,source_checksum,source_format,extraction_digest,mapping_digest,payload_digest,plan_digest,registry_version,mapper_version,table_index,row_index,table_first_row,source_row,coordinate_kind,evidence_encrypted)
  select r.id,$1,(r.context->>'dataset'),(r.context->>'documentRevision')::integer,(r.context->>'jobId')::uuid,
   (r.context->>'jobRevision')::integer,(r.context->>'extractionRevision')::integer,(r.context->>'reviewRevision')::integer,
   r.context->>'sourceChecksum',r.context->>'sourceFormat',r.context->>'extractionDigest',r.context->>'mappingDigest',r."payloadDigest",r.context->>'planDigest',
   r.context->>'registryVersion',r.context->>'mapperVersion',(r.context->>'tableIndex')::integer,(r.context->>'rowIndex')::integer,
   (r.context->>'tableFirstRow')::integer,(r.context->>'sourceRow')::integer,r.context->>'coordinateKind',r."evidenceEncrypted"
  from jsonb_to_recordset($2::jsonb) r(id uuid,context jsonb,"payloadDigest" text,"evidenceEncrypted" text)`,[prepared.documentId,JSON.stringify(prepared.rows)]);
 await client.query(typedInserts[prepared.dataset],[prepared.documentId,departmentId,JSON.stringify(prepared.rows.map(r=>({id:r.id,payload:r.payload})))]);
}
