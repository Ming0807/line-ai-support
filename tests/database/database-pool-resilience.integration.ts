import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));

async function recover(mode:'APPLICATION'|'SESSION',checkedOut=false){
 const application=`pool-resilience-${randomUUID()}`;
 const address=new URL(`postgresql://postgres:postgres@127.0.0.1:54422/${database}`);
 address.searchParams.set('application_name',application);
 const script=`
 import assert from 'node:assert/strict';
 import {Pool} from 'pg';
 import * as databasePools from './lib/database/pool.ts';
 const address=process.env.DATABASE_URL,application=process.env.YRU_POOL_TEST_APPLICATION;
 const pool=${mode==='APPLICATION'?'databasePools.getDatabasePool()':'databasePools.createDatabasePool(address,{max:2})'},control=new Pool({connectionString:address,max:1});
 try{
  const held=${checkedOut?'await pool.connect()':'null'};
  const first=(await (held??pool).query('select pg_backend_pid() pid')).rows[0].pid;
  const terminated=await control.query("select pg_terminate_backend(pid) stopped from pg_stat_activity where pid=$1 and datname=$2 and application_name=$3 and state='idle'",[first,process.env.YRU_STRUCTURED_SCHEMA_DATABASE,application]);
  assert.equal(terminated.rowCount,1);assert.equal(terminated.rows[0].stopped,true);
  console.log('OWNED_IDLE_BACKEND_TERMINATED');
  await new Promise(resolve=>setTimeout(resolve,250));
  if(held){await assert.rejects(held.query('select 1'));held.release();}
  const recovered=(await pool.query('select 1 value,pg_backend_pid() pid')).rows[0];
  assert.equal(recovered.value,1);assert.notEqual(recovered.pid,first);
  console.log('OWNED_IDLE_RECONNECT_PASS');
 }finally{await pool.end();await control.end();}
 `;
 const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,
   env:{...process.env,DATABASE_URL:address.toString(),YRU_POOL_TEST_APPLICATION:application},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(Error('OWNED_POOL_TEST_TIMEOUT'));},15000);
  child.stdout.on('data',part=>{stdout+=part;});child.stderr.on('data',part=>{stderr+=part;});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
 });
 const failure=result.stderr.includes('Unhandled')?'UNHANDLED_POOL_ERROR_TERMINATED_PROCESS':result.stderr.includes('SyntaxError')?'CHILD_IMPORT_ERROR':result.stderr.includes('not a function')?'POOL_FACTORY_MISSING':result.stderr.includes('ERR_ASSERTION')?'CHILD_FIXTURE_ASSERTION':'IDLE_DISCONNECT_TERMINATED_PROCESS';
 assert.equal(result.code,0,failure);
 assert.equal(result.stdout.trim(),'OWNED_IDLE_BACKEND_TERMINATED\nOWNED_IDLE_RECONNECT_PASS');
 assert.equal(result.stderr.trim(),checkedOut?'DATABASE_CLIENT_CONNECTION_ERROR':'DATABASE_POOL_IDLE_ERROR','LOG_MUST_CONTAIN_ONLY_FIXED_ERROR_CODE');
}
test('application pool survives an actual owned idle backend termination and reconnects without raw client logs',()=>recover('APPLICATION'));
test('dedicated session pool survives an actual owned idle backend termination and reconnects without raw client logs',()=>recover('SESSION'));

test('checked-out application client disconnect rejects work without killing process and reconnects after release',()=>recover('APPLICATION',true));
test('checked-out session client disconnect rejects work without killing process and reconnects after release',()=>recover('SESSION',true));
