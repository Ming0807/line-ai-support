import {describe,expect,it} from 'vitest';
import {evidenceStillMatches} from '../lib/knowledge/citations';
import type {KnowledgeEvidence} from '../lib/knowledge/types';
import {knowledgeLocations} from './fixtures/knowledge-locations';

const evidence:KnowledgeEvidence={chunkId:'11111111-1111-4111-8111-111111111111',documentId:'22222222-2222-4222-8222-222222222222',
 documentRevision:2,title:'ระเบียบการเทียบโอน',familyCode:'TRANSFER_REGULATION',academicYear:2569,authorityLevel:100,
 pageNumber:null,sectionTitle:'ข้อ 5',content:'Controlled reviewed rule',sourceUrl:'https://fixture.yru.ac.th/rules',similarity:0.9,
 sourceLocations:[knowledgeLocations[4]!]};

describe('rule-evidence comparison with serialized source locations',()=>{
 it('accepts equal location records when only object property order differs',()=>{
  const location=knowledgeLocations[4]!;
  if(location.kind!=='HTML')throw new Error('HTML_FIXTURE_REQUIRED');
  const reordered={tableIndex:location.tableIndex,headingPath:location.headingPath,blockEnd:location.blockEnd,
   blockStart:location.blockStart,sourceUrl:location.sourceUrl,kind:location.kind};
  expect(evidenceStillMatches([evidence],[{...evidence,sourceLocations:[reordered]}])).toBe(true);
 });

 it('still rejects changed source-location values',()=>{
  const location=knowledgeLocations[4]!;
  if(location.kind!=='HTML')throw new Error('HTML_FIXTURE_REQUIRED');
  expect(evidenceStillMatches([evidence],[{...evidence,sourceLocations:[{...location,blockStart:3,blockEnd:4}]}])).toBe(false);
  expect(evidenceStillMatches([evidence],[{...evidence,sourceLocations:[{...location,sourceUrl:'https://fixture.yru.ac.th/other'}]}])).toBe(false);
 });

 it('continues to treat source-location array order as significant',()=>{
  const first=knowledgeLocations[4]!;
  if(first.kind!=='HTML')throw new Error('HTML_FIXTURE_REQUIRED');
  const second={...first,blockStart:5,blockEnd:6,headingPath:['ข้อ 6']};
  const row={...evidence,sourceLocations:[first,second]};
  expect(evidenceStillMatches([row],[{...row,sourceLocations:[second,first]}])).toBe(false);
 });
});
