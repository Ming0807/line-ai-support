import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import PublicSourceReviewPanel from '@/app/(dashboard)/knowledge/import/public-source-review-panel';
import {publicSourceReviewIssues} from '@/app/(dashboard)/knowledge/import/public-source-review-panel';
import {changeReviewMode,enablePublicSourceReview,restartReviewDraft} from '@/app/(dashboard)/knowledge/import/review-state';
import {unfinishedReviewDraft} from './fixtures/import-review';
import type {ImportReviewDraft} from '@/lib/imports/review-schema';
import type {PublicSourceReview} from '@/lib/imports/public-source-review';
import {isVersionCandidate,targetSummary} from '@/app/(dashboard)/knowledge/import/version-panel';
import {DocumentDetails,DocumentSummary} from '@/app/(dashboard)/knowledge/catalog-panel';
import type {VersionCandidate} from '@/lib/imports/version-candidates';
import type {CatalogDetail,CatalogSummary} from '@/lib/knowledge/catalog-types';

const blankReview=():PublicSourceReview=>({
 temporalBasis:'DATED',temporalReason:null,sensitivityAdjudications:[],
});

function schemaFourDraft():Extract<ImportReviewDraft,{schemaVersion:4}>{
 const base=unfinishedReviewDraft();
 return {
  ...base,schemaVersion:4,chunkPlan:{digest:'a'.repeat(64),chunkerVersion:'located-e5-v1'},structuredMapping:null,
  publicSourceReview:{temporalBasis:'CURRENT_REVIEWED',temporalReason:'ตรวจต้นฉบับแล้วไม่พบวันที่มีผล',sensitivityAdjudications:[
   {category:'STUDENT_RECORDS',basis:'PUBLIC_BLANK_TEMPLATE',reason:'ช่องชื่อและรหัสยังว่าง'},
  ]},
 } as Extract<ImportReviewDraft,{schemaVersion:4}>;
}

it('renders dated and current-reviewed temporal choices without preselecting a consent',()=>{
 const html=renderToStaticMarkup(createElement(PublicSourceReviewPanel,{
  value:blankReview(),documentType:'FORM',visibility:'PUBLIC',storageMode:'RAG',publishedAt:null,effectiveFrom:null,effectiveTo:null,
  action:'NEW_FAMILY',relationship:null,target:null,sourceUrl:'https://www.yru.ac.th/forms',sensitiveCategories:[],disabled:false,onChange:()=>undefined,
 }));
 expect(html).toContain('ฐานการระบุเวลา');
 expect(html).toContain('ระบุวันที่ตามต้นฉบับ');
 expect(html).toContain('ตรวจแล้วว่าเป็นข้อมูลปัจจุบัน โดยต้นฉบับไม่ระบุวัน');
 expect(html).toContain('วันที่ประกาศเว้นว่างได้เมื่อไม่ปรากฏในต้นฉบับ');
 expect(html).not.toContain('<textarea');
 expect(html).toContain('วันที่เริ่มมีผลยังจำเป็น');
});

it('offers only category-matched public source bases with a separate reviewer reason',()=>{
 const html=renderToStaticMarkup(createElement(PublicSourceReviewPanel,{
  value:{...blankReview(),temporalBasis:'CURRENT_REVIEWED',sensitivityAdjudications:[
   {category:'STUDENT_RECORDS',basis:'PUBLIC_BLANK_TEMPLATE',reason:null},
   {category:'PHONE',basis:'INSTITUTIONAL_CONTACT',reason:null},
  ]},documentType:'FORM',visibility:'PUBLIC',storageMode:'RAG',publishedAt:null,effectiveFrom:null,effectiveTo:null,
  action:'ADD_ADDITIONAL',relationship:null,target:null,sourceUrl:'https://www.yru.ac.th/forms',sensitiveCategories:['STUDENT_RECORDS','PHONE'],disabled:false,onChange:()=>undefined,
 }));
 expect(html).toContain('ช่องข้อมูลในแบบฟอร์มว่าง');
 expect(html).toContain('หมายเลขติดต่อของหน่วยงาน');
 expect(html).toContain('เหตุผลจากการตรวจต้นฉบับ');
 expect(html).not.toContain('ข้อมูลที่กรอกแล้ว');
 expect(html).not.toContain('หมายเลขโทรศัพท์ส่วนบุคคล');
});

