import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {validateAssistantConversationContext,type AssistantConversationContextSource} from '../../lib/ai/conversation-eval-context';
import {createImportJob} from '../../lib/imports/import-staging';
import {analyzeImportJob} from '../../lib/imports/import-extraction';
import {getImportStructuredPlan} from '../../lib/imports/import-structured-plan';
import {getImportChunkPlan} from '../../lib/imports/import-chunk-plan';
import {getImportReview,saveImportReview} from '../../lib/imports/import-review';
import {approveImport,type ImportPublicationReceipt} from '../../lib/imports/import-publication';
import {parseCsvSource} from '../../lib/imports/csv-parser';
import {computeStructuredExtractionDigest} from '../../lib/imports/structured-mapper';
import {getStructuredRegistryEntry} from '../../lib/knowledge/structured-registry';
import {reviewDraftSchema} from '../../lib/imports/review-schema';
import {buildReviewWarnings} from '../../lib/imports/review-warnings';
import {unfinishedReviewDraft} from '../../tests/fixtures/import-review';
import {createOwnedAssistantSource} from './assistant-owned-source';
import type {LocalE5EmbeddingProvider} from '../../lib/knowledge/embedding-client';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import type {ImportStagingOptions} from '../../lib/imports/import-staging';

const structuredCases=['A10','A11','A12','A13','A16','A18','B01'] as const;
const ragCases=['A14','A15'] as const;
const allSourceCases=[...structuredCases,...ragCases];
const reviewAttestations={sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true};
const todayQuery="select to_char((clock_timestamp() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') today";

interface OwnedSourceReceipt {
 sourceId:string;caseId:string;storageMode:'STRUCTURED'|'RAG';receipt:ImportPublicationReceipt;
}
interface OwnedRagSourceEvidence {
 sourceId:string;caseId:string;documentId:string;sourceChecksum:string;sourceUrl:string;review:{attestations:typeof reviewAttestations;warningCount:number;allWarningsResolved:boolean};
 document:{status:string;isCurrent:boolean;approvalStatus:string;visibility:string;officialSource:boolean;effectiveToday:boolean;sourceUrl:string;checksum:string;authorityLevel:number};
 chunks:{count:number;fingerprint:string;dimension:number;normalized:boolean;reviewClear:boolean;allLocatedToSource:boolean;fixtureTextWitness:boolean};
}
type OwnedRagImportOptions=Parameters<typeof getImportChunkPlan>[3]&Parameters<typeof approveImport>[2];

