import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { databaseConnection } from '../../lib/database/connection';
import { assertDevelopmentTarget } from '../../lib/database/development-target';

assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,
 supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
const client=new Client(databaseConnection(process.env.DIRECT_URL!));
const structuredTables=['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements'];
const retainedTables=['public.incidents','public.incident_tickets','private.incident_ticket_vectors','private.incident_rules','private.incident_detection_jobs'];
const immutableTables=['private.knowledge_import_revisions','private.knowledge_import_reviews','private.knowledge_import_publications',
 'private.structured_row_provenance','private.structured_publication_effects','private.incident_action_receipts','private.ticket_support_contexts','private.ai_support_outcomes'];
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
   and not (n.nspname||'.'||c.relname=any($1::text[]))
   and not has_table_privilege('service_role',c.oid,privilege)`,[
    ['private.knowledge_import_jobs','private.worker_observations','private.structured_selection_epoch','private.incident_context_proofs','private.web_search_attempts',...immutableTables,...retainedTables,...structuredTables.map(name=>`public.${name}`)]]);
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
 const observationGrants=await client.query(`select
  has_table_privilege('service_role','private.worker_observations','SELECT') can_read,
  has_table_privilege('service_role','private.worker_observations','INSERT') can_append,
  has_table_privilege('service_role','private.worker_observations','UPDATE') can_update,
  has_table_privilege('service_role','private.worker_observations','DELETE') can_delete,
  has_column_privilege('service_role','private.worker_observations','observed_at','UPDATE') update_timestamp,
  has_column_privilege('service_role','private.worker_observations','worker','UPDATE') update_worker`);
 const observation=observationGrants.rows[0];
 const webGrants=(await client.query(`select
  has_table_privilege('service_role',c.oid,'SELECT') can_read,has_table_privilege('service_role',c.oid,'INSERT') can_append,
  has_table_privilege('service_role',c.oid,'UPDATE,DELETE,TRUNCATE') can_rewrite,
  not has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE') and not has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE') browser_denied,
  (select bool_and(has_column_privilege('service_role',c.oid,a.attname,'UPDATE')=(a.attname=any(array['observation','http_status','provider_request_id','credits'])))
   from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) observation_columns_only
  from pg_class c where c.oid='private.web_search_attempts'::regclass`)).rows[0];
 if(!webGrants?.can_read||!webGrants.can_append||webGrants.can_rewrite||!webGrants.browser_denied||!webGrants.observation_columns_only)throw new Error('DEVELOPMENT_WEB_ADMISSION_GRANT_VERIFICATION_FAILED');
 if(!observation.can_read||!observation.can_append||observation.can_update||observation.can_delete||!observation.update_timestamp||observation.update_worker)throw new Error('DEVELOPMENT_OBSERVATION_GRANT_VERIFICATION_FAILED');
 const contextGrants=await client.query(`select c.relname,
  has_table_privilege('service_role',c.oid,'SELECT') can_read,has_table_privilege('service_role',c.oid,'INSERT') can_append,
  has_table_privilege('service_role',c.oid,'UPDATE') can_update,has_table_privilege('service_role',c.oid,'DELETE') can_delete,
  not has_table_privilege('anon',c.oid,'SELECT') and not has_table_privilege('authenticated',c.oid,'SELECT') browser_denied,
  (select bool_and(has_column_privilege('service_role',c.oid,a.attname,'UPDATE')=(a.attname<>case when c.relname='structured_selection_epoch' then 'id' else 'ticket_id' end))
   from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) mutable_columns_only
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('structured_selection_epoch','incident_context_proofs')`);
 if(contextGrants.rows.length!==2||contextGrants.rows.some(row=>!row.can_read||row.can_append!==(row.relname==='incident_context_proofs')||row.can_update||row.can_delete||!row.browser_denied||!row.mutable_columns_only))throw new Error('DEVELOPMENT_INCIDENT_CONTEXT_GRANT_VERIFICATION_FAILED');
 const supportGrants=await client.query(`select c.relname,
  has_table_privilege('service_role',c.oid,'SELECT') can_read,has_table_privilege('service_role',c.oid,'INSERT') can_append,
  has_table_privilege('service_role',c.oid,'UPDATE') can_update,has_table_privilege('service_role',c.oid,'DELETE') can_delete
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('ticket_support_contexts','ai_support_outcomes')`);
 const restrictedGrants=await client.query(`select n.nspname||'.'||c.relname as name,
  has_table_privilege('service_role',c.oid,'SELECT') can_read,has_table_privilege('service_role',c.oid,'INSERT') can_append,
  has_table_privilege('service_role',c.oid,'UPDATE') can_update,has_table_privilege('service_role',c.oid,'DELETE') can_delete,
  (select bool_or(has_column_privilege('service_role',c.oid,a.attname,'UPDATE')) from pg_attribute a
   where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) any_column_update,
  (select bool_and(has_column_privilege('service_role',c.oid,a.attname,'UPDATE')=(a.attname=any(array['active','is_current','updated_at'])))
   from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) lifecycle_columns_only
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname||'.'||c.relname=any($1::text[])`,[
   [...immutableTables,...retainedTables,...structuredTables.map(name=>`public.${name}`)]]);
 if(restrictedGrants.rows.length!==immutableTables.length+retainedTables.length+structuredTables.length||restrictedGrants.rows.some(row=>
  !row.can_read||!row.can_append||row.can_delete||
  (retainedTables.includes(row.name)?!row.can_update:row.can_update)||
  (immutableTables.includes(row.name)&&row.any_column_update)||
  (structuredTables.some(name=>row.name===`public.${name}`)&&!row.lifecycle_columns_only)))throw new Error('DEVELOPMENT_RESTRICTED_GRANT_VERIFICATION_FAILED');
 if(missingServerGrants.rows[0].count!==0 || !workerPermission.rows[0].allowed ||
  revisionGrants.rows.length!==3 || revisionGrants.rows.some(row=>!row.can_read||!row.can_append||row.can_update||row.can_delete) ||
  !jobGrants.rows[0].can_read||!jobGrants.rows[0].can_append||!jobGrants.rows[0].can_update||jobGrants.rows[0].can_delete||
  supportGrants.rows.length!==2||supportGrants.rows.some(row=>!row.can_read||!row.can_append||row.can_update||row.can_delete)) throw new Error('DEVELOPMENT_SERVER_GRANT_VERIFICATION_FAILED');
 console.log(JSON.stringify({stage:'development_security',tableCount:tables.rows[0].count,allRls:true,
  rolePrivacyFixture:true,effectiveBrowserGrants:true,effectiveServerGrants:true,appendOnlyImportRevisions:true,appendOnlyImportReviews:true,
  immutablePublicationReceipts:true,appendOnlySupportContexts:true,appendOnlySupportOutcomes:true,structuredLifecycleColumnsOnly:true,
  incidentRetention:true,workerObservationTimestampOnly:true,webAdmissionObservationColumnsOnly:true,runtimeOriginalRetention:true,crossDepartmentDenied:true,inactiveDenied:true,anonymousDenied:true,fixtureRolledBack:true}));
} catch(error) {
 await client.query('rollback').catch(()=>undefined);
 const message=error instanceof Error?error.message:'';
 console.error(JSON.stringify({stage:'development_security_failed',code:/^[A-Z_]+$/.test(message)?message:'DATABASE_VERIFICATION_ERROR'}));
 process.exitCode=1;
} finally {await client.end();}
