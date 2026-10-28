import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,unlink,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
assert.equal(resolve(process.cwd()),root,'WORKSPACE_ROOT_REQUIRED');
const container='supabase_db_line-ai-yru',database=`yru_structured_schema_${randomUUID().replaceAll('-','').slice(0,12)}`;
assert(/^yru_structured_schema_[a-f0-9]{12}$/.test(database),'DISPOSABLE_DATABASE_REQUIRED');
function command(args:string[],input?:string):string {
 return execFileSync('docker',['exec',...(input===undefined?[]:['-i']),container,...args],
  {encoding:'utf8',input,windowsHide:true,maxBuffer:16*1024*1024,timeout:60_000,stdio:['pipe','pipe','pipe']});
}
function sql(target:string,role:string,input:string):string {
 return command(['psql','-X','-At','-U',role,'-d',target,'-v','ON_ERROR_STOP=1'],input);
}
const installedCount="select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements') and c.relkind='r';";
const advisorSchema=z.object({results:z.array(z.object({name:z.string(),level:z.enum(['INFO','WARN','ERROR']),cacheKey:z.string(),metadata:z.record(z.string(),z.unknown()).default({})}))});
const cli=process.env.YRU_SUPABASE_CLI_PATH;
function advisors(){
 assert(cli,'YRU_SUPABASE_CLI_PATH_REQUIRED');
 const output=execFileSync(cli,['db','advisors','--db-url',`postgresql://postgres:postgres@127.0.0.1:54422/${database}`,'--type','all','--level','info','--fail-on','none','--output-format','json'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:60_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 return advisorSchema.parse(JSON.parse(output)).results;
}
let created=false,stage='preflight',normalTables='';
let baselineAdvisors:ReturnType<typeof advisors>=[];
const ragFixture=resolve(root,'tests/database',`.structured-rag-${randomUUID().replaceAll('-','')}.integration.ts`);
assert.equal(dirname(ragFixture),resolve(root,'tests/database'),'OWNED_TEST_FIXTURE_DIRECTORY_REQUIRED');
let ragFixtureCreated=false;
try {
 assert.equal(sql('postgres','supabase_admin',`select count(*) from pg_database where datname='${database}';`).trim(),'0','DATABASE_MUST_NOT_EXIST');
 normalTables=sql('postgres','supabase_admin',installedCount).trim();
 const auth=command(['pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--schema=auth','--no-owner','--no-privileges']);
 assert(auth.includes('CREATE SCHEMA auth'),'AUTH_SCHEMA_BOOTSTRAP_REQUIRED');
 stage='create';sql('postgres','supabase_admin',`create database ${database} owner postgres;`);created=true;
 stage='bootstrap';sql(database,'supabase_admin',auth);
 sql(database,'supabase_admin',`create schema extensions;create extension vector with schema extensions;
  grant usage on schema auth,extensions to postgres,anon,authenticated,service_role;
  grant references,select,insert,delete on auth.users to postgres;`);
 const migrations=(await readdir(resolve(root,'supabase/migrations'))).filter(name=>/^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
 assert(migrations.length>0,'APPLICATION_MIGRATIONS_REQUIRED');
 for(const name of migrations){
  if(cli&&name==='20261007095535_yru_fixed_structured_knowledge.sql'){stage='baseline_isolated_advisors';baselineAdvisors=advisors();}
  stage=`migration:${name}`;
  sql(database,'postgres',`begin;set local statement_timeout='10s';\n${await readFile(resolve(root,'supabase/migrations',name),'utf8')}\ncommit;`);
 }
 stage='foundation_RLS';sql(database,'supabase_admin',await readFile(resolve(root,'tests/database/foundation.sql'),'utf8'));
 sql(database,'postgres',await readFile(resolve(root,'supabase/seed.sql'),'utf8'));
  // Run bounded-catalog concurrency cases before unrelated suites retain hundreds of references.
stage='import_model_assistance_actual_PG';
 assert.equal(sql(database,'postgres',"select count(*) from public.departments where code !~ '^[A-Z][A-Z0-9_]{1,79}$';").trim(),'0','SHARED_IMPORT_FIXTURE_DEPARTMENT_CODES_INVALID');
 const importModelOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/import-model-assistance.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(importModelOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='ai_turn_budget_actual_PG';
 const turnBudgetOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/ai-turn-budget.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(turnBudgetOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='database_pool_resilience_actual_PG';
 const poolResilienceOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/database-pool-resilience.integration.ts','tests/database/outbox-connection-loss.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(poolResilienceOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='ddgs_admission_actual_PG';
 const ddgsOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/ddgs-admission.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(ddgsOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='public_service_transcription_actual_PG';
 const transcriptionOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/import-public-structured.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(transcriptionOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='public_family_catalog_actual_PG';
 const familyCatalogOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/family-catalog.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(familyCatalogOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='owned_web_leads_actual_PG';
 const ownedWebOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/owned-web-fallback.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(ownedWebOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='web_search_admission_actual_PG';
 const webSearchOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/web-search-admission.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(webSearchOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='rag_catalog_fence_actual_PG';
 const ragFenceOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/rag-catalog-fence.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(ragFenceOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='internal_miss_actual_PG';
 const internalMissOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/internal-miss.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(internalMissOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='incident_context_infrastructure_actual_PG';
 const contextInfrastructureOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/incident-context-infrastructure.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(contextInfrastructureOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='worker_observations_actual_PG';
 const workerObservationOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/worker-observations.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(workerObservationOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='support_business_flow_actual_PG';
 const businessOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/support-business-flow.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(businessOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='support_state_actual_PG';
 const supportOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/ai-support-state.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(supportOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='support_worker_actual_PG';
 const supportWorkerOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/ai-support-worker.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(supportWorkerOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='ticket_support_context_actual_PG';
 const contextOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/ticket-support-context.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(contextOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='live_human_continuation_actual_PG';
 const liveContinuationOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/live-human-continuation.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(liveContinuationOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='ticket_security_actual_PG';
 const ticketSecurityOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/ticket-security.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(ticketSecurityOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='staff_alert_coalescing_actual_PG';
 const alertOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/staff-alert-coalescing.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(alertOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='staff_line_chat_actual_PG';
 const staffChatOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/staff-line-chat.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(staffChatOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='incident_batch_preview_actual_PG';
 const batchPreviewOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/incident-batch-preview.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(batchPreviewOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='incident_batch_confirm_retry_actual_PG';
 const batchConfirmOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/incident-batch-confirm.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(batchConfirmOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='assistant_conversation_actual_PG';
 const assistantConversationOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/assistant-conversation.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(assistantConversationOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='semantic_routing_actual_PG';
 const semanticOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/semantic-context-routing.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(semanticOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='typed_context_choice_actual_PG';
 const typedChoiceOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/typed-context-choice.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(typedChoiceOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='staff_knowledge_actual_PG';
 const knowledgeAssistOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/staff-knowledge-assistance.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(knowledgeAssistOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='staff_assistance_actual_PG';
 const assistOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/staff-ai-assistance.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(assistOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='staff_copilot_and_gap_actual_PG';
 const copilotOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/staff-copilot.integration.ts','tests/database/knowledge-gap-miner.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(copilotOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='structured_actual_PG';
 const output=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/structured-schema.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 // Only synthetic test output; never dump SQL fixtures, auth data or environment.
 console.log(output.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 assert.equal(sql(database,'supabase_admin',installedCount).trim(),'7','SEVEN_STRUCTURED_TABLES_REQUIRED');
 // Current source registers77 cases; retain every unique case with the same120s bound.
 const runtimePattern='^(?:incident runtime|source invalidation|unreadable owned|a lower current|valid ambiguous|publication and revision changes|corrupted proof|HUMAN staff|RAG fallback|actual structured AI|LINE dispatch|service department|typed structured tool|only canonical)';
 const datasetPattern='^(?:academic_calendar_events|tuition_fees|transfer_courses|university_services|university_systems|service_forms|announcements)';
 const incidentPattern='^(?:incident runtime|source invalidation|unreadable owned|a lower current|valid ambiguous|publication and revision changes|corrupted proof|HUMAN staff)';
 const guardrailPattern='^(?:actual COMMIT|owned solved|actual support-enabled|non-Structured|HUMAN Staff fallback)';
 const partitions=[
  ['publication_datasets',[`--test-name-pattern=${datasetPattern}`]],
  ['publication_other',[`--test-skip-pattern=(?:${runtimePattern}|${datasetPattern}|${guardrailPattern})`]],
  ['publication_guardrails',[`--test-name-pattern=${guardrailPattern}`,`--test-skip-pattern=(?:${runtimePattern}|${datasetPattern})`]],
  ['delivery_incidents',[`--test-name-pattern=${incidentPattern}`]],
  ['delivery_other',[`--test-name-pattern=${runtimePattern}`,`--test-skip-pattern=${incidentPattern}`]],
 ] as const;
 let publicationCases=0;
 const publicationCaseNames:string[]=[];
 for(const [name,filters] of partitions){
  stage=`structured_${name}_actual_PG`;
  const publicationOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1',...filters,'tests/database/import-structured-publication.integration.ts'],
   {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
  const executed=Number(publicationOutput.match(/^ℹ tests (\d+)$/mu)?.[1]);
  assert(Number.isSafeInteger(executed)&&executed>0,'PUBLICATION_PARTITION_MUST_EXECUTE_CASES');
  const names=[...publicationOutput.matchAll(/^✔ (.+) \([\d.]+ms\)$/gmu)].map(match=>match[1]);
  assert.equal(names.length,executed,'EVERY_EXECUTED_PUBLICATION_CASE_MUST_BE_NAMED');
  publicationCaseNames.push(...names);
  publicationCases+=executed;
  console.log(JSON.stringify({stage,partition:name,executed}));
  console.log(publicationOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 }
 assert.equal(publicationCases,77,'ALL_PUBLICATION_AND_DELIVERY_CASES_REQUIRED');
 assert.equal(new Set(publicationCaseNames).size,77,'PUBLICATION_PARTITIONS_MUST_NOT_OVERLAP');
 console.log(JSON.stringify({stage:'publication_unique_coverage',cases:publicationCaseNames.length,unique:new Set(publicationCaseNames).size,names:publicationCaseNames}));
 stage='RAG_compatibility_actual_PG';
 const original=await readFile(resolve(root,'tests/database/import-publication.integration.ts'),'utf8');
 const normalConnection='postgresql://postgres:postgres@127.0.0.1:54422/postgres';
 assert(original.includes(normalConnection),'RAG_FIXTURE_CONNECTION_REQUIRED');
 const isolated=original.replaceAll(normalConnection,`postgresql://postgres:postgres@127.0.0.1:54422/${database}`);
 assert(!isolated.includes(normalConnection),'NORMAL_CONNECTION_FORBIDDEN');
 await writeFile(ragFixture,isolated,{flag:'wx'});ragFixtureCreated=true;
 const ragOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1',ragFixture],
  {cwd:root,encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(JSON.stringify({stage:'RAG_compatibility_actual_PG',source:'tests/database/import-publication.integration.ts',status:'PASS',networkSender:'MOCK',connectionOnlyRewritten:true}));
 console.log(ragOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='operations_reads_actual_PG';
 const operationsOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/operations-reads.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(operationsOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='LINE_loading_worker_actual_PG';
 const loadingOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/line-loading-worker.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(loadingOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='structured_readiness_actual_PG';
 const readinessOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/structured-readiness.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(readinessOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='incidents_actual_PG';
 const incidentOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/incidents.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(incidentOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='staff_binding_actual_PG';
 const bindingOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/staff-line-binding.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(bindingOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 // These flows publish retained PUBLIC fixtures; run last so earlier miss witnesses stay isolated.
 stage='v1_combined_flows_actual_PG';
 const combinedOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/v1-business-flows.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(combinedOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='assistant_grounding_actual_PG';
 const assistantGroundingOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/assistant-grounding.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(assistantGroundingOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='assistant_eval_publication_actual_PG';
 assert.equal(sql(database,'postgres',"select count(*) from public.departments where code !~ '^[A-Z][A-Z0-9_]{1,79}$';").trim(),'0','SHARED_IMPORT_FIXTURE_DEPARTMENT_CODES_INVALID');
 const assistantPublicationOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/assistant-eval-publication.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(assistantPublicationOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='reviewed_grade_policy_actual_PG';
 const gradePolicyOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/import-policy-grades.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(gradePolicyOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 stage='reviewed_public_sources_actual_PG';
 const publicSourceOutput=execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/database/import-public-source-review.integration.ts'],
  {cwd:root,env:{...process.env,YRU_STRUCTURED_SCHEMA_DATABASE:database},encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(publicSourceOutput.split(/\r?\n/u).filter(line=>/^ℹ/u.test(line)).join('\n'));
 if(cli){
  stage='isolated_advisors';
  const version=execFileSync(cli,['--version'],{encoding:'utf8',windowsHide:true,timeout:10_000,stdio:['pipe','pipe','pipe']}).trim();
  const current=advisors(),known=new Set(baselineAdvisors.map(finding=>`${finding.cacheKey}:${finding.level}`));
  const added=current.filter(finding=>!known.has(`${finding.cacheKey}:${finding.level}`));
  const counts=(findings:typeof current)=>Object.fromEntries(['ERROR','WARN','INFO'].map(level=>[level,findings.filter(finding=>finding.level===level).length]));
  console.log(JSON.stringify({stage:'isolated_advisors',version,baseline:counts(baselineAdvisors),current:counts(current),added:added.map(finding=>({name:finding.name,level:finding.level,schema:finding.metadata.schema,object:finding.metadata.name}))}));
  assert(!added.some(finding=>finding.level==='ERROR'||finding.level==='WARN'),'NEW_SCHEMA_ADVISOR_ERROR_OR_WARNING');
  assert(!added.some(finding=>finding.name==='unindexed_foreign_keys'),'STRUCTURED_FK_COVERAGE_REQUIRED');
 }else console.log(JSON.stringify({stage:'isolated_advisors',status:'NOT_RUN',reason:'YRU_SUPABASE_CLI_PATH_REQUIRED'}));
 assert.equal(sql('postgres','supabase_admin',installedCount).trim(),normalTables,'NORMAL_SCHEMA_CHANGED');
 console.log(JSON.stringify({stage:'isolated_structured_schema',migrations:migrations.length,tables:7,foundationRLS:'PASS',status:'PASS',normalTables:Number(normalTables),normalSchemaApplied:false,authDataCopied:false,existingDatabaseReset:false}));
} catch(error) {
 // node:test labels are synthetic and useful; migration stderr can contain SQL values and is suppressed.
 if(stage.endsWith('actual_PG')&&error&&typeof error==='object'&&'stdout' in error&&typeof error.stdout==='string'){
  let diagnostic=error.stdout;
  for(const [name,value] of Object.entries(process.env))if(value&&value.length>=8&&/KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|DIRECT_URL/u.test(name))diagnostic=diagnostic.split(value).join('[REDACTED]');
  await mkdir(resolve(root,'.superpowers/staging'),{recursive:true});
  await writeFile(resolve(root,'.superpowers/staging/structured-acceptance-failure.log'),diagnostic);
  console.error(error.stdout.split(/\r?\n/u).filter(line=>/^(✔|✖|ℹ|  error:|  AssertionError|    code:)/u.test(line)).slice(-90).join('\n'));
 }
 const processFailure=error&&typeof error==='object'?error as {code?:unknown;signal?:unknown;status?:unknown;killed?:unknown}:{};
 console.error(JSON.stringify({stage,status:'FAIL',
  processCode:typeof processFailure.code==='string'&&/^[A-Z0-9_]{1,32}$/u.test(processFailure.code)?processFailure.code:undefined,
  processSignal:typeof processFailure.signal==='string'&&/^SIG[A-Z0-9]{1,16}$/u.test(processFailure.signal)?processFailure.signal:undefined,
  processStatus:typeof processFailure.status==='number'?processFailure.status:undefined,
  processKilled:typeof processFailure.killed==='boolean'?processFailure.killed:undefined,
 }));process.exitCode=1;
} finally {
 if(ragFixtureCreated){
  try{
   assert.equal(dirname(ragFixture),resolve(root,'tests/database'));
   assert(/\.structured-rag-[a-f0-9]{32}\.integration\.ts$/u.test(ragFixture));
   await unlink(ragFixture);
  }catch{console.error('OWNED_RAG_FIXTURE_CLEANUP_FAILED');process.exitCode=1;}
 }
 if(created){
  try {
   assert(/^yru_structured_schema_[a-f0-9]{12}$/.test(database));
   assert.equal(sql('postgres','supabase_admin',`select r.rolname from pg_database d join pg_roles r on r.oid=d.datdba where d.datname='${database}';`).trim(),'postgres','DISPOSABLE_DATABASE_OWNER_CHANGED');
   sql('postgres','supabase_admin',`drop database ${database};`);
   console.log(JSON.stringify({stage:'owned_disposable_cleanup',status:'PASS'}));
  } catch {console.error('DISPOSABLE_STRUCTURED_CLEANUP_FAILED');process.exitCode=1;}
 }
}