it('does not choose a sensitivity basis or create a reason when the review is enabled',()=>{
 const html=renderToStaticMarkup(createElement(PublicSourceReviewPanel,{
  value:blankReview(),documentType:'FORM',visibility:'PUBLIC',storageMode:'RAG',publishedAt:null,effectiveFrom:'2026-01-01',effectiveTo:null,
  action:'NEW_FAMILY',relationship:null,target:null,sourceUrl:'https://www.yru.ac.th/forms',sensitiveCategories:['STUDENT_RECORDS'],disabled:false,onChange:()=>undefined,
 }));
 expect(html).toContain('<option value="" selected="">เลือกเหตุผลจากต้นฉบับ</option>');
 expect(html).not.toContain('value="PUBLIC_BLANK_TEMPLATE" selected=""');
 expect(html).not.toContain('placeholder="ระบุว่าตรวจตรงไหนและพบอะไร"');
});

it('explains when current-reviewed cannot replace dates or a version relationship',()=>{
 const issues=publicSourceReviewIssues({
  value:{temporalBasis:'CURRENT_REVIEWED',temporalReason:null,sensitivityAdjudications:[]},documentType:'ANNOUNCEMENT',visibility:'PUBLIC',storageMode:'BOTH',
  publishedAt:null,effectiveFrom:'2026-01-01',effectiveTo:'2026-02-01',action:'ADD_ADDITIONAL',relationship:'CANCELS',
  target:{documentId:'123e4567-e89b-42d3-a456-426614174002',revision:2},sourceUrl:null,sensitiveCategories:['PHONE','MEDICAL'],disabled:false,onChange:()=>undefined,
 });
 expect(issues).toContain('การทบทวนแหล่งข้อมูลสาธารณะใช้ได้เฉพาะเอกสารสาธารณะที่ค้นจากข้อความ (RAG)');
 expect(issues).toContain('ระบุ URL ต้นฉบับทางการก่อน');
 expect(issues).toContain('การทบทวนแบบข้อมูลปัจจุบันใช้กับแบบฟอร์ม คู่มือ หรือปฏิทินเท่านั้น');
 expect(issues).toContain('ล้างวันที่เริ่มมีผลและวันสิ้นผล เพราะต้นฉบับไม่ได้ระบุวันเหล่านี้');
 expect(issues).toContain('ระบุเหตุผลที่ยืนยันข้อมูลปัจจุบันโดยไม่แทนวันที่ที่ไม่มีในต้นฉบับ');
 expect(issues).toContain('เลือกการเพิ่มเอกสารใหม่หรือเพิ่มฉบับในกลุ่มเดิมโดยไม่ผูกกับฉบับหรือการยกเลิก');
 expect(issues).toContain('หมวดหมู่ MEDICAL ยังใช้การทบทวนแหล่งข้อมูลสาธารณะนี้ไม่ได้');
});

it('accepts a fully reasoned institutional office contact review with no invented dates',()=>{
 const issues=publicSourceReviewIssues({
  value:{temporalBasis:'CURRENT_REVIEWED',temporalReason:'หน้าเว็บทางการระบุช่องทางติดต่อและเวลาทำการปัจจุบัน',sensitivityAdjudications:[
   {category:'PHONE',basis:'INSTITUTIONAL_CONTACT',reason:'หมายเลขนี้อยู่ในหน้าติดต่อห้องสมุดและระบุเป็นเบอร์หน่วยงาน'},
  ]},documentType:'GUIDE',visibility:'PUBLIC',storageMode:'RAG',publishedAt:null,effectiveFrom:null,effectiveTo:null,
  action:'NEW_FAMILY',relationship:null,target:null,sourceUrl:'https://library.yru.ac.th/contact',sensitiveCategories:['PHONE'],disabled:false,onChange:()=>undefined,
 });
 expect(issues).toEqual([]);
});

function versionCandidate(temporalBasis?:'DATED'|'CURRENT_REVIEWED'):VersionCandidate{
 return {
  documentId:'123e4567-e89b-42d3-a456-426614174002',revision:2,title:'ข้อมูลติดต่อ',departmentCode:'LIBRARY',documentType:'GUIDE',
  versionName:'ฉบับปัจจุบัน',versionStream:'ALL',academicYear:null,
  scope:{semester:null,audience:'ALL',studentType:'ALL',programCode:null,curriculumCode:null,cohort:null},
  status:'ACTIVE',isCurrent:true,approved:true,isAmendment:false,isCancellation:false,effectiveFrom:null,effectiveTo:null,
  matchingScope:true,targetActions:[],...(temporalBasis?{temporalBasis}:{}),
 };
}

it('accepts both legacy and current-reviewed version candidates but rejects unknown temporal bases',()=>{
 const legacy=versionCandidate();
 expect(isVersionCandidate(legacy)).toBe(true);
 expect(isVersionCandidate({...legacy,temporalBasis:'CURRENT_REVIEWED'})).toBe(true);
 expect(isVersionCandidate({...legacy,temporalBasis:'GUESSED'})).toBe(false);
});

