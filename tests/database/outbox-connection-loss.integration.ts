import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createDatabasePool} from '../../lib/database/pool';
import {encryptValue,hashLineUserId} from '../../lib/security/identity';
import {runOutboxCycle} from '../../lib/queue/run-outbox';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database));
for(const mode of ['REPLY','PUSH'] as const)test(`actual ${mode} delivery connection loss aborts HTTP and preserves ambiguous/retry semantics`,async()=>{
 const application=`outbox-disconnect-${randomUUID()}`,address=new URL(`postgresql://postgres:postgres@127.0.0.1:54422/${database}`);
 const control=new Pool({connectionString:address.toString(),max:1});address.searchParams.set('application_name',application);
 const pool=createDatabasePool(address.toString(),{max:1}),key=randomBytes(32).toString('base64'),user=`U${randomUUID().replaceAll('-','')}`;
 let session:string|undefined,outbox:string|undefined;const requests:{key:string|null;body:string}[]=[];
 try{
  session=(await control.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[application])).rows[0].id;
  await control.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,hashLineUserId(user,key),encryptValue(user,key)]);
  outbox=(await control.query(`insert into private.message_outbox(idempotency_key,line_session_id,kind,payload_encrypted,delivery_mode,reply_deadline_at)
   values($1,$2,'SYSTEM',$3,$4,clock_timestamp()+interval '55 seconds') returning id`,[randomUUID(),session,encryptValue(JSON.stringify({messages:[{type:'text',text:'Synthetic disconnect'}],replyToken:'synthetic-token'}),key),mode])).rows[0].id;
  const fetchImpl:typeof fetch=async(_url,init)=>{
   requests.push({key:new Headers(init?.headers).get('x-line-retry-key'),body:String(init?.body)});
   if(requests.length>1)return new Response(null,{status:409});
   assert(init?.signal);
   const abortObserved=new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('CONNECTION_LOSS_DID_NOT_ABORT_HTTP')),3000);
    init.signal!.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});
   });
   const target=await control.query("select pid from pg_stat_activity where datname=$1 and application_name=$2 and state='idle'",[database,application]);
   assert.equal(target.rowCount,1,'EXACT_HELD_DELIVERY_SESSION_REQUIRED');
   assert.equal((await control.query('select pg_terminate_backend($1) stopped',[target.rows[0].pid])).rows[0].stopped,true);
   await abortObserved;throw Error('SYNTHETIC_ABORTED_TRANSPORT');
  };
  const first=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl});
  assert.deepEqual(first,{claimed:1,sent:0,failed:1});
  assert.deepEqual((await control.query('select status,attempts from private.message_outbox where id=$1',[outbox])).rows[0],{status:mode==='REPLY'?'UNKNOWN':'PENDING',attempts:1});
  assert.equal((await control.query('select count(*)::int n from private.delivery_attempts where outbox_id=$1 and accepted',[outbox])).rows[0].n,0);
  await control.query('update private.message_outbox set available_at=clock_timestamp() where id=$1',[outbox]);
  const second=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl});
  if(mode==='REPLY'){assert.equal(second.claimed,0);assert.equal(requests.length,1);}
  else{assert.equal(second.sent,1);assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert(requests[0].key);}
 }finally{
  if(outbox){await control.query('delete from private.delivery_attempts where outbox_id=$1',[outbox]);await control.query('delete from private.message_outbox where id=$1',[outbox]);}
  if(session){await control.query('delete from private.line_identities where line_session_id=$1',[session]);await control.query('delete from public.line_sessions where id=$1',[session]);}
  await pool.end();await control.end();
 }
});
