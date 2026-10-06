import {describe,it,expect} from 'vitest';
import {buildVersionCandidates,type VersionDocument,type VersionFamily} from '../lib/imports/version-candidates';
import {unfinishedReviewDraft} from './fixtures/import-review';
const family:VersionFamily={id:'560406ad-61c8-428c-993c-de4eb3a68854',code:'TRANSFER_REGULATION',name:'ระเบียบเทียบโอน',category:'ACADEMIC'};
function metadata(){return {...unfinishedReviewDraft().metadata,familyCode:family.code,departmentCode:'REGISTRAR',documentType:'REGULATION',versionStream:'MAIN',academicYear:2569,
 scope:{semester:null,audience:'ALL',studentType:'ALL',programCode:null,curriculumCode:null,cohort:null}};}
function document(overrides:Partial<VersionDocument>={}):VersionDocument{return {documentId:'3fe60cbb-607e-4414-9f2b-a359e93d2dd9',revision:4,title:'ระเบียบเดิม',departmentCode:'REGISTRAR',documentType:'REGULATION',versionName:'2569',versionStream:'MAIN',academicYear:2569,
 scope:{semester:null,audience:'ALL',studentType:'ALL',programCode:null,curriculumCode:null,cohort:null},status:'ACTIVE',isCurrent:true,approved:true,isAmendment:false,isCancellation:false,effectiveFrom:'2026-01-01',effectiveTo:null,...overrides};}
const targets=(row:VersionDocument,review=metadata())=>buildVersionCandidates(review,family,[row]).candidates[0].targetActions;
describe('reviewed version candidate choices never publish or infer intent',()=>{
 it('requires explicit family/department/type/stream and audience/student type rather than interpreting null as ALL',()=>{
  const result=buildVersionCandidates(unfinishedReviewDraft().metadata,null,[]);expect(result.missingMetadata).toEqual(['familyCode','departmentCode','documentType','versionStream','audience','studentType']);expect(result.availableActions).toEqual([]);expect(result.candidates).toEqual([]);
 });
 it('offers an absent explicitly named custom family without a startup-family allowlist',()=>{
  const result=buildVersionCandidates({...metadata(),familyCode:'CUSTOM_SHUTTLE_SCHEDULE'},null,[]);expect(result.availableActions).toEqual(['NEW_FAMILY']);expect(result.family).toBeNull();
 });
 it('offers existing family additional/historical choices without automatically selecting an action',()=>{
  const result=buildVersionCandidates(metadata(),family,[]);expect(result.availableActions).toEqual(['ADD_ADDITIONAL','ADD_HISTORICAL']);expect(result.candidates).toEqual([]);
 });
 it('offers exact approved/current base replacement, amendment and explicit cancellation',()=>{
  expect(targets(document())).toEqual(['REPLACE_CURRENT','AMEND_EXISTING','CANCELS']);expect(buildVersionCandidates(metadata(),family,[document()]).availableActions).toEqual(['ADD_HISTORICAL']);
 });
 it('permits replacement across years but forbids amendment/cancellation applicability mismatch',()=>{
  expect(targets(document({academicYear:2568}))).toEqual(['REPLACE_CURRENT']);expect(targets(document({academicYear:null}))).toEqual(['REPLACE_CURRENT']);
 });
 it('denies cross department/type/scope targets while displaying them for conflict awareness',()=>{
  for(const row of [document({departmentCode:'IT'}),document({departmentCode:null}),document({documentType:'GUIDE'}),
   document({scope:{...document().scope,audience:'UNDERGRAD'}}),document({scope:{...document().scope,programCode:'CS'}}),document({scope:{...document().scope,cohort:2568}})]){
   const result=buildVersionCandidates(metadata(),family,[row]);expect(result.candidates[0].targetActions).toEqual([]);expect(result.candidates[0].matchingScope).toBe(false);
  }
 });
 it('can cancel one amendment but does not offer amendment chains or replacement of an amendment',()=>{
  expect(targets(document({isAmendment:true,isCurrent:false}))).toEqual(['CANCELS']);expect(targets(document({isAmendment:true}))).toEqual(['CANCELS']);
 });
 it('rejects pending/draft/unapproved/cancellation targets; approved historical target is a separate cancellation case',()=>{
  for(const row of [document({approved:false}),document({status:'DRAFT',isCurrent:false}),document({isCancellation:true})])expect(targets(row)).toEqual([]);
  expect(targets(document({status:'SUPERSEDED',isCurrent:false}))).toEqual(['CANCELS']);expect(targets(document({status:'EXPIRED',isCurrent:false}))).toEqual(['CANCELS']);
 });
 it('honors family-wide current-stream occupancy even when another department occupies it',()=>{
  const result=buildVersionCandidates(metadata(),family,[document({departmentCode:'IT'})]);expect(result.currentStreamOccupied).toBe(true);expect(result.availableActions).toEqual(['ADD_HISTORICAL']);expect(result.candidates[0].targetActions).toEqual([]);
 });
 it('requires same stream only for replacement; an amendment instrument can have a separate reviewed stream',()=>{
  const result=buildVersionCandidates({...metadata(),versionStream:'AMENDMENT_2'},family,[document()]);expect(result.currentStreamOccupied).toBe(false);expect(result.candidates[0].targetActions).toEqual(['AMEND_EXISTING','CANCELS']);expect(result.availableActions).toEqual(['ADD_ADDITIONAL','ADD_HISTORICAL']);
 });
 it('fails bounded lookup closed rather than implying the first100 candidates are complete',()=>{
  const result=buildVersionCandidates(metadata(),family,Array.from({length:101},(_,index)=>document({documentId:String(index)})));expect(result.limitExceeded).toBe(true);expect(result.availableActions).toEqual([]);expect(result.candidates).toEqual([]);
 });
 it('keeps input and returned target records separate',()=>{
  const row=document(),review=metadata(),snapshot=structuredClone({row,review,family});const result=buildVersionCandidates(review,family,[row]);result.candidates[0].scope.programCode='ALTERED';expect({row,review,family}).toEqual(snapshot);
 });
});