async function publishStructured(input:{pool:Pool;actor:string;item:Extract<AssistantConversationContextSource,{kind:'STRUCTURED'}>;source:ReturnType<typeof createOwnedAssistantSource>;options:ImportStagingOptions}){
 const {item,source,options,pool,actor}=input,entry=getStructuredRegistryEntry(item.dataset);
 const {job}=await createImportJob(actor,source,options);
 const preview=await analyzeImportJob(actor,job.id,0,{...options,parse:async value=>parseCsvSource(value)});
 const transform=(kind:string)=>kind==='INTEGER'?'INTEGER_V1':kind==='DECIMAL'?'DECIMAL_V1':kind==='DATE'?'DATE_GREGORIAN_V1':kind==='TIMESTAMP'?'TIMESTAMP_UTC_V1':'TEXT_V1';
 const mapping={version:1,registryVersion:'structured-v1',dataset:item.dataset,source:{jobId:job.id,jobRevision:preview.job.revision,extractionRevision:preview.extractionRevision,sourceChecksum:source.checksum,extractionDigest:computeStructuredExtractionDigest(source,preview.extraction)},tables:[{tableIndex:0,dataRanges:[{startRowIndex:1,endRowIndex:1}],excludedRanges:[{startRowIndex:0,endRowIndex:0,reason:'HEADER',note:'Synthetic fixture header reviewed.'}],fields:Object.fromEntries(entry.fields.map((field,index)=>[field.name,{kind:'COLUMN',columnIndex:index,transform:transform(field.kind),blank:field.nullable?'NULL':'REJECT'}]))}],excludedTables:[]};
 const mapped=await getImportStructuredPlan(actor,job.id,{expectedJobRevision:preview.job.revision,expectedExtractionRevision:preview.extractionRevision,expectedReviewRevision:0,mapping},options);
 assert(mapped.publicationAvailable,'OWNED_INFRASTRUCTURE_NOT_AVAILABLE');
 const payload=item.payload as Record<string,string|number|null>;
 const draft=reviewDraftSchema.parse({...unfinishedReviewDraft(),schemaVersion:3,chunkPlan:null,metadata:{...unfinishedReviewDraft().metadata,title:`Synthetic ${item.id}`,familyCode:`EVAL_${randomUUID().replaceAll('-','').slice(0,20).toUpperCase()}`,newFamily:{name:`Synthetic ${item.id}`,category:'TEST'},departmentCode:'IT',documentType:'DATASET',versionName:'TEST_ONLY',versionStream:'DEFAULT',academicYear:payload.academic_year??null,scope:{...unfinishedReviewDraft().metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:'2026-01-01',effectiveFrom:'2026-01-01',effectiveTo:null,authorityLevel:90,visibility:'PUBLIC',sourceUrl:item.url,storageMode:'STRUCTURED',datasetType:item.dataset},action:'NEW_FAMILY',attestations:reviewAttestations,warningDispositions:buildReviewWarnings(preview).map(warning=>({warningKey:warning.key,status:'CORRECTED',reason:'Synthetic owned evaluation source manually reviewed by test author.'})),structuredMapping:{mapping,acknowledgment:mapped.acknowledgment}});
 const saved=await saveImportReview(actor,job.id,{expectedJobRevision:preview.job.revision,expectedExtractionRevision:preview.extractionRevision,expectedReviewRevision:0,draft},options);
 const result=await approveImport(actor,{id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,confirmPublication:true},options);
 const row=(await pool.query(`select to_jsonb(t) payload from public.${item.dataset} t where document_id=$1`,[result.receipt.documentId])).rows;
 assert.equal(row.length,1,'EXACT_TYPED_ROW_REQUIRED');
 for(const field of entry.fields){
  const expected=payload[field.name],actual=row[0].payload[field.name];
  if(field.kind==='DECIMAL'&&expected!==null)assert.equal(Number(actual),Number(expected),'PUBLISHED_PAYLOAD_MISMATCH');
  else assert.equal(actual,expected,'PUBLISHED_PAYLOAD_MISMATCH');
 }
 return result.receipt;
}

async function publishRag(input:{pool:Pool;actor:string;item:Extract<AssistantConversationContextSource,{kind:'RAG_HTML'}>;source:ReturnType<typeof createOwnedAssistantSource>;options:OwnedRagImportOptions;provider:LocalE5EmbeddingProvider}):Promise<{receipt:ImportPublicationReceipt;evidence:OwnedRagSourceEvidence}>{
 const {pool,actor,item,source,options,provider}=input;
 const {job}=await createImportJob(actor,source,options);
 const preview=await analyzeImportJob(actor,job.id,0,options);
 const firstReview=await getImportReview(actor,job.id,options),base=unfinishedReviewDraft();
 const today=(await pool.query<{today:string}>(todayQuery)).rows[0]?.today;
 assert(today,'OWNED_CURRENT_SOURCE_DATE_REQUIRED');
 const metadata={...base.metadata,title:`Synthetic ${item.id}`,familyCode:`EVAL_${randomUUID().replaceAll('-','').slice(0,20).toUpperCase()}`,
  newFamily:{name:`Synthetic ${item.id}`,category:'TEST'},departmentCode:item.scenarioId==='A14'?'ADMIN':'IT',documentType:item.scenarioId==='A14'?'ANNOUNCEMENT':'GUIDE',
  versionName:'TEST_ONLY',versionStream:'DEFAULT',academicYear:null,scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:today,
  effectiveFrom:today,effectiveTo:null,authorityLevel:90,visibility:'PUBLIC',sourceUrl:item.url,storageMode:'RAG'};
 const attestations={...reviewAttestations};
 const dispositions=firstReview.warnings.map(warning=>({warningKey:warning.key,status:'CORRECTED' as const,reason:'Exact synthetic fixture source and extraction reviewed for the owned evaluation.'}));
 const firstDraft=reviewDraftSchema.parse({...base,schemaVersion:2,chunkPlan:null,metadata,action:'NEW_FAMILY',attestations,warningDispositions:dispositions});
 const first=await saveImportReview(actor,job.id,{expectedJobRevision:preview.job.revision,expectedExtractionRevision:preview.extractionRevision,expectedReviewRevision:0,draft:firstDraft},options);
 const plan=await getImportChunkPlan(actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision},options);
 const savedDraft=reviewDraftSchema.parse({...firstDraft,chunkPlan:{digest:plan.plan.digest,chunkerVersion:plan.plan.chunkerVersion}});
 const saved=await saveImportReview(actor,job.id,{expectedJobRevision:first.jobRevision,expectedExtractionRevision:first.extractionRevision,expectedReviewRevision:first.reviewRevision,draft:savedDraft},options);
 const result=await approveImport(actor,{id:job.id,expectedJobRevision:saved.jobRevision,expectedExtractionRevision:saved.extractionRevision,expectedReviewRevision:saved.reviewRevision,confirmPublication:true},
  {...options,provider});
 assert.equal(result.receipt.storageMode,'RAG','RAG_PUBLICATION_RECEIPT_REQUIRED');
 assert.equal(result.receipt.planDigest,plan.plan.digest,'PUBLISHED_PLAN_RECEIPT_MISMATCH');
 const document=(await pool.query(`select status,is_current,approval_status,visibility,official_source,source_url,checksum,authority_level,
  (effective_from<=($2::date) and (effective_to is null or effective_to>=($2::date))) effective_today
  from public.documents where id=$1`,[result.receipt.documentId,today])).rows[0];
 assert.deepEqual(document,{status:'ACTIVE',is_current:true,approval_status:'APPROVED',visibility:'PUBLIC',official_source:true,source_url:item.url,
  checksum:source.checksum,authority_level:90,effective_today:true},'CURRENT_REVIEWED_SOURCE_REQUIRED');
 const chunks=(await pool.query(`select id,chunk_index,content,requires_review,embedding_fingerprint,embedding_dimensions,
  extensions.vector_dims(embedding_e5) dimension,extensions.vector_norm(embedding_e5) vector_norm,source_locations
  from public.knowledge_chunks where document_id=$1 order by chunk_index`,[result.receipt.documentId])).rows;
 assert.equal(chunks.length,plan.plan.chunks.length,'PUBLISHED_RAG_CHUNKS_REQUIRED');
 const text=chunks.map(chunk=>chunk.content).join('\n');
 const fixtureTextWitness=item.scenarioId==='A14'?text.includes('กลุ่มทดลอง X')&&text.includes('ไม่ได้ให้นิยาม')&&text.includes('NOT_REAL_YRU_POLICY'):
  text.includes('ก่อนเริ่ม')&&text.includes('คำเตือน')&&text.includes('NOT_REAL_YRU_POLICY');
 assert(fixtureTextWitness,'EXACT_SYNTHETIC_SOURCE_TEXT_REQUIRED');
 for(const [index,chunk] of chunks.entries()){
  const locations=Array.isArray(chunk.source_locations)?chunk.source_locations:[];
  assert.equal(chunk.chunk_index,index,'ORDERED_CHUNK_INDEX_REQUIRED');
  assert.equal(chunk.embedding_fingerprint,LOCAL_EMBEDDING_FINGERPRINT,'LOCAL_E5_FINGERPRINT_REQUIRED');
  assert.equal(chunk.embedding_dimensions,384,'LOCAL_E5_DIMENSION_REQUIRED');
  assert.equal(chunk.dimension,384,'LOCAL_E5_VECTOR_REQUIRED');
  assert(Math.abs(Number(chunk.vector_norm)-1)<=0.001,'NORMALIZED_LOCAL_E5_VECTOR_REQUIRED');
  assert.equal(chunk.requires_review,false,'REVIEWED_CHUNKS_REQUIRED');
  assert(locations.length>0&&locations.every((location:Record<string,unknown>)=>location.kind==='HTML'&&location.sourceUrl===item.url),'SOURCE_LOCATION_WITNESS_REQUIRED');
  assert.equal(chunk.content,plan.plan.chunks[index]?.content,'EXACT_REVIEWED_CHUNK_CONTENT_REQUIRED');
 }
 const review= savedDraft;
 assert(Object.values(review.attestations).every(Boolean),'EXPLICIT_SOURCE_REVIEW_ATTESTATIONS_REQUIRED');
 assert(dispositions.every(disposition=>disposition.status==='CORRECTED'&&disposition.reason.length>0),'ALL_SOURCE_WARNINGS_MUST_BE_REVIEWED');
 return {receipt:result.receipt,evidence:{sourceId:item.id,caseId:item.scenarioId,documentId:result.receipt.documentId,sourceChecksum:source.checksum,sourceUrl:item.url,
  review:{attestations:review.attestations,warningCount:dispositions.length,allWarningsResolved:true},
  document:{status:document.status,isCurrent:document.is_current,approvalStatus:document.approval_status,visibility:document.visibility,
   officialSource:document.official_source,effectiveToday:document.effective_today,sourceUrl:document.source_url,checksum:document.checksum,authorityLevel:document.authority_level},
  chunks:{count:chunks.length,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,dimension:384,normalized:true,reviewClear:true,allLocatedToSource:true,fixtureTextWitness}}};
}

