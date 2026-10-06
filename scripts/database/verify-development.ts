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
   and not (n.nspname='private' and c.relname in ('knowledge_import_jobs','knowledge_import_revisions','knowledge_import_reviews','knowledge_import_publications'))
   and not has_table_privilege('service_role',c.oid,privilege)`);
 const revisionGrants=await client.query(`select c.relname,
  has_table_privilege('service_role',c.oid,'SELECT') as can_read,
  has_table_privilege('service_role',c.oid,'INSERT') as can_append,
  has_table_privilege('service_role',c.oid,'UPDATE') as can_update,
  has_table_privilege('service_role',c.oid,'DELETE') as can_delete
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('knowledge_import_revisions','knowledge_import_reviews','knowledge_import_publications')`);
 const jobGrants=await client.query(`select
  has_table_privilege('service_role','private.knowledge_import_jobs','SELECT') as can_read,
  has_table_privilege('service_role','private.knowledge_import_jobs','INSERT') as can_append,
  has_table_privilege('service_role','private.knowledge_import_jobs','UPDATE') as can_update,
  has_table_privilege('service_role','private.knowledge_import_jobs','DELETE') as can_delete`);
 const workerPermission=await client.query("select has_function_privilege('service_role','private.claim_inbox(text)','EXECUTE') as allowed");
 if(missingServerGrants.rows[0].count!==0 || !workerPermission.rows[0].allowed ||
  revisionGrants.rows.length!==3 || revisionGrants.rows.some(row=>!row.can_read||!row.can_append||row.can_update||row.can_delete) ||
  !jobGrants.rows[0].can_read||!jobGrants.rows[0].can_append||!jobGrants.rows[0].can_update||jobGrants.rows[0].can_delete) throw new Error('DEVELOPMENT_SERVER_GRANT_VERIFICATION_FAILED');
 console.log(JSON.stringify({stage:'development_security',tableCount:tables.rows[0].count,allRls:true,
  rolePrivacyFixture:true,effectiveBrowserGrants:true,effectiveServerGrants:true,appendOnlyImportRevisions:true,appendOnlyImportReviews:true,
  immutablePublicationReceipts:true,runtimeOriginalRetention:true,crossDepartmentDenied:true,inactiveDenied:true,anonymousDenied:true,fixtureRolledBack:true}));
} catch(error) {
 await client.query('rollback').catch(()=>undefined);
 const message=error instanceof Error?error.message:'';
 console.error(JSON.stringify({stage:'development_security_failed',code:/^[A-Z_]+$/.test(message)?message:'DATABASE_VERIFICATION_ERROR'}));
 process.exitCode=1;
} finally {await client.end();}
