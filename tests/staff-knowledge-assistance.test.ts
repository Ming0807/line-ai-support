import {expect,it} from 'vitest';
import {projectStaffKnowledgeAdvice} from '@/lib/staff/knowledge-assistance-projection';
import {staffKnowledgeAdviceSchema} from '@/lib/staff/knowledge-assistance-contracts';
import type {AIResult} from '@/lib/ai/jobs';
const chunkId='56df60db-83b6-437a-a644-f097c9bf6815';
function result():AIResult{return {kind:'ANSWER',output:{answer:'ตรวจสอบเวลาที่ให้บริการตามเอกสารนี้ครับ',citationChunkIds:[chunkId]},
 scope:{historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null},
 queryVector:[1],fingerprint:'a'.repeat(64),evidence:[{chunkId,documentId:'985d2339-351c-4d13-b7cb-d058d7b859f3',documentRevision:0,title:'คู่มือบริการ YRU',familyCode:'SERVICES',academicYear:null,authorityLevel:50,pageNumber:2,sectionTitle:null,content:'ข้อความที่ตรวจแล้ว',sourceUrl:'https://library.yru.ac.th/services',similarity:0.9}]};}
it('projects server-selected references without private record/proof or source content fields',()=>{
 const view=projectStaffKnowledgeAdvice(result(),3);expect(view.status).toBe('VERIFIED');expect(view.revision).toBe(3);expect(view.sources).toEqual([{title:'คู่มือบริการ YRU',academicYear:null,url:'https://library.yru.ac.th/services',location:'หน้า 2'}]);
 expect(view.draftText).toContain('https://library.yru.ac.th/services');for(const value of [chunkId,'985d2339-351c-4d13-b7cb-d058d7b859f3','ข้อความที่ตรวจแล้ว'])expect(JSON.stringify(view)).not.toContain(value);
});
it('rejects a model citation to an unavailable source and malformed reply instead of trusting it',()=>{
 const unknown=result();if(unknown.kind==='ANSWER')unknown.output.citationChunkIds=['c1686190-363e-48cb-bc5d-c14be0bb17f9'];expect(()=>projectStaffKnowledgeAdvice(unknown,0)).toThrow();
 const malformed=result();if(malformed.kind==='ANSWER')malformed.output.answer='https://invented.example';expect(()=>projectStaffKnowledgeAdvice(malformed,0)).toThrow();
});
it('does not truncate references to fit the existing staff reply limit',()=>{
 const long=result();if(long.kind==='ANSWER'){long.output.answer='ก'.repeat(3000);long.evidence[0].title='ข'.repeat(500);long.evidence[0].sourceUrl='https://library.yru.ac.th/'+ 'c'.repeat(1900);}
 const view=projectStaffKnowledgeAdvice(long,0);expect(view.status).toBe('VERIFIED');expect(view.draftText).toBeNull();expect(view.sources[0].url).toBe(long.kind==='ANSWER'?long.evidence[0].sourceUrl:null);
});
it('labels a clarification as unverified and supplies no fabricated sources or sendable draft',()=>{
 expect(projectStaffKnowledgeAdvice({kind:'CLARIFY',text:'กรุณาระบุปีที่เกี่ยวข้อง'},2)).toEqual({revision:2,status:'NOT_VERIFIED',answer:'กรุณาระบุปีที่เกี่ยวข้อง',draftText:null,sources:[]});
});
it('rejects unsafe browser citation links even if a response has otherwise valid fields',()=>{
 const view=projectStaffKnowledgeAdvice(result(),0);
 for(const url of ['javascript:alert(1)','http://example.com','https://user:password@example.com'])expect(staffKnowledgeAdviceSchema.safeParse({...view,sources:[{...view.sources[0],url}]}).success).toBe(false);
});
