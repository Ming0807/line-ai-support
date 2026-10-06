import {expect,it} from 'vitest';
import {buildImportAssistance} from '@/lib/imports/assistance';
import {parseAssistanceEnvelope,applyImportAssistance,requiredReviewFields} from '@/lib/imports/assistance-contract';
import {unfinishedReviewDraft} from './fixtures/import-review';
import type {ImportPreview} from '@/lib/imports/import-extraction';
const binding={jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',jobRevision:1,extractionRevision:1};
function preview(text:string):ImportPreview{
 return {job:{id:binding.jobId,revision:1,filename:'calendar.pdf',sourceUrl:'https://regis.yru.ac.th/calendar.pdf'},extractionRevision:1,
  extraction:{title:'ปฏิทินการศึกษา',pages:[{text}],tables:[]},analysis:{title:'ปฏิทินการศึกษา',familyCode:'ACADEMIC_CALENDAR',departmentCode:'ACADEMIC_AFFAIRS',documentType:'CALENDAR',academicYear:2569,versionName:'ปีการศึกษา 2569'}} as unknown as ImportPreview;
}
const references={families:[{code:'ACADEMIC_CALENDAR',name:'ปฏิทินการศึกษา',category:'การศึกษา'}],departments:[{code:'ACADEMIC_AFFAIRS',name:'งานวิชาการ'}]};
it('prepares evidence-backed proposals and distinguishes operational defaults without consent',()=>{
 const a=buildImportAssistance(preview('ประกาศ ณ วันที่ ๖ ตุลาคม พ.ศ. ๒๕๖๙\nมีผลตั้งแต่วันที่ 1 พฤศจิกายน 2569'),references);
 expect(a.metadata).toMatchObject({publishedAt:'2026-10-06',effectiveFrom:'2026-11-01',familyCode:'ACADEMIC_CALENDAR',departmentCode:'ACADEMIC_AFFAIRS',versionStream:'main',visibility:'INTERNAL',storageMode:'RAG',authorityLevel:null});
 expect(a.origins.publishedAt?.kind).toBe('EXTRACTED');expect(a.origins.visibility?.kind).toBe('DEFAULT');
 const draft=applyImportAssistance(unfinishedReviewDraft(),a);expect(draft.action).toBeNull();expect(draft.target).toBeNull();expect(Object.values(draft.attestations).every(v=>!v)).toBe(true);expect(draft.warningDispositions).toEqual([]);
});
it('leaves absent, invalid, ambiguous and unrelated date evidence unresolved',()=>{
 for(const text of ['ปีการศึกษา 2569 วันที่ 1 ตุลาคม 2569','ประกาศ ณ วันที่ 31 กุมภาพันธ์ 2569','มีผลตั้งแต่วันที่ 2026-01-01\nมีผลตั้งแต่วันที่ 2026-02-01']){
  const a=buildImportAssistance(preview(text),references);expect(a.metadata.effectiveFrom).toBeNull();expect(a.metadata.publishedAt).toBeNull();
 }
 const a=buildImportAssistance(preview('ประกาศ ณ วันที่ 2026-02-31\nประกาศ ณ วันที่ 2026-01-01'),references);expect(a.metadata.publishedAt).toBeNull();
});
it('does not invent references, authority, public scope or expose copied body snippets',()=>{
 const a=buildImportAssistance(preview('รายชื่อนักศึกษา secret-person@example.com มีผลตั้งแต่วันที่ 1 มกราคม 2569'),{families:[],departments:[]});
 expect(a.metadata.familyCode).toBeNull();expect(a.metadata.departmentCode).toBeNull();expect(a.metadata.authorityLevel).toBeNull();expect(a.metadata.scope.audience).toBeNull();expect(a.metadata.scope.studentType).toBeNull();expect(JSON.stringify(a)).not.toContain('secret-person');
 expect(requiredReviewFields(a.metadata).map(v=>v.key)).toContain('authorityLevel');
});
it('clears invalid effective interval and preserves existing human fields and every consent',()=>{
 const a=buildImportAssistance(preview('มีผลตั้งแต่วันที่ 2026-11-01\nสิ้นสุดวันที่ 2026-10-01'),references);expect(a.metadata.effectiveTo).toBeNull();
 const draft=unfinishedReviewDraft();draft.metadata.title='ชื่อที่คนตรวจแล้ว';draft.metadata.visibility='RESTRICTED';draft.attestations.extractionReviewed=true;
 expect(applyImportAssistance(draft,a)).toMatchObject({metadata:{title:'ชื่อที่คนตรวจแล้ว',visibility:'RESTRICTED'},attestations:{extractionReviewed:true}});
});
it('does not fill a proposed end date that conflicts with a human-reviewed start date',()=>{
 const a=buildImportAssistance(preview('มีผลตั้งแต่วันที่ 2026-01-01\nสิ้นสุดวันที่ 2026-12-31'),references),draft=unfinishedReviewDraft();draft.metadata.effectiveFrom='2027-01-01';
 const result=applyImportAssistance(draft,a);expect(result.metadata.effectiveFrom).toBe('2027-01-01');expect(result.metadata.effectiveTo).toBeNull();
});
it('rejects extra fields, wrong job/revisions and invalid proposal metadata',()=>{
 const a=buildImportAssistance(preview(''),references);expect(parseAssistanceEnvelope({assistance:a},binding)).toEqual(a);
 for(const invalid of [{...a,jobId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},{...a,jobRevision:2},{...a,extractionRevision:2},{...a,approved:true},{...a,metadata:{...a.metadata,publishedAt:'2026-02-31'}}])expect(parseAssistanceEnvelope({assistance:invalid},binding)).toBeNull();
});
