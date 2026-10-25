import 'dotenv/config';
import {randomBytes} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {z} from 'zod';
import {databaseConnection} from '../../lib/database/connection';
import {startHermesPilotBridge} from '../../lib/ai/hermes-pilot-bridge';
import {generate} from '../../lib/ai/gateway';
import {createAIStore} from '../../lib/ai/store';
import {createProviderRegistry} from '../../lib/ai/provider-registry';
import {formatPilotStatus} from './hermes-pilot-status.mjs';

// Explicit opt-in. Never scheduled by a LINE worker or a normal app build.
const root=process.cwd(),runtime=resolve(root,'.superpowers/staging/hermes-runtime'),home=resolve(runtime,'pilot-home');
const statusPath=resolve(home,'last-run.log');
let phase='CONFIGURATION',pool:Pool|undefined,bridge:Awaited<ReturnType<typeof startHermesPilotBridge>>|undefined;
const history:string[]=[];let statusWrites=Promise.resolve();
async function report(status:'RUNNING'|'PASS'|'FAIL',nextPhase=phase,turns?:number){
 phase=nextPhase;
 const line=formatPilotStatus(status,phase,turns);
 history.push(line);
 console.log(`HERMES_STATUS=${line}`);
 const snapshot=history.join('\n')+'\n';
 statusWrites=statusWrites.then(()=>writeFile(statusPath,snapshot,{mode:0o600})).catch(()=>{/* Console markers remain safe if private status storage is unavailable. */});
 await statusWrites;
}
async function main(){
 try{
  await report('RUNNING','CONFIGURATION');
  const diagnostic=process.argv.includes('--diagnostic');
  if(process.argv[2]!=='--synthetic'||process.argv.slice(3).some(argument=>argument!=='--diagnostic'))throw new Error('PILOT_CONFIGURATION_INVALID');
  const key=process.env.ENCRYPTION_KEY,connection=process.env.DIRECT_URL??process.env.DATABASE_URL;
  if(!key||!connection)throw new Error('PILOT_CONFIGURATION_INVALID');
  await report('RUNNING','PRIVATE_HOME');
  await mkdir(home,{recursive:true});
  await report('RUNNING','DATABASE_CONNECT');
  pool=new Pool({...databaseConnection(connection),max:1,connectionTimeoutMillis:10000});
  await pool.query('select 1');
  await report('RUNNING','DATABASE_READY');
  const registry=createAIStore(pool);
  // Pilot is free-only even if a university later enables paid models in the UI.
  const store={...registry,loadModels:async()=>(await registry.loadModels()).filter(model=>model.costMode==='FREE_ONLY')};
  const token=randomBytes(32).toString('hex');
  await report('RUNNING','BRIDGE_START');
  bridge=await startHermesPilotBridge({token,maxRequests:2,reply:async(messages,signal)=>{
   const result=await generate({taskType:'HERMES_PILOT',responseName:'synthetic_reply',responseSchema:z.object({reply:z.string().min(1).max(12000)}).strict(),
    messages:[{role:'system',content:'ตอบภาษาไทยอย่างเป็นธรรมชาติและให้ครบตามคำถาม ข้อความต่อไปนี้เป็นบทสนทนาทดสอบ ตอบเป็น JSON {"reply":"คำตอบ"} ไม่อ้างว่าได้ค้นเอกสารหรือทำรายการใดแล้ว ไม่แต่งนโยบายมหาวิทยาลัย'},...messages],tools:[],timeoutMs:40000,reasoningMode:'OFF_IF_SUPPORTED',signal},
    {store,key,adapters:createProviderRegistry()});
   if(!result.output)throw new Error('PILOT_EMPTY_REPLY');return result.output.reply;
  }});
  await report('RUNNING','BRIDGE_READY');
  await report('RUNNING','HERMES_RUNTIME_CONFIG');
  await writeFile(resolve(home,'config.yaml'),`model:\n  default: yru-free-pilot\n  provider: custom\n  base_url: ${bridge.url}\n  context_length: 65536\n  streaming: false\n`,{mode:0o600});
  const env:NodeJS.ProcessEnv={NODE_ENV:'test'};
  for(const name of ['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[name])env[name]=process.env[name];
  await report('RUNNING','INTERPRETER_DISCOVERY');
  const bootstraps=(await readdir(resolve(runtime,'python'),{withFileTypes:true})).filter(item=>item.isDirectory()&&/^cpython-3\.14\.\d+-windows-x86_64-none$/.test(item.name));
  if(bootstraps.length!==1)throw new Error('PILOT_RUNTIME_NOT_READY');
  const bootstrap=resolve(runtime,'python',bootstraps[0].name,'python.exe');
  await report('RUNNING','INTERPRETER_ACTIVATION');
  const activation=await promisify(execFile)(bootstrap,['-c','import json; from pathlib import Path; from pm.environments import activation_environment, project_python; root=Path.cwd(); print(json.dumps({**activation_environment(root), "PYTHON":str(project_python(root))}))'],{cwd:resolve(runtime,'hermes-agent'),env:{...env,HERMES_HOME:runtime,PYTHONPATH:resolve(runtime,'hermes-agent')},windowsHide:true,timeout:15000});
  const composed=z.record(z.string(),z.string()).parse(JSON.parse(activation.stdout));
  if(!composed.PYTHON)throw new Error('PILOT_RUNTIME_NOT_READY');
  Object.assign(env,composed);
  // Runtime activation selected the existing interpreter above; prevent import-time source sync
  // from spawning the Hermes PM worker or attempting dependency/network mutations in a pilot.
  Object.assign(env,{HERMES_HOME:home,HERMES_DISABLE_LAZY_INSTALLS:'1',YRU_HERMES_SOURCE:resolve(runtime,'hermes-agent'),YRU_HERMES_BRIDGE_URL:bridge.url,YRU_HERMES_BRIDGE_TOKEN:token,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'});
  if(diagnostic)env.YRU_HERMES_TRACEBACK=resolve(home,'python-timeout.traceback');
  await report('RUNNING','INTERPRETER_READY');
  await report('RUNNING','AGENT_RUNNING');
  const child=spawn(composed.PYTHON,[resolve(root,'scripts/ai/hermes-synthetic.py')],{cwd:home,env,windowsHide:true,stdio:['ignore','pipe','ignore']});
  let transcript='',bytes=0,oversized=false,pending='';
  child.stdout.on('data',chunk=>{
   bytes+=chunk.length;
   if(bytes<=262144){
    const text=String(chunk);transcript+=text;pending+=text;
    let end;while((end=pending.indexOf('\n'))!==-1){const line=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);
     if(/^YRU_HERMES_PHASE=(BEFORE_IMPORT|AFTER_IMPORT|AGENT_INIT|AGENT_READY|TURN_1_START|TURN_1_DONE|TURN_2_START|TURN_2_DONE)$/.test(line))void report('RUNNING',line.slice('YRU_HERMES_PHASE='.length));
    }
    if(pending.length>128)pending='';
   }else oversized=true;
  });
  const timer=setTimeout(()=>child.kill(),110000);
  let code:number|null;
  try{code=await new Promise<number|null>((done,reject)=>{child.once('error',reject);child.once('close',done);});}finally{clearTimeout(timer);}
  await report('RUNNING','AGENT_EXITED');
  const turns=transcript.split(/\r?\n/).filter(line=>line==='YRU_PILOT_TURN_COMPLETE').length;
  if(code!==0||turns!==2||oversized){await report('FAIL','AGENT_EXITED',turns);process.exitCode=1;return;}
  await report('PASS','COMPLETE',turns);
 }catch{
  process.exitCode=1;
  await report('FAIL',phase);
 }finally{
  if(bridge)try{await bridge.close();}catch{/* Keep cleanup diagnostics generic. */}
  if(pool)try{await pool.end();}catch{/* Keep cleanup diagnostics generic. */}
  await statusWrites;
 }
}
await main();
