import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { databaseConnection } from '../../lib/database/connection';
import { assertDevelopmentTarget } from '../../lib/database/development-target';

assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,
 supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
const client=new Client(databaseConnection(process.env.DIRECT_URL!));
try {
 await client.connect();
 const sql=readFileSync('tests/database/foundation.sql','utf8')
  .replace(/\s*select 'foundation RLS\/privacy checks passed' as result;\s*$/i,'');
 if(!/\bbegin\s*;/i.test(sql) || !/\brollback\s*;\s*$/i.test(sql)) throw new Error('ROLLBACK_FIXTURE_REQUIRED');
 // The fixture impersonates actual Postgres roles and rolls every insert back.
 await client.query(sql);
 const tables=await client.query("select count(*)::int as count, bool_and(rowsecurity) as rls from pg_tables where schemaname in ('public','private')");
 const fixtures=await client.query("select count(*)::int as count from auth.users where email like '%-test@example.invalid'");
 if(!tables.rows[0].rls || fixtures.rows[0].count!==0) throw new Error('DEVELOPMENT_RLS_VERIFICATION_FAILED');
 const missingServerGrants=await client.query(`select count(*)::int as count from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege
  where n.nspname in ('public','private') and c.relkind='r'
   and not has_table_privilege('service_role',c.oid,privilege)`);
 const workerPermission=await client.query("select has_function_privilege('service_role','private.claim_inbox(text)','EXECUTE') as allowed");
 if(missingServerGrants.rows[0].count!==0 || !workerPermission.rows[0].allowed) throw new Error('DEVELOPMENT_SERVER_GRANT_VERIFICATION_FAILED');
 console.log(JSON.stringify({stage:'development_security',tableCount:tables.rows[0].count,allRls:true,
  rolePrivacyFixture:true,effectiveBrowserGrants:true,effectiveServerGrants:true,
  crossDepartmentDenied:true,inactiveDenied:true,anonymousDenied:true,fixtureRolledBack:true}));
} catch(error) {
 await client.query('rollback').catch(()=>undefined);
 const message=error instanceof Error?error.message:'';
 console.error(JSON.stringify({stage:'development_security_failed',code:/^[A-Z_]+$/.test(message)?message:'DATABASE_VERIFICATION_ERROR'}));
 process.exitCode=1;
} finally {await client.end();}
