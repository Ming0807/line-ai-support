import {expect,it,vi} from 'vitest';
import {createSupportProducer} from '../lib/ai/support-producer';
import {supportProposalSchema,projectSupportInput} from '../lib/ai/support-contracts';
import {aiResultSchema} from '../lib/ai/jobs';
import type {GenerateInput} from '../lib/ai/gateway';
import type {AISnapshot} from '../lib/ai/run-worker';
import type {KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import {buildRuleProof} from '../lib/knowledge/rule-proof';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const directory=[{code:'IT',name:'เทคโนโลยีสารสนเทศ'},{code:'LIBRARY',name:'ห้องสมุด'}];
const socialProposal={intent:'SOCIAL',category:'GENERAL',subcategory:null,needsTicket:false,department:null,urgency:'low',
 needsKnowledgeSearch:false,needsStructuredSearch:false,needsWebSearch:false,confidence:.99,missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',facts:[]};
const generated='สวัสดีครับ ยินดีช่วยตอบคำถามทั่วไปเกี่ยวกับบริการของมหาวิทยาลัยครับ';
const unavailable='ตอนนี้ระบบยังวิเคราะห์บริบทเพื่อยืนยันคำตอบไม่ได้ครับ สามารถติดต่อเจ้าหน้าที่เพื่อให้ช่วยตรวจสอบได้';
const neutralFallback='ยินดีช่วยครับ มีคำถามหรือปัญหาเรื่องไหน เล่าให้ฟังได้เลยครับ';

function snapshot(question='สวัสดีครับ วันนี้เป็นอย่างไรบ้าง'):AISnapshot{
 const base={jobId:id(1),sessionId:id(2),conversationId:id(3),messageId:id(4),revision:0,question,
  history:[{role:'user' as const,content:'ขอบคุณสำหรับคำตอบก่อนหน้านี้'},{role:'assistant' as const,content:'PRIVATE_ASSISTANT_ASSERTION'}]};
 return {...base,support:{context:{sessionId:base.sessionId,conversationId:base.conversationId,messageId:base.messageId,revision:base.revision},
  input:projectSupportInput(base,directory),sourceDigest:'a'.repeat(64),directoryDigest:'b'.repeat(64),minimumSensitivity:'GENERAL'}};
}

interface FixtureOptions {
 proposal?:unknown;socialOutput?:unknown;classifierTools?:unknown[];socialTools?:unknown[];abortDuringSocial?:()=>void;socialFailure?:boolean;
}
function fixture(options:FixtureOptions={}){
 const generate=vi.fn(async(input:GenerateInput<unknown>)=>{
  if(input.taskType==='SUPPORT_INTENT')return {output:options.proposal??socialProposal,toolCalls:options.classifierTools??[],providerId:id(6),modelId:id(7),fallbackUsed:false};
  if(input.taskType==='SUPPORT_SOCIAL'){
   options.abortDuringSocial?.();
   if(options.socialFailure)throw new Error('PRIVATE_UPSTREAM_FAILURE');
   return {output:options.socialOutput??{answer:generated},toolCalls:options.socialTools??[],providerId:id(6),modelId:id(7),fallbackUsed:false};
  }
  return {output:{answer:'NEVER_USE_KNOWLEDGE_FOR_SOCIAL',citationChunkIds:[id(5)]},toolCalls:[],providerId:id(6),modelId:id(7),fallbackUsed:false};
 });
 const embed=vi.fn(async()=>({vectors:[[1,0]],dimensions:2,fingerprint:'c'.repeat(64),providerId:id(6),modelId:id(7),fallbackUsed:false}));
 const search=vi.fn(async()=>[{chunkId:id(5),documentId:id(8),documentRevision:0,title:'Private knowledge source',familyCode:'PRIVATE',academicYear:null,
  authorityLevel:100,pageNumber:1,sectionTitle:null,content:'Private source text',sourceUrl:'https://fixture.yru.ac.th/private.pdf',similarity:.95,
  ruleProof:buildRuleProof({familyId:id(9),baseDocumentId:id(8),versionStream:'DEFAULT',ruleRevision:'0',evaluationDate:'2026-10-08',
   members:[{documentId:id(8),revision:0}],effects:[]})}]);
 const produce=createSupportProducer({generate:generate as unknown as KnowledgeProducerOptions['generate'],embed,search});
 return {generate,embed,search,produce};
}

it('accepts only a neutral strict SOCIAL support proposal',()=>{
 expect(supportProposalSchema.safeParse(socialProposal).success).toBe(true);
 for(const changes of [
  {category:'IT_SUPPORT'},{department:'IT'},{subcategory:'SERVICE'},{missingContext:'DEVICE'},{needsTicket:true},
  {needsKnowledgeSearch:true},{needsStructuredSearch:true},{needsWebSearch:true},{urgency:'high'},{impact:'MULTIPLE_USERS'},
  {sensitivity:'SENSITIVE'},{facts:[{field:'PROBLEM',source:'U0',quote:'greeting'}]},{extraAuthority:true},
 ])expect(supportProposalSchema.safeParse({...socialProposal,...changes}).success).toBe(false);
});

it('retains a safe social invitation when classification succeeds but optional wording fails',async()=>{
 const f=fixture({socialFailure:true}),result=await f.produce(snapshot(),new AbortController().signal);
 expect(result).toMatchObject({kind:'CLARIFY',text:neutralFallback,support:{proposal:{intent:'SOCIAL'}}});
 expect(JSON.stringify(result)).not.toContain('PRIVATE_UPSTREAM_FAILURE');
 expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});

it('returns the exact generated social text with private support metadata and no retrieval',async()=>{
 const f=fixture(),s=snapshot(),result=await f.produce(s,new AbortController().signal);
 expect(result).toMatchObject({kind:'CLARIFY',text:generated,support:{version:1,sourceDigest:s.support!.sourceDigest,
  directoryDigest:s.support!.directoryDigest,minimumSensitivity:'GENERAL',deliveredGuidance:false,proposal:socialProposal}});
 expect(aiResultSchema.safeParse(result).success).toBe(true);
 expect(f.generate).toHaveBeenCalledTimes(2);
 expect(f.generate.mock.calls[0][0]).toMatchObject({taskType:'SUPPORT_INTENT',responseName:'support_intent',conversationId:s.conversationId,tools:[]});
 const call=f.generate.mock.calls[1][0];
 expect(call).toMatchObject({taskType:'SUPPORT_SOCIAL',responseName:'support_social',timeoutMs:8000,conversationId:s.conversationId,tools:[]});
 expect(f.generate.mock.invocationCallOrder[0]).toBeLessThan(f.generate.mock.invocationCallOrder[1]);
 expect(call.responseSchema.safeParse({answer:generated}).success).toBe(true);
 expect(call.responseSchema.safeParse({answer:'   '}).success).toBe(false);
 expect(call.responseSchema.safeParse({answer:'A'.repeat(1001)}).success).toBe(false);
 expect(call.responseSchema.safeParse({answer:'ดูข้อมูล https://example.invalid'}).success).toBe(false);
 expect(call.responseSchema.safeParse({answer:'คำตอบ',injected:'ticket'}).success).toBe(false);
 const providerMessages=JSON.stringify(call.messages);
 expect(providerMessages).toContain(s.question);
 for(const privateValue of [s.jobId,s.sessionId,s.messageId,s.support!.sourceDigest,s.support!.directoryDigest,'PRIVATE_ASSISTANT_ASSERTION'])
  expect(providerMessages).not.toContain(privateValue);
 expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});

it('fails closed when a social reply is invalid or attempts to use a tool',async()=>{
 for(const options of [
  {socialOutput:{answer:'https://unsafe.example/'}},
  {socialOutput:{answer:'A'.repeat(1001)}},
  {socialOutput:{answer:'   '}},
  {socialOutput:{answer:generated,extra:'authority'}},
  {socialTools:[{id:'tool-1',name:'create_ticket',arguments:{}}]},
 ]){
  const f=fixture(options),result=await f.produce(snapshot(),new AbortController().signal);
  expect(result.kind).toBe('CLARIFY');
  if(result.kind==='CLARIFY'){
   expect(result.text).not.toBe(generated);
   expect(result.text).not.toContain('https://unsafe.example/');
   expect(result.text).not.toContain('NEVER_USE_KNOWLEDGE_FOR_SOCIAL');
  }
  expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
 }
});

it.each([
 ['an arbitrary university-policy claim','การลงทะเบียนภาคเรียนใหม่เริ่มวันที่ 12 พฤศจิกายนครับ'],
 ['a naked registrar domain','ดูรายละเอียดที่ registrar.yru.ac.th ได้เลยครับ'],
 ['a claimed solved outcome and ticket action','แก้ปัญหาเรียบร้อยแล้วและเปิด ticket ส่งให้เจ้าหน้าที่แล้วครับ'],
 ['a greeting mixed with a substantive policy answer','สวัสดีครับ ค่าปรับลงทะเบียนล่าช้าคือ 500 บาท และปิดรับวันที่ 30 พฤศจิกายนครับ'],
])('uses a reviewed neutral invitation instead of %s from the SOCIAL generator',async(_case,answer)=>{
 const f=fixture({socialOutput:{answer}}),result=await f.produce(snapshot(),new AbortController().signal);
 expect(result).toMatchObject({kind:'CLARIFY',text:neutralFallback});
 expect(result).not.toMatchObject({text:answer});
 expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});

it('does not call the social generator for a non-neutral proposal or classifier tool call',async()=>{
 for(const options of [
  {proposal:{...socialProposal,department:'IT'}},
  {proposal:{...socialProposal,needsKnowledgeSearch:true}},
  {classifierTools:[{id:'tool-1',name:'create_ticket',arguments:{}}]},
 ]){
  const f=fixture(options),result=await f.produce(snapshot(),new AbortController().signal);
  expect(result.kind).toBe('CLARIFY');
  expect(f.generate.mock.calls.some(([call])=>call.taskType==='SUPPORT_SOCIAL')).toBe(false);
  expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
 }
});

it('uses only a safe clarification if the request is cancelled during social generation',async()=>{
 const controller=new AbortController(),f=fixture({abortDuringSocial:()=>controller.abort()});
 const result=await f.produce(snapshot(),controller.signal);
 expect(result.kind).toBe('CLARIFY');
 if(result.kind==='CLARIFY'){
  expect(result.text).not.toBe(generated);
  expect(result.text).toBe(unavailable);
 }
 expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});
