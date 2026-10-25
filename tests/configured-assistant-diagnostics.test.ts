import {Pool} from 'pg';
import {afterEach,expect,it,vi} from 'vitest';

const generation=vi.hoisted(()=>vi.fn());
vi.mock('../lib/ai/gateway',()=>({generate:generation}));

import {createConfiguredKnowledgeProducer} from '../lib/knowledge/configured';

const uuids={job:'00000000-0000-4000-8000-000000000101',session:'00000000-0000-4000-8000-000000000102',
 conversation:'00000000-0000-4000-8000-000000000103',message:'00000000-0000-4000-8000-000000000104',
 lease:'00000000-0000-4000-8000-000000000105'};

afterEach(()=>generation.mockReset());

it('uses the actual general-claim rejection code for one configured repair, without speculative retrieval',async()=>{
 generation.mockImplementation(async(input:{taskType:string})=>({output:{decision:{action:'GENERAL_REPLY',text:input.taskType==='ASSISTANT_DECISION'
  ?'ลองรีสตาร์ทมือถือครับ ใช้ Wi-Fi ของมหาวิทยาลัย เช่น YRU-WiFI หรือไม่ครับ':'ลองรีสตาร์ทมือถือแล้วเชื่อมต่อเครือข่ายเดิมอีกครั้งครับ'}},toolCalls:[],providerId:'fixture-provider',modelId:'fixture-model',fallbackUsed:false}));
 const pool=new Pool(),events:unknown[]=[];
 try{
  const result=await createConfiguredKnowledgeProducer(pool,'fixture-only',{assistantEnabled:true,onAssistantGenerationDiagnostic:event=>events.push(event)})({jobId:uuids.job,sessionId:uuids.session,conversationId:uuids.conversation,messageId:uuids.message,revision:1,question:'ควรลองอะไรต่อ โดยไม่ล้างการตั้งค่าทั้งหมด',history:[],leaseToken:uuids.lease},new AbortController().signal);
  expect(result).toMatchObject({kind:'CONVERSATION',text:'ลองรีสตาร์ทมือถือแล้วเชื่อมต่อเครือข่ายเดิมอีกครั้งครับ'});
  expect(generation.mock.calls.map(([input])=>input.taskType)).toEqual(['ASSISTANT_DECISION','ASSISTANT_DECISION_REPAIR']);
  expect(events).toContainEqual({taskType:'ASSISTANT_DECISION',outcome:'SUCCESS',decisionAction:'GENERAL_REPLY',generalAccepted:false,generalScreenReason:'INSTITUTIONAL_TOPIC'});
  expect(events).toContainEqual({taskType:'ASSISTANT_DECISION_REPAIR',outcome:'SUCCESS',decisionAction:'GENERAL_REPLY',generalAccepted:true});
  expect(JSON.stringify(events)).not.toContain('YRU-WiFI');
 }finally{await pool.end();}
});

it('forwards the actual temporal preguard reason after a lookup decision without additional generation',async()=>{
 generation.mockResolvedValue({output:{decision:{action:'LOOKUP',query:'เกณฑ์การเทียบโอนปี2569'}},toolCalls:[],providerId:'fixture-provider',modelId:'fixture-model',fallbackUsed:false});
 const pool=new Pool(),events:unknown[]=[];
 try{
  const result=await createConfiguredKnowledgeProducer(pool,'fixture-only',{assistantEnabled:true,onAssistantGenerationDiagnostic:event=>events.push(event)})({jobId:uuids.job,sessionId:uuids.session,conversationId:uuids.conversation,messageId:uuids.message,revision:1,question:'ช่วยเปรียบเทียบปี2567 ปี2568 และปี2569',history:[],leaseToken:uuids.lease},new AbortController().signal);
  expect(result.kind).toBe('CLARIFY');expect(generation).toHaveBeenCalledTimes(1);
  expect(events).toContainEqual({taskType:'KNOWLEDGE_VALIDATION',outcome:'REJECTED',stage:'PRE_SCOPE',reason:'MULTIPLE_YEARS'});
  expect(JSON.stringify(events)).not.toContain('2568');expect(JSON.stringify(events)).not.toContain('2569');
 }finally{await pool.end();}
});

it.each(['AMBIGUOUS','INVALID'] as const)('forwards a real non-executable two-year planner rejection: %s',async kind=>{
 generation.mockImplementation(async(input:{taskType:string})=>({output:input.taskType==='ASSISTANT_DECISION'
  ?{decision:{action:'LOOKUP',query:'เกณฑ์การเทียบโอนปี2569'}}:{resolution:kind==='AMBIGUOUS'?{kind}:{kind:'EXCLUSIVE_REPLACEMENT',requestedYear:2570}},toolCalls:[],providerId:'fixture-provider',modelId:'fixture-model',fallbackUsed:false}));
 const pool=new Pool(),events:unknown[]=[];
 try{
  const result=await createConfiguredKnowledgeProducer(pool,'fixture-only',{assistantEnabled:true,onAssistantGenerationDiagnostic:event=>events.push(event)})({jobId:uuids.job,sessionId:uuids.session,conversationId:uuids.conversation,messageId:uuids.message,revision:1,question:'ไม่ใช้ปี2568แล้ว ขอเฉพาะปี2569',history:[],leaseToken:uuids.lease},new AbortController().signal);
  expect(result.kind).toBe('CLARIFY');expect(generation.mock.calls.map(([input])=>input.taskType)).toEqual(['ASSISTANT_DECISION','KNOWLEDGE_PLAN']);
  expect(events).toContainEqual({taskType:'KNOWLEDGE_VALIDATION',outcome:'REJECTED',stage:'PERIOD_PLAN',reason:kind==='AMBIGUOUS'?'AMBIGUOUS_PERIOD':'INVALID_PERIOD_PLAN'});
  expect(JSON.stringify(events)).not.toContain('2568');expect(JSON.stringify(events)).not.toContain('2569');
 }finally{await pool.end();}
});

