import {describe,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildSessionEnvironment,hermesReadiness,parseArguments,readyMessages,redactLine,validateEmbeddingHealth} from '../scripts/local/config.mjs';
import {forceStopOwnedTree} from '../scripts/local/process-tree.mjs';

const env={YRU_DEPLOYMENT_ENV:'development',DEV_SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',
 SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',NEXT_PUBLIC_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'public-placeholder',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-placeholder',SUPABASE_SECRET_KEY:'test-secret',
 DATABASE_URL:'postgresql://postgres.abcdefghijklmnopqrst:fixture@aws-0.pooler.supabase.com:6543/postgres?pgbouncer=true',
 DIRECT_URL:'postgresql://postgres.abcdefghijklmnopqrst:fixture@aws-0.pooler.supabase.com:5432/postgres',
 ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),LINE_STUDENT_CHANNEL_SECRET:'student-fixture-secret',LINE_STAFF_CHANNEL_SECRET:'staff-fixture-secret',
 LINE_STUDENT_CHANNEL_ACCESS_TOKEN:'student-fixture-access',LINE_STAFF_CHANNEL_ACCESS_TOKEN:'staff-fixture-access',
 EMBEDDING_API_URL:'http://127.0.0.1:8000',LINE_WEBHOOK_MODE:'echo',YRU_AI_ENABLED:'false'};
