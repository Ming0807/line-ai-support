import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {approveImport,getImportPublication,type ImportPublicationOptions} from '../../lib/imports/import-publication';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob} from '../../lib/imports/import-staging';
import {analyzeImportJob,editImportExtraction,getImportPreview} from '../../lib/imports/import-extraction';
import {getImportChunkPlan} from '../../lib/imports/import-chunk-plan';
import {getImportStructuredPlan} from '../../lib/imports/import-structured-plan';
import {buildStructuredMappingPlan} from '../../lib/imports/structured-mapper';
import {saveImportReview} from '../../lib/imports/import-review';
import {unfinishedReviewDraft} from '../fixtures/import-review';
import {buildReviewWarnings} from '../../lib/imports/review-warnings';
import {reviewDraftSchema,type ImportReviewDraft} from '../../lib/imports/review-schema';
import {computeStructuredExtractionDigest} from '../../lib/imports/structured-mapper';
import {getStructuredRegistryEntry} from '../../lib/knowledge/structured-registry';
import {STRUCTURED_DATASETS,type StructuredDataset} from '../../lib/knowledge/structured-payload';
import {structuredMappingFixture} from '../fixtures/structured-mapping';
import {parseCsvSource} from '../../lib/imports/csv-parser';
import {parseHtmlSource} from '../../lib/imports/html-parser';
import {decryptStructuredRowEvidence} from '../../lib/knowledge/structured-row-envelope';
import {prepareStructuredPublication} from '../../lib/imports/structured-publication-preparation';
import {persistStructuredRows,structuredEffectProof} from '../../lib/imports/structured-publication-persistence';
import type {LocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {LOCAL_EMBEDDING_FINGERPRINT,LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION} from '../../lib/knowledge/embedding-space';
import type {ImportFormat,ImportSource} from '../../lib/imports/types';
import type {StructuredMappingPlan} from '../../lib/imports/structured-mapping-contract';
import {searchStructured} from '../../lib/knowledge/structured-search';
import {validateStructuredQuery} from '../../lib/knowledge/structured-query';
import {buildStructuredAnswer,structuredEvidenceStillMatches} from '../../lib/knowledge/structured-citations';
import type {KnowledgeScope} from '../../lib/knowledge/types';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob,claimAIJob,saveAIResult} from '../../lib/ai/jobs';
import {loadSupportSnapshot,saveSupportState} from '../../lib/ai/support-state';
import {enqueueOutbound} from '../../lib/queue/outbox';
import {runAICycle} from '../../lib/ai/run-worker';
import {runOutboxCycle} from '../../lib/queue/run-outbox';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {createKnowledgeToolRegistry} from '../../lib/ai/backend-tools';
import {buildRuleProof} from '../../lib/knowledge/rule-proof';
import {knowledgeStructuredCatalogLock} from '../../lib/knowledge/delivery-fence';
import {createStaffKnowledgeAssistance} from '../../lib/staff/knowledge-assistance';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_ISOLATED_DATABASE_REQUIRED');
const key=Buffer.alloc(32,61).toString('base64');
const databaseOptions={host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres'};
type Mode='STRUCTURED'|'BOTH';
type Action='NEW_FAMILY'|'REPLACE_CURRENT'|'ADD_HISTORICAL'|'AMEND_EXISTING'|'ADD_ADDITIONAL';
type Counters={tokenBatches:number;embeddingBatches:number;embeddedTexts:string[][]};
type ChunkPlan=Awaited<ReturnType<typeof getImportChunkPlan>>['plan'];
type Fixture={pool:Pool;actor:string;staff:string;key:string;applicationName:string;provider:LocalE5EmbeddingProvider;counters:Counters;
 options:ImportPublicationOptions&{structuredVerificationDatabase:string};
};
type Ready={dataset:StructuredDataset;mode:Mode;format:ImportFormat;source:ImportSource;jobId:string;jobRevision:number;extractionRevision:number;
 familyCode:string;mapping:Record<string,unknown>;plan:StructuredMappingPlan;acknowledgment:{contentDigest:string;mapperVersion:'structured-mapper-v1'};
 draft:ImportReviewDraft;reviewRevision:number;request:{id:string;expectedJobRevision:number;expectedExtractionRevision:number;expectedReviewRevision:number;confirmPublication:true};
 chunkPlan:{digest:string;chunkerVersion:'located-e5-v1';plan:ChunkPlan}|null;};

function escapeHtml(value:string){return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
function quoteCsv(value:string){return /[",\r\n]/u.test(value)?`"${value.replaceAll('"','""')}"`:value;}
function transformFor(kind:string){
 if(kind==='INTEGER')return 'INTEGER_V1';
 if(kind==='DECIMAL')return 'DECIMAL_V1';
 if(kind==='DATE')return 'DATE_GREGORIAN_V1';
 if(kind==='TIMESTAMP')return 'TIMESTAMP_UTC_V1';
 return 'TEXT_V1';
}
function sourceFor(dataset:StructuredDataset,format:ImportFormat,recordCount=1,publicFixture=false):ImportSource{
 const values={...structuredMappingFixture(dataset,format).expectedPayload},fields=getStructuredRegistryEntry(dataset).fields;
 // Public fixtures contain no contact identifiers; private fixtures retain all original phone/email coverage.
 if(publicFixture&&dataset==='university_services'){values.phone=null;values.email=null;}
 const fixtureTag=`fixture-${randomUUID().replaceAll('-','').slice(0,16)}`;
 const uniqueText=fields.find(field=>field.kind==='TEXT'&&typeof values[field.name]==='string');
 assert(uniqueText,'SYNTHETIC_DATASET_NEEDS_TEXT_FIELD');values[uniqueText.name]=`${values[uniqueText.name]} ${fixtureTag}`;
 const header=fields.map(field=>field.name),records=Array.from({length:recordCount},(_,index)=>fields.map(field=>{
  const value=values[field.name];if(value===null)return '';
  return field===uniqueText&&index>0?`${value} row-${index+1}`:String(value);
 }));
 const bytes=format==='CSV'
  ?new TextEncoder().encode([header,...records].map(row=>row.map(quoteCsv).join(',')).join('\r\n'))
  :new TextEncoder().encode(`<html><body><h1>Reviewed synthetic ${dataset}</h1><p>Approved integration fixture ${fixtureTag} for ${dataset}.</p><table><thead><tr>${header.map(value=>`<th>${escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${records.map(record=>`<tr>${record.map(value=>`<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
 return createImportSource({bytes,filename:`synthetic.${format.toLowerCase()}`,mimeType:format==='CSV'?'text/csv':'text/html',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
}
function providerFor(pool:Pool,applicationName:string,counters:Counters):LocalE5EmbeddingProvider{
 return {modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,
  countPassageTokens:async texts=>{counters.tokenBatches++;const active=(await pool.query('select count(*)::int n from pg_stat_activity where application_name=$1 and state=\'idle in transaction\'',[applicationName])).rows[0].n;assert.equal(active,0,'TOKEN_COUNT_MUST_RUN_OUTSIDE_SQL');return texts.map(()=>25);},
  embedPassages:async texts=>{counters.embeddingBatches++;counters.embeddedTexts.push([...texts]);const active=(await pool.query('select count(*)::int n from pg_stat_activity where application_name=$1 and state=\'idle in transaction\'',[applicationName])).rows[0].n;assert.equal(active,0,'PASSAGE_EMBEDDING_MUST_RUN_OUTSIDE_SQL');return texts.map(()=>[1,...Array(383).fill(0)]);},
  embedQuery:async()=>{throw new Error('QUERY_EMBED_NOT_ALLOWED');},
  healthCheck:async()=>({healthy:true,model:LOCAL_EMBEDDING_MODEL,dimension:384,mode:'Local',observedAt:new Date().toISOString(),httpStatus:200})};
}
async function fixture(work:(f:Fixture)=>Promise<void>){
 const actor=randomUUID(),staff=randomUUID(),applicationName=`structured-publication-${actor}`;
 const pool=new Pool({...databaseOptions,max:8,application_name:applicationName});
 const counters:Counters={tokenBatches:0,embeddingBatches:0,embeddedTexts:[]},provider=providerFor(pool,applicationName,counters);
 const f:Fixture={pool,actor,staff,key,applicationName,provider,counters,
  options:{pool,key,originalBackend:'PRIVATE_DATABASE',provider,structuredVerificationDatabase:database!}};
 try{
  for(const [id,role] of [[actor,'SUPER_ADMIN'],[staff,'STAFF']] as const){
   await pool.query('insert into auth.users(id) values($1)',[id]);
   await pool.query("insert into public.staff_profiles(id,role,display_name,active,department_id) values($1,$2,'Atomic structured fixture',true,case when $2='STAFF' then (select id from public.departments where code='IT') else null end)",[id,role]);
  }
  await work(f);
 }finally{await pool.end();}
}
function mappingFor(dataset:StructuredDataset,source:ImportSource,preview:Awaited<ReturnType<typeof analyzeImportJob>>,jobId:string,recordCount=1){
 const entry=getStructuredRegistryEntry(dataset);
 const fields=Object.fromEntries(entry.fields.map((field,index)=>[field.name,{kind:'COLUMN',columnIndex:index,transform:transformFor(field.kind),blank:field.nullable?'NULL':'REJECT'}]));
 return {version:1,registryVersion:'structured-v1',dataset,
  source:{jobId,jobRevision:preview.job.revision,extractionRevision:preview.extractionRevision,sourceChecksum:source.checksum,extractionDigest:computeStructuredExtractionDigest(source,preview.extraction)},
  tables:[{tableIndex:0,dataRanges:[{startRowIndex:1,endRowIndex:recordCount}],excludedRanges:[{startRowIndex:0,endRowIndex:0,reason:'HEADER',note:'Synthetic header row reviewed and excluded.'}],fields}],excludedTables:[]};
}
async function ready(f:Fixture,dataset:StructuredDataset,mode:Mode,format:ImportFormat='HTML',options:{familyCode?:string;action?:Action;relationship?:'CANCELS';target?:{documentId:string;revision:number};versionName?:string;academicYear?:number;recordCount?:number;visibility?:'PUBLIC'|'INTERNAL'}={}):Promise<Ready>{
 const source=sourceFor(dataset,format,options.recordCount??1,options.visibility==='PUBLIC'),{job}=await createImportJob(f.actor,source,f.options);
 const parse=async(value:ImportSource)=>format==='CSV'?parseCsvSource(value):parseHtmlSource(value);
 const preview=await analyzeImportJob(f.actor,job.id,0,{...f.options,parse});
 const mapping=mappingFor(dataset,source,preview,job.id,options.recordCount??1);
 const familyCode=options.familyCode??`SP_${randomUUID().replaceAll('-','').slice(0,20).toUpperCase()}`;
 const action=options.action??'NEW_FAMILY';
 const structured=getImportStructuredPlan(f.actor,job.id,{expectedJobRevision:preview.job.revision,expectedExtractionRevision:preview.extractionRevision,expectedReviewRevision:0,mapping},f.options);
 const mapped=await structured;
 assert.equal(mapped.publicationAvailable,true,'INSTALLED_INFRASTRUCTURE_IS_AVAILABLE_BUT_PREVIEW_DOES_NOT_APPROVE');
 const base=unfinishedReviewDraft();
 let draft=reviewDraftSchema.parse({...base,schemaVersion:3,chunkPlan:null,
  metadata:{...base.metadata,title:`Reviewed synthetic ${dataset}`,familyCode,newFamily:action==='NEW_FAMILY'?{name:`Synthetic ${dataset} family`,category:'TEST'}:null,
   departmentCode:'IT',documentType:'DATASET',versionName:options.versionName??'2569',versionStream:'DEFAULT',academicYear:options.academicYear??2569,
   scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:'2026-10-07',effectiveFrom:'2026-10-07',effectiveTo:null,
   authorityLevel:90,visibility:options.visibility??'INTERNAL',sourceUrl:options.visibility==='PUBLIC'?'https://fixture.yru.ac.th/structured-test':base.metadata.sourceUrl,storageMode:mode,datasetType:dataset},
  action,target:options.target??null,relationship:options.relationship??null,
  attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},
  warningDispositions:buildReviewWarnings(preview).map(warning=>({warningKey:warning.key,status:'CORRECTED',reason:'Reviewed synthetic integration source'})),
  structuredMapping:{mapping,acknowledgment:mapped.acknowledgment}});
 let saved=await saveImportReview(f.actor,job.id,{expectedJobRevision:preview.job.revision,expectedExtractionRevision:preview.extractionRevision,expectedReviewRevision:0,draft},f.options);
 let chunkPlan:Ready['chunkPlan']=null;
 if(mode==='BOTH'){
  const chunkSnapshot=await getImportChunkPlan(f.actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision},{...f.options,counter:f.provider});
  chunkPlan={digest:chunkSnapshot.plan.digest,chunkerVersion:chunkSnapshot.plan.chunkerVersion,plan:chunkSnapshot.plan};
  draft=reviewDraftSchema.parse({...draft,chunkPlan:{digest:chunkPlan.digest,chunkerVersion:chunkPlan.chunkerVersion}});
  saved=await saveImportReview(f.actor,job.id,{expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,draft},{...f.options,counter:f.provider});
 }
 const publicationPlan=buildStructuredMappingPlan(source,preview.extraction,{jobId:job.id,jobRevision:saved.jobRevision,extractionRevision:saved.extractionRevision,reviewRevision:saved.reviewRevision},mapping);
 return {dataset,mode,format,source,jobId:job.id,jobRevision:saved.jobRevision,extractionRevision:saved.extractionRevision,familyCode,mapping,
  plan:publicationPlan,acknowledgment:mapped.acknowledgment,draft,reviewRevision:saved.reviewRevision,
  request:{id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,confirmPublication:true},
  chunkPlan};
}
async function counts(f:Fixture,r:Ready){
 const result=(await f.pool.query(`select
  (select count(*)::int from public.documents where approved_by=$1) documents,
  (select count(*)::int from public.document_families where code=$2) families,
  (select count(*)::int from private.knowledge_import_publications where job_id=$3) receipts,
  (select count(*)::int from private.structured_publication_effects where job_id=$3) effects,
  (select count(*)::int from private.structured_row_provenance where job_id=$3) provenance,
  (select count(*)::int from public.knowledge_chunks c join public.documents d on d.id=c.document_id where d.approved_by=$1) chunks,
  (select publication_status from private.knowledge_import_jobs where id=$3) publication_status`,[f.actor,r.familyCode,r.jobId])).rows[0];
 const datasetRows=(await f.pool.query(`select count(*)::int n from public.${r.dataset} t join public.documents d on d.id=t.document_id where d.approved_by=$1`,[f.actor])).rows[0].n;
 return {...result,rows:datasetRows};
}
async function assertNoPublication(f:Fixture,r:Ready){
 assert.deepEqual(await counts(f,r),{documents:0,families:0,receipts:0,effects:0,provenance:0,chunks:0,publication_status:'NOT_PUBLISHED',rows:0});
}
function contextFrom(row:Record<string,unknown>,dataset:StructuredDataset){
 return {schemaVersion:1 as const,registryVersion:row.registry_version,mapperVersion:row.mapper_version,dataset,rowId:row.id,documentId:row.document_id,
  documentRevision:row.published_document_revision,jobId:row.job_id,jobRevision:row.job_revision,extractionRevision:row.extraction_revision,reviewRevision:row.review_revision,
  sourceFormat:row.source_format,sourceChecksum:row.source_checksum,extractionDigest:row.extraction_digest,mappingDigest:row.mapping_digest,payloadDigest:row.payload_digest,
  planDigest:row.plan_digest,tableIndex:row.table_index,rowIndex:row.row_index,tableFirstRow:row.table_first_row,sourceRow:row.source_row,coordinateKind:row.coordinate_kind};
}
function compareStoredValue(value:unknown,kind:string){
 if(value instanceof Date)return kind==='DATE'?`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`:value.toISOString();
 if(kind==='DECIMAL')return String(value);
 return value;
}
async function assertEffects(f:Fixture,r:Ready,receipt:{documentId:string;familyId:string;storageMode:string;planDigest:string}){
 const {rows:[proof]}=await f.pool.query('select * from private.structured_publication_effects where job_id=$1',[r.jobId]);
 assert(proof,'STRUCTURED_EFFECT_PROOF_REQUIRED');
 assert.equal(proof.document_id,receipt.documentId);assert.equal(proof.storage_mode,r.mode);assert.equal(proof.dataset_code,r.dataset);
 assert.equal(proof.published_document_revision,0);assert.equal(proof.source_format,r.format);
 assert.equal(proof.extraction_digest,r.plan.extractionDigest);assert.equal(proof.mapping_digest,r.plan.mappingDigest);
 assert.equal(proof.structured_plan_digest,r.plan.digest);assert.equal(proof.acknowledgment_digest,r.acknowledgment.contentDigest);
 assert.equal(proof.registry_version,'structured-v1');assert.equal(proof.mapper_version,'structured-mapper-v1');
 assert.equal(proof.row_count,r.plan.rows.length);assert.equal(proof.chunk_count,r.chunkPlan?.plan.chunks.length??0);
 assert.equal(proof.chunk_plan_digest,r.mode==='BOTH'?r.chunkPlan?.digest:null);
 assert.equal(receipt.planDigest,r.mode==='STRUCTURED'?r.plan.digest:r.chunkPlan?.digest);
 const rowManifest=proof.row_manifest as Array<{id:string;payloadDigest:string;payload:Record<string,unknown>}>;
 assert.equal(rowManifest.length,r.plan.rows.length);
 assert.deepEqual(rowManifest.map(row=>({payloadDigest:row.payloadDigest,payload:row.payload})),r.plan.rows.map(row=>({payloadDigest:row.payloadDigest,payload:row.payload})));
 assert.equal(new Set(rowManifest.map(row=>row.id)).size,rowManifest.length);
 const {rows:receiptRows}=await f.pool.query('select storage_mode,plan_digest,embedding_fingerprint from private.knowledge_import_publications where job_id=$1',[r.jobId]);
 assert.deepEqual(receiptRows[0],{storage_mode:r.mode,plan_digest:receipt.planDigest,embedding_fingerprint:r.mode==='BOTH'?LOCAL_EMBEDDING_FINGERPRINT:null});
 const {rows:prov}=await f.pool.query(`select id,document_id,dataset_code,published_document_revision,job_id,job_revision,extraction_revision,review_revision,
  source_checksum,source_format,extraction_digest,mapping_digest,payload_digest,plan_digest,registry_version,mapper_version,
  table_index,row_index,table_first_row,source_row,coordinate_kind,evidence_encrypted
  from private.structured_row_provenance where job_id=$1 order by row_index`,[r.jobId]);
 assert.equal(prov.length,rowManifest.length);
 const entry=getStructuredRegistryEntry(r.dataset);
 const {rows:typed}=await f.pool.query(`select * from public.${r.dataset} where document_id=$1 order by id`,[receipt.documentId]);
 assert.equal(typed.length,rowManifest.length);
 const typedById=new Map(typed.map(row=>[row.id,row]));
 const planByDigest=new Map(r.plan.rows.map(row=>[row.payloadDigest,row]));
 for(const [index,evidenceRow] of prov.entries()){
  const manifest=rowManifest[index]!,planned=planByDigest.get(evidenceRow.payload_digest);
  assert(planned,'MAPPED_ROW_MATCH_REQUIRED');assert.equal(evidenceRow.id,manifest.id);assert.equal(evidenceRow.document_id,receipt.documentId);
  assert.equal(evidenceRow.dataset_code,r.dataset);assert.equal(evidenceRow.published_document_revision,0);
  assert.equal(evidenceRow.job_id,r.jobId);assert.equal(evidenceRow.job_revision,r.jobRevision);assert.equal(evidenceRow.extraction_revision,r.extractionRevision);
  assert.equal(evidenceRow.review_revision,r.reviewRevision);assert.equal(evidenceRow.source_checksum,r.source.checksum);assert.equal(evidenceRow.source_format,r.format);
  assert.equal(evidenceRow.extraction_digest,r.plan.extractionDigest);assert.equal(evidenceRow.mapping_digest,r.plan.mappingDigest);
  assert.equal(evidenceRow.payload_digest,planned.payloadDigest);assert.equal(evidenceRow.plan_digest,r.plan.digest);
  assert.equal(evidenceRow.registry_version,'structured-v1');assert.equal(evidenceRow.mapper_version,'structured-mapper-v1');
  assert.equal(evidenceRow.table_index,planned.tableIndex);assert.equal(evidenceRow.row_index,planned.rowIndex);assert.equal(evidenceRow.source_row,planned.sourceRow);
  assert.equal(evidenceRow.table_first_row,planned.sourceRow-planned.rowIndex);assert.equal(evidenceRow.coordinate_kind,planned.coordinateKind);
  const decrypted=decryptStructuredRowEvidence(evidenceRow.evidence_encrypted,contextFrom(evidenceRow,r.dataset),f.key);
  assert.deepEqual(decrypted.payload,manifest.payload);
  const typedRow=typedById.get(evidenceRow.id);assert(typedRow,'TYPED_ROW_FOR_EACH_PROVENANCE_REQUIRED');
  assert.equal(typedRow.active,true);assert.equal(typedRow.is_current,true);
  for(const field of entry.fields)assert.deepEqual(compareStoredValue(typedRow[field.name],field.kind),manifest.payload[field.name],`${r.dataset}.${field.name}`);
 }
 const chunkManifest=proof.chunk_manifest as Array<{index:number;page:number|null;section:string|null;content:string;locations:unknown[];tokens:number}>;
 if(r.mode==='STRUCTURED'){
  assert.deepEqual(chunkManifest,[]);assert.equal((await f.pool.query('select count(*)::int n from public.knowledge_chunks where document_id=$1',[receipt.documentId])).rows[0].n,0);
 }else{
  const expected=r.chunkPlan!.plan.chunks.map(chunk=>({index:chunk.index,page:chunk.pageNumber,section:chunk.sectionTitle,content:chunk.content,locations:chunk.sourceLocations,tokens:chunk.passageTokenCount}));
  assert.deepEqual(chunkManifest,expected);
  const {rows:chunks}=await f.pool.query(`select chunk_index,page_number,section_title,content,source_locations,passage_token_count,embedding_dimensions,
   embedding_fingerprint,extensions.vector_dims(embedding_e5) as vector_dimensions from public.knowledge_chunks where document_id=$1 order by chunk_index`,[receipt.documentId]);
  assert.deepEqual(chunks.map(chunk=>({index:chunk.chunk_index,page:chunk.page_number,section:chunk.section_title,content:chunk.content,locations:chunk.source_locations,tokens:chunk.passage_token_count})),expected);
  assert(chunks.length>0);assert(chunks.every(chunk=>chunk.embedding_dimensions===384&&chunk.vector_dimensions===384&&chunk.embedding_fingerprint===LOCAL_EMBEDDING_FINGERPRINT));
 }
}
async function publish(f:Fixture,r:Ready,options:Partial<Fixture['options']>={}){
 return approveImport(f.actor,r.request,{...f.options,...options});
}

type EffectAttack='MISSING_PROOF'|'NULL_PAYLOAD_DIGEST'|'WRONG_PAYLOAD'|'UNKNOWN_FIELD'|'WRONG_PROVENANCE_HASH'|'EXTRA_ROWS'|'EXTRA_CHUNK';
const rejectedEffectCode:Record<EffectAttack,string>={
 MISSING_PROOF:'STRUCTURED_EFFECT_REQUIRED',NULL_PAYLOAD_DIGEST:'STRUCTURED_EFFECT_ROWS_INVALID',
 WRONG_PAYLOAD:'STRUCTURED_EFFECT_PAYLOAD_INVALID',UNKNOWN_FIELD:'STRUCTURED_EFFECT_PAYLOAD_INVALID',
 WRONG_PROVENANCE_HASH:'STRUCTURED_EFFECT_ROWS_INVALID',EXTRA_ROWS:'STRUCTURED_EFFECT_ROWS_INVALID',
 EXTRA_CHUNK:'STRUCTURED_EFFECT_CHUNKS_INVALID',
};
async function assertCommitRejectsEffect(f:Fixture,r:Ready,attack:EffectAttack){
 const preview=await getImportPreview(f.actor,r.jobId,f.options),documentId=randomUUID(),familyId=randomUUID();
 const binding={jobId:r.jobId,jobRevision:r.jobRevision,extractionRevision:r.extractionRevision,reviewRevision:r.reviewRevision};
 const prepared=prepareStructuredPublication(r.source,preview.extraction,binding,r.mapping,
  {documentId,documentRevision:0,acknowledgment:r.acknowledgment},f.key);
 const plan=r.chunkPlan?.plan??null;
 const effect=JSON.parse(JSON.stringify(structuredEffectProof(prepared,plan)));
 if(attack==='NULL_PAYLOAD_DIGEST')effect.rowManifest[0].payloadDigest=null;
 if(attack==='WRONG_PROVENANCE_HASH')effect.rowManifest[0].payloadDigest='f'.repeat(64);
 if(attack==='WRONG_PAYLOAD'){
  const payload=effect.rowManifest[0].payload,field=Object.keys(payload)[0];assert(field,'FIXED_ROW_HAS_PAYLOAD');
  const value=payload[field];payload[field]=typeof value==='string'?`${value} changed`:typeof value==='number'?value+1:'changed';
 }
 if(attack==='UNKNOWN_FIELD')effect.rowManifest[0].payload.unregistered_column='must not be projected';
 // Three actual prepared records, but a proof intentionally declaring only two.
 // Immediate FK/coordinate constraints pass; the actual COMMIT rejects the extra effect.
 if(attack==='EXTRA_ROWS'){effect.rowManifest.pop();effect.rowCount--;}

 const client=await f.pool.connect();let transactionOpen=false;
 try{
  await client.query('begin');transactionOpen=true;
  const metadata=r.draft.metadata;assert(metadata.newFamily,'NEW_FAMILY_METADATA_REQUIRED');
  const department=(await client.query('select id from public.departments where code=$1 and active',[metadata.departmentCode])).rows[0];
  assert(department,'ACTIVE_DEPARTMENT_REQUIRED');
  await client.query('insert into public.document_families(id,code,name,category,default_storage_mode) values($1,$2,$3,$4,$5)',
   [familyId,metadata.familyCode,metadata.newFamily.name,metadata.newFamily.category,r.mode]);
  await client.query(`insert into public.documents(id,document_family_id,department_id,title,document_type,version_name,version_stream,academic_year,semester,audience,student_type,program_code,curriculum_code,cohort,
   published_at,effective_from,effective_to,status,is_current,authority_level,approval_status,approved_by,approved_at,official_source,extraction_reviewed,requires_review,visibility,archive_only,source_url,source_page_url,mime_type,checksum,supersedes_document_id)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'ACTIVE',true,$18,'APPROVED',$19,clock_timestamp(),false,true,false,$20,false,$21,$22,$23,$24,null)`,
   [documentId,familyId,department.id,metadata.title,metadata.documentType,metadata.versionName,metadata.versionStream,metadata.academicYear,
    metadata.scope.semester,metadata.scope.audience,metadata.scope.studentType,metadata.scope.programCode,metadata.scope.curriculumCode,metadata.scope.cohort,
    metadata.publishedAt,metadata.effectiveFrom,metadata.effectiveTo,metadata.authorityLevel,f.actor,metadata.visibility,
    metadata.sourceUrl,metadata.sourcePageUrl,r.source.mimeType,r.source.checksum]);

  const review=(await client.query('select payload_hash from private.knowledge_import_reviews where job_id=$1 and review_revision=$2',[r.jobId,r.reviewRevision])).rows[0];
  assert(review,'SAVED_REVIEW_HASH_REQUIRED');
  const planDigest=r.mode==='STRUCTURED'?prepared.planDigest:r.chunkPlan!.digest;
  await client.query(`insert into private.knowledge_import_publications(job_id,job_revision,extraction_revision,review_revision,actor_id,document_id,family_id,storage_mode,action,relationship,source_checksum,review_hash,plan_digest,embedding_fingerprint)
   values($1,$2,$3,$4,$5,$6,$7,$8,'NEW_FAMILY',null,$9,$10,$11,$12)`,
   [r.jobId,r.jobRevision,r.extractionRevision,r.reviewRevision,f.actor,documentId,familyId,r.mode,r.source.checksum,review.payload_hash,planDigest,
    r.mode==='BOTH'?LOCAL_EMBEDDING_FINGERPRINT:null]);
  if(attack!=='MISSING_PROOF'){
   await client.query(`insert into private.structured_publication_effects(job_id,document_id,storage_mode,dataset_code,published_document_revision,source_format,extraction_digest,mapping_digest,structured_plan_digest,acknowledgment_digest,registry_version,mapper_version,row_count,chunk_count,chunk_plan_digest,row_manifest,chunk_manifest)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb)`,
    [r.jobId,documentId,r.mode,effect.dataset,effect.documentRevision,effect.sourceFormat,effect.extractionDigest,effect.mappingDigest,effect.structuredPlanDigest,
     effect.acknowledgmentDigest,effect.registryVersion,effect.mapperVersion,effect.rowCount,effect.chunkCount,effect.chunkPlanDigest,
     JSON.stringify(effect.rowManifest),JSON.stringify(effect.chunkManifest)]);
  }
  await persistStructuredRows(client,prepared,department.id);
  if(plan){
   const chunks=plan.chunks.map(chunk=>({index:chunk.index,page:chunk.pageNumber,section:chunk.sectionTitle,content:chunk.content,
    locations:chunk.sourceLocations,tokens:chunk.passageTokenCount,vector:JSON.stringify([1,...Array(383).fill(0)])}));
   await client.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,section_title,content,requires_review,embedding,embedding_dimensions,embedding_fingerprint,source_locations,passage_token_count)
    select $1,r.index,r.page,r.section,r.content,false,r.vector::extensions.vector,384,$3,r.locations,r.tokens
    from jsonb_to_recordset($2::jsonb) as r(index integer,page integer,section text,content text,locations jsonb,tokens integer,vector text)`,
    [documentId,JSON.stringify(chunks),LOCAL_EMBEDDING_FINGERPRINT]);
  }
  if(attack==='EXTRA_CHUNK')await client.query(`insert into public.knowledge_chunks(document_id,chunk_index,page_number,section_title,content,requires_review,embedding,embedding_dimensions,embedding_fingerprint,source_locations,passage_token_count)
   select c.document_id,(select coalesce(max(chunk_index),-1)+1 from public.knowledge_chunks where document_id=$1),c.page_number,c.section_title,c.content,c.requires_review,c.embedding,c.embedding_dimensions,c.embedding_fingerprint,c.source_locations,c.passage_token_count
   from public.knowledge_chunks c where c.document_id=$1 order by c.chunk_index limit 1`,[documentId]);
  await client.query("update private.knowledge_import_jobs set publication_status='COMPLETED' where id=$1",[r.jobId]);

  let commitError:unknown;
  try{await client.query('commit');transactionOpen=false;}
  catch(error){commitError=error;await client.query('rollback').catch(()=>undefined);transactionOpen=false;}
  assert(commitError,`${attack}: commit must reject the incomplete or inconsistent structured effect`);
  const sqlError=commitError as {code?:unknown;message?:unknown};
  assert.equal(sqlError.code,'23514');assert.match(String(sqlError.message??''),new RegExp(rejectedEffectCode[attack],'u'));
 }finally{
  if(transactionOpen)await client.query('rollback').catch(()=>undefined);
  client.release();
 }
}

for(const dataset of STRUCTURED_DATASETS)test(`${dataset}: actual retained HTML source publishes exact private evidence and typed rows without E5`,()=>fixture(async f=>{
 const r=await ready(f,dataset,'STRUCTURED');
 const result=await publish(f,r);assert.equal(result.replayed,false);assert.equal(result.receipt.storageMode,'STRUCTURED');
 assert.equal(f.counters.tokenBatches,0,'STRUCTURED_SKIPS_TOKEN_COUNT');assert.equal(f.counters.embeddingBatches,0,'STRUCTURED_SKIPS_E5');
 await assertEffects(f,r,result.receipt);
 const first=await publish(f,r);assert.equal(first.replayed,true);assert.deepEqual(first.receipt,result.receipt);
 assert.deepEqual(await getImportPublication(f.actor,r.jobId,f.options),{receipt:result.receipt});
 assert.deepEqual(await counts(f,r),{documents:1,families:1,receipts:1,effects:1,provenance:r.plan.rows.length,chunks:0,publication_status:'COMPLETED',rows:r.plan.rows.length});
 assert.equal(f.counters.tokenBatches,0);assert.equal(f.counters.embeddingBatches,0);
}));

test('BOTH: actual retained HTML source binds structured rows and reviewed RAG chunks to one receipt/document',()=>fixture(async f=>{
 const r=await ready(f,'tuition_fees','BOTH','HTML');assert(r.chunkPlan&&r.chunkPlan.plan.chunks.length>0);
 const result=await publish(f,r);assert.equal(result.replayed,false);assert.equal(result.receipt.storageMode,'BOTH');
 assert(f.counters.tokenBatches>0);assert(f.counters.embeddingBatches>0);assert(f.counters.embeddedTexts.flat().length>0);
 await assertEffects(f,r,result.receipt);
 assert.equal((await f.pool.query('select count(*)::int n from public.knowledge_chunks where document_id=$1',[result.receipt.documentId])).rows[0].n,r.chunkPlan.plan.chunks.length);
}));

test('CSV structured publication retains parser-derived record coordinates and exact source values',()=>fixture(async f=>{
 const r=await ready(f,'tuition_fees','STRUCTURED','CSV');const result=await publish(f,r);
 assert.equal(result.receipt.storageMode,'STRUCTURED');assert.equal(f.counters.tokenBatches,0);assert.equal(f.counters.embeddingBatches,0);
 await assertEffects(f,r,result.receipt);
 const sourceRows=(await f.pool.query('select source_format,coordinate_kind,source_row from private.structured_row_provenance where job_id=$1',[r.jobId])).rows;
 assert.deepEqual(sourceRows,[{source_format:'CSV',coordinate_kind:'CSV_RECORD',source_row:2}]);
}));

test('structured publication effect proof remains private and immutable after approval',()=>fixture(async f=>{
 const r=await ready(f,'university_systems','STRUCTURED'),result=await publish(f,r);
 for(const role of ['anon','authenticated'])assert.equal((await f.pool.query("select has_table_privilege($1,'private.structured_publication_effects','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
 for(const operation of ['SELECT','INSERT'])assert.equal((await f.pool.query("select has_table_privilege('service_role','private.structured_publication_effects',$1) allowed",[operation])).rows[0].allowed,true);
 for(const operation of ['UPDATE','DELETE'])assert.equal((await f.pool.query("select has_table_privilege('service_role','private.structured_publication_effects',$1) allowed",[operation])).rows[0].allowed,false);
 const before=(await f.pool.query('select row_manifest,chunk_manifest,row_count,chunk_count from private.structured_publication_effects where job_id=$1',[r.jobId])).rows[0];
 await assert.rejects(f.pool.query("update private.structured_publication_effects set row_manifest='[]'::jsonb where job_id=$1",[r.jobId]));
 await assert.rejects(f.pool.query('delete from private.structured_publication_effects where job_id=$1',[r.jobId]));
 assert.deepEqual((await f.pool.query('select row_manifest,chunk_manifest,row_count,chunk_count from private.structured_publication_effects where job_id=$1',[r.jobId])).rows[0],before);
 assert.equal(result.receipt.documentId,(await f.pool.query('select document_id from private.structured_publication_effects where job_id=$1',[r.jobId])).rows[0].document_id);
}));

test('replacement and historical publication retire only projections and preserve immutable prior payload/provenance',()=>fixture(async f=>{
 const firstReady=await ready(f,'tuition_fees','STRUCTURED');const first=await publish(f,firstReady);
 const before=(await f.pool.query('select to_jsonb(t)-array[\'active\',\'is_current\',\'updated_at\'] payload from public.tuition_fees t where document_id=$1',[first.receipt.documentId])).rows[0].payload;
 const replacementReady=await ready(f,'tuition_fees','STRUCTURED','HTML',{familyCode:firstReady.familyCode,action:'REPLACE_CURRENT',target:{documentId:first.receipt.documentId,revision:0},versionName:'2570',academicYear:2570});
 const replacement=await publish(f,replacementReady);
 assert.deepEqual((await f.pool.query('select status,is_current,revision from public.documents where id=$1',[first.receipt.documentId])).rows[0],{status:'SUPERSEDED',is_current:false,revision:1});
 assert.deepEqual((await f.pool.query('select active,is_current,to_jsonb(t)-array[\'active\',\'is_current\',\'updated_at\'] payload from public.tuition_fees t where document_id=$1',[first.receipt.documentId])).rows[0],{active:false,is_current:false,payload:before});
 assert.equal((await f.pool.query('select count(*)::int n from private.structured_row_provenance where document_id=$1',[first.receipt.documentId])).rows[0].n,firstReady.plan.rows.length);
 const historicalReady=await ready(f,'tuition_fees','STRUCTURED','HTML',{familyCode:firstReady.familyCode,action:'ADD_HISTORICAL',versionName:'2560',academicYear:2560});
 const historical=await publish(f,historicalReady);
 assert.deepEqual((await f.pool.query('select status,is_current from public.documents where id=$1',[historical.receipt.documentId])).rows[0],{status:'SUPERSEDED',is_current:false});
 assert.equal((await f.pool.query('select active,is_current from public.tuition_fees where document_id=$1',[historical.receipt.documentId])).rows[0].active,false);
 assert.equal((await f.pool.query(`select count(*)::int n from public.tuition_fees r join public.documents d on d.id=r.document_id
  join public.document_families family on family.id=d.document_family_id where family.code=$1 and r.active and r.is_current`,[firstReady.familyCode])).rows[0].n,1);
 assert.equal((await f.pool.query('select count(*)::int n from private.structured_row_provenance where document_id=any($1::uuid[])',[[first.receipt.documentId,replacement.receipt.documentId,historical.receipt.documentId]])).rows[0].n,
  firstReady.plan.rows.length+replacementReady.plan.rows.length+historicalReady.plan.rows.length);
}));

test('same structured approval racing after preparation commits one row set and replays one immutable receipt',()=>fixture(async f=>{
 const r=await ready(f,'university_systems','STRUCTURED');
 const secondPool=new Pool({...databaseOptions,max:4,application_name:`structured-publication-race-${f.actor}`});
 const secondProvider=providerFor(secondPool,`structured-publication-race-${f.actor}`,{tokenBatches:0,embeddingBatches:0,embeddedTexts:[]});
 let arrivals=0,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const beforeCommit=async()=>{if(++arrivals===2)release();await gate;};
 const first=approveImport(f.actor,r.request,{...f.options,beforeCommit});
 const second=approveImport(f.actor,r.request,{...f.options,pool:secondPool,provider:secondProvider,beforeCommit});
 try{
  const results=await Promise.all([first,second]);assert.equal(arrivals,2);assert.deepEqual(results[0].receipt,results[1].receipt);assert.equal(results.filter(result=>!result.replayed).length,1);
  assert.equal((await f.pool.query('select count(*)::int n from public.documents where approved_by=$1',[f.actor])).rows[0].n,1);
  assert.equal((await f.pool.query('select count(*)::int n from private.knowledge_import_publications where job_id=$1',[r.jobId])).rows[0].n,1);
  assert.equal((await f.pool.query('select count(*)::int n from private.structured_publication_effects where job_id=$1',[r.jobId])).rows[0].n,1);
  assert.equal((await f.pool.query(`select count(*)::int n from public.university_systems where document_id=$1`,[results[0].receipt.documentId])).rows[0].n,r.plan.rows.length);
 }finally{release();await Promise.allSettled([first,second]);await secondPool.end();}
}));

for(const failureAt of ['DOCUMENT','STRUCTURED','CHUNKS','ACTIVITY','RECEIPT'] as const)test(`forced ${failureAt} failure rolls back document, structured proof/rows, chunks and receipt`,()=>fixture(async f=>{
 const mode:Mode=failureAt==='CHUNKS'?'BOTH':'STRUCTURED';const r=await ready(f,'tuition_fees',mode);
 await assert.rejects(publish(f,r,{failureAt}),/INTERNAL_ERROR/);await assertNoPublication(f,r);
 if(mode==='STRUCTURED'){assert.equal(f.counters.tokenBatches,0);assert.equal(f.counters.embeddingBatches,0);}
}));

test('review changed after source preparation fails the final receipt fence',()=>fixture(async f=>{
 const r=await ready(f,'university_systems','STRUCTURED');
 await assert.rejects(publish(f,r,{beforeCommit:async()=>{
  await saveImportReview(f.actor,r.jobId,{expectedJobRevision:r.jobRevision,expectedExtractionRevision:r.extractionRevision,expectedReviewRevision:r.reviewRevision,draft:r.draft},f.options);
 }}),/CONFLICT/);
 await assertNoPublication(f,r);
}));

test('retained extraction changed after source preparation fails the final source/revision fence',()=>fixture(async f=>{
 const r=await ready(f,'university_systems','STRUCTURED');
 await assert.rejects(publish(f,r,{beforeCommit:async()=>{
  await editImportExtraction(f.actor,r.jobId,r.jobRevision,{reason:'Synthetic source review correction',pages:[{index:0,text:'Changed reviewed source text'}]},f.options);
 }}),/CONFLICT/);
 await assertNoPublication(f,r);
}));

test('administrator revoked after preparation cannot publish any structured effect',()=>fixture(async f=>{
 const r=await ready(f,'university_systems','STRUCTURED');
 await assert.rejects(publish(f,r,{beforeCommit:async()=>{await f.pool.query('update public.staff_profiles set active=false where id=$1',[f.actor]);}}),/FORBIDDEN/);
 await assertNoPublication(f,r);
}));

test('ordinary staff authorization precedes parsing and structured approval',()=>fixture(async f=>{
 const r=await ready(f,'university_systems','STRUCTURED');
 await assert.rejects(approveImport(f.staff,new Proxy({}, {get(){throw new Error('INPUT_SHOULD_NOT_BE_READ');}}),f.options),/FORBIDDEN/);
 await assertNoPublication(f,r);
}));

test('missing catalog fence or wrong isolated target fails readiness with no E5 work',()=>fixture(async f=>{
 const r=await ready(f,'university_systems','STRUCTURED');
 await assert.rejects(publish(f,r,{structuredVerificationDatabase:'postgres'}),{code:'PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE'});
 await f.pool.query('alter table public.departments disable trigger structured_selection_catalog');
 try{await assert.rejects(publish(f,r),{code:'PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE'});}
 finally{await f.pool.query('alter table public.departments enable trigger structured_selection_catalog');}
 assert.equal(f.counters.tokenBatches,0);assert.equal(f.counters.embeddingBatches,0);await assertNoPublication(f,r);
 assert(STRUCTURED_DATASETS.every(dataset=>getStructuredRegistryEntry(dataset).installed===false),'STATIC_REGISTRY_METADATA_IS_NOT_DEPLOYMENT_OBSERVATION');
}));
test('installed complete infrastructure permits the normal publication caller without a disposable-only switch',()=>fixture(async f=>{
 const r=await ready(f,'university_systems','STRUCTURED');
 const {structuredVerificationDatabase:_verification,...normalCaller}=f.options;void _verification;
 const result=await approveImport(f.actor,r.request,normalCaller);assert.equal(result.receipt.storageMode,'STRUCTURED');assert.equal(result.replayed,false);assert.equal(f.counters.embeddingBatches,0);
 const replay=await approveImport(f.actor,r.request,normalCaller);assert.equal(replay.replayed,true);assert.equal(replay.receipt.documentId,result.receipt.documentId);
}));

for(const attack of ['NULL_PAYLOAD_DIGEST','MISSING_PROOF','WRONG_PAYLOAD','UNKNOWN_FIELD','WRONG_PROVENANCE_HASH','EXTRA_ROWS','EXTRA_CHUNK'] as const)test(`actual COMMIT rejects ${attack.toLowerCase()} structured effects`,()=>fixture(async f=>{
 const mode:Mode=attack==='EXTRA_CHUNK'?'BOTH':'STRUCTURED';const r=await ready(f,'tuition_fees',mode,'HTML',{recordCount:attack==='EXTRA_ROWS'?3:1});
 await assertCommitRejectsEffect(f,r,attack);await assertNoPublication(f,r);
}));

function exactRequest(r:Ready,patch:Record<string,unknown>={}){
 const payload:Record<string,unknown>=r.plan.rows[0].payload;
 const keys:Record<StructuredDataset,string[]>={academic_calendar_events:['academic_year','semester','student_type','title'],tuition_fees:['academic_year','program_name','student_group','study_type','fee_amount_min','fee_amount_max'],transfer_courses:['source_program','source_course_code','target_program'],university_services:['service_code'],university_systems:['code'],service_forms:['name'],announcements:['title']};
 const filters=Object.fromEntries(keys[r.dataset].filter(key=>Object.hasOwn(payload,key)).map(key=>[key,payload[key]]));
 if(r.dataset==='tuition_fees'){filters.fee_amount_min=payload.fee_amount;filters.fee_amount_max=payload.fee_amount;}
 const query=validateStructuredQuery({version:1,dataset:r.dataset,filters:{...filters,...patch},limit:20});
 const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[r.familyCode],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 return {query,scope};
}
async function exactSearch(f:Fixture,r:Ready,patch:Record<string,unknown>={}){
 const client=await f.pool.connect();try{await client.query('begin');const result=await searchStructured(client,exactRequest(r,patch),f.key,'2026-10-08');await client.query('commit');return result;}catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
test('HUMAN staff advice revalidates actual approved structured envelopes without E5 or delivery',()=>fixture(async f=>{
 const r=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'}),receipt=await publish(f,r);
 const initial=await exactSearch(f,r);assert.equal(initial.status,'READY');if(initial.status!=='READY')return;
 const session=(await f.pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['STAFF_STRUCTURED_'+randomUUID()])).rows[0].id;
 const conversation=(await f.pool.query("insert into public.conversations(line_session_id,mode,conversation_type) values($1,'HUMAN','TICKET') returning id",[session])).rows[0].id;
 const ticket=(await f.pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,category,mode,status) values($1,$2,(select id from public.departments where code='IT'),'Owned structured question','IT_NETWORK','HUMAN','STAFF_HANDLING') returning id",[session,conversation])).rows[0].id;
 await f.pool.query("insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content) values($1,$2,'USER','TEXT','ขอข้อมูลบริการที่ตรวจแล้ว')",[conversation,ticket]);
 const result={kind:'STRUCTURED_ANSWER' as const,output:{answer:'ข้อมูลบริการที่ผ่านการตรวจแล้ว',citationRowIds:[initial.evidence[0].rowId]},...exactRequest(r),evidence:initial.evidence};
 const view=await createStaffKnowledgeAssistance(f.staff,ticket,{revision:0},{pool:f.pool,key:f.key,produce:async()=>result});
 assert.equal(view.status,'VERIFIED');assert(view.draftText?.includes('แหล่งอ้างอิง'));assert(view.sources[0].location?.includes('แถว'));
 assert(!JSON.stringify(view).includes(receipt.receipt.documentId));assert.equal(f.counters.embeddingBatches,0);
 assert.equal((await f.pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[ticket])).rows[0].n,0);
 await assert.rejects(createStaffKnowledgeAssistance(f.staff,ticket,{revision:0},{pool:f.pool,key:f.key,produce:async()=>{
  await f.pool.query("update public.documents set visibility='INTERNAL',revision=revision+1 where id=$1",[receipt.receipt.documentId]);return result;
 }}),{code:'CONFLICT'});
}));
for(const dataset of STRUCTURED_DATASETS)test(`${dataset}: exact PUBLIC retrieval authenticates published source payload and row reference`,()=>fixture(async f=>{
 const r=await ready(f,dataset,'STRUCTURED','HTML',{visibility:'PUBLIC'});const receipt=await publish(f,r);
 const result=await exactSearch(f,r);assert.equal(result.status,'READY');if(result.status!=='READY')return;
 assert.deepEqual(result.evidence[0].payload,r.plan.rows[0].payload);assert.equal(result.evidence[0].reference.documentId,receipt.receipt.documentId);
 assert.equal(result.evidence[0].reference.sourceRow,r.plan.rows[0].sourceRow);assert.equal(result.evidence[0].reference.ruleProof.evaluationDate,'2026-10-08');
 assert.equal(JSON.stringify(result).includes('evidenceEncrypted'),false);assert.equal(f.counters.embeddingBatches,0);
 const changedField=dataset==='academic_calendar_events'?'title':dataset==='tuition_fees'?'program_name':dataset==='transfer_courses'?'source_course_code':dataset==='university_services'?'service_code':dataset==='university_systems'?'code':dataset==='service_forms'?'name':'title';
 assert.equal((await exactSearch(f,r,{[changedField]:'not present in reviewed source'})).status,'EMPTY');
}));
test('student exact search excludes INTERNAL source and rejects wrong envelope key without exposing payload',()=>fixture(async f=>{
 const internal=await ready(f,'university_services','STRUCTURED');await publish(f,internal);assert.equal((await exactSearch(f,internal)).status,'EMPTY');
 const publicSource=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'});await publish(f,publicSource);
 const client=await f.pool.connect();try{await client.query('begin');const result=await searchStructured(client,exactRequest(publicSource),Buffer.alloc(32,62).toString('base64'),'2026-10-08');assert.deepEqual(result,{status:'CONTEXT_INCOMPLETE'});await client.query('rollback');}finally{client.release();}
}));
test('exact result cap never hides additional matching records',()=>fixture(async f=>{
 // All three rows differ only in service_code; name remains an exact shared source value.
 const services=await ready(f,'university_services','STRUCTURED','CSV',{visibility:'PUBLIC',recordCount:3});await publish(f,services);
 const servicesRequest=exactRequest(services);
 const servicePayload:Record<string,unknown>=services.plan.rows[0].payload;
 const client=await f.pool.connect();try{await client.query('begin');const result=await searchStructured(client,{...servicesRequest,query:validateStructuredQuery({version:1,dataset:'university_services',filters:{name:servicePayload.name},limit:1})},f.key,'2026-10-08');assert.deepEqual(result,{status:'CONTEXT_INCOMPLETE'});await client.query('rollback');}finally{client.release();}
}));
test('fresh exact evidence changes after canonical document eligibility or revision changes',()=>fixture(async f=>{
 const r=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'}),published=await publish(f,r),before=await exactSearch(f,r);assert.equal(before.status,'READY');
 await f.pool.query('update public.documents set revision=revision+1 where id=$1',[published.receipt.documentId]);const after=await exactSearch(f,r);assert.equal(after.status,'READY');
 if(before.status==='READY'&&after.status==='READY')assert.equal(structuredEvidenceStillMatches(before.evidence,after.evidence),false);
 await f.pool.query("update public.documents set visibility='INTERNAL',revision=revision+1 where id=$1",[published.receipt.documentId]);assert.equal((await exactSearch(f,r)).status,'EMPTY');
}));

test('unrelated amendment does not block an exact hit; relevant amendment requires clarification; cancellation preserves complete effect proof',()=>fixture(async f=>{
 const a=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'});await publish(f,a);
 const b=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'}),base=await publish(f,b);
 const amendment=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC',familyCode:b.familyCode,action:'AMEND_EXISTING',versionName:'amendment',target:{documentId:base.receipt.documentId,revision:0}}),amended=await publish(f,amendment);
 const client=await f.pool.connect();try{await client.query('begin');const request=exactRequest(a);request.scope.familyCodes=[];assert.equal((await searchStructured(client,request,f.key,'2026-10-08')).status,'READY');await client.query('rollback');}finally{client.release();}
 assert.equal((await exactSearch(f,b)).status,'CONTEXT_INCOMPLETE');
 const cancellation=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC',familyCode:b.familyCode,action:'ADD_ADDITIONAL',relationship:'CANCELS',versionName:'cancel amendment',target:{documentId:amended.receipt.documentId,revision:0}});await publish(f,cancellation);
 const current=await exactSearch(f,b);assert.equal(current.status,'READY');
 if(current.status==='READY'){
  const epoch=(await f.pool.query('select rule_revision::text from public.document_families where id=$1',[base.receipt.familyId])).rows[0].rule_revision;
  const revision=(await f.pool.query('select revision from public.documents where id=$1',[base.receipt.documentId])).rows[0].revision;
  const effects=(await f.pool.query(`select r.source_document_id "sourceDocumentId",r.target_document_id "targetDocumentId",r.relation_type "relationType",d.revision from public.document_relationships r join public.documents d on d.id=r.source_document_id where r.source_document_id=any($1::uuid[])`,[[amended.receipt.documentId,(await getImportPublication(f.actor,cancellation.jobId,f.options))!.receipt!.documentId]])).rows;
  assert.equal(effects.length,2);assert.deepEqual(current.evidence[0].reference.ruleProof,buildRuleProof({familyId:base.receipt.familyId,baseDocumentId:base.receipt.documentId,versionStream:'DEFAULT',ruleRevision:epoch,evaluationDate:'2026-10-08',members:[{documentId:base.receipt.documentId,revision}],effects}));
 }
}));

async function aiContext(f:Fixture){
 const session=(await f.pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[randomUUID()])).rows[0].id;
 const user='U'+randomUUID().replaceAll('-','');
 await f.pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(user,f.key),encryptValue(user,f.key)]);
 const conversation=(await f.pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id;
 const message=(await f.pool.query("insert into public.messages(conversation_id,sender_type,message_type,content) values($1,'USER','TEXT','Synthetic exact library question') returning id",[conversation])).rows[0].id;
 const job=await transaction(client=>prepareAIJob(client,{sessionId:session,conversationId:conversation,messageId:message,receivedAt:new Date()},f.key),f.pool);
 return {session,conversation,job};
}
for(const timing of ['UNCHANGED','BEFORE_FINALIZE','BEFORE_DISPATCH','HUMAN'] as const)test(`actual structured AI worker/outbox fences ${timing.toLowerCase()} context`,()=>fixture(async f=>{
 const r=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'}),publication=await publish(f,r),context=await aiContext(f);
 const initial=await exactSearch(f,r);assert.equal(initial.status,'READY');if(initial.status!=='READY')return;
 const request=exactRequest(r);
 const result={kind:'STRUCTURED_ANSWER' as const,output:{answer:'Synthetic reviewed exact library answer',citationRowIds:[initial.evidence[0].rowId]},...request,evidence:initial.evidence};
 const stats=await runAICycle(f.pool,f.key,{produce:async()=>{
  const open=(await f.pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and state='idle in transaction'",[f.applicationName])).rows[0].n;assert.equal(open,0,'PRODUCER_OUTSIDE_SQL');
  if(timing==='BEFORE_FINALIZE')await f.pool.query('update public.documents set revision=revision+1 where id=$1',[publication.receipt.documentId]);
  if(timing==='HUMAN')await f.pool.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1",[context.conversation]);
  return result;
 }});
 if(timing==='HUMAN'){assert.equal(stats.suppressed,1);assert.equal((await f.pool.query('select count(*)::int n from private.message_outbox where conversation_id=$1',[context.conversation])).rows[0].n,0);return;}
 assert.equal(stats.completed,1);assert.equal(stats.failed,0);
 const metadata=(await f.pool.query("select metadata,content from public.messages where conversation_id=$1 and sender_type='AI'",[context.conversation])).rows[0];
 if(timing==='BEFORE_FINALIZE'){assert.deepEqual(metadata.metadata.citations,[]);assert.match(metadata.content,/เอกสารอ้างอิงเปลี่ยนแปลง/u);}else assert.equal(metadata.metadata.citations[0].rowId,initial.evidence[0].rowId);
 if(timing==='BEFORE_DISPATCH')await f.pool.query('update public.document_families set rule_revision=rule_revision+1 where id=$1',[publication.receipt.familyId]);
 let sent=0;
 const delivery=await runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'synthetic-only',STAFF:'synthetic-only'},fetchImpl:async()=>{
  sent++;const open=(await f.pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and state='idle in transaction'",[f.applicationName])).rows[0].n;assert.equal(open,0,'LINE_MOCK_OUTSIDE_SQL');return new Response(null,{status:200});
 }});
 assert.equal(delivery.failed,0);assert.equal(sent,timing==='BEFORE_DISPATCH'?0:1);
 assert.equal((await f.pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${context.job}`])).rows[0].status,timing==='BEFORE_DISPATCH'?'SUPPRESSED':'SENT');
}));
test('typed structured tool uses authenticated conversation context and rejects a fabricated principal or HUMAN session',()=>fixture(async f=>{
 const r=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'});await publish(f,r);const context=await aiContext(f);
 const registry=createKnowledgeToolRegistry(f.pool,{key:f.key}),toolContext={lineSessionId:context.session,conversationId:context.conversation,conversationRevision:0};
 const result=await registry.execute({name:'search_structured',arguments:exactRequest(r)},toolContext,['search_structured']);assert.equal((result as {status:string}).status,'READY');
 await assert.rejects(registry.execute({name:'search_structured',arguments:{...exactRequest(r),role:'SUPER_ADMIN'}},toolContext,['search_structured']),{message:'INVALID_ARGUMENTS'});
 await assert.rejects(registry.execute({name:'search_structured',arguments:exactRequest(r)},{...toolContext,lineSessionId:randomUUID()},['search_structured']),{message:'TOOL_EXECUTION_FAILED'});
 await f.pool.query("update public.conversations set mode='HUMAN',revision=revision+1 where id=$1",[context.conversation]);
 await assert.rejects(registry.execute({name:'search_structured',arguments:exactRequest(r)},toolContext,['search_structured']),{message:'TOOL_EXECUTION_FAILED'});
 // This fixture only tests the tool; settle its intentionally unclaimed job before global worker tests.
 await f.pool.query("update private.ai_jobs set status='SUPPRESSED',completed_at=clock_timestamp() where id=$1",[context.job]);
}));

test('LINE dispatch freezes new matching publication in a family absent from saved evidence',()=>fixture(async f=>{
 const a=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'});await publish(f,a);
 const b=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'}),context=await aiContext(f);
 const request=exactRequest(a);request.scope.familyCodes=[a.familyCode,b.familyCode];
 const payload=a.plan.rows[0].payload;assert('name' in payload);
 request.query=validateStructuredQuery({version:1,dataset:'university_services',filters:{name:payload.name},limit:20});
 const client=await f.pool.connect();let initial;
 try{await client.query('begin');initial=await searchStructured(client,request,f.key,'2026-10-08');await client.query('commit');}finally{client.release();}
 assert.equal(initial.status,'READY');if(initial.status!=='READY')return;assert.equal(initial.evidence.length,1);
 assert.equal((await runAICycle(f.pool,f.key,{produce:async()=>({kind:'STRUCTURED_ANSWER',output:{answer:'Synthetic exact answer',citationRowIds:[initial.evidence[0].rowId]},...request,evidence:initial.evidence})})).completed,1);
 let finished=false,pending:ReturnType<typeof publish>|undefined;
 const delivery=await runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'synthetic-only',STAFF:'synthetic-only'},fetchImpl:async()=>{
  pending=publish(f,b).then(result=>{finished=true;return result;});
  const deadline=performance.now()+2000;let blocked=false;
  while(performance.now()<deadline&&!finished){
   blocked=(await f.pool.query("select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event='advisory' and cardinality(pg_blocking_pids(pid))>0) blocked",[f.applicationName])).rows[0].blocked;
   if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(finished,false,'NEW_FAMILY_PUBLICATION_MUST_WAIT_DURING_LINE_HTTP');assert.equal(blocked,true,'CATALOG_READER_MUST_BLOCK_NEW_MATCH');
  return new Response(null,{status:200});
 }});
 if(pending)await pending;
 assert.equal(delivery.sent,1);assert.equal(delivery.failed,0);assert.equal(finished,true,'SHARED_CATALOG_LOCK_RELEASED_AFTER_DELIVERY');
 const reader=await f.pool.connect();try{await reader.query('begin');const fresh=await searchStructured(reader,request,f.key,'2026-10-08');assert.equal(fresh.status,'READY');if(fresh.status==='READY')assert.equal(fresh.evidence.length,2);await reader.query('rollback');}finally{reader.release();}
 assert.equal((await f.pool.query('select status from private.message_outbox where idempotency_key=$1',[`ai-job:${context.job}`])).rows[0].status,'SENT');
}));

test('service department code writer cannot change selector eligibility during a shared catalog fence',()=>fixture(async f=>{
 const r=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'}),publication=await publish(f,r);
 const reader=await f.pool.connect(),writer=await f.pool.connect();
 try{
  await reader.query('select pg_advisory_lock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);
  await writer.query('begin');await writer.query('set local role service_role');
  await assert.rejects(writer.query("update public.departments set code=code||'_FENCE_TEST' where id=(select department_id from public.documents where id=$1)",[publication.receipt.documentId]),{code:'40001',message:'STRUCTURED_SELECTION_RETRY'});
 }finally{
  await writer.query('rollback');writer.release();
  await reader.query('select pg_advisory_unlock_shared(hashtextextended($1,0))',[knowledgeStructuredCatalogLock]);reader.release();
 }
}));

test('only canonical reviewed guidance delivered by the actual outbox grants the private guidance flag',()=>fixture(async f=>{
 const r=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'});await publish(f,r);
 const context=await aiContext(f),evidence=await exactSearch(f,r);assert.equal(evidence.status,'READY');if(evidence.status!=='READY')return;
 const job=await claimAIJob(f.pool);assert(job,'GUIDANCE_JOB_REQUIRED');assert.equal(job.id,context.job);
 const supportContext={sessionId:context.session,conversationId:context.conversation,messageId:job.message_id,revision:0};
 const directory=(await f.pool.query('select code from public.departments where active')).rows;
 assert(directory.every(d=>/^[A-Z_]{2,40}$/u.test(d.code)),'GUIDANCE_DIRECTORY_CONTRACT');
 const snapshot=await transaction(c=>loadSupportSnapshot(c,supportContext,f.key),f.pool);assert(snapshot,'GUIDANCE_SNAPSHOT_REQUIRED');assert.equal(snapshot.input.deliveredGuidance,false);
 const result={kind:'STRUCTURED_ANSWER' as const,output:{answer:'Synthetic reviewed exact library answer',citationRowIds:[evidence.evidence[0].rowId]},...exactRequest(r),evidence:evidence.evidence};
 await saveAIResult(f.pool,job,result,f.key);const canonical=buildStructuredAnswer(result.output,result.evidence);
 const proposal={intent:'INFORMATION',category:'LIBRARY',subcategory:'SERVICE',needsTicket:false,department:'LIBRARY',urgency:'low',
  needsKnowledgeSearch:false,needsStructuredSearch:true,needsWebSearch:false,confidence:.99,missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',
  facts:[{field:'PROBLEM',source:'U0',quote:'Synthetic exact library question'}]};
 // Exercise the private finalization storage boundary; production support integration is a separate B3 gate.
 const outbox=await transaction(async c=>{
  const id=await enqueueOutbound(c,{idempotencyKey:`ai-job:${job.id}`,kind:'AI',channel:'STUDENT',lineSessionId:context.session,
   conversationId:context.conversation,conversationRevision:0,messages:canonical.messages},f.key);assert(id,'GUIDANCE_OUTBOX_REQUIRED');
  await c.query("insert into public.messages(conversation_id,sender_type,message_type,content,metadata) values($1,'AI','TEXT',$2,$3)",
   [context.conversation,canonical.messages.map(m=>m.text).join('\n'),{ai_job_id:job.id,citations:canonical.citations}]);
  await saveSupportState(c,job,snapshot,proposal,f.key,{guidanceOutboxId:id});
  await c.query("update private.ai_jobs set status='DONE',last_error_code=null,lease_token=null,lease_until=null,completed_at=clock_timestamp() where id=$1",[job.id]);
  return id;
 },f.pool);
 assert.equal((await transaction(c=>loadSupportSnapshot(c,supportContext,f.key),f.pool))?.input.deliveredGuidance,false,'PENDING_IS_NOT_DELIVERED');
 const sent=await runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'synthetic-only',STAFF:'synthetic-only'},fetchImpl:async()=>{
  assert.equal((await f.pool.query("select count(*)::int n from pg_stat_activity where application_name=$1 and state='idle in transaction'",[f.applicationName])).rows[0].n,0);
  return new Response(null,{status:200});
 }});assert.equal(sent.sent,1);assert.equal(sent.failed,0);
 assert.equal((await f.pool.query('select status from private.message_outbox where id=$1',[outbox])).rows[0].status,'SENT');
 assert.equal((await transaction(c=>loadSupportSnapshot(c,supportContext,f.key),f.pool))?.input.deliveredGuidance,true);
 await f.pool.query("update public.messages set content=content||' altered' where conversation_id=$1 and sender_type='AI'",[context.conversation]);
 assert.equal((await transaction(c=>loadSupportSnapshot(c,supportContext,f.key),f.pool))?.input.deliveredGuidance,false,'ALTERED_CANONICAL_MESSAGE_IS_NOT_GUIDANCE');
 assert.equal((await f.pool.query('select count(*)::int n from private.ai_support_outcomes where conversation_id=$1',[context.conversation])).rows[0].n,0,'DELIVERY_IS_NOT_A_SOLVED_OUTCOME');
}));

