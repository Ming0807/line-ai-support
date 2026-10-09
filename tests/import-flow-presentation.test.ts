import {expect,it} from 'vitest';
import {getImportFlowSteps,getImportReviewChecklist} from '../app/(dashboard)/knowledge/import/import-flow';

it('opens each import step only when its source state exists',()=>{
 expect(getImportFlowSteps('upload',false,false).map(step=>step.state)).toEqual(['current','locked','locked']);
 expect(getImportFlowSteps('prepare',true,false).map(step=>step.state)).toEqual(['complete','current','locked']);
 expect(getImportFlowSteps('upload',true,true).map(step=>step.state)).toEqual(['current','available','available']);
 expect(getImportFlowSteps('review',true,true).map(step=>step.state)).toEqual(['complete','complete','current']);
});

it('keeps missing review work visible in plain language near the approval step',()=>{
 const items=getImportReviewChecklist({
  missingFields:['วันที่ประกาศ','วันที่เริ่มมีผล'],unresolvedWarnings:2,unconfirmedAttestations:3,extractionReviewed:false,
  hasSavedDraft:false,draftChanged:false,stale:true,actionSelected:false,targetRequired:true,targetSelected:false,
  newFamilyDetailsMissing:false,storageMode:'BOTH',chunkPlanReady:false,mappingReady:false,
 });
 const copy=items.map(item=>item.message).join(' ');
 expect(items.map(item=>item.key)).toEqual(expect.arrayContaining(['stale','metadata','warnings','attestations','extraction','action','target','chunks','mapping','save']));
 expect(copy).toContain('วันที่ประกาศ');
 expect(copy).toContain('วันที่เริ่มมีผล');
 expect(copy).toContain('คำเตือน');
 expect(copy).toContain('คำยืนยัน');
 expect(copy).not.toContain('RAG');
 expect(copy).not.toContain('STRUCTURED');
 expect(copy).not.toContain('CAS');
});

it('does not show blockers after the saved review contains every required decision',()=>{
 expect(getImportReviewChecklist({
  missingFields:[],unresolvedWarnings:0,unconfirmedAttestations:0,extractionReviewed:true,
  hasSavedDraft:true,draftChanged:false,stale:false,actionSelected:true,targetRequired:true,targetSelected:true,
  newFamilyDetailsMissing:false,storageMode:'RAG',chunkPlanReady:true,mappingReady:false,
 })).toEqual([]);
});
