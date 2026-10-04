import {describe,expect,it} from 'vitest';
import {buildCitedAnswer,evidenceStillMatches} from '../lib/knowledge/citations';
import type {KnowledgeEvidence} from '../lib/knowledge/types';

const evidence:KnowledgeEvidence={chunkId:'11111111-1111-4111-8111-111111111111',documentId:'22222222-2222-4222-8222-222222222222',
 documentRevision:2,title:'ระเบียบการเทียบโอน',familyCode:'TRANSFER_REGULATION',academicYear:2569,authorityLevel:100,
 pageNumber:12,sectionTitle:'ข้อ 5',content:'Controlled reviewed rule',sourceUrl:'https://fixture.yru.ac.th/transfer.pdf',similarity:0.9};
const output={answer:'ยื่นคำร้องตามระเบียบที่อ้างอิงครับ',citationChunkIds:[evidence.chunkId]};
describe('backend-owned source citations',()=>{
 it('uses source title/page/section/URL from retrieved evidence',()=>{
  const reply=buildCitedAnswer(output,[evidence]);
  expect(reply.citations[0]).toMatchObject({documentId:evidence.documentId,pageNumber:12,sourceUrl:evidence.sourceUrl});
  expect(reply.messages[0].text).toContain('หน้า 12');expect(reply.messages[0].text).toContain('ข้อ 5');
  expect(reply.messages[0].text).toContain(evidence.sourceUrl);
 });
 it.each([
  {...output,citationChunkIds:['33333333-3333-4333-8333-333333333333']},
  {...output,citationChunkIds:[]},{...output,citationChunkIds:[evidence.chunkId,evidence.chunkId]},
  {...output,sourceUrl:'https://invented.example/policy'},
  {...output,pageNumber:99},{...output,answer:'อ่าน https://invented.example/policy'},
 ])('rejects invented/missing/duplicate citations and model-controlled source fields',unsafe=>
  expect(()=>buildCitedAnswer(unsafe,[evidence])).toThrow('KNOWLEDGE_CITATION_INVALID'));
 it('revalidates exact evidence revisions and content, permitting similarity changes only',()=>{
  expect(evidenceStillMatches([evidence],[{...evidence,similarity:0.85}])).toBe(true);
  expect(evidenceStillMatches([evidence],[])).toBe(false);
  expect(evidenceStillMatches([evidence],[{...evidence,documentRevision:3}])).toBe(false);
  expect(evidenceStillMatches([evidence],[{...evidence,content:'Changed after generation'}])).toBe(false);
  expect(evidenceStillMatches([evidence],[{...evidence,sourceUrl:'https://invented.example/policy'}])).toBe(false);
 });
 it('keeps a long, valid source list within LINE text bounds without detached emoji or marks',()=>{
  const long={...evidence,title:'เ'.repeat(500),sourceUrl:'https://fixture.yru.ac.th/'+ 'a'.repeat(1900)};
  const next={...long,chunkId:'44444444-4444-4444-8444-444444444444',pageNumber:13};
  const answer=buildCitedAnswer({answer:'😀'.repeat(1400),citationChunkIds:[long.chunkId,next.chunkId]},[long,next]);
  expect(answer.messages.length).toBeGreaterThan(1);
  expect(answer.messages.every(m=>m.text.length<=5000)).toBe(true);
  expect(answer.messages.map(m=>m.text).join('')).toContain('😀'.repeat(1400));
 });
});
