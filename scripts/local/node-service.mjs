import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

/** IPC delivers the worker's existing stop signal in-process, including on Windows. */
export function installShutdownBridge(target=process){
 let stopping=false;
 const stop=()=>{if(!stopping){stopping=true;
  const attempt=()=>{if(target.listenerCount('SIGTERM')){target.emit('SIGTERM');return true;}return false;};
  if(!attempt()){const timer=setInterval(()=>{if(attempt())clearInterval(timer);},25);timer.unref();}
 }};
 target.on('message',message=>{if(message?.type==='local-stop')stop();});
 target.once('disconnect',stop);
 return stop;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const service=process.argv[2];
 const entries={INBOX:'scripts/worker.ts',AI:'scripts/ai-worker.ts',OUTBOX:'scripts/outbox-worker.ts',INCIDENT:'scripts/incident-worker.ts'};
 installShutdownBridge();
 try{
  if(service==='WEB'){
   const next=createRequire(import.meta.url).resolve('next/dist/bin/next');
   process.argv=[process.execPath,next,'dev','--hostname','127.0.0.1','--port',process.argv[3]];
   await import(pathToFileURL(next).href);
  }else if(entries[service]){
   await import(pathToFileURL(resolve(entries[service])).href);
   if(process.connected)process.disconnect();
  }else throw new Error('LOCAL_SERVICE_INVALID');
 }catch{
  console.error('LOCAL_SERVICE_FAILED');if(process.connected)process.disconnect();process.exitCode=1;
 }
}
