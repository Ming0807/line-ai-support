import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {recordWorkerObservation,createWorkerObserver} from '../lib/operations/worker-observations';

it('writes one fixed worker code without accepting a caller timestamp',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[],rowCount:1});
 await recordWorkerObservation({query} as unknown as Pool,'INBOX');
 expect(query).toHaveBeenCalledOnce();
 expect(query).toHaveBeenCalledWith(expect.any(String),['INBOX']);
});

it('rejects unsupported worker codes before touching the database',async()=>{
 const query=vi.fn();
 await expect(recordWorkerObservation({query} as unknown as Pool,'WEB' as never)).rejects.toThrow('WORKER_CODE_INVALID');
 expect(query).not.toHaveBeenCalled();
});

it('writes immediately then throttles repeated check-ins for thirty seconds',async()=>{
 let now=100;
 const query=vi.fn().mockResolvedValue({rows:[],rowCount:1});
 const observe=createWorkerObserver({query} as unknown as Pool,'OUTBOX',{now:()=>now});
 await observe();await observe();
 expect(query).toHaveBeenCalledOnce();
 now+=29_999;await observe();expect(query).toHaveBeenCalledOnce();
 now+=1;await observe();expect(query).toHaveBeenCalledTimes(2);
});

it('keeps check-in failures out of the worker loop and logs only a fixed code',async()=>{
 let now=0;
 const query=vi.fn().mockRejectedValue(new Error('private connection string'));
 const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);
 const observe=createWorkerObserver({query} as unknown as Pool,'AI',{now:()=>now});
 await expect(observe()).resolves.toBeUndefined();
 expect(log).toHaveBeenCalledExactlyOnceWith('WORKER_OBSERVATION_FAILED');
 now+=29_999;await observe();expect(query).toHaveBeenCalledOnce();
 now+=1;await observe();expect(query).toHaveBeenCalledTimes(2);
 expect(JSON.stringify(log.mock.calls)).not.toContain('private connection string');
 log.mockRestore();
});

it('checks in before each enabled AI worker cycle, including --once',async()=>{
 vi.resetModules();
 const events:string[]=[],pool={end:vi.fn()};
 const createWorkerObserver=vi.fn((_pool:unknown,worker:string)=>async()=>{events.push(`observe:${worker}`);});
 vi.doMock('dotenv/config',()=>({}));
 vi.doMock('../lib/operations/worker-observations',()=>({createWorkerObserver}));
 vi.doMock('../lib/database/pool',()=>({getDatabasePool:()=>pool}));
 vi.doMock('../lib/ai/run-worker',()=>({runAICycle:async()=>{events.push('cycle:AI');return {claimed:1,failed:0};}}));
 vi.doMock('../lib/knowledge/configured',()=>({createConfiguredKnowledgeProducer:()=>async()=>({})}));
 vi.stubEnv('YRU_AI_ENABLED','true');vi.stubEnv('ENCRYPTION_KEY','test-key');vi.stubEnv('DATABASE_URL','postgres://localhost/test');
 const argv=[...process.argv],sigint=process.listeners('SIGINT'),sigterm=process.listeners('SIGTERM');process.argv.push('--once');
 try{await import('../scripts/ai-worker');}
 finally{
  process.argv.splice(0,process.argv.length,...argv);
  for(const listener of process.listeners('SIGINT'))if(!sigint.includes(listener))process.removeListener('SIGINT',listener);
  for(const listener of process.listeners('SIGTERM'))if(!sigterm.includes(listener))process.removeListener('SIGTERM',listener);
  for(const mockedModule of ['dotenv/config','../lib/operations/worker-observations','../lib/database/pool','../lib/ai/run-worker','../lib/knowledge/configured'])vi.doUnmock(mockedModule);
  vi.unstubAllEnvs();vi.resetModules();
 }
 expect(createWorkerObserver).toHaveBeenCalledWith(pool,'AI');
 expect(events).toEqual(['observe:AI','cycle:AI']);
 expect(pool.end).toHaveBeenCalledOnce();
});

