import {readFile} from 'node:fs/promises';
import {describe,expect,it,vi} from 'vitest';
import {
 capturePinnedGenerationModel,
 createHermesKnowledgeTool,
 createPinnedGenerate,
 modelsForPinnedGeneration,
 parseCopilotArguments,
} from '../scripts/ai/hermes-copilot-tools';
import {canMarkCopilotSmokePass,formatCopilotFailure,formatCopilotStatus} from '../scripts/ai/hermes-copilot-status.mjs';
import type {AIModelConfig} from '../lib/ai/types';

const staff='6bd1b62e-8f8a-4b9f-8d1f-e35f3f2a5b34';
const ticket='f7860434-44a7-4a65-93dd-c3475cde09a1';

function model(overrides:Partial<AIModelConfig>={}):AIModelConfig{
 return {id:'b634e81d-b87a-4b4a-92b2-d5f80e36dc22',providerId:'9c1757bd-af87-4632-96b2-a0f62dc655f4',
  adapter:'ZEN',modelId:'free-model',baseUrl:'https://gateway.example/v1',apiKeyEncrypted:'encrypted',
  providerRevision:2,modelRevision:3,providerNetworkRevision:4,modelNetworkRevision:5,
  providerPriority:1,priority:1,timeoutMs:15000,supportsJson:true,supportsTools:true,costMode:'FREE_ONLY',
  inputPricePerMillion:null,outputPricePerMillion:null,...overrides};
}