const embedding={EMBEDDING_MODEL_CACHE_DIR:'D:/fixture/cache',EMBEDDING_HOST:'127.0.0.1',EMBEDDING_PORT:'8000'};
const webConfig=()=>{const key='fixture-web-key';return {TAVILY_API_KEY:key,TAVILY_FREE_NO_PAYG_ATTESTED:'true',TAVILY_FREE_KEY_SHA256:createHash('sha256').update(key).digest('hex'),TAVILY_FREE_ATTESTED_AT:new Date().toISOString()};};
describe('local test session configuration',()=>{
 it('explicit web search accepts configured DDGS without a Tavily account or fresh Tavily attestation',()=>{
  const input={...env,DDGS_ENABLED:'true',DDGS_PYTHON_PATH:'D:/fixture/python.exe'};
  expect(buildSessionEnvironment(input,embedding,'http://127.0.0.1:3000',3000,{assistantPreview:true,webSearch:true}).YRU_WEB_SEARCH_ENABLED).toBe('true');
  expect(buildSessionEnvironment(input,embedding,'http://127.0.0.1:3000',3000).YRU_WEB_SEARCH_ENABLED).toBe('false');
 });
 it('keeps web off by default and enables configured web only for an explicit session',()=>{
  const input={...env,...webConfig(),YRU_WEB_SEARCH_ENABLED:'true'},before={...input};
  expect(buildSessionEnvironment(input,embedding,'http://127.0.0.1:3000',3000).YRU_WEB_SEARCH_ENABLED).toBe('false');
  for(const base of ['http://127.0.0.1:3000','https://example.trycloudflare.com']){
   expect(buildSessionEnvironment(input,embedding,base,3000,{assistantPreview:true,webSearch:true}).YRU_WEB_SEARCH_ENABLED).toBe('true');
  }
  expect(input).toEqual(before);
 });
 it.each([
  {},{TAVILY_API_KEY:''},{TAVILY_FREE_NO_PAYG_ATTESTED:'false'},{TAVILY_FREE_KEY_SHA256:'a'.repeat(64)},
  {TAVILY_FREE_ATTESTED_AT:'invalid'},{TAVILY_FREE_ATTESTED_AT:new Date(Date.now()+3600000).toISOString()},
  {TAVILY_FREE_ATTESTED_AT:new Date(Date.now()-25*3600000).toISOString()},
 ])('rejects unavailable, unverified, mismatched or expired web credentials before starting %j',patch=>{
  const input=Object.keys(patch).length?{...env,...webConfig(),...patch}:env;
  expect(()=>buildSessionEnvironment(input,embedding,'http://127.0.0.1:3000',3000,{webSearch:true})).toThrow('LOCAL_WEB_SEARCH_CONFIG_INVALID');
 });
 it('explicit natural preview overrides inherited OFF on both local and tunnel children without editing saved env',()=>{
  const saved={...env,YRU_ASSISTANT_ENABLED:'false'},before={...saved};
  for(const base of ['http://127.0.0.1:3000','https://example.trycloudflare.com']){
   const actual=buildSessionEnvironment(saved,embedding,base,3000,{assistantPreview:true});
   expect(actual.YRU_ASSISTANT_ENABLED).toBe('true');
   expect(actual.YRU_AI_ENABLED).toBe('true');expect(actual.LINE_WEBHOOK_MODE).toBe('durable');
   expect(actual.YRU_WEB_SEARCH_ENABLED).toBe('false');expect(actual.DATABASE_URL).toBe(saved.DATABASE_URL);
  }
  expect(saved).toEqual(before);
  expect(buildSessionEnvironment(saved,embedding,'http://127.0.0.1:3000',3000).YRU_ASSISTANT_ENABLED).toBe('false');
 });
 it('staff pilot forces natural assistant off without hiding legacy support or mutating saved configuration',()=>{
  const saved={...env,YRU_ASSISTANT_ENABLED:'true'};
  const actual=buildSessionEnvironment(saved,embedding,'http://127.0.0.1:3000',3000,{staffTest:true});
  expect(actual.YRU_ASSISTANT_ENABLED).toBe('false');
  expect(actual.YRU_AI_ENABLED).toBe('true');
  expect(saved.YRU_ASSISTANT_ENABLED).toBe('true');
  const afterTunnel=buildSessionEnvironment(saved,embedding,'https://example.trycloudflare.com',3000,{staffTest:true});
  expect(afterTunnel.YRU_ASSISTANT_ENABLED).toBe('false');
 });
 it('enables only child-session durable+AI without mutating either input or web-search choice',()=>{
  const actual=buildSessionEnvironment(env,embedding,'https://example.trycloudflare.com',3000);
  expect(actual.LINE_WEBHOOK_MODE).toBe('durable');expect(actual.YRU_AI_ENABLED).toBe('true');expect(actual.APP_BASE_URL).toBe('https://example.trycloudflare.com');
  expect(actual.YRU_WEB_SEARCH_ENABLED).toBe('false');expect(actual.DATABASE_URL).toBe(env.DATABASE_URL);
  expect(env.LINE_WEBHOOK_MODE).toBe('echo');expect(env.YRU_AI_ENABLED).toBe('false');expect(embedding).not.toHaveProperty('HF_HUB_OFFLINE');
 });
 it.each([{YRU_DEPLOYMENT_ENV:'production'},{DIRECT_URL:env.DATABASE_URL},{DATABASE_URL:'postgresql://postgres:fixture@foreign.example:5432/postgres'},
  {NEXT_PUBLIC_SUPABASE_URL:'https://foreign.example'},{DIRECT_URL:env.DIRECT_URL+'?host=foreign.example'}])('rejects a mismatched database or session target %j',patch=>{
  expect(()=>buildSessionEnvironment({...env,...patch},embedding,'http://127.0.0.1:3000',3000)).toThrow();
 });
 it('requires a local matching E5 vector space and authentication',()=>{
  expect(()=>buildSessionEnvironment({...env,EMBEDDING_API_URL:'https://remote.example'},embedding,'http://127.0.0.1:3000',3000)).toThrow();
  expect(()=>buildSessionEnvironment(env,{...embedding,EMBEDDING_DIMENSION:'768'},'http://127.0.0.1:3000',3000)).toThrow();
  expect(()=>buildSessionEnvironment({...env,EMBEDDING_API_KEY:'different-fixture-key'},{...embedding,EMBEDDING_API_KEY:'configured-fixture-key'},'http://127.0.0.1:3000',3000)).toThrow();
 });
 it('rejects missing required values without putting their value into diagnostics',()=>{
  expect(()=>buildSessionEnvironment({...env,ENCRYPTION_KEY:'secret-invalid-fixture'},embedding,'http://127.0.0.1:3000',3000)).toThrow('LOCAL_ENCRYPTION_KEY_INVALID');
  expect(()=>buildSessionEnvironment({...env,LINE_STAFF_CHANNEL_SECRET:''},embedding,'http://127.0.0.1:3000',3000)).toThrow('LOCAL_MISSING_LINE_STAFF_CHANNEL_SECRET');
 });
 it('keeps E5 offline and normalizes a consistent local endpoint',()=>{
  const actual=buildSessionEnvironment(env,embedding,'http://127.0.0.1:3000',3000);
  expect(actual.HF_HUB_OFFLINE).toBe('1');expect(actual.TRANSFORMERS_OFFLINE).toBe('1');expect(actual.EMBEDDING_DIMENSION).toBe('384');
 });
 it('accepts only exact loaded E5 health, not arbitrary status200',()=>{
  expect(validateEmbeddingHealth({status:'ok',model:'intfloat/multilingual-e5-small',revision:'614241f622f53c4eeff9890bdc4f31cfecc418b3',dimension:384})).toBe(true);
  expect(validateEmbeddingHealth({status:'ok',dimension:384})).toBe(false);expect(validateEmbeddingHealth({status:'ok',model:'other',dimension:768})).toBe(false);
 });
});
describe('actual local child shutdown transport',()=>{
 function message(child:ChildProcess,type:string){return new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>{child.off('message',handler);reject(new Error('CHILD_MESSAGE_TIMEOUT'));},5000);
  function handler(value:unknown){if(value!==null&&typeof value==='object'&&'type'in value&&value.type===type){clearTimeout(timeout);child.off('message',handler);resolve();}}
  child.on('message',handler);
 });}
 function exited(child:ChildProcess){return new Promise<number|null>(resolve=>child.once('exit',code=>resolve(code)));}
 it('finishes an early IPC stop, preserves a separate child and closes both cleanly',async()=>{
  const fixture=fileURLToPath(new URL('./fixtures/local-runner-child.mjs',import.meta.url));
  const a=spawn(process.execPath,[fixture],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  const b=spawn(process.execPath,[fixture],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  try{
   await Promise.all([message(a,'ready'),message(b,'ready')]);
   const closedA=message(a,'closed'),exitA=exited(a);a.send({type:'local-stop'});
   await closedA;expect(await exitA).toBe(0);expect(b.exitCode).toBe(null);
   const pong=message(b,'pong');b.send({type:'ping'});await pong;
   const closedB=message(b,'closed'),exitB=exited(b);b.send({type:'local-stop'});await closedB;expect(await exitB).toBe(0);
  }finally{if(a.exitCode===null)a.kill();if(b.exitCode===null)b.kill();}
 },10_000);
 it('stops only the exact owned process tree and preserves an unrelated tree',async()=>{
  const fixture=fileURLToPath(new URL('./fixtures/local-runner-tree-child.mjs',import.meta.url));
  const start=()=>spawn(process.execPath,[fixture],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,detached:process.platform!=='win32'});
  const a=start(),b=start();let aDescendant:number|undefined,bDescendant:number|undefined;
  function descendantPid(child:ChildProcess){return new Promise<number>((resolve,reject)=>{
   const timeout=setTimeout(()=>{child.off('message',handler);reject(new Error('TREE_FIXTURE_TIMEOUT'));},5000);
   function handler(value:unknown){if(value!==null&&typeof value==='object'&&'type'in value&&value.type==='ready'&&'descendantPid'in value&&typeof value.descendantPid==='number'){
    clearTimeout(timeout);child.off('message',handler);resolve(value.descendantPid);
   }}
   child.on('message',handler);
  });}
  function exited(child:ChildProcess){return new Promise<void>(resolve=>child.exitCode!==null||child.signalCode!==null?resolve():child.once('exit',()=>resolve()));}
  function alive(pid:number){try{process.kill(pid,0);return true;}catch(error){return !(error!==null&&typeof error==='object'&&'code' in error&&error.code==='ESRCH');}}
  async function waitDead(pid:number){const deadline=Date.now()+5000;while(alive(pid)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));expect(alive(pid)).toBe(false);}
  try{
   [aDescendant,bDescendant]=await Promise.all([descendantPid(a),descendantPid(b)]);
   const aExit=exited(a);await forceStopOwnedTree(a);await aExit;await waitDead(aDescendant);
   expect(alive(b.pid!)).toBe(true);expect(alive(bDescendant)).toBe(true);
   const bExit=exited(b);await forceStopOwnedTree(b);await bExit;await waitDead(bDescendant);
  }finally{
   for(const [child,descendant]of [[a,aDescendant],[b,bDescendant]] as const){
    if(child.exitCode===null&&child.signalCode===null){try{await forceStopOwnedTree(child);}catch{child.kill();}}
    if(descendant&&alive(descendant)){try{process.kill(descendant,'SIGKILL');}catch{/* Process already exited. */}}
   }
  }
 },15_000);
});
describe('local command and output boundaries',()=>{
 it('accepts explicit web search only on start and reports its limited unverified scope',()=>{
  expect(parseArguments(['--assistant-preview','--web-search'])).toMatchObject({assistantPreview:true,webSearch:true});
  for(const args of [['--web-search','--check'],['--web-search','--stop'],['--web-search','--web-search']])expect(()=>parseArguments(args)).toThrow('LOCAL_ARGUMENTS_INVALID');
  const output=readyMessages(3000,'https://example.trycloudflare.com','SKIPPED','CONFIGURATION',{assistantPreview:true,webSearch:true}).join('\n');
  expect(output).toContain('Web search configured');expect(output).toContain('source leads');expect(output).toContain('runtime checks');expect(output).not.toContain('verified provider');
 });
 it('accepts explicit natural preview, optional isolated Hermes and refuses conflicting modes/duplicates',()=>{
  expect(parseArguments(['--assistant-preview'])).toMatchObject({mode:'start',assistantPreview:true,hermesCheck:false});
  expect(parseArguments(['--assistant-preview','--no-tunnel','--port','3001','--hermes-check']))
   .toMatchObject({mode:'start',assistantPreview:true,port:3001,tunnel:false,hermesCheck:true});
  for(const args of [['--assistant-preview','--staff-test'],['--assistant-preview','--check'],['--assistant-preview','--stop'],['--assistant-preview','--assistant-preview']])
   expect(()=>parseArguments(args)).toThrow('LOCAL_ARGUMENTS_INVALID');
 });
 it('labels natural preview, real LINE/DB side effects and missing quality acceptance beside exact current URLs',()=>{
  const lines=readyMessages(3000,'https://example.trycloudflare.com','SKIPPED','CONFIGURATION',{assistantPreview:true}).join('\n');
  expect(lines).toContain('Natural assistant preview: ON');
  expect(lines).toContain('model quality NOT_QUALIFIED');expect(lines).toContain('not V1 acceptance');
  expect(lines).toContain('DEVELOPMENT queues');expect(lines).toContain('real LINE');
  expect(lines).toContain('/api/line/student/webhook');expect(lines).toContain('/api/line/staff/webhook');
  expect(lines).toContain('Hermes CLI pilot: SKIPPED');
  expect(lines).not.toContain('natural assistant OFF');
 });
 it('accepts explicit staff pilot and refuses implicit Hermes calls or check/stop combinations',()=>{
  expect(parseArguments(['--staff-test'])).toMatchObject({mode:'start',staffTest:true,hermesCheck:false});
  for(const args of [['--staff-test','--hermes-check'],['--staff-test','--check'],['--staff-test','--stop']])
   expect(()=>parseArguments(args)).toThrow('LOCAL_ARGUMENTS_INVALID');
 });
 it('labels the staff pilot honestly and retains both webhook URLs',()=>{
  const lines=readyMessages(3000,'https://example.trycloudflare.com','SKIPPED','CONFIGURATION',{staffTest:true}).join('\n');
  expect(lines).toContain('Staff workflow pilot');
  expect(lines).toContain('legacy support AI remains enabled');
  expect(lines).toContain('not V1 acceptance');
  expect(lines).toContain('/api/line/student/webhook');expect(lines).toContain('/api/line/staff/webhook');
  expect(lines).not.toContain('add --hermes-check');
 });
 it('starts all services by default and offers explicit check/stop/browser-only commands',()=>{
  expect(parseArguments([])).toEqual({mode:'start',port:3000,tunnel:true,hermesCheck:false});expect(parseArguments(['--check']).mode).toBe('check');
  expect(parseArguments(['--stop']).mode).toBe('stop');expect(parseArguments(['--no-tunnel','--port','3001'])).toEqual({mode:'start',port:3001,tunnel:false,hermesCheck:false});
  expect(parseArguments(['--hermes-check'])).toEqual({mode:'start',port:3000,tunnel:true,hermesCheck:true});
 });
 it('prints current LINE webhook URLs and sanitized Hermes pilot readiness',()=>{
  expect(readyMessages(3001,'https://example.trycloudflare.com','PASS','COMPLETE')).toEqual([
   'Dashboard: http://127.0.0.1:3001/login',
   'Student webhook: https://example.trycloudflare.com/api/line/student/webhook',
   'Staff webhook: https://example.trycloudflare.com/api/line/staff/webhook',
   'Hermes CLI pilot: PASS at COMPLETE (two synthetic FREE_ONLY turns)',
  ]);
  expect(hermesReadiness('FAIL','AGENT_EXITED')).toBe('Hermes CLI pilot: FAIL at AGENT_EXITED (response content is suppressed)');
  expect(hermesReadiness('FAIL','TURN_1_START')).toBe('Hermes CLI pilot: FAIL at TURN_1_START (response content is suppressed)');
  expect(readyMessages(3000,null,'FAIL','AGENT_EXITED')).toEqual([
   'Dashboard: http://127.0.0.1:3000/login',
   'Hermes CLI pilot: FAIL at AGENT_EXITED (response content is suppressed)',
  ]);
  expect(readyMessages(3000,null)).toEqual([
   'Dashboard: http://127.0.0.1:3000/login',
   'Hermes CLI pilot: SKIPPED (add --hermes-check for two bounded FREE_ONLY model calls)',
  ]);
 });
 it.each([['--unknown'],['--port','0'],['--port','3000oops'],['--port','3000','--port','3001'],['--hermes-check','--hermes-check'],['--stop','--check'],['--check','--no-tunnel'],['--check','--hermes-check']].map(args=>({args})))('rejects unknown/duplicate/conflicting options %j',({args})=>expect(()=>parseArguments(args)).toThrow('LOCAL_ARGUMENTS_INVALID'));
 it('redacts actual configured secrets, connection strings, arbitrary bearer tokens and LINE reply tokens',()=>{
  const line=`${env.LINE_STUDENT_CHANNEL_SECRET} ${env.ENCRYPTION_KEY} postgresql://someone:password@db.example:5432/postgres Authorization: Bearer unknown-bearer-value {"replyToken":"unknown-reply-value"}`;
  const actual=redactLine(line,env);for(const value of [env.LINE_STUDENT_CHANNEL_SECRET,env.ENCRYPTION_KEY,'someone','password','unknown-bearer-value','unknown-reply-value'])expect(actual).not.toContain(value);
  expect(redactLine('https://example.trycloudflare.com/api/line/student/webhook',env)).toContain('https://example.trycloudflare.com');
 });
});
