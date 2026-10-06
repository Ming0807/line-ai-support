import {describe,it,expect} from 'vitest';
import {reviewDraftSchema,reviewSaveSchema} from '../lib/imports/review-schema';
function draft(){return {
 schemaVersion:1,metadata:{title:null,familyCode:null,newFamily:null,departmentCode:null,documentType:null,versionName:null,versionStream:null,academicYear:null,
 scope:{semester:null,audience:null,studentType:null,programCode:null,curriculumCode:null,cohort:null},publishedAt:null,effectiveFrom:null,effectiveTo:null,authorityLevel:null,
 sourceUrl:null,sourcePageUrl:null,visibility:null,storageMode:null,datasetType:null},action:null,target:null,relationship:null,
 attestations:{sourceAuthorityReviewed:false,extractionReviewed:false,applicabilityReviewed:false,sensitivityReviewed:false,versionReviewed:false},warningDispositions:[],
};}
const id='39f7e07f-7d76-433e-a83e-205297c60a83';
const accepts=(value:unknown)=>reviewDraftSchema.safeParse(value).success;
describe('strict independent review drafts',()=>{
 it('accepts explicitly unfinished metadata and false attestations without inferred trust or defaults',()=>{
  const value=draft();expect(reviewDraftSchema.parse(value)).toEqual(value);
  const missing=structuredClone(value) as Record<string,unknown>;delete missing.attestations;expect(accepts(missing)).toBe(false);
  const missingMetadata=structuredClone(value) as {metadata:Record<string,unknown>};delete missingMetadata.metadata.effectiveFrom;expect(accepts(missingMetadata)).toBe(false);
 });
 it('rejects injected approval, SQL, unknown dataset/model and nested unchecked fields',()=>{
  for(const injection of [{...draft(),approved:true},{...draft(),sql:'select 1'},
   {...draft(),metadata:{...draft().metadata,table:'student_grades'}},
   {...draft(),metadata:{...draft().metadata,storageMode:'MODEL',model:'paid'}},
   {...draft(),metadata:{...draft().metadata,datasetType:'student_grades'}},
   {...draft(),metadata:{...draft().metadata,scope:{...draft().metadata.scope,studentId:'123'}}},
   {...draft(),attestations:{...draft().attestations,officialSource:true}}])expect(accepts(injection)).toBe(false);
 });
 it('preserves all storage choices and seven fixed codes without calling a mapper',()=>{
  for(const storageMode of ['RAG','STRUCTURED','BOTH'])for(const datasetType of ['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements'])
   expect(accepts({...draft(),metadata:{...draft().metadata,storageMode,datasetType}})).toBe(true);
 });
 it('requires real calendar dates, ordered intervals and bounded authority/year/scope',()=>{
  expect(accepts({...draft(),metadata:{...draft().metadata,publishedAt:'2024-02-29',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',academicYear:2569,authorityLevel:90}})).toBe(true);
  for(const fields of [{effectiveFrom:'2026-02-30'},{publishedAt:'2025-02-29'},{effectiveTo:'2026-12-31'},
   {effectiveFrom:'2026-12-31',effectiveTo:'2026-01-01'},{academicYear:2026},{authorityLevel:101},
   {scope:{...draft().metadata.scope,cohort:100}},{title:'   '}])expect(accepts({...draft(),metadata:{...draft().metadata,...fields}})).toBe(false);
 });
 it('stores reviewed provenance only as safe official HTTPS and never sets attestations automatically',()=>{
  const value={...draft(),metadata:{...draft().metadata,sourceUrl:'https://eduservice.yru.ac.th/?view=fee'}};
  const parsed=reviewDraftSchema.parse(value);expect(parsed.attestations.sourceAuthorityReviewed).toBe(false);
  for(const sourceUrl of ['http://yru.ac.th/','https://yru.ac.th.evil.example/','https://user:pass@yru.ac.th/',
   'https://yru.ac.th/?token=secret','https://yru.ac.th/#secret','https://127.0.0.1/','https://yru.ac.th:444/'])
   expect(accepts({...draft(),metadata:{...draft().metadata,sourceUrl}})).toBe(false);
 });
 it('allows reviewed new-family data without closing the family registry to the initial nineteen codes',()=>{
  expect(accepts({...draft(),action:'NEW_FAMILY',metadata:{...draft().metadata,familyCode:'SHUTTLE_GUIDE',newFamily:{name:'คู่มือรถรับส่ง',category:'Services'}}})).toBe(true);
  expect(accepts({...draft(),metadata:{...draft().metadata,familyCode:'x; drop table'}})).toBe(false);
  expect(accepts({...draft(),action:'ADD_ADDITIONAL',metadata:{...draft().metadata,newFamily:{name:'New',category:'Services'}}})).toBe(false);
 });
 it('requires exact targets for replacement/amendment and whole CANCELS only on additional instruments',()=>{
  for(const action of ['REPLACE_CURRENT','AMEND_EXISTING']){
   expect(accepts({...draft(),action,target:{documentId:id,revision:0}})).toBe(true);
   expect(accepts({...draft(),action})).toBe(false);
  }
  for(const action of ['NEW_FAMILY','ADD_ADDITIONAL','ADD_HISTORICAL'])expect(accepts({...draft(),action})).toBe(true);
  expect(accepts({...draft(),action:'ADD_ADDITIONAL',relationship:'CANCELS',target:{documentId:id,revision:4}})).toBe(true);
  for(const bad of [{action:'AMEND_EXISTING',relationship:'CANCELS',target:{documentId:id,revision:0}},
   {action:'ADD_ADDITIONAL',relationship:'CANCELS',target:null},{action:'ADD_HISTORICAL',target:{documentId:id,revision:0}},
   {action:'ADD_ADDITIONAL',target:{documentId:id,revision:0}},{action:'REPLACE_CURRENT',target:{documentId:id}},
   {action:'AMEND_EXISTING',target:{documentId:id,revision:-1}},{action:'DELETE_DOCUMENT'},
   {action:'ADD_ADDITIONAL',relationship:'PARTIAL_CANCELS',target:{documentId:id,revision:0}}])expect(accepts({...draft(),...bad})).toBe(false);
 });
 it('retains unresolved disposition and requires exact reason-bound nonduplicate warning keys',()=>{
  const warningKey='a'.repeat(64);
  expect(accepts({...draft(),warningDispositions:[{warningKey,status:'UNRESOLVED',reason:null}]})).toBe(true);
  expect(accepts({...draft(),warningDispositions:[{warningKey,status:'FALSE_POSITIVE',reason:'ตรวจเอกสารแล้วเป็นรหัสแบบฟอร์ม'}]})).toBe(true);
  for(const warningDispositions of [[{warningKey,status:'CORRECTED',reason:null}],[{warningKey,status:'FALSE_POSITIVE',reason:' '}],
   [{warningKey:'raw original text',status:'UNRESOLVED',reason:null}],
   [{warningKey,status:'UNRESOLVED',reason:null},{warningKey,status:'CORRECTED',reason:'แก้แล้ว'}],
   [{warningKey,status:'APPROVED',reason:'ok'}]])expect(accepts({...draft(),warningDispositions})).toBe(false);
 });
 it('binds save input to three distinct exact counters and rejects missing/extra/negative counters',()=>{
  const valid={expectedJobRevision:3,expectedExtractionRevision:2,expectedReviewRevision:1,draft:draft()};
  expect(reviewSaveSchema.parse(valid)).toEqual(valid);
  for(const bad of [{...valid,expectedJobRevision:-1},{...valid,expectedExtractionRevision:0},{...valid,expectedReviewRevision:0.1},
   {...valid,approve:true},{...valid,expectedReviewRevision:undefined}])expect(reviewSaveSchema.safeParse(bad).success).toBe(false);
 });
 it('bounds encrypted draft payload by UTF8 bytes even when Thai text is below the character cap',()=>{
  const choices=Array.from({length:900},(_,index)=>({warningKey:(index+1).toString(16).padStart(64,'0'),status:'FALSE_POSITIVE',reason:'ก'.repeat(500)}));
  const value={...draft(),warningDispositions:choices};expect(JSON.stringify(value).length).toBeLessThan(1024*1024);expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(1024*1024);
  expect(accepts(value)).toBe(false);expect(accepts({...draft(),warningDispositions:choices.slice(0,10)})).toBe(true);
 });
});
