import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertDevelopmentTarget} from '../../lib/database/development-target';
import {getDatabasePool} from '../../lib/database/pool';
import {listTickets} from '../../lib/tickets/reads';

assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,
 supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
const credentials=JSON.parse(readFileSync('.superpowers/staging/dev-staff-credentials.json','utf8'));
assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF);
const pool=getDatabasePool();
try{
 const schema=await pool.query(`select table_name,column_name from information_schema.columns
  where table_schema='public' and table_name in ('tickets','conversations') and column_name='revision'`);
 if(schema.rowCount!==2)throw new Error('TICKET_SCHEMA_REVISION_MISSING');
 const verified=[];
 for(const account of credentials.accounts){
  const result=await listTickets(account.id);
  assert(Array.isArray(result.tickets));
  assert(result.tickets.every(ticket=>Number.isInteger(ticket.revision)));
  verified.push({role:account.role,department:account.departmentCode,ticketCount:result.tickets.length});
 }
 console.log(JSON.stringify({stage:'development_ticket_schema_verified',revisionColumns:true,staffReads:verified}));
}catch(error){
 const code=error instanceof Error&&error.message==='TICKET_SCHEMA_REVISION_MISSING'?'TICKET_SCHEMA_REVISION_MISSING':'TICKET_SCHEMA_SMOKE_FAILED';
 console.error(JSON.stringify({stage:'development_ticket_schema_failed',code}));process.exitCode=1;
}finally{await pool.end();}
