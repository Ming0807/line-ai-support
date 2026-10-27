import {describe,it,expect} from 'vitest';
import {reviewDraftSchema} from '../lib/imports/review-schema';
import {validatePublicationReview} from '../lib/imports/publication-contract';
import {analyzeExtraction} from '../lib/imports/analyzer';
import {buildReviewWarnings} from '../lib/imports/review-warnings';
import {createImportSource} from '../lib/imports/source';
import {parseHtmlSource} from '../lib/imports/html-parser';
import {buildLocatedChunkPlan} from '../lib/knowledge/located-chunk-plan';
import {locatedPlanFixture} from './fixtures/located-plan';
import {unfinishedReviewDraft} from './fixtures/import-review';
import {isKnowledgeEligible} from '../lib/knowledge/metadata-filter';
import type {KnowledgeMetadata,KnowledgeScope} from '../lib/knowledge/types';

async function fixture(body='<p>เวลาเปิดบริการ จันทร์ถึงศุกร์</p>',documentType='GUIDE',adjudications:unknown[]=[]){
 const f=await locatedPlanFixture();
 const source=createImportSource({filename:f.source.filename,mimeType:f.source.mimeType,sourceUrl:f.source.sourceUrl,acquiredFrom:'UPLOAD',fetchedAt:null,bytes:new TextEncoder().encode(`<html><body>${body}</body></html>`)});
 const extraction=parseHtmlSource(source),plan=await buildLocatedChunkPlan(source,extraction,f.plan.binding,f.counter);
 const preview={job:{id:plan.binding.jobId,status:'READY' as const,revision:3,filename:source.filename,format:'HTML' as const,mimeType:'text/html',sourceUrl:source.sourceUrl,acquiredFrom:'UPLOAD' as const,fetchedAt:null,acquisition:null,byteLength:source.bytes.length,createdAt:'2026-10-26T00:00:00.000Z',errorCode:null},extractionRevision:2,kind:'PARSED' as const,extraction,analysis:analyzeExtraction(source,extraction),edit:null};
 const base=unfinishedReviewDraft(),warnings=buildReviewWarnings(preview);
 const input={...base,schemaVersion:4,metadata:{...base.metadata,title:'ข้อมูลบริการทางการ',familyCode:'PUBLIC_SERVICE',newFamily:{name:'ข้อมูลบริการ',category:'บริการ'},departmentCode:'LIBRARY',documentType,versionName:'ตรวจต้นฉบับแล้ว',versionStream:'PUBLIC',academicYear:documentType==='CALENDAR'?2569:null,scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},authorityLevel:50,sourceUrl:source.sourceUrl,visibility:'PUBLIC',storageMode:'RAG'},action:'NEW_FAMILY',attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},chunkPlan:{digest:plan.digest,chunkerVersion:plan.chunkerVersion},structuredMapping:null,
  publicSourceReview:{temporalBasis:'CURRENT_REVIEWED',temporalReason:'ตรวจแหล่งทางการและใช้เป็นข้อมูลปัจจุบันเท่านั้น ไม่ระบุวันที่ในต้นฉบับ',sensitivityAdjudications:adjudications},
  warningDispositions:warnings.map(w=>({warningKey:w.key,status:w.code==='SENSITIVE_DATA_REVIEW_REQUIRED'?'FALSE_POSITIVE':'CORRECTED',reason:'ตรวจเนื้อหาทั้งฉบับและแหล่งทางการแล้ว'}))};
 const draft=reviewDraftSchema.parse(input);
 const review={jobId:preview.job.id,jobRevision:3,extractionRevision:2,reviewRevision:1,stale:false,warnings,saved:{reviewRevision:1,jobRevision:3,extractionRevision:2,actorId:'123e4567-e89b-42d3-a456-426614174001',createdAt:'2026-10-26T00:00:00.000Z',draft}};
 const validate=()=>validatePublicationReview(preview,review,plan,source.checksum);
 return {source,preview,plan,review,draft,input,validate};
}
const adjudication=(category:string,basis:string)=>({category,basis,reason:'ตรวจทุกหน้าของต้นฉบับแล้ว พบเฉพาะเนื้อหาสาธารณะตามประเภทที่ระบุ ไม่มีรายการรายบุคคล'});
describe('explicit reviewed public source publication',()=>{
 it('accepts current-only RAG with unknown source dates, retaining null dates and schema4',async()=>{
  const f=await fixture();expect(f.validate().draft.schemaVersion).toBe(4);expect(f.draft.metadata.publishedAt).toBeNull();expect(f.draft.metadata.effectiveFrom).toBeNull();
 });
 it('allows unknown publication date with an explicitly dated effective interval',async()=>{
  const f=await fixture();const input={...f.input,metadata:{...f.input.metadata,effectiveFrom:'2026-10-01'},publicSourceReview:{...f.input.publicSourceReview,temporalBasis:'DATED',temporalReason:null}};
  f.review.saved.draft=reviewDraftSchema.parse(input);expect(f.validate().draft.metadata.publishedAt).toBeNull();
 });
 for(const action of ['ADD_HISTORICAL','AMEND_EXISTING','REPLACE_CURRENT'])it(`rejects undated ${action}`,async()=>{
  const f=await fixture();f.review.saved.draft=reviewDraftSchema.parse({...f.input,metadata:{...f.input.metadata,newFamily:null},action,target:action!=='ADD_HISTORICAL'?{documentId:'123e4567-e89b-42d3-a456-426614174003',revision:1}:null});
  expect(f.validate).toThrow('PUBLICATION_REVIEW_INCOMPLETE');
 });
 for(const documentType of ['FEE','REGULATION','ANNOUNCEMENT'])it(`does not give ${documentType} current-only applicability`,async()=>{const f=await fixture('<p>ประกาศทั่วไป</p>',documentType);expect(f.validate).toThrow('PUBLICATION_REVIEW_INCOMPLETE');});
 it('admits only explicitly cohort/degree/study-type scoped current notices without invented effective dates',async()=>{
  const f=await fixture('<p>ประกาศกิจกรรมสำหรับผู้เข้าศึกษาปี2568 ภาคปกติ ระดับปริญญาตรี</p>','ANNOUNCEMENT');
  const scoped={...f.input,metadata:{...f.input.metadata,publishedAt:'2025-06-06',scope:{...f.input.metadata.scope,cohort:2568,audience:'ปริญญาตรี',studentType:'ภาคปกติ'}}};
  f.review.saved.draft=reviewDraftSchema.parse(scoped);expect(f.validate().draft.metadata.effectiveFrom).toBeNull();
  for(const scope of [{...scoped.metadata.scope,cohort:null},{...scoped.metadata.scope,audience:'ALL'},{...scoped.metadata.scope,studentType:'ALL'}]){
   f.review.saved.draft=reviewDraftSchema.parse({...scoped,metadata:{...scoped.metadata,scope}});expect(f.validate).toThrow('PUBLICATION_REVIEW_INCOMPLETE');
  }
  f.review.saved.draft=reviewDraftSchema.parse({...scoped,metadata:{...scoped.metadata,publishedAt:null}});expect(f.validate).toThrow('PUBLICATION_REVIEW_INCOMPLETE');
 });
 it('requires a deliberate temporal reason and keeps structured mode outside this exception',async()=>{
  const f=await fixture();f.review.saved.draft=reviewDraftSchema.parse({...f.input,publicSourceReview:{...f.input.publicSourceReview,temporalReason:null}});expect(f.validate).toThrow('PUBLICATION_REVIEW_INCOMPLETE');
  f.review.saved.draft=reviewDraftSchema.parse({...f.input,metadata:{...f.input.metadata,storageMode:'BOTH'}});expect(f.validate).toThrow('PUBLICATION_REVIEW_INCOMPLETE');
 });
 it('reviews generic grade policy wording in a calendar without pretending it is a regulation',async()=>{
  const f=await fixture('<p>ปฏิทินวิชาการ วันส่งผลการเรียน</p>','CALENDAR',[adjudication('GRADES','GENERAL_POLICY_WORDING')]);expect(f.validate().draft.metadata.documentType).toBe('CALENDAR');
  f.review.saved.draft=reviewDraftSchema.parse({...f.input,metadata:{...f.input.metadata,academicYear:null}});expect(f.validate).toThrow('PUBLICATION_REVIEW_INCOMPLETE');
 });
 it('reviews only empty public form labels for student records and grades',async()=>{
  const f=await fixture('<p>คำร้องขอหลักฐานการศึกษา รหัสนักศึกษา ................ ผลการเรียน ..............</p>','FORM',[adjudication('STUDENT_RECORDS','PUBLIC_BLANK_TEMPLATE'),adjudication('GRADES','PUBLIC_BLANK_TEMPLATE')]);expect(f.validate().draft.metadata.documentType).toBe('FORM');
 });
 it('reviews a public institutional landline and retains the detector finding',async()=>{
  const f=await fixture('<p>โทรศัพท์: 073299675 ต่อ23300 ศูนย์บรรณสารสนเทศ</p>','GUIDE',[adjudication('PHONE','INSTITUTIONAL_CONTACT')]);expect(f.validate().draft.metadata.visibility).toBe('PUBLIC');expect(f.preview.analysis.sensitiveCategories).toEqual(['PHONE']);
 });
 it('rejects generic/missing/extra adjudications and corrected-only dispositions',async()=>{
  const f=await fixture('<p>โทรศัพท์: 073299675</p>');expect(f.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
  f.review.saved.draft=reviewDraftSchema.parse({...f.input,publicSourceReview:{...f.input.publicSourceReview,sensitivityAdjudications:[adjudication('PHONE','PUBLIC_BLANK_TEMPLATE')]}});expect(f.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
  f.review.saved.draft=reviewDraftSchema.parse({...f.input,publicSourceReview:{...f.input.publicSourceReview,sensitivityAdjudications:[adjudication('PHONE','INSTITUTIONAL_CONTACT'),adjudication('GRADES','GENERAL_POLICY_WORDING')]}});expect(f.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
  const good=await fixture('<p>โทรศัพท์: 073299675</p>','GUIDE',[adjudication('PHONE','INSTITUTIONAL_CONTACT')]);good.review.saved.draft=reviewDraftSchema.parse({...good.input,warningDispositions:good.input.warningDispositions.map(w=>({...w,status:'CORRECTED'}))});expect(good.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 for(const text of ['รหัสนักศึกษา 4069123456 ผลการเรียน 3.50','รหัสนักศึกษา ........ GPA: 3.50','ชื่อ นายสมมติ ตัวอย่าง เกรด 3.50'])it('does not adjudicate a populated form as a blank template',async()=>{
  const f=await fixture(`<p>${text}</p>`,'FORM',[adjudication('STUDENT_RECORDS','PUBLIC_BLANK_TEMPLATE'),adjudication('GRADES','PUBLIC_BLANK_TEMPLATE')]);expect(f.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it('rejects personal mobile and unsupported sensitive categories',async()=>{
  const f=await fixture('<p>phone: 0812345678</p>','GUIDE',[adjudication('PHONE','INSTITUTIONAL_CONTACT')]);expect(f.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
  const medical=await fixture('<p>ข้อมูลสุขภาพ ผลการเรียน</p>','GUIDE',[adjudication('GRADES','GENERAL_POLICY_WORDING')]);expect(medical.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it('rejects populated student/grade cells beneath separate sensitive table headers',async()=>{
  const f=await fixture('<table><tr><th>รหัสนักศึกษา</th><th>ผลการเรียน</th></tr><tr><td>66012345</td><td>3.5</td></tr></table>','FORM',[adjudication('STUDENT_RECORDS','PUBLIC_BLANK_TEMPLATE'),adjudication('GRADES','PUBLIC_BLANK_TEMPLATE')]);expect(f.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it('rejects a filled Thai name attached to its title in a purported blank form',async()=>{
  const f=await fixture('<p>รหัสนักศึกษา ........ ผลการเรียน ........ ชื่อ นายสมชาย ใจดี</p>','FORM',[adjudication('STUDENT_RECORDS','PUBLIC_BLANK_TEMPLATE'),adjudication('GRADES','PUBLIC_BLANK_TEMPLATE')]);expect(f.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it('keeps empty template cells eligible with explicit category review',async()=>{
  const f=await fixture('<table><tr><th>รหัสนักศึกษา</th><th>ผลการเรียน</th></tr><tr><td>........</td><td>........</td></tr></table>','FORM',[adjudication('STUDENT_RECORDS','PUBLIC_BLANK_TEMPLATE'),adjudication('GRADES','PUBLIC_BLANK_TEMPLATE')]);expect(f.validate().draft.metadata.documentType).toBe('FORM');
 });
 it('rejects a populated grade without punctuation after its label',async()=>{
  const f=await fixture('<p>คำร้อง รหัสนักศึกษา ........ ผลการเรียน 3.5</p>','FORM',[adjudication('STUDENT_RECORDS','PUBLIC_BLANK_TEMPLATE'),adjudication('GRADES','PUBLIC_BLANK_TEMPLATE')]);expect(f.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it('rejects a populated name column without an honorific beside blank ID fields',async()=>{
  const f=await fixture('<table><tr><th>ชื่อ-นามสกุล</th><th>รหัสนักศึกษา</th></tr><tr><td>สมชาย ใจดี</td><td>........</td></tr></table>','FORM',[adjudication('STUDENT_RECORDS','PUBLIC_BLANK_TEMPLATE')]);expect(f.validate).toThrow('PUBLICATION_PUBLIC_SENSITIVE_DATA');
 });
 it('retains exact official source and stale-review fencing',async()=>{
  const f=await fixture('<p>โทรศัพท์: 073299675</p>','GUIDE',[adjudication('PHONE','INSTITUTIONAL_CONTACT')]);
  f.review.saved.draft=reviewDraftSchema.parse({...f.input,metadata:{...f.input.metadata,sourceUrl:'https://library.yru.ac.th/another'}});expect(f.validate).toThrow('PUBLICATION_REVIEW_INCOMPLETE');
  f.review.saved.draft=f.draft;f.review.stale=true;expect(f.validate).toThrow('PUBLICATION_PLAN_MISMATCH');
 });
});

describe('current review temporal eligibility',()=>{
 const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 const source:KnowledgeMetadata={status:'ACTIVE',isCurrent:true,approved:true,officialSource:true,extractionReviewed:true,requiresReview:false,visibility:'PUBLIC',archiveOnly:false,familyCode:'LIBRARY_GUIDE',departmentCode:null,audience:'ALL',studentType:'ALL',academicYear:null,semester:null,programCode:null,curriculumCode:null,cohort:null,effectiveFrom:null,effectiveTo:null,temporalBasis:'CURRENT_REVIEWED',currentReviewedAt:'2026-10-26T01:00:00.000Z'};
 it('admits a reviewed current source without inventing an effective date',()=>expect(isKnowledgeEligible(source,scope,'2026-10-26')).toBe(true));
 it('retains global yearless service applicability only for a current query',()=>expect(isKnowledgeEligible(source,{...scope,academicYear:2569},'2026-10-26')).toBe(true));
 it('excludes historical/as-of, future review and unreviewed legacy undated sources',()=>{
  expect(isKnowledgeEligible(source,{...scope,historical:true,asOfDate:'2026-10-26'},'2026-10-26')).toBe(false);
  expect(isKnowledgeEligible(source,{...scope,historical:true,academicYear:2569},'2026-10-26')).toBe(false);
  expect(isKnowledgeEligible(source,scope,'2026-10-25')).toBe(false);
  expect(isKnowledgeEligible({...source,temporalBasis:'DATED'},scope,'2026-10-26')).toBe(false);
 });
});
