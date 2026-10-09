export type ImportFlowStage='upload'|'prepare'|'review';
export type ImportFlowStepState='current'|'complete'|'available'|'locked';
export type ImportFlowStep={id:ImportFlowStage;label:string;state:ImportFlowStepState;disabled:boolean};

export function getImportFlowSteps(stage:ImportFlowStage,hasJob:boolean,hasPreview:boolean):ImportFlowStep[]{
 const canPrepare=hasJob||hasPreview;
 return [
  {id:'upload',label:'เพิ่มต้นฉบับ',state:stage==='upload'?'current':hasJob?'complete':'available',disabled:stage==='upload'},
  {id:'prepare',label:'ตรวจสรุป',state:stage==='prepare'?'current':stage==='review'&&hasPreview?'complete':canPrepare?'available':'locked',disabled:!canPrepare||stage==='prepare'},
  {id:'review',label:'ตรวจรายละเอียดและอนุมัติ',state:stage==='review'?'current':hasPreview?'available':'locked',disabled:!hasPreview||stage==='review'},
 ];
}

export type ImportReviewChecklistInput={
 missingFields:readonly string[];
 unresolvedWarnings:number;
 unconfirmedAttestations:number;
 extractionReviewed:boolean;
 hasSavedDraft:boolean;
 draftChanged:boolean;
 stale:boolean;
 actionSelected:boolean;
 targetRequired:boolean;
 targetSelected:boolean;
 newFamilyDetailsMissing:boolean;
 storageMode:'RAG'|'STRUCTURED'|'BOTH'|null;
 chunkPlanReady:boolean;
 mappingReady:boolean;
};
export type ImportReviewChecklistItem={key:string;message:string;href:string};

/** Presentation guidance only; the server and approval panel remain authoritative. */
export function getImportReviewChecklist(input:ImportReviewChecklistInput):ImportReviewChecklistItem[]{
 const items:ImportReviewChecklistItem[]=[];
 if(input.stale)items.push({key:'stale',message:'โหลดข้อมูลตรวจฉบับล่าสุดก่อนดำเนินการต่อ',href:'#review-state'});
 if(input.missingFields.length>0)items.push({key:'metadata',message:`เติมข้อมูลที่ยังขาด: ${input.missingFields.join(' · ')}`,href:'#review-metadata'});
 if(input.unresolvedWarnings>0)items.push({key:'warnings',message:`ตรวจคำเตือนอีก ${input.unresolvedWarnings} รายการและระบุเหตุผล`,href:'#review-warnings'});
 if(!input.extractionReviewed)items.push({key:'extraction',message:'เปิดดูข้อความและตำแหน่งที่อ่านได้ก่อนยืนยันการตรวจ',href:'#review-extraction'});
 const remainingAttestations=Math.max(0,input.unconfirmedAttestations-(input.extractionReviewed?0:1));
 if(remainingAttestations>0)items.push({key:'attestations',message:`ทำคำยืนยันการตรวจอีก ${remainingAttestations} ข้อ หลังตรวจหลักฐานจริง`,href:'#review-attestations'});
 if(!input.actionSelected)items.push({key:'action',message:'เลือกวิธีดำเนินการกับเอกสารฉบับนี้',href:'#review-version'});
 if(input.targetRequired&&!input.targetSelected)items.push({key:'target',message:'เลือกเอกสารฉบับเดิมที่เกี่ยวข้อง',href:'#review-version'});
 if(input.newFamilyDetailsMissing)items.push({key:'new-family',message:'กรอกชื่อและหมวดหมู่ของกลุ่มเอกสารใหม่',href:'#review-family-details'});
 if((input.storageMode==='RAG'||input.storageMode==='BOTH')&&!input.chunkPlanReady)items.push({key:'chunks',message:'เตรียมและตรวจข้อความที่จะใช้ค้น',href:'#review-storage'});
 if((input.storageMode==='STRUCTURED'||input.storageMode==='BOTH')&&!input.mappingReady)items.push({key:'mapping',message:'ตรวจรูปแบบข้อมูลตารางที่ระบบรองรับ',href:'#review-storage'});
 if(!input.hasSavedDraft||input.draftChanged)items.push({key:'save',message:input.hasSavedDraft?'บันทึกการแก้ไขก่อนส่งอนุมัติ':'บันทึกร่างส่วนตัวก่อนส่งอนุมัติ',href:'#review-draft-actions'});
 return items;
}
