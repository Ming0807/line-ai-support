import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {structuredInfrastructureReady} from '../../lib/knowledge/structured-readiness';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'OWNED_DATABASE_REQUIRED');
test('readiness rejects incomplete shape, disabled RLS, wrong trigger targets and missing effect constraints',async()=>{
 const pool=new Pool({connectionString:`postgresql://postgres:postgres@127.0.0.1:54422/${database}`});
 try{
  for(const mutation of [null,
   'alter table public.departments disable row level security',
   'alter table public.tuition_fees rename column fee_amount to incorrect_amount',
   'alter table public.tuition_fees disable trigger tuition_fees_effect_complete',
   `create function private.fixture_wrong_catalog() returns trigger language plpgsql as $$begin return null;end$$;
    drop trigger structured_selection_catalog on public.departments;
    create trigger structured_selection_catalog before insert or update or delete or truncate on public.departments for each statement execute function private.fixture_wrong_catalog()`,
   'alter table private.structured_publication_effects drop constraint structured_publication_effects_pkey',
  ]){
   const c=await pool.connect();
   try{await c.query('begin');if(mutation)await c.query(mutation);assert.equal(await structuredInfrastructureReady(c),mutation===null,mutation??'complete schema');}
   finally{await c.query('rollback');c.release();}
  }
 }finally{await pool.end();}
});
