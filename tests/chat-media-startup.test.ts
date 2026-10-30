import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect,it,vi} from 'vitest';
import {workerObservationCodes} from '../lib/operations/worker-observations';

it('checks in MEDIA, runs one bounded cycle and flushes pending Inbox invalidations before exit',async()=>{
 vi.resetModules();
 const events:string[]=[],pool={end:vi.fn()};
 const createWorkerObserver=vi.fn((_pool:unknown,worker:string)=>async()=>{events.push(`observe:${worker}`);});
 const runChatMediaCycle=vi.fn(async()=>{events.push('cycle:MEDIA');return {claimed:1,completed:1,failed:0};});
 const flushInboxInvalidations=vi.fn(async()=>{events.push('flush:invalidations');});
 vi.doMock('dotenv/config',()=>({}));
 vi.doMock('../lib/database/pool',()=>({getDatabasePool:()=>pool}));
 vi.doMock('../lib/operations/worker-observations',()=>({createWorkerObserver}));
 vi.doMock('../lib/chat/media-worker',()=>({runChatMediaCycle}));
 vi.doMock('../lib/chat/realtime',()=>({flushInboxInvalidations}));
 vi.stubEnv('DATABASE_URL','postgres://fixture');vi.stubEnv('ENCRYPTION_KEY','fixture-encryption-key');
 const argv=[...process.argv],listeners={sigint:process.listeners('SIGINT'),sigterm:process.listeners('SIGTERM')},exitCode=process.exitCode;
 process.argv.push('--once');
 try{await import('../scripts/media-worker');}
 finally{
  process.argv.splice(0,process.argv.length,...argv);process.exitCode=exitCode;
  for(const listener of process.listeners('SIGINT'))if(!listeners.sigint.includes(listener))process.removeListener('SIGINT',listener);
  for(const listener of process.listeners('SIGTERM'))if(!listeners.sigterm.includes(listener))process.removeListener('SIGTERM',listener);
  for(const mockedModule of ['dotenv/config','../lib/database/pool','../lib/operations/worker-observations','../lib/chat/media-worker','../lib/chat/realtime'])vi.doUnmock(mockedModule);
  vi.unstubAllEnvs();vi.resetModules();
 }
 expect(createWorkerObserver).toHaveBeenCalledWith(pool,'MEDIA');
 expect(runChatMediaCycle).toHaveBeenCalledWith(pool,'fixture-encryption-key');
 expect(flushInboxInvalidations).toHaveBeenCalledWith(pool);
 expect(events).toEqual(['observe:MEDIA','cycle:MEDIA','flush:invalidations']);
 expect(pool.end).toHaveBeenCalledOnce();
 expect(workerObservationCodes).toContain('MEDIA');
});

it('routes the local MEDIA service entry to its worker script',async()=>{
 const projectRoot=fileURLToPath(new URL('..',import.meta.url));
 const fixtureRoot=mkdtempSync(join(projectRoot,'.media-node-service-'));
 let child:ChildProcess|undefined;
 try{
  mkdirSync(join(fixtureRoot,'scripts','local'),{recursive:true});
  mkdirSync(join(fixtureRoot,'scripts'),{recursive:true});
  writeFileSync(join(fixtureRoot,'scripts','local','node-service.mjs'),readFileSync(new URL('../scripts/local/node-service.mjs',import.meta.url)));
  writeFileSync(join(fixtureRoot,'scripts','media-worker.ts'),"process.send?.({type:'media-worker-started'});\n");
  child=spawn(process.execPath,['--import','tsx',join(fixtureRoot,'scripts','local','node-service.mjs'),'MEDIA'],{
   cwd:fixtureRoot,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true,
  });
  const exit= new Promise<number|null>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('MEDIA_CHILD_TIMEOUT')),5000);
   child!.once('exit',code=>{clearTimeout(timer);resolve(code);});
  });
  const started=new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('MEDIA_CHILD_MESSAGE_TIMEOUT')),5000);
   child!.on('message',message=>{
    if(message!==null&&typeof message==='object'&&'type'in message&&message.type==='media-worker-started'){
     clearTimeout(timer);resolve();
    }
   });
   child!.stderr?.on('data',chunk=>reject(new Error(`MEDIA_CHILD_FAILED:${String(chunk).slice(0,300)}`)));
  });
  await started;
  expect(await exit).toBe(0);
 }finally{
  if(child?.exitCode===null&&child.signalCode===null)child.kill();
  rmSync(fixtureRoot,{recursive:true,force:true});
 }
});

it('starts and waits for all five local worker check-ins, including MEDIA',()=>{
 const source=readFileSync(new URL('../scripts/local/run.mjs',import.meta.url),'utf8');
 const launched=source.match(/for\s*\(const name of \[([^\]]+)\]\)\s*launch\(name/);
 const observed=source.match(/return \[([^\]]+)\]\.every\(name=>rows\.some\(row=>row\.worker===name\)\)/);
 const names=(value:string|undefined)=>value?.match(/'([A-Z]+)'/gu)?.map(item=>item.slice(1,-1))??[];
 expect(names(launched?.[1])).toEqual(['INBOX','AI','OUTBOX','INCIDENT','MEDIA']);
 expect(names(observed?.[1])).toEqual(['INBOX','AI','OUTBOX','INCIDENT','MEDIA']);
 expect(source).toContain('verifyChatMediaStorage');
 expect(source).not.toContain('provisionChatMediaStorage(');
});
