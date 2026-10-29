import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {Client,Pool} from 'pg';
import type {GenerateInput} from '../lib/ai/gateway';
import {createCompatibleChatAdapter} from '../lib/ai/providers/compatible-chat-completions';
import type {CompatibleHttpResponse,CompatibleTransport} from '../lib/ai/compatible-network';
import type {ProviderRequest} from '../lib/ai/types';
import {createCopilotAdmission,createStaffCopilotAssistance} from '../lib/staff/staff-copilot';
import {withStaffAssistanceSnapshot,type StaffAssistanceSnapshot} from '../lib/staff/ai-assistance-snapshot';
import {createStaffKnowledgeAssistance} from '../lib/staff/knowledge-assistance';
import type {KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import type {runHermesStaffRuntime} from '../lib/ai/hermes-staff-runtime';
import {parseStaffCopilotDecision,staffCopilotWireSchema} from '../lib/staff/staff-copilot-decision';

vi.mock('../lib/staff/ai-assistance-snapshot',()=>({withStaffAssistanceSnapshot:vi.fn()}));
vi.mock('../lib/staff/knowledge-assistance',()=>({createStaffKnowledgeAssistance:vi.fn()}));

const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ticket='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pool=new Pool();
const key='synthetic-wire-test-key';
const modelId='org/model:free';
const baseUrl='https://api.provider-support.com/v1';
const advice={revision:4,status:'VERIFIED' as const,answer:'หลักฐานที่ผ่านการอนุมัติ',draftText:'ร่างเดิม',
 sources:[{title:'คู่มือทดสอบ',academicYear:2569,url:'https://yru.ac.th/guide',location:'หน้า 2'}]};
const receipt={revalidate:vi.fn(async()=>advice)};
let current:StaffAssistanceSnapshot;
let decisionIndex=0;
let transport:CompatibleTransport;
let generate:KnowledgeProducerOptions['generate'];
let adapterErrorCode:string|undefined;

const completion=(output:unknown):CompatibleHttpResponse=>({status:200,retryAfter:null,contentType:'application/json',json:{
 choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output)}}],
 usage:{prompt_tokens:5,completion_tokens:3},
}});

beforeEach(()=>{
 vi.stubEnv('YRU_AI_ENABLED','true');
 decisionIndex=0;
 adapterErrorCode=undefined;
 current={source:{summary:'เรื่องทดสอบ',category:'IT',priority:'NORMAL',messages:[],departments:[],truncated:false},
  serialized:'{}',digest:'original',revision:4,
  knowledge:{jobId:ticket,sessionId:ticket,conversationId:ticket,messageId:ticket,revision:2,question:'คำถามจริงจากผู้แจ้ง',history:[]}};
 vi.mocked(withStaffAssistanceSnapshot).mockImplementation(async(...args)=>args[4](Object.assign(new Client(),{release:vi.fn()}),current));
 vi.mocked(createStaffKnowledgeAssistance).mockImplementation(async(_actor,_id,_input,options)=>{
  options?.onReceipt?.(receipt);return advice;
 });
 transport={request:vi.fn(async()=>completion(decisionIndex++===0
  ?{decision:{tool:{name:'search_yru_knowledge',query:'คำค้นเสริม'}}}
  :{decision:{reply:'ร่างคำตอบจากหลักฐาน'}}))};
 const adapter=createCompatibleChatAdapter({transport});
 generate=async <T>(input:GenerateInput<T>)=>{
  const request:ProviderRequest={modelId,baseUrl,apiKey:key,messages:input.messages,
   responseSchema:{name:input.responseName,schema:z.toJSONSchema(input.responseSchema,{target:'draft-7'}) as Record<string,unknown>},
   signal:input.signal??new AbortController().signal,costMode:'FREE_ONLY',apiFormat:'CHAT',timeoutMs:input.timeoutMs,
   ...(input.tools?{tools:input.tools}:{})};
  let result;
  try{result=await adapter.generate(request);}
  catch(error){adapterErrorCode=(error as {code?:string}).code;throw error;}
  const output=input.responseSchema.parse(result.output);
  return {...result,output,providerId:'provider-fixture',modelId:'model-fixture',fallbackUsed:false};
 };
});

afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});

const runner:typeof runHermesStaffRuntime=async options=>{
 const first=await options.decide([{role:'user',content:'choose a lookup'}],options.signal);
 if(!('tool' in first))throw new Error('Hermes did not request the knowledge lookup');
 await options.lookup(first.tool.query,options.signal);
 const second=await options.decide([{role:'user',content:'draft from the verified result'}],options.signal);
 if(!('reply' in second))throw new Error('Hermes did not return its draft');
 return {draftText:second.reply};
};

it('uses a strict root object and unwraps both valid decision variants unchanged',()=>{
 const jsonSchema=z.toJSONSchema(staffCopilotWireSchema,{target:'draft-7'}) as Record<string,unknown>;
 expect(jsonSchema).toMatchObject({type:'object',additionalProperties:false,required:['decision'],
  properties:{decision:expect.any(Object)}});
 const tool={tool:{name:'search_yru_knowledge' as const,query:'คำค้นเสริม'}};
 const reply={reply:'ร่างคำตอบจากหลักฐาน'};
 expect(parseStaffCopilotDecision({decision:tool})).toEqual(tool);
 expect(parseStaffCopilotDecision({decision:reply})).toEqual(reply);
});

it.each([
 ['mixed decision variants',{decision:{tool:{name:'search_yru_knowledge',query:'ค้น'},reply:'ตอบ'}}],
 ['extra wrapper field',{decision:{reply:'ตอบ'},unexpected:true}],
 ['extra decision field',{decision:{reply:'ตอบ',unexpected:true}}],
 ['extra tool field',{decision:{tool:{name:'search_yru_knowledge',query:'ค้น',unexpected:true}}}],
 ['missing decision envelope',{reply:'ตอบ'}],
] as const)('rejects %s at the copilot decision boundary',(_name,output)=>{
 expect(()=>parseStaffCopilotDecision(output)).toThrow();
});

it('sends the production staff copilot decision through the strict compatible adapter envelope',async()=>{
 let result;
 try{result=await createStaffCopilotAssistance(actor,ticket,{revision:4},{pool,key,generate,runAgent:runner,admission:createCopilotAdmission()});}
 catch(error){
  // The service intentionally normalizes provider details. Keep the useful
  // pre-HTTP adapter diagnosis visible to this test without exposing it outside.
  expect(adapterErrorCode).toBeUndefined();
  throw error;
 }

 expect(result).toMatchObject({ticketId:ticket,revision:4,status:'DRAFT',evidenceText:advice.answer});
 expect(result.draftText).toContain('ร่างคำตอบจากหลักฐาน');
 expect(transport.request).toHaveBeenCalledTimes(2);
 const firstRequest=vi.mocked(transport.request).mock.calls[0]![1];
 expect('json' in firstRequest?firstRequest.json:null).toMatchObject({
  response_format:{type:'json_schema',json_schema:{strict:true,schema:{type:'object',additionalProperties:false,
   required:['decision'],properties:{decision:expect.any(Object)}}}},
 });
});

it('uses a backend-owned SEARCH then DRAFT phase and narrows the next permitted decision',async()=>{
 let calls=0;
 const phasedGenerate=async<T>(input:GenerateInput<T>)=>{
  const first=calls++===0;
  expect(input.responseSchema.safeParse(first?{decision:{reply:'premature'}}:
   {decision:{tool:{name:'search_yru_knowledge',query:'repeat'}}}).success).toBe(false);
  const data=JSON.parse(input.messages.at(-1)!.content);
  expect(data.backendPhase).toBe(first?'SEARCH':'DRAFT');
  expect(data.boundStudentQuestion).toBe(current.knowledge!.question);
  if(first)expect(data.verifiedKnowledge).toBeUndefined();
  else expect(data.verifiedKnowledge).toEqual({answer:advice.answer,sources:advice.sources});
  return generate(input);
 };
 const result=await createStaffCopilotAssistance(actor,ticket,{revision:4},
  {pool,key,generate:phasedGenerate,runAgent:runner,admission:createCopilotAdmission()});
 expect(result.status).toBe('DRAFT');expect(calls).toBe(2);
});
