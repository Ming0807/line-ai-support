import {describe,expect,it} from 'vitest';
import {normalizeRagCoverageCompletion,ragCoverageCompletionSchema} from '../lib/knowledge/rag-coverage';

const firstChunkId='11111111-1111-4111-8111-111111111111';
const secondChunkId='22222222-2222-4222-8222-222222222222';
const thirdChunkId='33333333-3333-4333-8333-333333333333';
const fourthChunkId='44444444-4444-4444-8444-444444444444';
const fifthChunkId='55555555-5555-4555-8555-555555555555';
const partialPrefix='จากข้อมูลที่ค้นพบ ตอบได้บางส่วนดังนี้ครับ:\n\n';
const limitationSeparator='\n\nข้อจำกัดของข้อมูล: ';

describe('RAG coverage completion',()=>{
 it('keeps a full supported answer unchanged while preserving its cited chunks',()=>{
  const completion={coverage:'FULL',answer:'ยื่นคำร้องตามข้อมูลที่อ้างอิงครับ',limitation:null,citationChunkIds:[firstChunkId,secondChunkId]};

  expect(ragCoverageCompletionSchema.parse(completion)).toEqual(completion);
  expect(normalizeRagCoverageCompletion(completion)).toEqual({answer:completion.answer,citationChunkIds:completion.citationChunkIds});
 });

 it('marks a partial answer explicitly and preserves the complete answer and citations',()=>{
  const answer='ข้อมูลที่ค้นพบอธิบายขั้นตอนทั่วไปได้ แต่ไม่ระบุวิธีแก้ปัญหาเฉพาะกรณี';
  const limitation='คู่มือไม่ได้ระบุวิธีแก้ปัญหาเฉพาะอาการ';
  const citationChunkIds=[firstChunkId,thirdChunkId];
  const result=normalizeRagCoverageCompletion({coverage:'PARTIAL',answer,limitation,citationChunkIds});

  expect(result).toEqual({answer:`${partialPrefix}${answer}${limitationSeparator}${limitation}`,citationChunkIds});
  expect(result.answer).toContain(answer);
  expect(result.answer).toContain(limitation);
 });

 it('normalizes no coverage to an empty legacy answer and citation list',()=>{
  const completion={coverage:'NONE',answer:null,limitation:null,citationChunkIds:[]};

  expect(ragCoverageCompletionSchema.parse(completion)).toEqual(completion);
  expect(normalizeRagCoverageCompletion(completion)).toEqual({answer:null,citationChunkIds:[]});
 });

 it.each([
  {coverage:'FULL',answer:null,limitation:null,citationChunkIds:[firstChunkId]},
  {coverage:'FULL',answer:'มีข้อมูล',limitation:null,citationChunkIds:[]},
  {coverage:'FULL',answer:'มีข้อมูล',limitation:'มีข้อจำกัด',citationChunkIds:[firstChunkId]},
  {coverage:'PARTIAL',answer:null,limitation:'มีข้อจำกัด',citationChunkIds:[firstChunkId]},
  {coverage:'PARTIAL',answer:'มีข้อมูล',limitation:null,citationChunkIds:[firstChunkId]},
  {coverage:'PARTIAL',answer:'มีข้อมูล',limitation:'  ',citationChunkIds:[firstChunkId]},
  {coverage:'PARTIAL',answer:'มีข้อมูล',citationChunkIds:[firstChunkId]},
  {coverage:'PARTIAL',answer:'มีข้อมูล',limitation:'มีข้อจำกัด',citationChunkIds:[]},
  {coverage:'NONE',answer:'มีข้อมูล',limitation:null,citationChunkIds:[]},
  {coverage:'NONE',answer:null,limitation:'มีข้อจำกัด',citationChunkIds:[]},
  {coverage:'NONE',answer:null,limitation:null,citationChunkIds:[firstChunkId]},
  {coverage:'UNKNOWN',answer:'มีข้อมูล',limitation:null,citationChunkIds:[firstChunkId]},
])('rejects inconsistent coverage and payload fields: $coverage',completion=>{
  expect(ragCoverageCompletionSchema.safeParse(completion).success).toBe(false);
  expect(()=>normalizeRagCoverageCompletion(completion)).toThrowError('RAG_COVERAGE_INVALID');
 });

 it('rejects unknown fields instead of accepting unreviewed model metadata',()=>{
  const completion={coverage:'FULL',answer:'มีข้อมูล',limitation:null,citationChunkIds:[firstChunkId],sourceUrl:'https://invented.example'};

  expect(ragCoverageCompletionSchema.safeParse(completion).success).toBe(false);
  expect(()=>normalizeRagCoverageCompletion(completion)).toThrowError('RAG_COVERAGE_INVALID');
 });

 it.each([
  {coverage:'FULL',answer:'   ',limitation:null,citationChunkIds:[firstChunkId]},
  {coverage:'FULL',answer:'อ่านเพิ่มที่ https://invented.example/policy',limitation:null,citationChunkIds:[firstChunkId]},
  {coverage:'PARTIAL',answer:'มีข้อมูล',limitation:'ดู https://invented.example/policy',citationChunkIds:[firstChunkId]},
  {coverage:'PARTIAL',answer:'มีข้อมูล',limitation:'ดู www.invented.example/policy',citationChunkIds:[firstChunkId]},
  {coverage:'PARTIAL',answer:'มีข้อมูล',limitation:'ข้อจำกัด '.repeat(251),citationChunkIds:[firstChunkId]},
  {coverage:'FULL',answer:'มีข้อมูล',limitation:null,citationChunkIds:['not-a-uuid']},
  {coverage:'PARTIAL',answer:'มีข้อมูล',limitation:'มีข้อจำกัด',citationChunkIds:[firstChunkId,firstChunkId]},
  {coverage:'FULL',answer:'มีข้อมูล',limitation:null,citationChunkIds:[]},
  {coverage:'FULL',answer:'มีข้อมูล',limitation:null,citationChunkIds:[firstChunkId,secondChunkId,thirdChunkId,fourthChunkId,fifthChunkId,firstChunkId]},
])('rejects blank answers, URL claims, malformed IDs, and citation counts outside 1–5',completion=>{
  expect(ragCoverageCompletionSchema.safeParse(completion).success).toBe(false);
  expect(()=>normalizeRagCoverageCompletion(completion)).toThrowError('RAG_COVERAGE_INVALID');
 });

 it('preserves a complete FULL answer at the source-answer limit',()=>{
  const answer='ก'.repeat(12000);
  const completion={coverage:'FULL',answer,limitation:null,citationChunkIds:[firstChunkId]};

  expect(ragCoverageCompletionSchema.parse(completion).answer).toBe(answer);
  expect(normalizeRagCoverageCompletion(completion)).toEqual({answer,citationChunkIds:[firstChunkId]});
 });

 it('allows a PARTIAL answer exactly at the normalized limit with its complete limitation and without clipping',()=>{
  const limitation='ขอบเขตของคู่มือ';
  const answer='ข'.repeat(12000-partialPrefix.length-limitationSeparator.length-limitation.length);
  const completion={coverage:'PARTIAL',answer,limitation,citationChunkIds:[secondChunkId]};
  const result=normalizeRagCoverageCompletion(completion);

  expect(result.answer).toBe(`${partialPrefix}${answer}${limitationSeparator}${limitation}`);
  expect(result.answer).toHaveLength(12000);
  expect(result.answer).toContain(answer);
  expect(result.answer).toContain(limitation);
  expect(result.citationChunkIds).toEqual([secondChunkId]);
 });

 it('fails rather than clipping a PARTIAL answer whose prefix and limitation suffix exceed the normalized limit',()=>{
  const limitation='ขอบเขตของคู่มือ';
  const answer='ค'.repeat(12000-partialPrefix.length-limitationSeparator.length-limitation.length+1);
  const completion={coverage:'PARTIAL',answer,limitation,citationChunkIds:[thirdChunkId]};

  expect(ragCoverageCompletionSchema.safeParse(completion).success).toBe(true);
  expect(()=>normalizeRagCoverageCompletion(completion)).toThrowError('RAG_COVERAGE_INVALID');
 });
});
