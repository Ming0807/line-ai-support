import {describe,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSessionEnvironment,parseArguments,redactLine,validateEmbeddingHealth} from '../scripts/local/config.mjs';

const env={YRU_DEPLOYMENT_ENV:'development',DEV_SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',
 SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',NEXT_PUBLIC_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'public-placeholder',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-placeholder',SUPABASE_SECRET_KEY:'test-secret',
 DATABASE_URL:'postgresql://postgres.abcdefghijklmnopqrst:fixture@aws-0.pooler.supabase.com:6543/postgres?pgbouncer=true',
 DIRECT_URL:'postgresql://postgres.abcdefghijklmnopqrst:fixture@aws-0.pooler.supabase.com:5432/postgres',
 ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),LINE_STUDENT_CHANNEL_SECRET:'student-fixture-secret',LINE_STAFF_CHANNEL_SECRET:'staff-fixture-secret',
 LINE_STUDENT_CHANNEL_ACCESS_TOKEN:'student-fixture-access',LINE_STAFF_CHANNEL_ACCESS_TOKEN:'staff-fixture-access',
 EMBEDDING_API_URL:'http://127.0.0.1:8000',LINE_WEBHOOK_MODE:'echo',YRU_AI_ENABLED:'false'};
const embedding={EMBEDDING_MODEL_CACHE_DIR:'D:/fixture/cache',EMBEDDING_HOST:'127.0.0.1',EMBEDDING_PORT:'8000'};
describe('local test session configuration',()=>{
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
});
describe('local command and output boundaries',()=>{
 it('starts all services by default and offers explicit check/stop/browser-only commands',()=>{
  expect(parseArguments([])).toEqual({mode:'start',port:3000,tunnel:true});expect(parseArguments(['--check']).mode).toBe('check');
  expect(parseArguments(['--stop']).mode).toBe('stop');expect(parseArguments(['--no-tunnel','--port','3001'])).toEqual({mode:'start',port:3001,tunnel:false});
 });
 it.each([['--unknown'],['--port','0'],['--port','3000oops'],['--port','3000','--port','3001'],['--stop','--check'],['--check','--no-tunnel']].map(args=>({args})))('rejects unknown/duplicate/conflicting options %j',({args})=>expect(()=>parseArguments(args)).toThrow('LOCAL_ARGUMENTS_INVALID'));
 it('redacts actual configured secrets, connection strings, arbitrary bearer tokens and LINE reply tokens',()=>{
  const line=`${env.LINE_STUDENT_CHANNEL_SECRET} ${env.ENCRYPTION_KEY} postgresql://someone:password@db.example:5432/postgres Authorization: Bearer unknown-bearer-value {"replyToken":"unknown-reply-value"}`;
  const actual=redactLine(line,env);for(const value of [env.LINE_STUDENT_CHANNEL_SECRET,env.ENCRYPTION_KEY,'someone','password','unknown-bearer-value','unknown-reply-value'])expect(actual).not.toContain(value);
  expect(redactLine('https://example.trycloudflare.com/api/line/student/webhook',env)).toContain('https://example.trycloudflare.com');
 });
});