it('does not create a check-in when the AI worker is disabled',async()=>{
 vi.resetModules();
 const pool={end:vi.fn()},getDatabasePool=vi.fn(()=>pool),createWorkerObserver=vi.fn();
 vi.doMock('dotenv/config',()=>({}));
 vi.doMock('../lib/operations/worker-observations',()=>({createWorkerObserver}));
 vi.doMock('../lib/database/pool',()=>({getDatabasePool}));
 vi.doMock('../lib/ai/run-worker',()=>({runAICycle:vi.fn()}));
 vi.doMock('../lib/knowledge/configured',()=>({createConfiguredKnowledgeProducer:vi.fn()}));
 vi.stubEnv('YRU_AI_ENABLED','false');vi.stubEnv('ENCRYPTION_KEY','');vi.stubEnv('DATABASE_URL','');
 const argv=[...process.argv];process.argv.push('--once');
 try{await import('../scripts/ai-worker');}
 finally{
  process.argv.splice(0,process.argv.length,...argv);
  for(const mockedModule of ['dotenv/config','../lib/operations/worker-observations','../lib/database/pool','../lib/ai/run-worker','../lib/knowledge/configured'])vi.doUnmock(mockedModule);
  vi.unstubAllEnvs();vi.resetModules();
 }
 expect(createWorkerObserver).not.toHaveBeenCalled();expect(getDatabasePool).not.toHaveBeenCalled();
});

it('checks in before each outbox worker cycle, including --once',async()=>{
 vi.resetModules();
 const events:string[]=[],pool={end:vi.fn()},createWorkerObserver=vi.fn((_pool:unknown,worker:string)=>async()=>{events.push(`observe:${worker}`);});
 vi.doMock('dotenv/config',()=>({}));
 vi.doMock('pg',()=>({Pool:class{constructor(){return pool;}}}));
 vi.doMock('../lib/database/connection',()=>({databaseConnection:()=>({})}));
 vi.doMock('../lib/operations/worker-observations',()=>({createWorkerObserver}));
 vi.doMock('../lib/queue/run-outbox',()=>({runOutboxCycle:async()=>{events.push('cycle:OUTBOX');return {claimed:1,failed:0};}}));
 vi.stubEnv('DIRECT_URL','postgres://postgres:postgres@localhost:5432/yru');vi.stubEnv('ENCRYPTION_KEY','test-key');
 const argv=[...process.argv],sigint=process.listeners('SIGINT'),sigterm=process.listeners('SIGTERM');process.argv.push('--once');
 try{await import('../scripts/outbox-worker');}
 finally{
  process.argv.splice(0,process.argv.length,...argv);
  for(const listener of process.listeners('SIGINT'))if(!sigint.includes(listener))process.removeListener('SIGINT',listener);
  for(const listener of process.listeners('SIGTERM'))if(!sigterm.includes(listener))process.removeListener('SIGTERM',listener);
  for(const mockedModule of ['dotenv/config','pg','../lib/database/connection','../lib/operations/worker-observations','../lib/queue/run-outbox'])vi.doUnmock(mockedModule);
  vi.unstubAllEnvs();vi.resetModules();
 }
 expect(createWorkerObserver).toHaveBeenCalledWith(pool,'OUTBOX');
 expect(events).toEqual(['observe:OUTBOX','cycle:OUTBOX']);
 expect(pool.end).toHaveBeenCalledOnce();
});