for(const changed of [false,true])test(`actual support-enabled worker preserves canonical structured guidance with source ${changed?'retired':'unchanged'} at dispatch`,()=>fixture(async f=>{
 const r=await ready(f,'university_services','STRUCTURED','HTML',{visibility:'PUBLIC'}),published=await publish(f,r),context=await aiContext(f);
 const found=await exactSearch(f,r);assert.equal(found.status,'READY');if(found.status!=='READY')return;
 const stats=await runAICycle(f.pool,f.key,{supportEnabled:true,produce:async s=>{
  assert(s.support);return {kind:'STRUCTURED_ANSWER',output:{answer:'Synthetic reviewed exact library answer',citationRowIds:[found.evidence[0].rowId]},...exactRequest(r),evidence:found.evidence,
   support:{version:1,sourceDigest:s.support.sourceDigest,directoryDigest:s.support.directoryDigest,minimumSensitivity:s.support.minimumSensitivity,deliveredGuidance:s.support.input.deliveredGuidance,
    proposal:{intent:'INFORMATION',category:'LIBRARY',subcategory:'SERVICE',needsTicket:false,department:'LIBRARY',urgency:'low',needsKnowledgeSearch:false,needsStructuredSearch:true,needsWebSearch:false,
     confidence:.99,missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',facts:[{field:'PROBLEM',source:'U0',quote:'Synthetic exact library question'}]}}};
 }});assert.equal(stats.completed,1);assert.equal(stats.failed,0);
 const state=(await f.pool.query('select last_message_id,guidance_outbox_id from private.ai_support_state where conversation_id=$1',[context.conversation])).rows[0];assert(state?.guidance_outbox_id);
 const owned={sessionId:context.session,conversationId:context.conversation,messageId:state.last_message_id,revision:0};
 assert.equal((await transaction(c=>loadSupportSnapshot(c,owned,f.key),f.pool))?.input.deliveredGuidance,false);
 if(changed)await f.pool.query('update public.documents set revision=revision+1 where id=$1',[published.receipt.documentId]);
 let calls=0;const delivery=await runOutboxCycle(f.pool,f.key,{accessTokens:{STUDENT:'synthetic-only',STAFF:'synthetic-only'},fetchImpl:async()=>{calls++;return new Response(null,{status:200});}});
 assert.equal(delivery.failed,0);assert.equal(calls,changed?0:1);
 assert.equal((await transaction(c=>loadSupportSnapshot(c,owned,f.key),f.pool))?.input.deliveredGuidance,!changed);
 assert.equal((await f.pool.query('select count(*)::int n from private.ai_support_outcomes where conversation_id=$1',[context.conversation])).rows[0].n,0);
}));
