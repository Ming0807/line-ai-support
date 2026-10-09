import {spawn} from 'node:child_process';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,appendFileSync,mkdirSync,openSync,closeSync,unlinkSync,readdirSync,realpathSync} from 'node:fs';
import {createServer} from 'node:http';
import {createServer as createSocket} from 'node:net';
import {delimiter,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import dotenv from 'dotenv';
import pg from 'pg';
import {databaseConnection} from '../../lib/database/connection.ts';
import {structuredInfrastructureReady} from '../../lib/knowledge/structured-readiness.ts';
import {buildSessionEnvironment,parseArguments,redactLine,validateEmbeddingHealth,REVISION} from './config.mjs';

const root=realpathSync(resolve(fileURLToPath(new URL('../..',import.meta.url))));
const require=createRequire(import.meta.url);
const nextEnvironment=createRequire(require.resolve('next/package.json'))('@next/env');
process.chdir(root);
const folder=join(root,'.superpowers/staging/local-test'),lockFile=join(folder,'runner.lock'),stateFile=join(folder,'state.json');
const children=new Map();let stopping=false,lockOwned=false,control,logFile,logBytes=0,sessionEnv={},state={},stopPromise,phase='CONFIG';
const runId=randomBytes(16).toString('hex'),token=randomBytes(32).toString('hex');
const maxLogBytes=10*1024*1024;
function log(name,text){
 if(name==='TUNNEL'&&!/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b|\bERR\b|\bWRN\b|verification/i.test(text))return;
 const safe=`[${name}] ${redactLine(text,sessionEnv)}`;
 console.log(safe);
 if(logFile&&logBytes+Buffer.byteLength(safe)<maxLogBytes){appendFileSync(logFile,safe+'\n');logBytes+=Buffer.byteLength(safe)+1;}
}
function persist(){if(lockOwned)writeFileSync(stateFile,JSON.stringify({...state,root,runId,pid:process.pid,token,
 services:[...children].map(([name,child])=>({name,pid:child.pid,running:active(child)}))}),{mode:0o600});}
function pipeLines(stream,name,onLine){
 const decoder=new StringDecoder('utf8');let pending='',omitted=false;
 stream.on('data',chunk=>{
  pending+=decoder.write(chunk);let end;
  while((end=pending.indexOf('\n'))!==-1){const line=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);
   if(!omitted&&line.length<65536){onLine?.(line);log(name,line);}else log(name,'Oversized output omitted');omitted=false;
  }
  if(pending.length>=65536){pending='';omitted=true;}
 });
 stream.on('end',()=>{pending+=decoder.end();if(pending&&!omitted&&pending.length<65536){onLine?.(pending);log(name,pending);}});
}
function launch(name,command,args,env,ipc=false,onLine){
 if(stopping)throw new Error('LOCAL_STOPPING');
 const child=spawn(command,args,{cwd:root,env,windowsHide:true,stdio:ipc?['ignore','pipe','pipe','ipc']:['ignore','pipe','pipe']});
 children.set(name,child);pipeLines(child.stdout,name,onLine);pipeLines(child.stderr,name,onLine);persist();
 child.once('error',()=>{log(name,'LOCAL_PROCESS_START_FAILED');if(!stopping)void shutdown(1);});
 child.once('exit',(code,signal)=>{
  log(name,`Stopped (${code??signal??'unknown'})`);
  if(!stopping){log('LOCAL',`${name} exited; stopping this session`);void shutdown(1);}
 });
 return child;
}
function active(child){return Boolean(child.pid)&&child.exitCode===null&&child.signalCode===null;}
async function forceStop(child){
 if(!active(child)||!child.pid)return;
 if(process.platform==='win32')await new Promise(done=>{
  const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',done);killer.once('exit',done);
 });else child.kill('SIGKILL');
}
function shutdown(code=0){
 if(stopPromise)return stopPromise;
 stopping=true;process.exitCode=code;state.status='STOPPING';persist();
 stopPromise=(async()=>{
  log('LOCAL','Stopping only services created by this session; waiting for workers to close');
  for(const name of ['TUNNEL','INBOX','INCIDENT','AI','OUTBOX','WEB','E5']){
   const child=children.get(name);if(!child||!active(child))continue;
   if(child.connected)child.send({type:'local-stop'},()=>{});else child.kill('SIGTERM');
  }
  const deadline=Date.now()+90_000;
  while([...children.values()].some(active)&&Date.now()<deadline)await delay(200);
  for(const [name,child]of children)if(active(child)){log(name,'Grace period ended; stopping exact owned process tree');await forceStop(child);}
  if(control)await new Promise(done=>control.close(done));
  if(lockOwned){
   if(existsSync(stateFile)&&JSON.parse(readFileSync(stateFile,'utf8')).runId===runId)unlinkSync(stateFile);
   if(existsSync(lockFile)&&JSON.parse(readFileSync(lockFile,'utf8')).runId===runId)unlinkSync(lockFile);
   lockOwned=false;
  }
  log('LOCAL','Session stopped');
 })();return stopPromise;
}
async function portAvailable(port,host='127.0.0.1'){
 return new Promise(done=>{const server=createSocket();server.once('error',()=>done(false));server.listen(port,host,()=>server.close(()=>done(true)));});
}
async function waitFor(label,work,timeout=90_000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){if(stopping)throw new Error('LOCAL_STOPPING');try{const result=await work();if(result)return result;}catch{/* Fixed outer diagnostic, no remote error/body disclosure. */}await delay(700);}
 throw new Error(`LOCAL_${label}_TIMEOUT`);
}
function findCloudflared(){
 const paths=process.env.PATH?.split(delimiter)??[];
 for(const directory of paths){const path=join(directory.replace(/^"|"$/g,''),process.platform==='win32'?'cloudflared.exe':'cloudflared');if(existsSync(path))return path;}
 throw new Error('LOCAL_CLOUDFLARED_MISSING');
}
function checkCache(service){
 const cache=realpathSync(service.EMBEDDING_MODEL_CACHE_DIR),snapshot=join(cache,'hub/models--intfloat--multilingual-e5-small/snapshots',REVISION);
 for(const file of ['config.json','modules.json','model.safetensors','tokenizer.json','1_Pooling/config.json']){
  const target=realpathSync(join(snapshot,file)),rel=relative(cache,target);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('LOCAL_EMBEDDING_CACHE_INVALID');
 }
}
async function databaseCheck(env){
 const pool=new pg.Pool({...databaseConnection(env.DIRECT_URL),max:1});
 const runtimePool=new pg.Pool({...databaseConnection(env.DATABASE_URL),max:1});
 try{
  await runtimePool.query('select 1');
  const expected=readdirSync(join(root,'supabase/migrations')).filter(file=>file.endsWith('.sql')).map(file=>file.split('_')[0]).sort();
  const versions=(await pool.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(row=>row.version);
  if(JSON.stringify(expected)!==JSON.stringify(versions))throw new Error('LOCAL_MIGRATION_HISTORY_MISMATCH');
  if(!await structuredInfrastructureReady(pool))throw new Error('LOCAL_STRUCTURED_NOT_READY');
  const rls=(await pool.query("select count(*)::int tables,bool_and(rowsecurity) enabled from pg_tables where schemaname in ('public','private')")).rows[0];
  if(!rls.enabled)throw new Error('LOCAL_RLS_NOT_READY');
  const counts=(await pool.query(`select (select count(*)::int from private.ai_models m join private.ai_providers p on p.id=m.provider_id where p.enabled and m.enabled and m.purpose='GENERATION') models,
   (select count(*)::int from private.ai_providers where enabled and cost_mode<>'FREE_ONLY') paid,
   (select count(*)::int from public.documents where approval_status='APPROVED' and visibility='PUBLIC') documents`)).rows[0];
  if(counts.paid)throw new Error('LOCAL_FREE_ONLY_REQUIRED');
  log('CHECK',`Development DB: ${versions.length} migrations, ${rls.tables} RLS tables, Structured ready`);
  log('CHECK',`Enabled generation models: ${counts.models}; approved PUBLIC documents: ${counts.documents}`);
  if(!counts.models)log('SETUP','Configure and test free generation models in Providers before sending AI questions');
  if(!counts.documents)log('SETUP','Review and approve PUBLIC documents in Knowledge before asking source-based questions');
 }finally{await Promise.all([pool.end(),runtimePool.end()]);}
}
async function checkEmbedding(env){
 const response=await fetch(env.EMBEDDING_API_URL+'/health',{headers:env.EMBEDDING_API_KEY?{Authorization:`Bearer ${env.EMBEDDING_API_KEY}`}:{},signal:AbortSignal.timeout(2000)});
 return response.ok&&validateEmbeddingHealth(await response.json());
}
async function workerObservations(since){
 const pool=new pg.Pool({...databaseConnection(sessionEnv.DIRECT_URL),max:1});
 try{
  const rows=(await pool.query('select worker from private.worker_observations where observed_at>=$1',[since])).rows;
  return ['INBOX','AI','OUTBOX','INCIDENT'].every(name=>rows.some(row=>row.worker===name));
 }finally{await pool.end();}
}
async function smokeWeb(base,env){
 const login=await fetch(base+'/login',{signal:AbortSignal.timeout(15_000)});if(login.status!==200)return false;
 const body='{"events":[]}';
 for(const channel of ['STUDENT','STAFF']){
  const url=`${base}/api/line/${channel.toLowerCase()}/webhook`;
  const valid=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':createHmac('sha256',env[`LINE_${channel}_CHANNEL_SECRET`].trim()).update(body).digest('base64')},body,signal:AbortSignal.timeout(15_000)});
  if(valid.status!==200)return false;
  const invalid=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':'invalid'},body,signal:AbortSignal.timeout(5000)});
  if(invalid.status!==401)return false;
 }
 return true;
}
async function stopExisting(){
 if(!existsSync(stateFile)){console.log('[LOCAL] No active local-test session');return;}
 const saved=JSON.parse(readFileSync(stateFile,'utf8'));
 if(saved.root!==root||!Number.isInteger(saved.controlPort)||saved.controlPort<1||saved.controlPort>65535||!/^[a-f0-9]{64}$/.test(saved.token))throw new Error('LOCAL_CONTROL_STATE_INVALID');
 const response=await fetch(`http://127.0.0.1:${saved.controlPort}/stop`,{method:'POST',headers:{Authorization:`Bearer ${saved.token}`},signal:AbortSignal.timeout(3000)});
 if(response.status!==202)throw new Error('LOCAL_STOP_FAILED');
 console.log('[LOCAL] Stop requested; workers finish their current cycle');
}
async function acquire(){
 mkdirSync(folder,{recursive:true});
 if(existsSync(lockFile)){
  const old=JSON.parse(readFileSync(lockFile,'utf8'));
  if(old.root!==root||!Number.isInteger(old.pid)||old.pid<1)throw new Error('LOCAL_LOCK_INVALID');
  let alive=true;try{process.kill(old.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
  if(alive)throw new Error('LOCAL_SESSION_ALREADY_RUNNING');
  unlinkSync(lockFile);
 }
 const fd=openSync(lockFile,'wx',0o600);writeFileSync(fd,JSON.stringify({root,pid:process.pid,runId}));closeSync(fd);lockOwned=true;
 logFile=join(folder,`run-${new Date().toISOString().replace(/[:.]/g,'-')}.log`);
 control=createServer((request,response)=>{
  const auth=Buffer.from(request.headers.authorization??''),expected=Buffer.from('Bearer '+token);
  if(auth.length!==expected.length||!timingSafeEqual(auth,expected)){response.writeHead(403).end();return;}
  if(request.method==='POST'&&request.url==='/stop'){response.writeHead(202).end();setImmediate(()=>void shutdown());return;}
  response.writeHead(404).end();
 });
 await new Promise((done,reject)=>{control.once('error',reject);control.listen(0,'127.0.0.1',done);});
 state={status:'STARTING',controlPort:control.address().port};persist();
 process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
}
async function main(){
 const options=parseArguments(process.argv.slice(2));if(options.mode==='stop'){await stopExisting();return;}
 if(Number(process.versions.node.split('.')[0])<24)throw new Error('LOCAL_NODE_24_REQUIRED');
 if(!existsSync(join(root,'.env'))||!existsSync(join(root,'services/embedding/.env')))throw new Error('LOCAL_ENV_FILES_MISSING');
 nextEnvironment.loadEnvConfig(root,true,{info(){},error(){}});
 const service=dotenv.parse(readFileSync(join(root,'services/embedding/.env')));
 const serviceKeys=new Set(['EMBEDDING_MODEL','EMBEDDING_DIMENSION','EMBEDDING_MODEL_REVISION','EMBEDDING_MODEL_CACHE_DIR','EMBEDDING_API_KEY','EMBEDDING_HOST','EMBEDDING_PORT']);
 if(Object.keys(service).some(key=>!serviceKeys.has(key)))throw new Error('LOCAL_EMBEDDING_CONFIG_INVALID');
 sessionEnv=buildSessionEnvironment(process.env,service,`http://127.0.0.1:${options.port}`,options.port);
 const python=join(root,'services/embedding/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 if(!existsSync(python))throw new Error('LOCAL_EMBEDDING_PYTHON_MISSING');
 phase='CACHE';checkCache(service);phase='DATABASE';await databaseCheck(sessionEnv);phase='START';
 if(options.mode==='check'){log('CHECK','PASS: configuration/cache/development database; no services or provider/LINE calls started');return;}
 if(!await portAvailable(options.port))throw new Error('LOCAL_WEB_PORT_IN_USE');
 const cloudflared=options.tunnel?findCloudflared():undefined;
 await acquire();log('LOCAL',`Logs: ${relative(root,logFile)}; stop: pnpm local:stop or Ctrl+C`);
 let embeddingReady=false;try{embeddingReady=await checkEmbedding(sessionEnv);}catch{/* A missing service is started below. */}
 if(embeddingReady)log('E5','Reusing existing verified E5; it will not be stopped by this session');
 else{
  if(!await portAvailable(Number(sessionEnv.EMBEDDING_PORT),sessionEnv.EMBEDDING_HOST))throw new Error('LOCAL_EMBEDDING_PORT_IN_USE');
  launch('E5',python,[join(root,'services/embedding/run.py')],sessionEnv);
  await waitFor('E5',()=>checkEmbedding(sessionEnv),120_000);log('E5','Ready: offline CPU multilingual-e5-small / 384');
 }
 if(options.tunnel){
  let tunnelUrl;
  launch('TUNNEL',cloudflared,['tunnel','--url',`http://127.0.0.1:${options.port}`,'--no-autoupdate'],sessionEnv,false,line=>{
   const found=line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);if(found)tunnelUrl=found[0];
  });
  const url=await waitFor('TUNNEL',()=>tunnelUrl,60_000);
  sessionEnv=buildSessionEnvironment(process.env,service,url,options.port);
 }
 const entry=join(root,'scripts/local/node-service.mjs');
 launch('WEB',process.execPath,['--import','tsx',entry,'WEB',String(options.port)],sessionEnv,true);
 await waitFor('WEB',()=>smokeWeb(`http://127.0.0.1:${options.port}`,sessionEnv),120_000);
 log('WEB','Login and both signed empty-event webhooks PASS; invalid signatures rejected');
 const clockPool=new pg.Pool({...databaseConnection(sessionEnv.DIRECT_URL),max:1});let startedAt;
 try{startedAt=(await clockPool.query('select clock_timestamp() observed_at')).rows[0].observed_at;}finally{await clockPool.end();}
 for(const name of ['INBOX','AI','OUTBOX','INCIDENT'])launch(name,process.execPath,['--import','tsx',entry,name],sessionEnv,true);
 await waitFor('WORKERS',()=>workerObservations(startedAt),30_000);log('CHECK','All four worker check-ins observed after startup; processes are running');
 if(options.tunnel){await waitFor('PUBLIC_WEB',()=>smokeWeb(sessionEnv.APP_BASE_URL,sessionEnv),90_000);log('TUNNEL','Public signed verification requests PASS');}
 state={...state,status:'READY',localUrl:`http://127.0.0.1:${options.port}`,publicUrl:options.tunnel?sessionEnv.APP_BASE_URL:null};persist();
 log('READY',`Dashboard: http://127.0.0.1:${options.port}/login`);
 if(options.tunnel){
  log('READY',`Student webhook: ${sessionEnv.APP_BASE_URL}/api/line/student/webhook`);
  log('READY',`Staff webhook: ${sessionEnv.APP_BASE_URL}/api/line/staff/webhook`);
 }
 log('READY','Durable + AI enabled for this session; .env unchanged; web search remains off');
 log('READY','Manual tests: docs/operations/LOCAL_TEST.md; login accounts: .superpowers/staging/dev-staff-credentials.json');
}
try{await main();}catch(error){
 if(stopping&&error?.message==='LOCAL_STOPPING'){if(stopPromise)await stopPromise;}
 else{
 const code=/^LOCAL_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'LOCAL_PREFLIGHT_FAILED';
 const detail=/^[A-Z0-9_]{1,40}$/.test(error?.code??'')?error.code:'unavailable';
 log('ERROR',`${code} (${phase}, ${detail})`);if(lockOwned)await shutdown(1);else process.exitCode=1;
 }
}
