import {describe,expect,it} from 'vitest';
import {isKnowledgeEligible} from '../lib/knowledge/metadata-filter';
import type {KnowledgeMetadata,KnowledgeScope} from '../lib/knowledge/types';

const source:KnowledgeMetadata={status:'ACTIVE',isCurrent:true,approved:true,officialSource:true,extractionReviewed:true,requiresReview:false,
 visibility:'PUBLIC',archiveOnly:false,familyCode:'TRANSFER_REGULATION',departmentCode:'REGISTRATION',audience:'ALL',studentType:'ALL',
 academicYear:2569,semester:null,programCode:null,curriculumCode:null,cohort:null,effectiveFrom:'2026-01-01',effectiveTo:null};
const scope:KnowledgeScope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,
 semester:null,programCode:null,curriculumCode:null,cohort:null};
const now='2026-10-04';

describe('knowledge eligibility before semantic ranking',()=>{
 it('accepts a reviewed official public current source',()=>expect(isKnowledgeEligible(source,scope,now)).toBe(true));
 it.each([
  {status:'PENDING_REVIEW' as const},{status:'SUPERSEDED' as const,isCurrent:false},{approved:false},{officialSource:false},
  {extractionReviewed:false},{requiresReview:true},{visibility:'INTERNAL' as const},{visibility:'RESTRICTED' as const},{archiveOnly:true},
  {effectiveFrom:'2027-01-01'},{effectiveTo:'2026-10-03'},{effectiveFrom:null},{effectiveFrom:'2026-02-30'},
 ])('rejects unsafe/inapplicable current metadata %j',change=>expect(isKnowledgeEligible({...source,...change},scope,now)).toBe(false));
 it('allows intentionally requested historical year without exposing other old years',()=>{
  const old={...source,status:'SUPERSEDED' as const,isCurrent:false,academicYear:2567,effectiveFrom:'2024-01-01',effectiveTo:'2024-12-31'};
  const historical={...scope,historical:true,academicYear:2567};
  expect(isKnowledgeEligible(old,historical,now)).toBe(true);
  expect(isKnowledgeEligible(old,{...historical,academicYear:2568},now)).toBe(false);
  expect(isKnowledgeEligible({...old,approved:false},historical,now)).toBe(false);
  expect(isKnowledgeEligible(old,scope,now)).toBe(false);
 });
 it('uses a historical date for applicability rather than the current date',()=>{
  const old={...source,status:'EXPIRED' as const,isCurrent:false,academicYear:null,effectiveFrom:'2024-01-01',effectiveTo:'2024-06-30'};
  expect(isKnowledgeEligible(old,{...scope,historical:true,asOfDate:'2024-05-01'},now)).toBe(true);
  expect(isKnowledgeEligible(old,{...scope,historical:true,asOfDate:'2024-07-01'},now)).toBe(false);
  expect(isKnowledgeEligible(old,{...scope,historical:true},now)).toBe(false);
 });
 it('asks for missing audience/program/cohort scope instead of assuming applicability',()=>{
  expect(isKnowledgeEligible({...source,audience:'REGULAR'},scope,now)).toBe(false);
  expect(isKnowledgeEligible({...source,audience:'REGULAR'},{...scope,audience:'WEEKEND'},now)).toBe(false);
  expect(isKnowledgeEligible({...source,audience:'REGULAR'},{...scope,audience:'REGULAR'},now)).toBe(true);
  expect(isKnowledgeEligible({...source,programCode:'IT',cohort:2568},scope,now)).toBe(false);
  expect(isKnowledgeEligible({...source,programCode:'IT',cohort:2568},{...scope,programCode:'IT',cohort:2568},now)).toBe(true);
 });
 it('enforces relevant family/department and rejects malformed date or current-asof override',()=>{
  expect(isKnowledgeEligible(source,{...scope,familyCodes:['LIBRARY_GUIDE']},now)).toBe(false);
  expect(isKnowledgeEligible(source,{...scope,departmentCode:'IT'},now)).toBe(false);
  expect(isKnowledgeEligible(source,{...scope,asOfDate:'2026-01-01'},now)).toBe(false);
  expect(isKnowledgeEligible(source,scope,'bad-date')).toBe(false);
 });
});