it('checks in before each inbox worker cycle, including --once',async()=>{
 vi.resetModules();
 const events:string[]=[],pool={end:vi.fn()},createWorkerObserver=vi.fn((_pool:unknown,worker:string)=>async()=>{events.push(`observe:${worker}`);});
 vi.doMock('dotenv/config',()=>({}));
 vi.doMock('../lib/operations/worker-observations',()=>({createWorkerObserver}));
 vi.doMock('../lib/database/pool',()=>({getDatabasePool:()=>pool}));
 vi.doMock('../lib/queue/run-inbox',()=>({runInboxCycle:async()=>{events.push('cycle:INBOX');return {claimed:1,failed:0};}}));
 vi.doMock('../lib/conversation/semantic-routing-provider',()=>({createSemanticRoutingClassifier:vi.fn()}));
 vi.doMock('../lib/ai/gateway',()=>({generate:vi.fn()}));
 vi.doMock('../lib/ai/store',()=>({createAIStore:vi.fn()}));
 vi.doMock('../lib/ai/provider-registry',()=>({createProviderRegistry:vi.fn()}));
 vi.doMock('../lib/ai/pricing',()=>({createPriceReader:vi.fn()}));
 vi.stubEnv('YRU_AI_ENABLED','false');vi.stubEnv('ENCRYPTION_KEY','test-key');vi.stubEnv('DATABASE_URL','postgres://localhost/test');
 const argv=[...process.argv],sigint=process.listeners('SIGINT'),sigterm=process.listeners('SIGTERM');process.argv.push('--once');
 try{await import('../scripts/worker');}
 finally{
  process.argv.splice(0,process.argv.length,...argv);
  for(const listener of process.listeners('SIGINT'))if(!sigint.includes(listener))process.removeListener('SIGINT',listener);
  for(const listener of process.listeners('SIGTERM'))if(!sigterm.includes(listener))process.removeListener('SIGTERM',listener);
  for(const mockedModule of ['dotenv/config','../lib/operations/worker-observations','../lib/database/pool','../lib/queue/run-inbox','../lib/conversation/semantic-routing-provider','../lib/ai/gateway','../lib/ai/store','../lib/ai/provider-registry','../lib/ai/pricing'])vi.doUnmock(mockedModule);
  vi.unstubAllEnvs();vi.resetModules();
 }
 expect(createWorkerObserver).toHaveBeenCalledWith(pool,'INBOX');
 expect(events).toEqual(['observe:INBOX','cycle:INBOX']);
 expect(pool.end).toHaveBeenCalledOnce();
});

it('checks in before each incident worker cycle, including --once',async()=>{
 vi.resetModules();
 const events:string[]=[],pool={end:vi.fn()},createWorkerObserver=vi.fn((_pool:unknown,worker:string)=>async()=>{events.push(`observe:${worker}`);});
 const embedding={embedPassages:vi.fn(async()=>[[0.1,0.2]])};
 vi.doMock('dotenv/config',()=>({}));
 vi.doMock('../lib/operations/worker-observations',()=>({createWorkerObserver}));
 vi.doMock('../lib/database/pool',()=>({getDatabasePool:()=>pool}));
 vi.doMock('../lib/knowledge/embedding-client',()=>({createLocalE5EmbeddingProvider:()=>embedding}));
 vi.doMock('../lib/incidents/worker',()=>({runIncidentCycle:async()=>{events.push('cycle:INCIDENT');return {claimed:1,failed:0};}}));
 const argv=[...process.argv],sigint=process.listeners('SIGINT'),sigterm=process.listeners('SIGTERM');process.argv.push('--once');
 try{await import('../scripts/incident-worker');}
 finally{
  process.argv.splice(0,process.argv.length,...argv);
  for(const listener of process.listeners('SIGINT'))if(!sigint.includes(listener))process.removeListener('SIGINT',listener);
  for(const listener of process.listeners('SIGTERM'))if(!sigterm.includes(listener))process.removeListener('SIGTERM',listener);
  for(const mockedModule of ['dotenv/config','../lib/operations/worker-observations','../lib/database/pool','../lib/knowledge/embedding-client','../lib/incidents/worker'])vi.doUnmock(mockedModule);
  vi.unstubAllEnvs();vi.resetModules();
 }
 expect(createWorkerObserver).toHaveBeenCalledWith(pool,'INCIDENT');
 expect(events).toEqual(['observe:INCIDENT','cycle:INCIDENT']);
 expect(pool.end).toHaveBeenCalledOnce();
});
