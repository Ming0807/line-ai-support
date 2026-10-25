import {expect,it,vi} from 'vitest';
import type {GenerateInput} from '../lib/ai/gateway';
import type {KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import {projectSupportInput,type SupportInput} from '../lib/ai/support-contracts';
import {createAssistantHandoff} from '../lib/ai/assistant-handoff';
import {AIProviderError} from '../lib/ai/types';

const departments=[{code:'IT',name:'เทคโนโลยีสารสนเทศ'},{code:'LIBRARY',name:'ห้องสมุด'}];
const personalQuestion='ช่วยตรวจสอบสถานะบัญชีของผมหน่อย';
const problem=(source='U0',quote=personalQuestion)=>({field:'PROBLEM' as const,source,quote});
const wire=(overrides:Record<string,unknown>={})=>({handoff:{reason:'PERSONAL_RECORD',departmentCode:null,confidence:.94,facts:[problem()],...overrides}});
it('reports transport unavailability without exposing the provider error or accepting a proposal',async()=>{
 const onUnavailable=vi.fn();
 const generate:KnowledgeProducerOptions['generate']=async()=>{throw new AIProviderError('TIMEOUT');};
 expect(await createAssistantHandoff({generate,onUnavailable})(input(),'PERSONAL_RECORD',new AbortController().signal)).toBeNull();
 expect(onUnavailable).toHaveBeenCalledExactlyOnceWith('TIMEOUT');
});
it('reports its own deadline even when generation ignores abort',async()=>{
 vi.useFakeTimers();try{
  const onUnavailable=vi.fn(),generate:KnowledgeProducerOptions['generate']=async()=>new Promise(()=>{});
  const pending=createAssistantHandoff({generate,onUnavailable})(input(),'PERSONAL_RECORD',new AbortController().signal);
  await vi.advanceTimersByTimeAsync(12000);expect(await pending).toBeNull();
  expect(onUnavailable).toHaveBeenCalledExactlyOnceWith('TIMEOUT');
 }finally{vi.useRealTimers();}
});
it('does not mislabel a rejected NONE proposal or malformed output as transport failure',async()=>{
 for(const output of [wire({reason:'NONE'}),{handoff:{reason:'bad'}}]){
  const onUnavailable=vi.fn(),generate:KnowledgeProducerOptions['generate']=async<T,>(request:GenerateInput<T>)=>({output:request.responseSchema.parse(output),toolCalls:[],providerId:'fixture',modelId:'fixture',fallbackUsed:false});
  expect(await createAssistantHandoff({generate,onUnavailable})(input(),'PERSONAL_RECORD',new AbortController().signal)).toBeNull();
  expect(onUnavailable).not.toHaveBeenCalled();
 }
});
it('does not report parent cancellation as unavailable',async()=>{
 const onUnavailable=vi.fn(),controller=new AbortController();
 const generate:KnowledgeProducerOptions['generate']=async()=>{controller.abort();throw new AIProviderError('CANCELLED');};
 expect(await createAssistantHandoff({generate,onUnavailable})(input(),'PERSONAL_RECORD',controller.signal)).toBeNull();
 expect(onUnavailable).not.toHaveBeenCalled();
});
it('isolates a failing diagnostic observer from the null rejection result',async()=>{
 const generate:KnowledgeProducerOptions['generate']=async()=>{throw new AIProviderError('RATE_LIMITED');};
 expect(await createAssistantHandoff({generate,onUnavailable:()=>{throw Error('observer');}})(input(),'PERSONAL_RECORD',new AbortController().signal)).toBeNull();
});
function input(question=personalQuestion,history:{role:string;content:string}[]=[]):SupportInput{
 return projectSupportInput({question,history},departments);
}
type Call={taskType:string;responseName:string;timeoutMs:number|undefined;tools:string[];signal:AbortSignal|undefined;messages:{role:string;content:string}[]};
function fixture(output:unknown=wire(),toolCalls:{id:string;name:string;arguments:unknown}[]=[],ignoreAbort=false){
 const calls:Call[]=[];
 const generate:KnowledgeProducerOptions['generate']=async <T,>(request:GenerateInput<T>)=>{
  calls.push({taskType:request.taskType,responseName:request.responseName,timeoutMs:request.timeoutMs,
   tools:(request.tools??[]).map(tool=>tool.name),signal:request.signal,messages:request.messages});
  if(ignoreAbort)await new Promise<void>(()=>{});
  return {output:request.responseSchema.parse(output),toolCalls,providerId:'provider-fixture',modelId:'model-fixture',fallbackUsed:false};
 };
 return {calls,run:createAssistantHandoff({generate})};
}

it('builds a PERSONAL_CASE proposal from an exact user quote with a backend-owned sensitive floor',async()=>{
 const f=fixture(wire());
 const result=await f.run(input(), 'PERSONAL_RECORD',new AbortController().signal);
 expect(result).not.toBeNull();
 expect(result?.proposal).toMatchObject({intent:'PERSONAL_CASE',category:'GENERAL',subcategory:null,needsTicket:true,department:null,
  urgency:'medium',needsKnowledgeSearch:false,needsStructuredSearch:false,needsWebSearch:false,sensitivity:'SENSITIVE'});
 expect(result?.proposal.facts).toEqual([problem()]);
 expect(result?.advice).toMatchObject({intent:'PERSONAL_CASE',needsTicket:true,needsKnowledgeSearch:false,needsStructuredSearch:false,needsWebSearch:false,
  priority:'MEDIUM',severity:'NORMAL',sensitiveLevel:'SENSITIVE',departmentCode:null});
 expect(f.calls[0]).toMatchObject({taskType:'SUPPORT_INTENT',responseName:'assistant_handoff',timeoutMs:12000,tools:[]});
});

it('sends only USER sources and the active department directory, with no tool authority',async()=>{
 const f=fixture(wire());
 await f.run(input(personalQuestion,[{role:'assistant',content:'assistant-only assertion'},{role:'user',content:'earlier user fact'}]),
  'PERSONAL_RECORD',new AbortController().signal);
 const call=f.calls[0]!;
 const request=JSON.parse(call.messages[1]!.content) as {sources:unknown[];departments:unknown[];[key:string]:unknown};
 expect(Object.keys(request).sort()).toEqual(['departments','sources']);
 expect(request.sources).toEqual([{code:'U0',text:personalQuestion},{code:'U1',text:'earlier user fact'}]);
 expect(request.departments).toEqual(departments);
 expect(JSON.stringify(call.messages)).not.toContain('assistant-only assertion');
 expect(JSON.stringify(call.messages)).not.toMatch(/sourceDigest|directoryDigest|jobId|messageId|sessionId|conversationId/u);
 expect(call.tools).toEqual([]);
});

it('rejects missing, fabricated, duplicate, or mismatched source facts',async()=>{
 const cases=[
  wire({facts:[]}),
  wire({facts:[problem('U0','invented account result')]}),
  wire({facts:[problem(),problem()]}),
 ];
 for(const response of cases){expect(await fixture(response).run(input(),'PERSONAL_RECORD',new AbortController().signal)).toBeNull();}
});

it('requires the requested reason to match and rejects NONE or low confidence',async()=>{
 expect(await fixture(wire({reason:'USER_REQUEST'})).run(input(),'PERSONAL_RECORD',new AbortController().signal)).toBeNull();
 expect(await fixture(wire({reason:'NONE'})).run(input(),'PERSONAL_RECORD',new AbortController().signal)).toBeNull();
 expect(await fixture(wire({confidence:.79})).run(input(),'PERSONAL_RECORD',new AbortController().signal)).toBeNull();
});
it('rejects NONE as a caller handoff reason before invoking a provider',async()=>{
 const f=fixture();
 expect(await Reflect.apply(f.run,undefined,[input(),'NONE',new AbortController().signal])).toBeNull();
 expect(f.calls).toHaveLength(0);
});

it('requires a literal ATTEMPTS quote for UNRESOLVED_CONFIRMED and returns only proposal advice',async()=>{
 const question='ลองปิดเปิด Wi-Fi แล้ว ยังใช้งานไม่ได้';
 const sources=input(question,[{role:'user',content:'Wi-Fi ที่บ้านต่อไม่ได้'}]);
 const missing=wire({reason:'UNRESOLVED_CONFIRMED',facts:[problem('U1','Wi-Fi ที่บ้านต่อไม่ได้')]});
 expect(await fixture(missing).run(sources,'UNRESOLVED_CONFIRMED',new AbortController().signal)).toBeNull();
 const invalid=wire({reason:'UNRESOLVED_CONFIRMED',facts:[problem('U1','Wi-Fi ที่บ้านต่อไม่ได้'),{field:'ATTEMPTS',source:'U0',quote:'I rebooted the router'}]});
 expect(await fixture(invalid).run(sources,'UNRESOLVED_CONFIRMED',new AbortController().signal)).toBeNull();
 const valid=wire({reason:'UNRESOLVED_CONFIRMED',facts:[problem('U1','Wi-Fi ที่บ้านต่อไม่ได้'),{field:'ATTEMPTS',source:'U0',quote:'ลองปิดเปิด Wi-Fi แล้ว'}]});
 const result=await fixture(valid).run(sources,'UNRESOLVED_CONFIRMED',new AbortController().signal);
 expect(result?.proposal).toMatchObject({intent:'ESCALATE',needsTicket:true,department:null,urgency:'medium',sensitivity:'GENERAL'});
 expect(result?.advice).toMatchObject({intent:'ESCALATE',needsTicket:true,priority:'MEDIUM',sensitiveLevel:'GENERAL'});
 expect(result).not.toHaveProperty('ticketId');expect(result).not.toHaveProperty('action');
});

it('accepts only an exact active department code and derives its category',async()=>{
 const question='ขอติดต่อหน่วยงานไอทีเรื่องระบบ';
 const exact=wire({reason:'USER_REQUEST',departmentCode:'IT',facts:[problem('U0',question)]});
 const accepted=await fixture(exact).run(input(question),'USER_REQUEST',new AbortController().signal);
 expect(accepted?.proposal).toMatchObject({intent:'ESCALATE',category:'IT_SUPPORT',department:'IT',subcategory:null});
 expect(accepted?.advice.departmentCode).toBe('IT');
 const inactive=wire({reason:'USER_REQUEST',departmentCode:'FINANCE',facts:[problem('U0',question)]});
 expect(await fixture(inactive).run(input(question),'USER_REQUEST',new AbortController().signal)).toBeNull();
});

it('keeps impact, urgency, sensitivity, search flags, and subcategory server-owned',async()=>{
 const question='มีผู้ใช้ 12 คนได้รับผลกระทบและขอติดต่อเจ้าหน้าที่';
 const response=wire({reason:'USER_REQUEST',departmentCode:'IT',facts:[problem('U0',question),{field:'IMPACT',source:'U0',quote:'ผู้ใช้ 12 คนได้รับผลกระทบ'}]});
 const result=await fixture(response).run(input(question),'USER_REQUEST',new AbortController().signal,'RESTRICTED');
 expect(result?.proposal).toMatchObject({intent:'ESCALATE',category:'IT_SUPPORT',subcategory:null,needsTicket:true,urgency:'medium',
  needsKnowledgeSearch:false,needsStructuredSearch:false,needsWebSearch:false,impact:'MULTIPLE_USERS',sensitivity:'GENERAL'});
 expect(result?.advice).toMatchObject({priority:'HIGH',severity:'ELEVATED',sensitiveLevel:'RESTRICTED'});
});

it.each(['USER_REQUEST','UNRESOLVED_CONFIRMED'] as const)('raises a %s sensitive-detail handoff above GENERAL before storing advice',async reason=>{
 const question='ถูกคุกคามจากผู้ใช้บัญชีอื่น ลองบล็อกแล้วแต่ยังเกิดปัญหา ขอส่งต่อเจ้าหน้าที่';
 const facts=[problem('U0','ถูกคุกคามจากผู้ใช้บัญชีอื่น'),
  {field:'SENSITIVE_DETAIL',source:'U0',quote:'ถูกคุกคามจากผู้ใช้บัญชีอื่น'},
  ...(reason==='UNRESOLVED_CONFIRMED'?[{field:'ATTEMPTS',source:'U0',quote:'ลองบล็อกแล้ว'}]:[])];
 const response=wire({reason,departmentCode:'IT',facts});
 const result=await fixture(response).run(input(question),reason,new AbortController().signal);
 expect(result?.advice).toMatchObject({intent:'ESCALATE',sensitiveLevel:'SENSITIVE',needsTicket:true});
 expect(result?.advice.collectedContext).toEqual(facts);
 const restricted=await fixture(response).run(input(question),reason,new AbortController().signal,'RESTRICTED');
 expect(restricted?.advice.sensitiveLevel).toBe('RESTRICTED');
});

it('does not record a single-user IMPACT quote as multiple affected users',async()=>{
 const question='บัญชีของผมเข้าไม่ได้ ขอให้เจ้าหน้าที่ช่วย';
 const response=wire({reason:'USER_REQUEST',departmentCode:'IT',facts:[problem('U0','บัญชีของผมเข้าไม่ได้'),
  {field:'IMPACT',source:'U0',quote:'บัญชีของผมเข้าไม่ได้'}]});
 const result=await fixture(response).run(input(question),'USER_REQUEST',new AbortController().signal);
 expect(result?.proposal.impact).toBe('SINGLE_USER');
 expect(result?.advice).toMatchObject({priority:'MEDIUM',severity:'NORMAL'});
});

it('rejects tool calls, malformed output, and pre-cancelled requests',async()=>{
 const tool=[{id:'tool-1',name:'create_ticket',arguments:{}}];
 expect(await fixture(wire(),tool).run(input(),'PERSONAL_RECORD',new AbortController().signal)).toBeNull();
 expect(await fixture({handoff:{reason:'PERSONAL_RECORD'}}).run(input(),'PERSONAL_RECORD',new AbortController().signal)).toBeNull();
 const cancelled=new AbortController();cancelled.abort();
 const f=fixture();expect(await f.run(input(),'PERSONAL_RECORD',cancelled.signal)).toBeNull();expect(f.calls).toHaveLength(0);
});

it('cancels an abort-ignoring generation when the caller cancels',async()=>{
 const f=fixture(wire(),[],true),controller=new AbortController();
 const pending=f.run(input(),'PERSONAL_RECORD',controller.signal);
 await Promise.resolve();await Promise.resolve();
 controller.abort();
 expect(await pending).toBeNull();
 expect(f.calls[0]?.signal?.aborted).toBe(true);
});

it('enforces the 12-second deadline even when generation ignores abort',async()=>{
 vi.useFakeTimers();
 try{
  const f=fixture(wire(),[],true),controller=new AbortController();
  const pending=f.run(input(),'PERSONAL_RECORD',controller.signal);
  await Promise.resolve();await Promise.resolve();
  await vi.advanceTimersByTimeAsync(12000);
  expect(await pending).toBeNull();
  expect(f.calls[0]?.signal?.aborted).toBe(true);
 }finally{vi.useRealTimers();}
});