it('keeps a successful assistant answer when the optional generation observer throws',async()=>{
 generation.mockResolvedValue({output:{decision:{action:'GENERAL_REPLY',text:'Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์ครับ'}},
  toolCalls:[],providerId:'fixture-provider',modelId:'fixture-model',fallbackUsed:false});
 const pool=new Pool(),observer=vi.fn(()=>{throw new Error('diagnostic callback failure');});
 try{
  const produce=createConfiguredKnowledgeProducer(pool,'fixture-only',{assistantEnabled:true,onAssistantGenerationDiagnostic:observer});
  const result=await produce({jobId:uuids.job,sessionId:uuids.session,conversationId:uuids.conversation,messageId:uuids.message,
   revision:1,question:'Wi-Fi คืออะไร',history:[],leaseToken:uuids.lease},new AbortController().signal);
  expect(result).toMatchObject({kind:'CONVERSATION',text:'Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์ครับ'});
  expect(observer).toHaveBeenCalledWith({taskType:'ASSISTANT_DECISION',outcome:'SUCCESS',decisionAction:'GENERAL_REPLY',generalAccepted:true});
 }finally{await pool.end();}
});

it('records only grounded acceptance and validated plan method and filter names',async()=>{
 generation.mockImplementation(async(input:{taskType:string})=>{
  if(input.taskType==='ASSISTANT_DECISION')return {output:{decision:{action:'MIXED_REPLY',
   generalText:'มหาวิทยาลัยเปิดให้บริการเวลา 9 โมงครับ',query:'ขอแบบฟอร์มลา'}},toolCalls:[],providerId:'fixture-provider',modelId:'fixture-model',fallbackUsed:false};
  if(input.taskType==='ASSISTANT_DECISION_REPAIR')return {output:{decision:{action:'MIXED_REPLY',
   generalText:['ควรระบุรหัสนักศึกษาครับ','เขียนจุดประสงค์ของคำร้องให้ชัดเจนครับ'],query:'ขอแบบฟอร์มลา'}},toolCalls:[],providerId:'fixture-provider',modelId:'fixture-model',fallbackUsed:false};
  if(input.taskType==='KNOWLEDGE_PLAN')return {output:{scope:{historical:false,academicYear:null,asOfDate:null,familyCodes:[],
   departmentCode:'LIBRARY',audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null},
   selection:{method:'STRUCTURED',query:{version:1,dataset:'service_forms',filters:[{field:'name',value:'private synthetic value'}],limit:20},notApplicable:null}},
   toolCalls:[],providerId:'fixture-provider',modelId:'fixture-model',fallbackUsed:false};
  throw new Error('Unexpected generation task');
 });
 const pool=new Pool(),events:unknown[]=[];
 try{
  const produce=createConfiguredKnowledgeProducer(pool,'fixture-only',{assistantEnabled:true,onAssistantGenerationDiagnostic:event=>events.push(event)});
  const result=await produce({jobId:uuids.job,sessionId:uuids.session,conversationId:uuids.conversation,messageId:uuids.message,
   revision:1,question:'ขอแบบฟอร์มลา',history:[],leaseToken:uuids.lease},new AbortController().signal);
  expect(result).toMatchObject({kind:'MIXED',general:{text:'เขียนจุดประสงค์ของคำร้องให้ชัดเจนครับ'},official:{kind:'CLARIFY'}});
  expect(events).toEqual([
   {taskType:'ASSISTANT_DECISION',outcome:'SUCCESS',decisionAction:'MIXED_REPLY',generalAccepted:false,generalScreenReason:'INSTITUTIONAL_NUMBER'},
   {taskType:'ASSISTANT_DECISION_REPAIR',outcome:'SUCCESS',decisionAction:'MIXED_REPLY',generalAccepted:true,repairAcceptedParts:1,repairRejectedParts:1},
   {taskType:'KNOWLEDGE_PLAN',outcome:'SUCCESS',planMethod:'STRUCTURED',planDataset:'service_forms',planFilterFields:['name']},
  ]);
  expect(generation.mock.calls[0]?.[0]).toMatchObject({taskType:'ASSISTANT_DECISION',reasoningMode:'OFF_IF_SUPPORTED'});
  // Grounded planning keeps its existing provider default; the preference must
  // not become a blanket override for every generation stage.
  expect(generation.mock.calls[2]?.[0]).toMatchObject({taskType:'KNOWLEDGE_PLAN'});
  expect(generation.mock.calls[2]?.[0]).not.toHaveProperty('reasoningMode');
  expect(JSON.stringify(events)).not.toContain('มหาวิทยาลัยเปิด');
  expect(JSON.stringify(events)).not.toContain('private synthetic value');
 }finally{await pool.end();}
});