/** Test-only: a supplied name is not enough; the connected DB must be disposable too. */
export async function publishOwnedAssistantSources(input:{pool:Pool;key:string;actor:string;database:string;caseIds:string[];companion:unknown;frozenText:string;embeddingProvider?:LocalE5EmbeddingProvider}){
 assert(/^yru_structured_schema_[a-f0-9]{12}$/u.test(input.database),'OWNED_PUBLICATION_DATABASE_REQUIRED');
 assert(input.caseIds.length===1,'OWNED_PUBLICATION_CASE_ISOLATION_REQUIRED');
 assert(input.caseIds.length>0&&input.caseIds.every(id=>allSourceCases.includes(id as typeof allSourceCases[number]))&&new Set(input.caseIds).size===input.caseIds.length,'OWNED_PUBLICATION_CASES_INVALID');
 assert(!input.caseIds.some(id=>ragCases.includes(id as typeof ragCases[number]))||input.embeddingProvider!==undefined,'OWNED_RAG_EMBEDDING_PROVIDER_REQUIRED');
 const fixture=validateAssistantConversationContext(input.companion,input.frozenText);
 const connected=(await input.pool.query('select current_database() name,pg_get_userbyid(datdba) owner from pg_database where datname=current_database()')).rows[0];
 assert(connected?.name===input.database&&connected.owner==='postgres','OWNED_PUBLICATION_CONNECTION_REQUIRED');
 const options={pool:input.pool,key:input.key,originalBackend:'PRIVATE_DATABASE' as const,structuredVerificationDatabase:input.database,
  ...(input.embeddingProvider?{provider:input.embeddingProvider,counter:input.embeddingProvider}:{})};
 const receipts:OwnedSourceReceipt[]=[],sourceEvidence:OwnedRagSourceEvidence[]=[];
 const selectedSources=fixture.sources.filter(source=>input.caseIds.includes(source.scenarioId));
 for(const item of selectedSources){
  const source=createOwnedAssistantSource(item);
  if(item.kind==='STRUCTURED'){
   const receipt=await publishStructured({pool:input.pool,actor:input.actor,item,source,options});
   receipts.push({sourceId:item.id,caseId:item.scenarioId,storageMode:'STRUCTURED',receipt});
  }else{
   assert(input.embeddingProvider,'OWNED_RAG_EMBEDDING_PROVIDER_REQUIRED');
   const result=await publishRag({pool:input.pool,actor:input.actor,item,source,options,provider:input.embeddingProvider});
   receipts.push({sourceId:item.id,caseId:item.scenarioId,storageMode:'RAG',receipt:result.receipt});
   sourceEvidence.push(result.evidence);
  }
 }
 const expectedSourceIds=fixture.cases.filter(item=>input.caseIds.includes(item.scenarioId)).flatMap(item=>item.sourceIds).sort();
 assert.deepEqual(receipts.map(item=>item.sourceId).sort(),expectedSourceIds,'COMPLETE_SOURCE_PUBLICATION_REQUIRED');
 return {receipts,sourceEvidence,contexts:fixture.cases.filter(row=>input.caseIds.includes(row.scenarioId))};
}