describe('Hermes copilot pilot safety contract',()=>{
 it('accepts only the explicit copilot, staff, ticket and nonnegative revision arguments',()=>{
  expect(parseCopilotArguments(['--copilot',`--staff-id=${staff}`,`--ticket-id=${ticket}`,'--revision=0']))
   .toEqual({staffId:staff,ticketId:ticket,revision:0});
  for(const args of [[],['--copilot',`--staff-id=${staff}`,`--ticket-id=${ticket}`,'--revision=-1'],
   ['--copilot',`--staff-id=${staff}`,`--ticket-id=${ticket}`,'--revision=1.5'],
   ['--copilot',`--staff-id=${staff}`,`--ticket-id=${ticket}`,'--revision=1','--database-url=postgres://secret'],
   ['--copilot',`--staff-id=${staff}`,`--staff-id=${staff}`,`--ticket-id=${ticket}`,'--revision=1'],
   ['--copilot',`--staff-id=not-a-uuid`,`--ticket-id=${ticket}`,'--revision=1']]){
   expect(()=>parseCopilotArguments(args)).toThrow('PILOT_CONFIGURATION_INVALID');
  }
 });

 it('captures one enabled FREE_ONLY JSON model and exposes only that model to every gateway call',async()=>{
  const selected=model({supportsTools:false});
  const pin=capturePinnedGenerationModel([
   model({id:'a0135f76-32de-47c7-b66c-0cef4103280f',costMode:'ALLOW_PAID'}),
   model({id:'3cb18240-7b3f-4648-98a6-1318b390befa',supportsJson:false}),selected,
  ]);
  const store={loadModels:vi.fn(async()=>[selected,model({id:'0b1ac432-a9d9-4635-a9f9-5c02fbaf0837'})]),recordAttempt:vi.fn(async()=>{})};
  const available=await modelsForPinnedGeneration(store.loadModels,pin);
  expect(available).toEqual([selected]);
  expect(pin).toMatchObject({id:selected.id,providerId:selected.providerId,providerRevision:2,modelRevision:3,
   providerNetworkRevision:4,modelNetworkRevision:5});
  await expect(modelsForPinnedGeneration(async()=>[model({...selected,modelNetworkRevision:6})],pin))
   .rejects.toThrow('PINNED_MODEL_DRIFT');
  await expect(modelsForPinnedGeneration(async()=>[],pin)).rejects.toThrow('PINNED_MODEL_DRIFT');

  const gateway=vi.fn(async(_input:unknown,options:{store:{loadModels:()=>Promise<AIModelConfig[]>}})=>{
   await options.store.loadModels();
   return {output:{answer:'ok'},toolCalls:[],providerId:selected.providerId,modelId:selected.id,fallbackUsed:false};
  });
  const generate=createPinnedGenerate({pin,loadModels:store.loadModels,store,key:'synthetic-key',adapters:{},gateway:gateway as never});
  const request={taskType:'HERMES_COPILOT',messages:[{role:'user' as const,content:'synthetic'}],
   responseSchema:{safeParse:()=>({success:true,data:{answer:'ok'}})} as never,responseName:'pilot',tools:[]};
  await generate(request);
  expect(gateway).toHaveBeenCalledOnce();
  const fallback=createPinnedGenerate({pin,loadModels:store.loadModels,store,key:'synthetic-key',adapters:{},
   gateway:vi.fn(async()=>({output:{answer:'ok'},toolCalls:[],providerId:selected.providerId,modelId:selected.id,fallbackUsed:true})) as never});
  await expect(fallback(request)).rejects.toThrow('PINNED_MODEL_DRIFT');
  await expect(modelsForPinnedGeneration(async()=>[model({...selected,providerRevision:3})],pin))
   .rejects.toThrow('PINNED_MODEL_DRIFT');
 });

 it('checks authorized ticket snapshots before, during and after the tool and never substitutes Hermes query for the ticket question',async()=>{
  const question='นักศึกษาถามถึงขั้นตอนลงทะเบียนอุปกรณ์';
  const snapshot={digest:'a'.repeat(64),revision:7,knowledge:{question}};
  const readSnapshot=vi.fn(async()=>snapshot);
  const assist=vi.fn(async()=>({revision:7,status:'VERIFIED',answer:'คำตอบมีหลักฐาน',draftText:'ร่างพร้อมอ้างอิง',
   sources:[{title:'คู่มือทางการ',academicYear:2569,url:'https://yru.ac.th/guide',location:'หน้า 2'}]}));
  const pilot=await createHermesKnowledgeTool({actorId:staff,ticketId:ticket,revision:7,
   readSnapshot,assist,pool:{} as never,key:'synthetic-key',generate:vi.fn() as never});
  const result=await pilot.tool.execute({query:'คำค้นเสริมที่ไม่ใช่คำถามนักศึกษา'},new AbortController().signal);
  expect(readSnapshot).toHaveBeenCalledTimes(3); // initial, immediately before service, and final freshness check
  expect(assist).toHaveBeenCalledWith(staff,ticket,{revision:7},expect.objectContaining({pool:expect.anything(),
   key:'synthetic-key',signal:expect.any(AbortSignal),generate:expect.any(Function)}));
  expect(result).toMatchObject({boundStudentQuestion:question,
   supplementalSearchQuery:{value:'คำค้นเสริมที่ไม่ใช่คำถามนักศึกษา',replacesBoundQuestion:false},advice:{status:'VERIFIED'}});
  expect(pilot.hasVerifiedSourceUse()).toBe(true);
  await pilot.assertCurrent();
 });

 it('denies the injected service when ticket authorization or freshness check fails',async()=>{
  const question='คำถามที่ผูกกับ ticket';
  const readSnapshot=vi.fn().mockResolvedValueOnce({digest:'b'.repeat(64),revision:1,knowledge:{question}})
   .mockRejectedValueOnce(new Error('PRIVATE_DATABASE_DIAGNOSTIC'));
  const assist=vi.fn();
  const pilot=await createHermesKnowledgeTool({actorId:staff,ticketId:ticket,revision:1,readSnapshot,assist,
   pool:{} as never,key:'synthetic-key',generate:vi.fn() as never});
  await expect(pilot.tool.execute({query:'supplemental'},new AbortController().signal)).rejects.toThrow();
  expect(assist).not.toHaveBeenCalled();
  expect(pilot.hasVerifiedSourceUse()).toBe(false);
 });

 it('does not expose advice or smoke-pass when the injected staff service denies the ticket',async()=>{
  const snapshot={digest:'e'.repeat(64),revision:4,knowledge:{question:'Bound ticket question'}};
  const readSnapshot=vi.fn(async()=>snapshot);
  const assist=vi.fn(async()=>{throw new Error('NOT_FOUND');});
  const pilot=await createHermesKnowledgeTool({actorId:staff,ticketId:ticket,revision:4,readSnapshot,assist,
   pool:{} as never,key:'synthetic-key',generate:vi.fn() as never});
  await expect(pilot.tool.execute({query:'supplemental'},new AbortController().signal)).rejects.toThrow('NOT_FOUND');
  expect(pilot.hasVerifiedSourceUse()).toBe(false);
  expect(canMarkCopilotSmokePass({exitCode:0,turns:1,verifiedSourceToolUsed:pilot.hasVerifiedSourceUse(),oversized:false,timedOut:false})).toBe(false);
 });

 it('rejects verified advice if the authorized ticket snapshot changes before the tool result is returned',async()=>{
  const snapshot={digest:'f'.repeat(64),revision:5,knowledge:{question:'Bound ticket question'}};
  const changed={...snapshot,digest:'0'.repeat(64)};
  const readSnapshot=vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot).mockResolvedValueOnce(changed);
  const assist=vi.fn(async()=>({revision:5,status:'VERIFIED',answer:'คำตอบ',draftText:'ร่าง',
   sources:[{title:'คู่มือ',academicYear:null,url:'https://yru.ac.th/guide',location:null}]}));
  const pilot=await createHermesKnowledgeTool({actorId:staff,ticketId:ticket,revision:5,readSnapshot,assist,
   pool:{} as never,key:'synthetic-key',generate:vi.fn() as never});
  await expect(pilot.tool.execute({query:'supplemental'},new AbortController().signal)).rejects.toThrow('PILOT_TICKET_CHANGED');
  expect(pilot.hasVerifiedSourceUse()).toBe(false);
 });

 it('does not count a completed tool response without VERIFIED sources as source evidence',async()=>{
  const readSnapshot=vi.fn(async()=>({digest:'c'.repeat(64),revision:2,knowledge:{question:'Bound ticket question'}}));
  const assist=vi.fn(async()=>({revision:2,status:'NOT_VERIFIED',answer:'ยังยืนยันไม่ได้',draftText:null,sources:[]}));
  const pilot=await createHermesKnowledgeTool({actorId:staff,ticketId:ticket,revision:2,readSnapshot,assist,
   pool:{} as never,key:'synthetic-key',generate:vi.fn() as never});
  await pilot.tool.execute({query:'supplemental'},new AbortController().signal);
  expect(pilot.hasVerifiedSourceUse()).toBe(false);
  expect(canMarkCopilotSmokePass({exitCode:0,turns:1,verifiedSourceToolUsed:pilot.hasVerifiedSourceUse(),oversized:false,timedOut:false})).toBe(false);
 });

 it('retains every validated source DTO and fails closed instead of silently clipping citations',async()=>{
  const sources=Array.from({length:5},(_,index)=>({title:`คู่มือ ${index+1}`,academicYear:2569,
   url:`https://yru.ac.th/guide-${index+1}`,location:`หน้า ${index+1}`}));
  const pilot=await createHermesKnowledgeTool({actorId:staff,ticketId:ticket,revision:3,
   readSnapshot:async()=>({digest:'d'.repeat(64),revision:3,knowledge:{question:'Bound ticket question'}}),
   assist:async()=>({revision:3,status:'VERIFIED',answer:'คำตอบที่ยืนยันแล้ว',draftText:'ร่าง',sources}),
   pool:{} as never,key:'synthetic-key',generate:vi.fn() as never});
  const result=await pilot.tool.execute({query:'supplemental'},new AbortController().signal) as {advice:{sources:unknown[]}};
  expect(result.advice.sources).toEqual(sources);
 });

 it('requires completed turn plus a successful VERIFIED source DTO before smoke PASS',()=>{
  expect(canMarkCopilotSmokePass({exitCode:0,turns:1,verifiedSourceToolUsed:true,oversized:false,timedOut:false})).toBe(true);
  expect(canMarkCopilotSmokePass({exitCode:0,turns:1,verifiedSourceToolUsed:false,oversized:false,timedOut:false})).toBe(false);
  expect(canMarkCopilotSmokePass({exitCode:0,turns:1,verifiedSourceToolUsed:true,oversized:false,timedOut:true})).toBe(false);
  expect(()=>formatCopilotStatus('PASS','COMPLETE',1,false)).toThrow('PILOT_STATUS_INVALID');
  const status=JSON.parse(formatCopilotStatus('PASS','COMPLETE',1,true));
  expect(status).toMatchObject({classification:'PROTOTYPE_SMOKE_ONLY',contentReview:'UNREVIEWED'});
 });

 it('uses generic failure diagnostics and the pilot contains no direct knowledge-document SQL',async()=>{
  expect(formatCopilotFailure(new Error('PRIVATE STDERR provider body'))).toBe('HERMES_PILOT_FAILED');
  expect(formatCopilotFailure(new Error('PRIVATE STDERR provider body'))).not.toContain('PRIVATE STDERR');
  const source=await readFile(new URL('../scripts/ai/hermes-copilot-pilot.ts',import.meta.url),'utf8');
  const python=await readFile(new URL('../scripts/ai/hermes-copilot.py',import.meta.url),'utf8');
  const tools=await readFile(new URL('../scripts/ai/hermes-copilot-tools.ts',import.meta.url),'utf8');
  expect(source).not.toMatch(/(?:pool|client)\.query\s*\(/u);
  expect(source).not.toMatch(/(?:from|join)\s+public\.(?:documents|knowledge_chunks)/iu);
  expect(source).not.toMatch(/stderrTail|COPILOT_DRIVER_STDERR/u);
  expect(source).toContain("process.env.YRU_AI_ENABLED!=='true'");
  expect(tools).not.toMatch(/(?:pool|client)\.query\s*\(/u);
  expect(tools).not.toMatch(/(?:from|join)\s+public\.(?:documents|knowledge_chunks)/iu);
  expect(python).not.toContain('passport.yru.ac.th');
  expect(python).toContain('actual successful tool use and VERIFIED source DTOs');
 });
});