it('labels a current-reviewed version without presenting a source date',()=>{
 const summary=targetSummary(versionCandidate('CURRENT_REVIEWED'));
 expect(summary).toContain('ข้อมูลปัจจุบันจากการตรวจทาน');
 expect(summary).not.toContain('เริ่ม');
});

function catalogSummary(temporalBasis?:'DATED'|'CURRENT_REVIEWED'):CatalogSummary{
 return {
  id:'123e4567-e89b-42d3-a456-426614174002',familyId:'123e4567-e89b-42d3-a456-426614174003',title:'ข้อมูลติดต่อ',documentType:'GUIDE',
  versionName:'ฉบับปัจจุบัน',versionStream:'ALL',academicYear:null,department:null,status:'ACTIVE',isCurrent:true,visibility:'PUBLIC',storageMode:'RAG',
  publishedAt:null,effectiveFrom:null,effectiveTo:null,authorityLevel:50,approvedAt:'2026-10-26T02:00:00.000Z',sourceUrl:'https://library.yru.ac.th/contact',
  sourcePageUrl:null,lastImportAt:null,temporalBasis,currentReviewedAt:temporalBasis==='CURRENT_REVIEWED'?'2026-10-26T02:00:00.000Z':null,
 } as CatalogSummary;
}

it('shows current-review basis and a distinct review timestamp in catalog list and details',()=>{
 const summary=catalogSummary('CURRENT_REVIEWED');
 const list=renderToStaticMarkup(createElement(DocumentSummary,{document:summary,onSelect:()=>undefined,selected:false}));
 const detail:CatalogDetail={summary,scope:{semester:null,audience:'ALL',studentType:'ALL',programCode:null,curriculumCode:null,cohort:null},
  review:{officialSource:true,extractionReviewed:true,requiresReview:false,archiveOnly:false},supersedesDocumentId:null,createdAt:'2026-10-26T02:00:00.000Z',
  updatedAt:'2026-10-26T02:00:00.000Z',relationships:[],totalRelationships:0,relationsPage:1,relationsPageSize:25};
 const details=renderToStaticMarkup(createElement(DocumentDetails,{document:detail,pageCount:1,onPageChange:()=>undefined,onSelectRelated:()=>undefined}));
 for(const html of [list,details]){
  expect(html).toContain('ข้อมูลปัจจุบันจากการตรวจทาน');
  expect(html).toContain('ตรวจทานเมื่อ');
  expect(html).toContain('2569');
 }
 expect(details).not.toContain('วันที่เผยแพร่</dt><dd>26 ต.ค. 2569');
});

it('keeps the schema-four floor and its review evidence when the selected storage mode changes',()=>{
 const draft=schemaFourDraft();
 const changed=changeReviewMode(draft,'STRUCTURED') as Extract<ImportReviewDraft,{schemaVersion:4}>;
 expect(changed.schemaVersion).toBe(4);
 expect(changed.publicSourceReview).toEqual(draft.publicSourceReview);
 expect(changed.metadata.storageMode).toBe('STRUCTURED');
});

it('upgrades only after a deliberate choice and preserves existing review attestations and warnings',()=>{
 const draft=unfinishedReviewDraft();
 draft.metadata.storageMode='RAG';
 draft.warningDispositions=[{warningKey:'b'.repeat(64),status:'FALSE_POSITIVE',reason:'ตรวจต้นฉบับแล้ว'}];
 draft.attestations.sensitivityReviewed=true;
 const upgraded=enablePublicSourceReview(draft);
 expect(upgraded.schemaVersion).toBe(4);
 expect(upgraded.publicSourceReview).toEqual(blankReview());
 expect(upgraded.warningDispositions).toEqual(draft.warningDispositions);
 expect(upgraded.attestations).toEqual(draft.attestations);
});

it('restarts schema-four review without carrying source-review reasons or attestations',()=>{
 const empty={...schemaFourDraft(),publicSourceReview:blankReview()};
 const restarted=restartReviewDraft(empty,schemaFourDraft()) as Extract<ImportReviewDraft,{schemaVersion:4}>;
 expect(restarted.schemaVersion).toBe(4);
 expect(restarted.publicSourceReview).toEqual(blankReview());
 expect(restarted.attestations).toEqual({sourceAuthorityReviewed:false,extractionReviewed:false,applicabilityReviewed:false,sensitivityReviewed:false,versionReviewed:false});
 expect(restarted.chunkPlan).toBeNull();
 expect(restarted.structuredMapping).toBeNull();
});
