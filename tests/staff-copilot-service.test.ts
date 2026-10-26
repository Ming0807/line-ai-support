import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Client,Pool} from 'pg';
import {createStaffCopilotAssistance,createCopilotAdmission} from '../lib/staff/staff-copilot';
import {withStaffAssistanceSnapshot,type StaffAssistanceSnapshot} from '../lib/staff/ai-assistance-snapshot';
import {createStaffKnowledgeAssistance} from '../lib/staff/knowledge-assistance';
import type {KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import type {runHermesStaffRuntime} from '../lib/ai/hermes-staff-runtime';
import {AssistError} from '../lib/staff/ai-assistance-contracts';
import {createHermesStaffRuntime} from '../lib/ai/hermes-staff-runtime';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
vi.mock('../lib/staff/ai-assistance-snapshot',()=>({withStaffAssistanceSnapshot:vi.fn()}));
vi.mock('../lib/staff/knowledge-assistance',()=>({createStaffKnowledgeAssistance:vi.fn()}));
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ticket='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pool=new Pool();
const generate=vi.fn() as unknown as KnowledgeProducerOptions['generate'];
let current:StaffAssistanceSnapshot;
const advice={revision:4,status:'VERIFIED' as const,answer:'หลักฐานที่ผ่านการอนุมัติ',draftText:'ร่างเดิม',
 sources:[{title:'คู่มือทดสอบ',academicYear:2569,url:'https://yru.ac.th/guide',location:'หน้า 2'}]};
const revalidate=vi.fn(async()=>advice);
const runAgent:typeof runHermesStaffRuntime=async options=>{
 await options.lookup('คำค้นเสริม',options.signal);return {draftText:'คำแนะนำที่ยังต้องตรวจโดยเจ้าหน้าที่'};
};
beforeEach(()=>{
 vi.stubEnv('YRU_AI_ENABLED','true');
 current={source:{summary:'เรื่องทดสอบ',category:'IT',priority:'NORMAL',messages:[],departments:[],truncated:false},
  serialized:'{}',digest:'original',revision:4,
  knowledge:{jobId:ticket,sessionId:ticket,conversationId:ticket,messageId:ticket,revision:2,question:'คำถามจริงจากผู้แจ้ง',history:[]}};
 vi.mocked(withStaffAssistanceSnapshot).mockImplementation(async(...args)=>args[4](Object.assign(new Client(),{release:vi.fn()}),current));
 revalidate.mockResolvedValue(advice);
 vi.mocked(createStaffKnowledgeAssistance).mockImplementation(async(_actor,_id,_input,options)=>{
  options?.onReceipt?.({revalidate});return advice;
 });
});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
const options=()=>({pool,key:'synthetic',generate,runAgent,admission:createCopilotAdmission()});

it('binds native lookup to the authorized original question and appends complete canonical references',async()=>{
 const result=await createStaffCopilotAssistance(actor,ticket,{revision:4},options());
 expect(result).toMatchObject({ticketId:ticket,revision:4,status:'DRAFT',evidenceText:advice.answer,sources:advice.sources});
 expect(result.draftText).toContain('https://yru.ac.th/guide');expect(result.draftText).toContain('หน้า 2');
 expect(createStaffKnowledgeAssistance).toHaveBeenCalledWith(actor,ticket,{revision:4},expect.objectContaining({generate}));
 expect(revalidate).toHaveBeenCalledOnce();
});
it('does not start an agent before authorization, a question, and the AI gate',async()=>{
 const runner=vi.fn(runAgent);
 vi.mocked(withStaffAssistanceSnapshot).mockRejectedValueOnce(new AssistError('NOT_FOUND'));
 await expect(createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),runAgent:runner})).rejects.toThrow('NOT_FOUND');
 current={...current,knowledge:null};
 expect((await createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),runAgent:runner})).status).toBe('NO_USER_QUESTION');
 current.knowledge={jobId:ticket,sessionId:ticket,conversationId:ticket,messageId:ticket,revision:2,question:'คำถาม',history:[]};
 vi.stubEnv('YRU_AI_ENABLED','false');
 await expect(createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),runAgent:runner})).rejects.toThrow('UNAVAILABLE');
 expect(runner).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled();
});
it('withholds drafts for nonverified or web-only knowledge',async()=>{
 for(const unverified of [
  {revision:4,status:'NOT_VERIFIED' as const,answer:'ยังไม่มีหลักฐาน',draftText:null,sources:[]},
  {revision:4,status:'WEB_LEADS' as const,sourceKind:'YRU_WEBSITE' as const,answer:'ข้อมูลจากเว็บ',draftText:'draft',sources:advice.sources},
 ]){
  const receipt=vi.fn(async()=>unverified);
  vi.mocked(createStaffKnowledgeAssistance).mockImplementationOnce(async(_a,_b,_c,o)=>{o?.onReceipt?.({revalidate:receipt});return unverified;});
  expect(await createStaffCopilotAssistance(actor,ticket,{revision:4},options())).toMatchObject({status:'NOT_VERIFIED',draftText:null,sources:[]});
 }
});
it('rejects a runtime draft without tool use, duplicate tool use, invented links and overflow without slicing',async()=>{
 const bad:typeof runHermesStaffRuntime[]=[
  async()=>({draftText:'ไม่มีหลักฐาน'}),
  async o=>{await o.lookup('one',o.signal);await o.lookup('two',o.signal);return {draftText:'ซ้ำ'};},
  async o=>{await o.lookup('one',o.signal);return {draftText:'ไป https://attacker.example'};},
  async o=>{await o.lookup('one',o.signal);return {draftText:'อ่านที่ yru.ac.th/help'};},
  async o=>{await o.lookup('one',o.signal);return {draftText:'ติดต่อ help@example.org'};},
  async o=>{await o.lookup('one',o.signal);return {draftText:'ใช้ http：//example.org'};},
  async o=>{await o.lookup('one',o.signal);return {draftText:'ก'.repeat(12001)};},
  async o=>{await o.lookup('one',o.signal);return {draftText:'   '};},
 ];
 for(const runner of bad)await expect(createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),runAgent:runner})).rejects.toThrow('UNAVAILABLE');
});
it('discards a changed ticket or revoked source after drafting, without regeneration',async()=>{
 const changed:typeof runHermesStaffRuntime=async o=>{await o.lookup('one',o.signal);current={...current,digest:'changed'};return {draftText:'ร่างเก่า'};};
 await expect(createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),runAgent:changed})).rejects.toThrow('CONFLICT');
 current={...current,digest:'original'};revalidate.mockRejectedValueOnce(new AssistError('CONFLICT'));
 await expect(createStaffCopilotAssistance(actor,ticket,{revision:4},options())).rejects.toThrow('CONFLICT');
 expect(generate).not.toHaveBeenCalled();
});
it('rejects concurrent jobs for an actor and keeps admission occupied until cancellation cleanup finishes',async()=>{
 const admission=createCopilotAdmission();let finish:()=>void=()=>{};let started:()=>void=()=>{};
 const ready=new Promise<void>(r=>{started=r;});const cleanup=new Promise<void>(r=>{finish=r;});
 const runner:typeof runHermesStaffRuntime=async o=>{started();await cleanup;if(o.signal.aborted)throw new Error('cancel');return {draftText:'unused'};};
 const abort=new AbortController();
 const first=createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),admission,runAgent:runner,signal:abort.signal});
 await ready;
 await expect(createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),admission})).rejects.toThrow('UNAVAILABLE');
 abort.abort();await expect(first).rejects.toThrow('UNAVAILABLE');
 await expect(createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),admission})).rejects.toThrow('UNAVAILABLE');
 finish();await vi.waitFor(()=>expect(admission.active()).toBe(0));
 expect((await createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),admission})).status).toBe('DRAFT');
});
it('enforces global admission and bounded deadline without dropping admission before cleanup',async()=>{
 const admission=createCopilotAdmission();const a=admission.acquire(actor),b=admission.acquire(ticket);
 expect(()=>admission.acquire('cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toThrow('UNAVAILABLE');a();b();
 const runner:typeof runHermesStaffRuntime=async o=>new Promise((_resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
 await expect(createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),admission,runAgent:runner,timeoutMs:20})).rejects.toThrow('UNAVAILABLE');
 await vi.waitFor(()=>expect(admission.active()).toBe(0));
});
it('connects the service through a real owned child and authenticated loopback using only controlled JSON decisions',async()=>{
 const testRoot=await mkdtemp(join(tmpdir(),'root-copilot-service-'));
 const run=createHermesStaffRuntime({runtimeRoot:join(testRoot,'runtime'),launcher:{command:process.execPath,
  args:[fileURLToPath(new URL('./fixtures/hermes-staff-runtime-child.mjs',import.meta.url)),'success',testRoot]},processTimeoutMs:5000});
 let calls=0;
 const controlled:KnowledgeProducerOptions['generate']=async request=>{
  calls++;expect(request.taskType).toBe('HERMES_STAFF_DRAFT');expect(request.ticketId).toBe(ticket);
  expect(request.messages.map(m=>m.role)).toEqual(['system','user']);
  expect(request.messages[1].content).toContain('คำถามจริงจากผู้แจ้ง');
  const output=request.responseSchema.parse(calls===1?{tool:{name:'search_yru_knowledge',query:'คำค้นจริง'}}:{reply:'ร่างที่ได้ผ่าน bridge จริง'});
  return {output,toolCalls:[],providerId:actor,modelId:ticket,fallbackUsed:false};
 };
 try{
  const result=await createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),runAgent:run,generate:controlled});
  expect(result).toMatchObject({status:'DRAFT'});expect(result.draftText).toContain('ร่างที่ได้ผ่าน bridge จริง');
  expect(calls).toBe(2);expect(revalidate).toHaveBeenCalledOnce();expect(await readdir(join(testRoot,'runtime','staff-runs'))).toEqual([]);
 }finally{
  const target=resolve(testRoot);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('root-copilot-service-'))throw new Error('EXACT_OWNED_CLEANUP_REQUIRED');
  await rm(target,{recursive:true,force:true});
 }
});
it('propagates a bridge disconnect into the actual generation request signal',async()=>{
 let observed:AbortSignal|undefined;
 const controlled:KnowledgeProducerOptions['generate']=async request=>{
  observed=request.signal;return new Promise((_resolve,reject)=>request.signal?.addEventListener('abort',()=>reject(new Error('stopped')),{once:true}));
 };
 const runner:typeof runHermesStaffRuntime=async o=>{
  const bridge=new AbortController(),decision=o.decide([{role:'user',content:'synthetic'}],bridge.signal);
  await vi.waitFor(()=>expect(observed).toBeInstanceOf(AbortSignal));bridge.abort();await decision;return {draftText:'unused'};
 };
 await expect(createStaffCopilotAssistance(actor,ticket,{revision:4},{...options(),runAgent:runner,generate:controlled})).rejects.toThrow('UNAVAILABLE');
 expect(observed?.aborted).toBe(true);
});
