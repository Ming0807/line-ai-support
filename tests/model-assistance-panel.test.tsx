import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import ModelAssistancePanel,{applyModelSuggestionsToDraft} from '@/app/(dashboard)/knowledge/import/model-assistance-panel';
import {unfinishedReviewDraft} from './fixtures/import-review';
import type {ImportModelSuggestion} from '@/lib/imports/model-assistance-contract';

const suggestion=(field:ImportModelSuggestion['field'],value:string):ImportModelSuggestion=>({field,value,segmentId:'p1',quote:`หลักฐาน ${value}`});

it('applies only allowed model fields that remain empty in the latest draft',()=>{
 const draft=unfinishedReviewDraft();
 draft.metadata.title='ชื่อที่คนแก้แล้ว';
 draft.metadata.documentType='GUIDE';
 draft.metadata.scope.audience='STUDENT';
 draft.action='ADD_ADDITIONAL';
 draft.attestations.extractionReviewed=true;
 const result=applyModelSuggestionsToDraft(draft,[
  suggestion('title','ข้อเสนอชื่อ'),suggestion('departmentCode','ACADEMIC_AFFAIRS'),
  suggestion('documentType','ANNOUNCEMENT'),suggestion('academicYear','2569'),
 ]);
 expect(result.metadata).toMatchObject({title:'ชื่อที่คนแก้แล้ว',departmentCode:'ACADEMIC_AFFAIRS',documentType:'GUIDE',academicYear:2569,
  scope:{audience:'STUDENT',studentType:null}});
 expect(result.action).toBe('ADD_ADDITIONAL');
 expect(result.attestations.extractionReviewed).toBe(true);
});

it('does not apply malformed academic-year text',()=>{
 const result=applyModelSuggestionsToDraft(unfinishedReviewDraft(),[suggestion('academicYear','2569.5')]);
 expect(result.metadata.academicYear).toBeNull();
});

it('requires explicit external-processing consent before enabling the model request',()=>{
 const html=renderToStaticMarkup(createElement(ModelAssistancePanel,{
  jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',jobRevision:2,extractionRevision:3,disabled:false,onApply:()=>undefined,
 }));
 expect(html).toContain('ส่งข้อความบางส่วนจากเอกสาร');
 expect(html).toContain('type="checkbox"');
 expect(html).toContain('ยืนยันว่าเอกสารนี้ส่งให้บริการภายนอกได้');
 expect(html).toContain('type="button" class="knowledge-button knowledge-button-primary" disabled=""');
 expect(html).toContain('ให้ AI ช่วยเตรียมข้อมูล');
});
