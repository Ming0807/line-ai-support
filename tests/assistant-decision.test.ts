import {describe,it,expect,vi} from 'vitest';
import {z} from 'zod';
import {assistantDecisionSchema,createAssistantDecision} from '../lib/ai/assistant-decision';
import type {GenerateInput} from '../lib/ai/gateway';
import {createChatCompletionsAdapter} from '../lib/ai/providers/chat-completions';

function fixture(output:unknown={action:'GENERAL_REPLY',text:'สวัสดีครับ วันนี้อยากให้ช่วยเรื่องอะไรครับ'}){
 const calls:GenerateInput<unknown>[]=[];
 const generate=vi.fn(async(input:GenerateInput<unknown>)=>{calls.push(input);return {output:{decision:output},toolCalls:[],providerId:'synthetic-provider',modelId:'synthetic-model',fallbackUsed:false};});
 return {calls,generate,decide:createAssistantDecision({generate})};
}
describe('minimal assistant proposal boundary',()=>{
 it('constrains action names with provider-supported singleton enums without accepting a misspelled action',async()=>{
  const f=fixture();await f.decide({question:'hello',history:[]},new AbortController().signal);
  const schema=z.toJSONSchema(f.calls[0].responseSchema,{target:'draft-7'});
  expect(schema).toMatchObject({properties:{decision:{oneOf:['GENERAL_REPLY','CLARIFY','LOOKUP','MIXED_REPLY','HANDOFF']
   .map(action=>({properties:{action:{type:'string',enum:[action]}}}))}}});
  expect(JSON.stringify(schema)).not.toContain('"const":');
  expect(assistantDecisionSchema.safeParse({action:'GENERAL_PREPLY',text:'synthetic typo'}).success).toBe(false);
 });
 it('sends a strict object root compatible with the installed provider adapter',async()=>{
  const f=fixture();await f.decide({question:'hello',history:[]},new AbortController().signal);
  const schema=z.toJSONSchema(f.calls[0].responseSchema);
  expect(schema.type).toBe('object');expect(schema.additionalProperties).toBe(false);expect(schema.required).toEqual(['decision']);
  expect(f.calls[0].messages[0].content).toContain('{"decision":{"action":"GENERAL_REPLY","text":');
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({decision:{action:'GENERAL_REPLY',text:'hello'}})}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200}));
  await expect(createChatCompletionsAdapter({fetchImpl}).generate({modelId:'synthetic',baseUrl:'https://opencode.ai/zen/v1',apiKey:'synthetic',messages:f.calls[0].messages,responseSchema:{name:'assistant_decision',schema},signal:new AbortController().signal})).resolves.toMatchObject({httpStatus:200});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it.each([
  {action:'GENERAL_REPLY',text:'18 คูณ 7 เท่ากับ 126 ครับ'},
  {action:'CLARIFY',text:'ต้องการให้ช่วยเรื่องคำถามใดครับ'},
  {action:'LOOKUP',query:'ปฏิทินลงทะเบียน YRU 2569'},
  {action:'HANDOFF',reason:'USER_REQUEST'},
  {action:'HANDOFF',reason:'PERSONAL_RECORD'},
  {action:'HANDOFF',reason:'UNRESOLVED_CONFIRMED'},
 ])('accepts a compact proposal without business authority: $action',proposal=>{
  expect(assistantDecisionSchema.safeParse(proposal).success).toBe(true);
 });
 it.each([
  {action:'EXECUTE_SQL',query:'select 1'},
  {action:'GENERAL_REPLY',text:'ok',verified:true},
  {action:'HANDOFF',reason:'PROVIDER_FAILED'},
  {action:'UNRESOLVED_CONFIRMED',reason:'UNRESOLVED_CONFIRMED'},
  {action:'HANDOFF',reason:'USER_REQUEST',recipientId:'someone'},
  {action:'LOOKUP',query:'   '},
  {action:'GENERAL_REPLY',text:'   '},
  {action:'GENERAL_REPLY',text:'a'.repeat(20001)},
 ])('rejects malformed or authority-bearing output',proposal=>{
  expect(assistantDecisionSchema.safeParse(proposal).success).toBe(false);
 });
 it('preserves natural prose and complete long answers without granting delivery authority',async()=>{
  const text='คำอธิบายทั่วไปโดยละเอียด\n'.repeat(300),f=fixture({action:'GENERAL_REPLY',text});
  const result=await f.decide({question:'อธิบาย Wi-Fi',history:[]},new AbortController().signal);
  expect(result).toEqual({decision:{action:'GENERAL_REPLY',text},provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0});
  expect(f.calls).toHaveLength(1);expect(f.calls[0].tools).toEqual([]);
  expect(()=>z.toJSONSchema(f.calls[0].responseSchema)).not.toThrow();
 });
 it('provides ordered owned conversational context, including assistant replies, and the exact latest question',async()=>{
  const f=fixture();await f.decide({question:'ขอสรุปสั้นกว่านี้',history:[{role:'user',content:'Wi-Fi คืออะไร'},{role:'assistant',content:'คำอธิบายก่อนหน้านี้'}]},new AbortController().signal);
  expect(f.calls[0].messages.slice(-3)).toEqual([{role:'user',content:'Wi-Fi คืออะไร'},{role:'assistant',content:'คำอธิบายก่อนหน้านี้'},{role:'user',content:'ขอสรุปสั้นกว่านี้'}]);
 });
 it('binds the actual rejection reason to unchanged real sources without resending UNSENT hallucinated prose',async()=>{
  const f=fixture(),context={question:'ควรลองอะไรต่อ',history:[{role:'user' as const,content:'มือถือ Android ต่อแล้วไม่มีอินเทอร์เน็ต'},{role:'assistant' as const,content:'ลองปิดเปิด Wi-Fi ครับ'}]};
  const before=structuredClone(context),feedback={reason:'INSTITUTIONAL_TOPIC' as const,rejectedProposal:{action:'GENERAL_REPLY' as const,text:'Wi-Fi ของมหาวิทยาลัย เช่น YRU-WiFI'}};
  await f.decide(context,new AbortController().signal,feedback);
  expect(f.calls[0].taskType).toBe('ASSISTANT_DECISION_REPAIR');expect(f.calls[0].responseName).toBe('assistant_decision_repair');
  expect(f.calls[0].messages.slice(1,-1)).toEqual(context.history);
  expect(f.calls[0].messages.at(-1)?.content).toBe(JSON.stringify({question:context.question,validationReason:feedback.reason}));
  expect(JSON.stringify(f.calls[0].messages)).not.toContain('YRU-WiFI');
  expect(f.calls[0].timeoutMs).toBe(25000);expect(f.calls[0].tools).toEqual([]);expect(context).toEqual(before);
 });
 it('does not clip sources or omit more history to fit oversized repair feedback',async()=>{
  const f=fixture();
  await expect(f.decide({question:'q'.repeat(19000),history:[{role:'assistant',content:'r'.repeat(8000)}]},new AbortController().signal,
   {reason:'INSTITUTIONAL_TOPIC',rejectedProposal:{action:'GENERAL_REPLY',text:'x'.repeat(15000)}})).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(f.generate).not.toHaveBeenCalled();
 });
 it('keeps a rejected MIXED proposal separate from delivered history and the unchanged question',async()=>{
  const f=fixture({action:'MIXED_REPLY',generalText:['เขียนเป้าหมายให้ชัดเจนครับ'],query:'ค้นแบบคำร้องที่เกี่ยวข้อง'}),context={question:'ช่วยเตรียมตัวก่อนยื่นคำร้องและหาแบบให้ด้วย',history:[{role:'user' as const,content:'ยังไม่ทราบประเภทคำร้อง'}]};
  const rejectedProposal={action:'MIXED_REPLY' as const,generalText:'คุณควรระบุรหัสนักศึกษาครับ',query:'ลิงก์แบบคำร้องทั่วไป'};
  await f.decide(context,new AbortController().signal,{reason:'INSTITUTIONAL_REQUIREMENT',rejectedProposal});
  expect(f.calls[0].messages.slice(1,-1)).toEqual(context.history);
  expect(JSON.parse(f.calls[0].messages.at(-1)!.content)).toEqual({question:context.question,validationReason:'INSTITUTIONAL_REQUIREMENT'});
  expect(JSON.stringify(f.calls[0].messages)).not.toContain('คุณควรระบุรหัสนักศึกษาครับ');
  expect(f.calls[0].taskType).toBe('ASSISTANT_DECISION_REPAIR');expect(f.calls[0].tools).toEqual([]);
  expect(f.calls[0].responseSchema.safeParse({decision:{action:'LOOKUP',query:'ค้นอย่างเดียว'}}).success).toBe(false);
  expect(f.calls[0].responseSchema.safeParse({decision:{action:'MIXED_REPLY',generalText:['เขียนเป้าหมายให้ชัดเจนครับ'],query:'ค้นแบบคำร้องที่เกี่ยวข้อง'}}).success).toBe(true);
 });
 it('retains whole safe model contributions from a MIXED correction and rejects an assembled unsafe fragment',async()=>{
  const context={question:'ช่วยแนะนำการเตรียมตัวก่อนยื่นคำร้องและหาแบบให้ด้วย',history:[]};
  const feedback={reason:'INSTITUTIONAL_REQUIREMENT' as const,rejectedProposal:{action:'MIXED_REPLY' as const,generalText:'ควรระบุรหัสนักศึกษาครับ',query:'แบบคำร้อง'}};
  const safe='เขียนวัตถุประสงค์และข้อเท็จจริงของเรื่องให้กระชับครับ';
  const f=fixture({action:'MIXED_REPLY',generalText:['ควรระบุรหัสนักศึกษาครับ',safe],query:'ค้นแบบคำร้อง'});
  expect(await f.decide(context,new AbortController().signal,feedback)).toMatchObject({decision:{action:'MIXED_REPLY',generalText:safe,query:'ค้นแบบคำร้อง'}});
  const split=fixture({action:'MIXED_REPLY',generalText:['คุณควรระบุ','รหัสนักศึกษาให้ชัดเจนครับ'],query:'ค้นแบบคำร้อง'});
  await expect(split.decide(context,new AbortController().signal,feedback)).rejects.toMatchObject({code:'INVALID_OUTPUT'});
 });
 it('rejects a single oversized repair message even when the aggregate fits 40000 characters',async()=>{
  const f=fixture();
  await expect(f.decide({question:'q'.repeat(10000),history:[]},new AbortController().signal,
   {reason:'INSTITUTIONAL_TOPIC',rejectedProposal:{action:'GENERAL_REPLY',text:'x'.repeat(11000)}})).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(f.generate).not.toHaveBeenCalled();
 });
 it('preserves provider reasoning for contextual decisions and complete writing meaning',async()=>{
  const f=fixture();await f.decide({question:'ช่วยปรับข้อความนี้ให้สุภาพขึ้น โดยคงความหมายครบ',history:[]},new AbortController().signal);
  expect(f.calls[0].reasoningMode).toBe('DEFAULT');
 });
 it('omits only complete old prefix turns, reports omission and never cuts the current question',async()=>{
  const f=fixture(),question='ก'.repeat(19000),old='o'.repeat(19000),recent='r'.repeat(8000);
  const result=await f.decide({question,history:[{role:'user',content:old},{role:'assistant',content:recent}]},new AbortController().signal);
  expect(result.historyOmittedCount).toBe(1);expect(f.calls[0].messages.at(-1)?.content).toBe(question);
  expect(f.calls[0].messages.map(m=>m.content)).toContain(recent);expect(f.calls[0].messages.map(m=>m.content)).not.toContain(old);
  expect(f.calls[0].messages.reduce((n,m)=>n+m.content.length,0)).toBeLessThanOrEqual(40000);
 });
 it('never interprets a model GENERAL label as verified university evidence',async()=>{
  const f=fixture({action:'GENERAL_REPLY',text:'มหาวิทยาลัยคิดค่าปรับ 500 บาท'});
  const result=await f.decide({question:'ค่าปรับเท่าไร',history:[]},new AbortController().signal);
  expect(result.provenance).toBe('MODEL_PROPOSAL_UNVERIFIED');expect(result).not.toHaveProperty('messages');expect(result).not.toHaveProperty('evidence');
 });
 it('rejects invalid output rather than coercing an action',async()=>{
  const f=fixture({action:'HANDOFF',reason:'PROVIDER_FAILED'});
  await expect(f.decide({question:'สวัสดี',history:[]},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_OUTPUT'});
 });
 it('does not generate when already cancelled and never returns output after cancellation',async()=>{
  const f=fixture();await expect(f.decide({question:'hi',history:[]},AbortSignal.abort())).rejects.toMatchObject({code:'CANCELLED'});expect(f.generate).not.toHaveBeenCalled();
  const controller=new AbortController();
  f.generate.mockImplementationOnce(async()=>{controller.abort();return {output:{decision:{action:'GENERAL_REPLY',text:'late'}},toolCalls:[],providerId:'p',modelId:'m',fallbackUsed:false};});
  await expect(f.decide({question:'hi',history:[]},controller.signal)).rejects.toMatchObject({code:'CANCELLED'});
 });
 it('rejects oversized current input without sending a partial question',async()=>{
  const f=fixture();await expect(f.decide({question:'a'.repeat(20001),history:[]},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(f.generate).not.toHaveBeenCalled();
 });
});
