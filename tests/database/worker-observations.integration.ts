import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import {recordWorkerObservation,type WorkerObservationCode} from '../../lib/operations/worker-observations';

const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DISPOSABLE_DATABASE_REQUIRED');
const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,max:4});
after(()=>pool.end());

function asPool(client:PoolClient){return client as unknown as Pool;}

async function preserveObservation(worker:WorkerObservationCode,run:()=>Promise<void>){
 const before=(await pool.query('select observed_at::text as observed_at from private.worker_observations where worker=$1',[worker])).rows[0] as {observed_at:string}|undefined;
 try{await run();}
 finally{
  if(before)await pool.query(`insert into private.worker_observations(worker,observed_at) values($1,$2)
   on conflict(worker) do update set observed_at=excluded.observed_at`,[worker,before.observed_at]);
  else await pool.query('delete from private.worker_observations where worker=$1',[worker]);
 }
}

test('service_role records a database-generated observation without wider mutation grants',async()=>{
 await preserveObservation('OUTBOX',async()=>{
  const client=await pool.connect();
  try{
   await client.query('begin');await client.query('set local role service_role');
   await recordWorkerObservation(asPool(client),'OUTBOX');await client.query('commit');
  }catch(error){await client.query('rollback');throw error;}
  finally{client.release();}
  const timestamp=(await pool.query(`select observed_at<=clock_timestamp() and observed_at>clock_timestamp()-interval '1 minute' as current
   from private.worker_observations where worker='OUTBOX'`)).rows[0]?.current;
  assert.equal(timestamp,true,'OBSERVATION_MUST_USE_CURRENT_DATABASE_TIME');
 });
});

test('concurrent upsert cannot move a worker observation backwards',async()=>{
 await preserveObservation('INCIDENT',async()=>{
  await pool.query(`insert into private.worker_observations(worker,observed_at) values('INCIDENT','2000-01-01T00:00:00Z')
   on conflict(worker) do update set observed_at=excluded.observed_at`);
  const lockHolder=await pool.connect(),contender=await pool.connect();let pending:Promise<void>|undefined;
  try{
   await lockHolder.query('begin');
   await lockHolder.query("select worker from private.worker_observations where worker='INCIDENT' for update");
   const pid=(await contender.query('select pg_backend_pid() as pid')).rows[0].pid as number;
   pending=recordWorkerObservation(asPool(contender),'INCIDENT');
   let blocked=false;
   for(let attempt=0;attempt<100;attempt++){
    const wait=(await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type;
    if(wait==='Lock'){blocked=true;break;}
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.equal(blocked,true,'UPSERT_MUST_WAIT_ON_THE_HELD_ROW_LOCK');
   const later=(await lockHolder.query(`update private.worker_observations set observed_at=clock_timestamp()
    where worker='INCIDENT' returning to_char(observed_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF') as observed_at`)).rows[0].observed_at as string;
   await lockHolder.query('commit');await pending;
   const preserved=(await pool.query('select observed_at >= $1::timestamptz as ok from private.worker_observations where worker=$2',[later,'INCIDENT'])).rows[0].ok;
   assert.equal(preserved,true,'CONCURRENT_CHECKIN_MUST_PRESERVE_LATEST_TIMESTAMP');
  }finally{
   await lockHolder.query('rollback').catch(()=>undefined);
   if(pending)await pending.catch(()=>undefined);
   await lockHolder.release();await contender.release();
  }
 });
});

test('observations stay private and service_role cannot mutate the worker key',async()=>{
 const privacy=(await pool.query(`select c.relrowsecurity,
  has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anon_access,
  has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') authenticated_access,
  has_table_privilege('service_role',c.oid,'SELECT') service_select,
  has_table_privilege('service_role',c.oid,'INSERT') service_insert,
  has_table_privilege('service_role',c.oid,'UPDATE') service_update,
  has_table_privilege('service_role',c.oid,'DELETE') service_delete,
  has_column_privilege('service_role',c.oid,'observed_at','UPDATE') update_timestamp,
  has_column_privilege('service_role',c.oid,'worker','UPDATE') update_worker
  from pg_class c where c.oid='private.worker_observations'::regclass`)).rows[0];
 assert.equal(privacy.relrowsecurity,true);
 assert.equal(privacy.anon_access,false);assert.equal(privacy.authenticated_access,false);
 assert.equal(privacy.service_select,true);assert.equal(privacy.service_insert,true);assert.equal(privacy.service_update,false);assert.equal(privacy.service_delete,false);
 assert.equal(privacy.update_timestamp,true);assert.equal(privacy.update_worker,false);
 const client=await pool.connect();
 try{
  await client.query('begin');await client.query('set local role authenticated');
  await assert.rejects(client.query('select worker from private.worker_observations'),{code:'42501'});
 }finally{await client.query('rollback').catch(()=>undefined);client.release();}
 const keyWriter=await pool.connect();
 try{
  await keyWriter.query('begin');await keyWriter.query('set local role service_role');
  await assert.rejects(keyWriter.query("update private.worker_observations set worker='AI' where worker='OUTBOX'"),{code:'42501'});
 }finally{await keyWriter.query('rollback').catch(()=>undefined);keyWriter.release();}
});
