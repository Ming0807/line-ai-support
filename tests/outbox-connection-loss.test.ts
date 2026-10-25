import {EventEmitter} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {afterEach,expect,it,vi} from 'vitest';
import {runOutboxCycle} from '../lib/queue/run-outbox';
import {encryptValue,hashLineUserId} from '../lib/security/identity';

afterEach(()=>vi.restoreAllMocks());

for(const phase of ['BEFORE_HTTP','DURING_HTTP'] as const)for(const mode of ['REPLY','PUSH'] as const){
 it(`${mode} loses its session connection ${phase} without sending after loss or recording SENT`,async()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{});
  const key=randomBytes(32).toString('base64'),user=`U${randomUUID().replaceAll('-','')}`;
  const job={id:randomUUID(),idempotency_key:randomUUID(),channel:'STUDENT',lease_token:randomUUID(),line_session_id:randomUUID(),
   recipient_staff_id:null,recipient_user_id_encrypted:null,conversation_id:null,ticket_id:null,kind:'SYSTEM',expected_conversation_revision:null,
   payload_encrypted:encryptValue(JSON.stringify({messages:[{type:'text',text:'Synthetic connection-loss test'}],replyToken:'synthetic-token'}),key),
   delivery_mode:mode,reply_deadline_at:new Date(Date.now()+30000),line_retry_key:randomUUID(),attempts:0,first_attempt_at:null};
  let lost=false,claimed=false;const client=new EventEmitter();
  // Isolate cancellation from EventEmitter's process-fatal behavior; actual PG
  // child tests separately prove the shared pool listener prevents that crash.
  client.on('error',()=>{});
  const disconnect=()=>{lost=true;client.emit('error',new Error('synthetic-secret-not-to-log'));};
  const query=vi.fn(async(sql:string)=>{
   if(lost)throw Error('CONNECTION_LOST');
   if(sql.includes('select * from private.message_outbox'))return{rows:[job],rowCount:1};
   if(sql.includes('select i.user_id_encrypted'))return{rows:[{user_id_encrypted:encryptValue(user,key),user_hash:hashLineUserId(user,key)}],rowCount:1};
   if(sql.includes('attempts=attempts+1')){if(phase==='BEFORE_HTTP')disconnect();return{rows:[{id:job.id}],rowCount:1};}
   return{rows:[],rowCount:0};
  });
  const release=vi.fn();Object.assign(client,{query,release});
  const recovery=vi.fn(async(sql:string)=>{if(sql.includes('claim_outbox')){if(!claimed){claimed=true;return{rows:[job]};}return{rows:[]};}return{rows:[],rowCount:1};});
  const pool={connect:async()=>client,query:recovery} as unknown as Pool;
  let observedAbort=false;
  const fetchImpl:typeof fetch=vi.fn(async(_url,init)=>{
   disconnect();observedAbort=init?.signal?.aborted===true;
   if(observedAbort)throw Error('CANCELLED');
   return new Response(null,{status:200});
  });
  const result=await runOutboxCycle(pool,key,{accessTokens:{STUDENT:'synthetic',STAFF:'synthetic'},fetchImpl});
  expect(result).toEqual({claimed:1,sent:0,failed:1});
  if(phase==='BEFORE_HTTP')expect(fetchImpl).not.toHaveBeenCalled();
  else{expect(fetchImpl).toHaveBeenCalledTimes(1);expect(observedAbort).toBe(true);}
  expect(release).toHaveBeenCalledExactlyOnceWith(true);
  expect(client.listenerCount('error')).toBe(1);
  expect(query.mock.calls.some(([sql])=>sql.includes('insert into private.delivery_attempts'))).toBe(false);
  expect(recovery.mock.calls.some(([sql])=>sql.includes("delivery_mode='REPLY' and attempts>0 then 'UNKNOWN'"))).toBe(true);
 });
}
