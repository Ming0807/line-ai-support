import {describe,it,expect} from 'vitest';
import {validatePublicationReview} from '../lib/imports/publication-contract';
import type {ImportPreview} from '../lib/imports/import-extraction';
import type {ImportReviewState} from '../lib/imports/import-review';
import type {ImportReviewDraft} from '../lib/imports/review-schema';
import {analyzeExtraction} from '../lib/imports/analyzer';
import {buildReviewWarnings} from '../lib/imports/review-warnings';
import {computeLocatedChunkPlanDigest,locatedReviewApplies} from '../lib/knowledge/located-chunk-plan';
import {locatedPlanFixture} from './fixtures/located-plan';
import {unfinishedReviewDraft} from './fixtures/import-review';
import {createImportSource} from '../lib/imports/source';
import {parseHtmlSource} from '../lib/imports/html-parser';
import {buildLocatedChunkPlan} from '../lib/knowledge/located-chunk-plan';
it('publishes reviewed RAG at schema3 without downgrading its saved schema floor',async()=>{
 const f=await fixture();f.review.saved!.draft={...f.draft,schemaVersion:3,structuredMapping:null};
 const result=validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum);
 expect(result.draft.schemaVersion).toBe(3);expect(result.plan).toEqual(f.plan);expect(result.draft.metadata.storageMode).toBe('RAG');
});
it('still requires a current acknowledged chunk plan for schema3 RAG',async()=>{
 const f=await fixture();f.review.saved!.draft={...f.draft,schemaVersion:3,structuredMapping:null,chunkPlan:null};
 expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_REVIEW_INCOMPLETE');
});
it('rejects schema3 RAG when its reviewed chunk digest has changed',async()=>{
 const f=await fixture();f.review.saved!.draft={...f.draft,schemaVersion:3,structuredMapping:null,chunkPlan:{...f.draft.chunkPlan,digest:'a'.repeat(64)}};
 expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PLAN_MISMATCH');
});
async function fixture(html?:string){
 let f=await locatedPlanFixture();
 if(html!==undefined){
  const source=createImportSource({filename:f.source.filename,mimeType:f.source.mimeType,sourceUrl:f.source.sourceUrl,
   acquiredFrom:f.source.acquiredFrom,fetchedAt:f.source.fetchedAt,bytes:new TextEncoder().encode(html)}),extraction=parseHtmlSource(source);
  const plan=await buildLocatedChunkPlan(source,extraction,f.plan.binding,f.counter);f={...f,source,extraction,plan};
 }
 const preview:ImportPreview={job:{id:f.plan.binding.jobId,status:'READY',revision:3,filename:f.source.filename,format:'HTML',mimeType:'text/html',sourceUrl:f.source.sourceUrl,acquiredFrom:'UPLOAD',fetchedAt:null,acquisition:null,byteLength:f.source.bytes.length,createdAt:'2026-10-06T00:00:00.000Z',errorCode:null},extractionRevision:2,kind:'PARSED',extraction:f.extraction,analysis:analyzeExtraction(f.source,f.extraction),edit:null};
 const prior=unfinishedReviewDraft();
 const draft:Extract<ImportReviewDraft,{schemaVersion:2}>&{chunkPlan:{digest:string;chunkerVersion:'located-e5-v1'}}={...prior,schemaVersion:2,metadata:{...prior.metadata,title:'คู่มือบริการ',familyCode:'REVIEW_SERVICES',newFamily:{name:'บริการ',category:'บริการนักศึกษา'},departmentCode:'IT',documentType:'GUIDE',versionName:'ฉบับปัจจุบัน',versionStream:'ALL',scope:{...prior.metadata.scope,audience:'ALL',studentType:'ALL'},publishedAt:'2026-10-01',effectiveFrom:'2026-10-01',authorityLevel:70,sourceUrl:f.source.sourceUrl,visibility:'PUBLIC',storageMode:'RAG'},action:'NEW_FAMILY',attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},chunkPlan:{digest:f.plan.digest,chunkerVersion:f.plan.chunkerVersion},warningDispositions:buildReviewWarnings(preview).map(w=>({warningKey:w.key,status:'CORRECTED',reason:'ตรวจข้อมูลและต้นฉบับแล้ว'}))};
 const review:ImportReviewState={jobId:preview.job.id,jobRevision:3,extractionRevision:2,reviewRevision:1,stale:false,warnings:buildReviewWarnings(preview),saved:{reviewRevision:1,jobRevision:3,extractionRevision:2,actorId:'123e4567-e89b-42d3-a456-426614174001',createdAt:'2026-10-06T00:00:00.000Z',draft}};
 const sync=()=>{f.plan.warnings=structuredClone(preview.extraction.report.warnings);for(const c of f.plan.chunks){const range=c.coverage;const loc=range.kind==='PAGE'?preview.extraction.locations.pages[range.index]:preview.extraction.locations.tables[range.index];c.requiresReview=(range.kind==='PAGE'?preview.extraction.pages[range.index].requiresReview:preview.extraction.pages.some(p=>p.requiresReview))||locatedReviewApplies(loc,f.plan.warnings);}f.plan.digest=computeLocatedChunkPlanDigest(f.plan.binding,f.plan.sourceChecksum,f.plan.chunks,f.plan.warnings);draft.chunkPlan.digest=f.plan.digest;draft.warningDispositions=buildReviewWarnings(preview).map(w=>({warningKey:w.key,status:'CORRECTED' as const,reason:'ตรวจข้อมูลและต้นฉบับแล้ว'}));};
 return {...f,preview,review,draft,sync};
}
describe('reviewed pattern-only grade wording in a public regulation',()=>{
 async function regulation(extra=''){
  const f=await fixture(`<html><h1>ระเบียบการเทียบโอน</h1><p>หลักเกณฑ์ผลการเรียนนี้เป็นข้อความกฎทั่วไป ไม่มีผลของนักศึกษารายบุคคล</p>${extra}</html>`);
  expect(f.preview.analysis.sensitiveCategories).toContain('GRADES');
  f.draft.metadata.documentType='REGULATION';
  f.draft.warningDispositions=buildReviewWarnings(f.preview).map(w=>({warningKey:w.key,
   status:w.code==='SENSITIVE_DATA_REVIEW_REQUIRED'?'FALSE_POSITIVE' as const:'CORRECTED' as const,
   reason:'ตรวจต้นฉบับทุกหน้าแล้ว เป็นข้อความเกณฑ์ทั่วไป ไม่มีผลการเรียนหรือข้อมูลนักศึกษารายบุคคล'}));
  return f;
 }
 it('accepts only an explicitly adjudicated pattern match while retaining the risk and exact review receipt',async()=>{
  const f=await regulation();expect(f.preview.extraction.tables).toHaveLength(0);
  const r=validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum);
  expect(r.draft.metadata.visibility).toBe('PUBLIC');expect(r.draft.metadata.storageMode).toBe('RAG');
  expect(r.draft.warningDispositions).toEqual(f.draft.warningDispositions);
  expect(f.preview.analysis.sensitiveRisk).toBe(true);expect(f.preview.analysis.sensitiveCategories).toEqual(['GRADES']);
 });
 it.each(['CORRECTED','UNRESOLVED'] as const)('refuses %s in place of the explicit sensitivity false-positive judgment',async status=>{
  const f=await regulation(),warning=buildReviewWarnings(f.preview).find(w=>w.code==='SENSITIVE_DATA_REVIEW_REQUIRED')!;
  f.draft.warningDispositions.find(d=>d.warningKey===warning.key)!.status=status;
  expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow(status==='UNRESOLVED'?'PUBLICATION_WARNINGS_UNRESOLVED':'PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it.each(['PHONE','STUDENT_RECORDS','PERSONAL_EMAIL','MEDICAL','PERSONAL_FINANCE'] as const)('never waives %s alongside grade wording',async category=>{
  const f=await regulation();f.preview.analysis.sensitiveCategories.push(category);
  expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it('refuses table-bearing documents even when their reviewed type says regulation',async()=>{
  const f=await regulation('<table><tr><td>รายการ</td><td>ผลการเรียน</td></tr></table>');
  expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it.each(['GUIDE','FORM'])('refuses a %s despite the same reviewer statement',async type=>{
  const f=await regulation();f.draft.metadata.documentType=type;
  expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it.each(['STRUCTURED','BOTH'] as const)('never admits %s through the RAG-only adjudication',async mode=>{
  const f=await regulation();f.draft.metadata.storageMode=mode;
  expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it('requires the original reviewed official provenance to match instead of relying on a new metadata URL',async()=>{
  const f=await regulation();f.preview.job.sourceUrl=null;
  expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
  f.preview.job.sourceUrl='https://www.yru.ac.th/another-source';
  expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
});
describe('complete reviewed publication policy',()=>{
 it('accepts reviewed RAG table candidate and explicitly nullable non-applicable year/scope without DDL',async()=>{const f=await fixture();const r=validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum);expect(r.plan).toEqual(f.plan);expect(r.draft.metadata.academicYear).toBeNull();expect(r.officialSource).toBe(true);expect(r.reviewHash).toMatch(/^[a-f0-9]{64}$/);f.draft.metadata.title='mutated';expect(r.draft.metadata.title).toBe('คู่มือบริการ');});
 it.each(['title','familyCode','departmentCode','documentType','versionName','versionStream','publishedAt','effectiveFrom','authorityLevel','visibility','storageMode'] as const)('refuses missing required %s',async key=>{const f=await fixture();const changed={...f.draft,metadata:{...f.draft.metadata,[key]:null}};f.review.saved!.draft=changed;expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_REVIEW_INCOMPLETE');});
 it.each(['sourceAuthorityReviewed','extractionReviewed','applicabilityReviewed','sensitivityReviewed','versionReviewed'] as const)('requires deliberate %s',async key=>{const f=await fixture();f.draft.attestations[key]=false;expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_REVIEW_INCOMPLETE');});
 it.each(['NEW_FAMILY','ADD_ADDITIONAL','REPLACE_CURRENT','ADD_HISTORICAL','AMEND_EXISTING'] as const)('preserves action %s for final database resolution',async action=>{const f=await fixture();f.review.saved!.draft={...f.draft,action,metadata:{...f.draft.metadata,newFamily:action==='NEW_FAMILY'?f.draft.metadata.newFamily:null},target:action==='REPLACE_CURRENT'||action==='AMEND_EXISTING'?{documentId:'123e4567-e89b-42d3-a456-426614174002',revision:0}:null};expect(validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum).draft.action).toBe(action);});
 it('retains whole CANCELS target and never treats it as partial editing',async()=>{const f=await fixture();f.review.saved!.draft={...f.draft,action:'ADD_ADDITIONAL',relationship:'CANCELS',metadata:{...f.draft.metadata,newFamily:null},target:{documentId:'123e4567-e89b-42d3-a456-426614174002',revision:4}};expect(validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum).draft.relationship).toBe('CANCELS');});
 it('refuses incomplete new family details',async()=>{const f=await fixture();f.review.saved!.draft={...f.draft,metadata:{...f.draft.metadata,newFamily:{name:null,category:null}}};expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_REVIEW_INCOMPLETE');});
 it('refuses legacy review or missing saved consent',async()=>{const f=await fixture();f.review.saved!.draft=unfinishedReviewDraft();expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_REVIEW_INCOMPLETE');f.review.saved=null;expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_REVIEW_INCOMPLETE');});
 it.each(['STRUCTURED','BOTH'] as const)('blocks unavailable %s without silently changing mode',async storageMode=>{const f=await fixture();f.review.saved!.draft={...f.draft,metadata:{...f.draft.metadata,storageMode,datasetType:'university_systems'}};expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE');});
 it('requires official provenance for PUBLIC while retaining reviewed INTERNAL material',async()=>{const f=await fixture();f.review.saved!.draft={...f.draft,metadata:{...f.draft.metadata,sourceUrl:null}};expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_REVIEW_INCOMPLETE');f.review.saved!.draft={...f.review.saved!.draft,metadata:{...f.review.saved!.draft.metadata,visibility:'INTERNAL'}};expect(validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum).officialSource).toBe(false);});
 it('rejects stale counters, failed source, wrong job or altered acknowledged digest',async()=>{const f=await fixture();f.review.stale=true;expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PLAN_MISMATCH');f.review.stale=false;f.review.jobRevision++;expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PLAN_MISMATCH');f.review.jobRevision--;f.draft.chunkPlan.digest='a'.repeat(64);expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PLAN_MISMATCH');});
 it('rejects missing or unresolved immutable warnings rather than trusting the UI warning list',async()=>{const f=await fixture();f.draft.warningDispositions=[];expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_WARNINGS_UNRESOLVED');f.sync();f.review.warnings=[];expect(validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum).draft.warningDispositions.length).toBeGreaterThan(0);});
 it('detected PUBLIC personal data cannot be waived with false-positive or corrected dispositions',async()=>{const f=await fixture();f.preview.analysis.sensitiveRisk=true;f.preview.analysis.sensitiveCategories=['PHONE'];f.preview.analysis.flags.push('SENSITIVE_DATA_REVIEW_REQUIRED');f.sync();f.review.saved!.draft={...f.draft,warningDispositions:f.draft.warningDispositions.map(d=>({...d,status:'FALSE_POSITIVE'}))};expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');f.review.saved!.draft={...f.review.saved!.draft,metadata:{...f.draft.metadata,visibility:'RESTRICTED'}};expect(validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum).draft.metadata.visibility).toBe('RESTRICTED');});
 it('refuses waivers for unextracted tables and unrepaired replacement characters',async()=>{const f=await fixture();f.preview.extraction.report.warnings.push({code:'UNSUPPORTED_TABLES',severity:'BLOCKING',location:null,count:1,disposition:'UNRESOLVED'});f.sync();expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');});
 it('rejects forged raw coverage even when recomputed digest and consent agree',async()=>{const f=await fixture();f.plan.chunks[0].content=f.plan.chunks[0].content.replace('บริการ','ขั้นตอน');const c=f.plan.chunks[0].coverage;if(c.kind==='PAGE')c.end=c.start+f.plan.chunks[0].content.length;f.sync();expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PLAN_MISMATCH');});
 it('binds the independently verified immutable source checksum',async()=>{const f=await fixture();expect(()=>validatePublicationReview(f.preview,f.review,f.plan,'b'.repeat(64))).toThrow('PUBLICATION_PLAN_MISMATCH');});
 it('binds global warning review evidence even when the parser page flag is false',async()=>{const f=await fixture();f.preview.extraction.pages.forEach(p=>{p.requiresReview=false;});f.preview.extraction.report.warnings.push({code:'EXTERNAL_LINKS_REVIEW',severity:'REVIEW',location:null,count:1,disposition:'UNRESOLVED'});f.sync();f.plan.chunks.forEach(c=>{c.requiresReview=false;});f.plan.digest=computeLocatedChunkPlanDigest(f.plan.binding,f.plan.sourceChecksum,f.plan.chunks,f.plan.warnings);f.draft.chunkPlan.digest=f.plan.digest;expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_PLAN_MISMATCH');});
 it('accepts corrected/reanalyzed OCR only with every affected page corrected and explicit CORRECTED disposition',async()=>{const f=await fixture();f.preview.kind='EDITED';f.preview.edit={reason:'Transcribed and checked original',changedPages:f.preview.extraction.pages.map((_,i)=>i),changedCells:[],titleChanged:false};f.preview.extraction.pages.forEach(p=>{p.requiresReview=true;});f.plan.chunks.forEach(c=>{c.requiresReview=true;});f.preview.extraction.report.warnings.push({code:'OCR_REQUIRED',severity:'REVIEW',location:null,count:1,disposition:'UNRESOLVED'});f.sync();expect(validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum).draft.schemaVersion).toBe(2);f.review.saved!.draft={...f.draft,warningDispositions:f.draft.warningDispositions.map(d=>({...d,status:'FALSE_POSITIVE'}))};expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');});
 it('OCR source with no actual extraction correction and replacement text cannot be waived',async()=>{const f=await fixture();f.preview.extraction.report.warnings.push({code:'OCR_REQUIRED',severity:'REVIEW',location:null,count:1,disposition:'UNRESOLVED'});f.plan.chunks.forEach(c=>{c.requiresReview=true;});f.sync();expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');f.preview.extraction.report.warnings=[];f.preview.extraction.report.replacementCharacters=1;f.sync();expect(()=>validatePublicationReview(f.preview,f.review,f.plan,f.source.checksum)).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');});
});
