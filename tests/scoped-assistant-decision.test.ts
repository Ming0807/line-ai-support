import {describe,it,expect,vi} from 'vitest';
import {createScopedAssistantDecision} from '../lib/ai/scoped-assistant-decision';
import type {GenerateInput} from '../lib/ai/gateway';

const signal=()=>new AbortController().signal;
const context={question:'ช่วยแนะนำวิธีเลือกคำค้นสำหรับหัวข้อที่สนใจครับ',history:[{role:'user' as const,content:'ผมสนใจพลังงานแสงอาทิตย์'}]};
function fixture(scope:unknown,decision:unknown={action:'GENERAL_REPLY',text:'แยกหัวข้อเป็นคำสำคัญแล้วลองคำที่มีความหมายใกล้กันครับ'}){
 const generate=vi.fn(async(input:GenerateInput<unknown>)=>({output:input.taskType==='ASSISTANT_SCOPE'?{scope}:{decision},toolCalls:[]}));
 return {generate,decide:createScopedAssistantDecision({generate})};
}
const general={kind:'GENERAL',officialQuestion:null,handoffReason:null};
describe('diagnostic escalation policy at the provider boundary',()=>{
 it.each([false,true])('retains failed-check and missing-observation constraints (singlePass=%s)',async singlePass=>{
  const followup={question:'ปิดเปิด Wi-Fi แล้ว ยังไม่ได้ครับ',history:[
   {role:'user' as const,content:'ใช้มือถือ Android ต่อ Wi-Fi ไม่ได้ครับ'},
   {role:'assistant' as const,content:'ลองปิดแล้วเปิด Wi-Fi บนมือถือครับ ขึ้นข้อความผิดพลาดว่าอะไรครับ'},
  ]};
  const decision={action:'GUIDED_REPLY',advice:{steps:[{effect:'OBSERVATION',text:'หน้าจอแสดงข้อความอะไรเมื่อเชื่อมต่อครับ'}]}};
  const generate=vi.fn(async(input:GenerateInput<unknown>)=>({output:singlePass?{scope:general,decision}:input.taskType==='ASSISTANT_SCOPE'?{scope:general}:{decision},toolCalls:[]}));
  await createScopedAssistantDecision({generate,singlePass})(followup,signal());
  const request=generate.mock.calls.at(-1)![0];
  expect(request.messages.slice(1)).toEqual([...followup.history,{role:'user',content:followup.question}]);
  // This tests transmitted policy, not whether a model will obey it.
  expect(request.messages[0].content).toContain('A failed basic check alone does not justify clearing settings.');
  expect(request.messages[0].content).toContain('If an important diagnostic question is still unanswered, ask for that observation or give a harmless reversible check rather than assuming its answer.');
  expect(generate).toHaveBeenCalledTimes(singlePass?1:2);
 });
});
describe('independent preparation policy at the provider boundary',()=>{
 it.each([false,true])('retains concrete permitted help alongside evidence restrictions (singlePass=%s)',async singlePass=>{
  const scope={kind:'MIXED',officialQuestion:'แบบฟอร์มคำร้องอยู่ที่ไหน',handoffReason:null};
  const decision={action:'MIXED_REPLY',generalText:'เขียนเป้าหมายที่ต้องการให้ชัดเจนครับ',query:scope.officialQuestion};
  const generate=vi.fn(async(input:GenerateInput<unknown>)=>({output:singlePass?{scope,decision}:input.taskType==='ASSISTANT_SCOPE'?{scope}:{decision},toolCalls:[]}));
  const result=await createScopedAssistantDecision({generate,singlePass})(context,signal());
  const request=generate.mock.calls.at(-1)![0];
  expect(request.messages[0].content).toContain('General preparation can explain how to state the purpose and relevant facts clearly, organize information already available, and compare the applicable form instructions before submission.');
  expect(request.messages[0].content).toContain('These are general suggestions, not a claim about mandatory documents or institutional rules.');
  expect(request.messages[0].content).toContain('Do not invent institutional requirements');
  expect(result.decision).toEqual(decision);
  expect(generate).toHaveBeenCalledTimes(singlePass?1:2);
 });
});
describe('single-pass scoped candidate',()=>{
 it('produces the scoped proposal in one call with full owned history',async()=>{
  const generate=vi.fn<(_input:GenerateInput<unknown>)=>Promise<{output:unknown;toolCalls:unknown[]}>>(async()=>({output:{scope:general,decision:{action:'GENERAL_REPLY',text:'ใช้คำค้นที่ตรงหัวข้อครับ'}},toolCalls:[]}));
  const result=await createScopedAssistantDecision({generate,singlePass:true})(context,signal());
  expect(result.decision).toEqual({action:'GENERAL_REPLY',text:'ใช้คำค้นที่ตรงหัวข้อครับ'});
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][0].messages.slice(1)).toEqual([...context.history,{role:'user',content:context.question}]);
  expect(generate.mock.calls[0][0].tools).toEqual([]);
 });
 it('renders prerequisite guards from a corrected GENERAL guided decision in one call',async()=>{
  const generate=vi.fn(async()=>({output:{scope:general,decision:{action:'GUIDED_REPLY',advice:{steps:[{effect:'SHARED_EQUIPMENT_CHANGE',text:'ลองเปิดเราเตอร์ใหม่ครับ'}]}}},toolCalls:[]}));
  const result=await createScopedAssistantDecision({generate,singlePass:true})(context,signal());
  expect(result.decision.action).toBe('GENERAL_REPLY');
  if(result.decision.action==='GENERAL_REPLY')expect(result.decision.text.indexOf('ได้รับอนุญาต')).toBeLessThan(result.decision.text.indexOf('ลองเปิดเราเตอร์'));
  expect(generate).toHaveBeenCalledTimes(1);
 });
 it.each([
  [{kind:'OFFICIAL',officialQuestion:'ประกาศปี2569',handoffReason:null},{action:'LOOKUP',query:'ประกาศปี2569'}],
  [{kind:'HANDOFF',officialQuestion:null,handoffReason:'USER_REQUEST'},{action:'HANDOFF',reason:'USER_REQUEST'}],
  [{kind:'MIXED',officialQuestion:'แบบคำร้อง',handoffReason:null},{action:'MIXED_REPLY',generalText:'อธิบายเป้าหมายให้ชัดเจนครับ',query:'แบบคำร้อง'}],
 ])('retains terminal and mixed proposal semantics in one request',async(scope,decision)=>{
  const generate=vi.fn(async()=>({output:{scope,decision},toolCalls:[]}));
  expect((await createScopedAssistantDecision({generate,singlePass:true})(context,signal())).decision).toEqual(decision);
  expect(generate).toHaveBeenCalledTimes(1);
 });
 it.each([
  [general,{action:'LOOKUP',query:'unapproved scope switch'}],
  [{kind:'GUIDED',officialQuestion:null,handoffReason:null},{action:'GENERAL_REPLY',text:'untyped bypass'}],
  [{kind:'OFFICIAL',officialQuestion:'ปี2569',handoffReason:null},{action:'LOOKUP',query:'ปี2568'}],
  [{kind:'HANDOFF',officialQuestion:null,handoffReason:'USER_REQUEST'},{action:'HANDOFF',reason:'PERSONAL_RECORD'}],
  [{kind:'MIXED',officialQuestion:'แบบคำร้อง',handoffReason:null},{action:'LOOKUP',query:'แบบคำร้อง'}],
  [general,{action:'GENERAL_REPLY',text:'hello',studentId:'forged'}],
 ])('rejects inconsistent scope or extra authority without retry',async(scope,decision)=>{
  const generate=vi.fn(async()=>({output:{scope,decision},toolCalls:[]}));
  await expect(createScopedAssistantDecision({generate,singlePass:true})(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
  expect(generate).toHaveBeenCalledTimes(1);
 });
 it('rejects cancellation and tools before a scoped proposal can escape',async()=>{
  const controller=new AbortController();
  const generate=vi.fn(async()=>{controller.abort();return {output:{scope:general,decision:{action:'GENERAL_REPLY',text:'hello'}},toolCalls:[]};});
  await expect(createScopedAssistantDecision({generate,singlePass:true})(context,controller.signal)).rejects.toMatchObject({code:'CANCELLED'});
  const tools=vi.fn(async()=>({output:{scope:general,decision:{action:'GENERAL_REPLY',text:'hello'}},toolCalls:[{name:'send'}]}));
  await expect(createScopedAssistantDecision({generate:tools,singlePass:true})(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
 });
 it('does not permit an untyped repair call',async()=>{
  const generate=vi.fn();
  await expect(createScopedAssistantDecision({generate,singlePass:true})(context,signal(),{reason:'INSTITUTIONAL_TOPIC',rejectedProposal:{action:'GENERAL_REPLY',text:'bad'}})).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(generate).not.toHaveBeenCalled();
 });
});
describe('scope before substantive composition',()=>{
 it('classifies without writing the answer, then preserves complete owned history for useful general help',async()=>{
  const f=fixture(general);const r=await f.decide(context,signal());
  expect(r.decision).toMatchObject({action:'GENERAL_REPLY'});
  expect(f.generate.mock.calls.map(([c])=>c.taskType)).toEqual(['ASSISTANT_SCOPE','ASSISTANT_DECISION']);
  for(const [call] of f.generate.mock.calls){expect(call.messages.slice(1)).toEqual([...context.history,{role:'user',content:context.question}]);expect(call.tools).toEqual([]);}
 });
 it('rejects a composition-stage attempt to switch a scoped general question to lookup',async()=>{
  const f=fixture(general,{action:'LOOKUP',query:'ห้องสมุด'});
  await expect(f.decide(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
  expect(f.generate).toHaveBeenCalledTimes(2);
 });
 it('maps an official need to lookup without a redundant answer call or altered question',async()=>{
  const q='ประกาศทุนปี2569สำหรับนักศึกษาภาคพิเศษกำหนดอย่างไร';
  const f=fixture({kind:'OFFICIAL',officialQuestion:q,handoffReason:null});
  expect((await f.decide({...context,question:q},signal())).decision).toEqual({action:'LOOKUP',query:q});
  expect(f.generate).toHaveBeenCalledTimes(1);
 });
 it('maps a staff proposal but grants no ticket, recipient or execution authority',async()=>{
  const f=fixture({kind:'HANDOFF',officialQuestion:null,handoffReason:'USER_REQUEST'});
  expect((await f.decide(context,signal())).decision).toEqual({action:'HANDOFF',reason:'USER_REQUEST'});
  expect(f.generate).toHaveBeenCalledTimes(1);
 });
 it('requires the mixed composition to retain both outcomes',async()=>{
  const f=fixture({kind:'MIXED',officialQuestion:'หาแบบคำร้อง',handoffReason:null},{action:'LOOKUP',query:'หาแบบคำร้อง'});
  await expect(f.decide(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
 });
 it.each([
  {kind:'GENERAL',officialQuestion:'invented official need',handoffReason:null},
  {kind:'HANDOFF',officialQuestion:null,handoffReason:null},
  {kind:'OFFICIAL',officialQuestion:null,handoffReason:null},
  {kind:'GENERAL',officialQuestion:null,handoffReason:null,studentId:'untrusted'},
 ])('rejects malformed or contradictory scope before another call: %j',async scope=>{
  const f=fixture(scope);await expect(f.decide(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});expect(f.generate).toHaveBeenCalledTimes(1);
 });
 it('rejects legacy untyped correction without another inference call in scope-first mode',async()=>{
  const f=fixture(general);
  await expect(f.decide(context,signal(),{reason:'INSTITUTIONAL_TOPIC',rejectedProposal:{action:'GENERAL_REPLY',text:'unverified proposal'}})).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(f.generate).not.toHaveBeenCalled();
 });
 it('cancels before composition and rejects model tool calls',async()=>{
  const c=new AbortController();const generate=vi.fn(async()=>{c.abort();return {output:{scope:general},toolCalls:[]};});
  await expect(createScopedAssistantDecision({generate})(context,c.signal)).rejects.toMatchObject({code:'CANCELLED'});expect(generate).toHaveBeenCalledTimes(1);
  const tools=vi.fn(async()=>({output:{scope:general},toolCalls:[{name:'create_ticket'}]}));
  await expect(createScopedAssistantDecision({generate:tools})(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});expect(tools).toHaveBeenCalledTimes(1);
 });
 it('retains the exact omission marker at both stages without clipping retained turns',async()=>{
  const f=fixture(general);const history=Array.from({length:4},(_,n)=>({role:'user' as const,content:String(n).repeat(15000)}));
  const result=await f.decide({...context,history},signal());
  expect(result.historyOmittedCount).toBeGreaterThan(0);
  const marker=`Earlier context turns omitted: ${result.historyOmittedCount}. Do not pretend to remember omitted details.`;
  for(const [call] of f.generate.mock.calls){expect(call.messages[0].content).toContain(marker);expect(call.messages.slice(1,-1)).toEqual(history.slice(result.historyOmittedCount));}
 });
});

describe('typed troubleshooting composition',()=>{
 const advice={steps:[{effect:'SHARED_EQUIPMENT_CHANGE',text:'รีสตาร์ตเราเตอร์ครับ'}]};
 it('allows a general composer to correct its advice format with guarded steps without another inference',async()=>{
  const f=fixture(general,{action:'GUIDED_REPLY',advice});
  const r=await f.decide(context,signal());
  expect(r.decision).toEqual({action:'GENERAL_REPLY',text:expect.stringContaining('มีสิทธิ์')});
  if(r.decision.action==='GENERAL_REPLY')expect(r.decision.text.indexOf('มีสิทธิ์')).toBeLessThan(r.decision.text.indexOf('รีสตาร์ต'));
  expect(f.generate).toHaveBeenCalledTimes(2);
 });
 it('allows mixed composition to use guarded advice while preserving the full lookup query',async()=>{
  const query='คู่มือเครือข่ายสำหรับปี 2569';
  const f=fixture({kind:'MIXED',officialQuestion:query,handoffReason:null},{action:'MIXED_GUIDED_REPLY',advice,query});
  expect((await f.decide(context,signal())).decision).toEqual({action:'MIXED_REPLY',generalText:expect.stringContaining('มีสิทธิ์'),query});
  expect(f.generate).toHaveBeenCalledTimes(2);
 });
 it('does not grant a general composer an official lookup through mixed guided output',async()=>{
  const f=fixture(general,{action:'MIXED_GUIDED_REPLY',advice,query:'unrequested lookup'});
  await expect(f.decide(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
 });
 it('screens corrected advice as strictly as an originally guided scope',async()=>{
  const f=fixture(general,{action:'GUIDED_REPLY',advice:{steps:[{effect:'OBSERVATION',text:'ค่าเทอม 500 บาทครับ'}]}});
  await expect(f.decide(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
 });
 it('rejects corrected mixed advice above its full text limit rather than clipping steps',async()=>{
  const f=fixture({kind:'MIXED',officialQuestion:'คู่มือ',handoffReason:null},{action:'MIXED_GUIDED_REPLY',query:'คู่มือ',
   advice:{steps:[{effect:'CLEARS_SAVED_ACCESS',text:'ก'.repeat(12000)}]}});
  await expect(f.decide(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
  expect(f.generate).toHaveBeenCalledTimes(2);
 });
 it('binds a guided scope to typed composition and renders prerequisites before the action',async()=>{
  const f=fixture({kind:'GUIDED',officialQuestion:null,handoffReason:null},{action:'GUIDED_REPLY',advice});
  const r=await f.decide(context,signal());
  expect(r.decision.action).toBe('GENERAL_REPLY');
  expect(r.decision).toMatchObject({text:expect.stringContaining('มีสิทธิ์')});
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.generate.mock.calls[1][0].responseSchema.safeParse({decision:{action:'GENERAL_REPLY',text:'รีสตาร์ตเราเตอร์'}}).success).toBe(false);
 });
 it('rejects free-form output from guided scope',async()=>{const f=fixture({kind:'GUIDED',officialQuestion:null,handoffReason:null});await expect(f.decide(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});expect(f.generate).toHaveBeenCalledTimes(2);});
 it('types the general component of mixed troubleshooting without losing official lookup',async()=>{
  const f=fixture({kind:'MIXED_GUIDED',officialQuestion:'คู่มือเครือข่าย',handoffReason:null},{action:'MIXED_GUIDED_REPLY',advice,query:'คู่มือเครือข่าย'});
  expect((await f.decide(context,signal())).decision).toEqual({action:'MIXED_REPLY',generalText:expect.stringContaining('มีสิทธิ์'),query:'คู่มือเครือข่าย'});
 });
 it('rejects mixed prose bypass',async()=>{const f=fixture({kind:'MIXED_GUIDED',officialQuestion:'คู่มือ',handoffReason:null},{action:'MIXED_REPLY',generalText:'reset',query:'คู่มือ'});await expect(f.decide(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});});
 it('rejects guided unsupported official claims before legacy free-prose correction',async()=>{
  const f=fixture({kind:'GUIDED',officialQuestion:null,handoffReason:null},{action:'GUIDED_REPLY',advice:{steps:[{effect:'OBSERVATION',text:'ค่าเทอม 500 บาทครับ'}]}});
  await expect(f.decide(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});expect(f.generate).toHaveBeenCalledTimes(2);
 });
 it('rejects a guided reply that exceeds the complete output limit',async()=>{const f=fixture({kind:'GUIDED',officialQuestion:null,handoffReason:null},{action:'GUIDED_REPLY',advice:{steps:Array.from({length:6},()=>({effect:'CLEARS_SAVED_ACCESS',text:'ก'.repeat(3400)}))}});await expect(f.decide(context,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});});
});
