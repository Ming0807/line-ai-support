import 'dotenv/config';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {catalogEnvelopeSchema,parseCatalogHistoryForFamily,parseCatalogDetailForDocument} from '../../lib/knowledge/catalog-types.ts';
import {parseAssistanceEnvelope} from '../../lib/imports/assistance-contract.ts';

// Only an existing owned isolated local QA database. No uploads or publication.
const output=resolve('.superpowers/staging/knowledge-backend-qa');
class QaFailure extends Error {constructor(code){super(code);this.code=code;}}
function requireQa(value,code){if(!value)throw new QaFailure(code);}
function privateResponse(response){
 const headers=response.headers();
 requireQa(headers['cache-control']==='private, no-store, max-age=0'&&headers.vary?.split(/\s*,\s*/).includes('Cookie')&&headers['x-content-type-options']==='nosniff','PRIVATE_HEADERS_INVALID');
}
async function get(context,base,path,status=200){
 const response=await context.request.get(new URL(path,base).href,{headers:{accept:'application/json'}});
 requireQa(response.status()===status,'HTTP_STATUS_'+status+'_EXPECTED');
 privateResponse(response);
 return response;
}
async function login(context,account,base){
 const page=await context.newPage();
 try{
  await page.goto(new URL('/login',base).href);
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:45_000});
 }finally{await page.close();}
}
async function businessFingerprint(database){
 // Fixed identifiers; encrypted private values are hashed in memory, never output.
 const tables=['private.knowledge_import_jobs','private.knowledge_import_revisions','private.knowledge_import_reviews','private.knowledge_import_publications','public.documents'];
 const values=[];
 for(const table of tables){
  const row=(await database.query(`select md5(coalesce(string_agg(to_jsonb(t)::text,'\n' order by to_jsonb(t)::text),'')) fingerprint from ${table} t`)).rows[0];
  values.push(row.fingerprint);
 }
 return values.join(':');
}
let browser,database,stage='configuration';
const checks=[];
try{
 await mkdir(output,{recursive:true});
 const runtime=JSON.parse(await readFile(resolve(output,'runtime.json'),'utf8'));
 const target=new URL(runtime.connectionString);
 const name=decodeURIComponent(target.pathname.slice(1));
 requireQa(['postgres:','postgresql:'].includes(target.protocol)&&['127.0.0.1','localhost'].includes(target.hostname)&&target.port==='54422'&&/^yru_publication_ui_qa_[a-f0-9]{12}$/.test(name)&&runtime.database===name,'ISOLATED_DATABASE_REQUIRED');
 const url=new URL(process.env.YRU_QA_BASE_URL??'http://127.0.0.1:3011');
 requireQa(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='3011'&&url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password,'LOCAL_QA_PORT_3011_REQUIRED');
 const base=url.origin;
 const credentials=JSON.parse(await readFile(resolve('.superpowers/staging/dev-staff-credentials.json'),'utf8'));
 requireQa(credentials.projectRef===process.env.DEV_SUPABASE_PROJECT_REF&&credentials.accounts?.length===3,'DEVELOPMENT_CREDENTIALS_REQUIRED');
 const admin=credentials.accounts.find(account=>account.role==='SUPER_ADMIN');
 const staff=credentials.accounts.filter(account=>account.role==='STAFF');
 requireQa(admin&&staff.length===2,'THREE_ROLES_REQUIRED');
 requireQa(Boolean(process.env.YRU_QA_PLAYWRIGHT_PACKAGE),'PLAYWRIGHT_RUNTIME_REQUIRED');
 const {chromium}=createRequire(resolve(process.env.YRU_QA_PLAYWRIGHT_PACKAGE))('playwright');
 database=new Client({connectionString:runtime.connectionString});await database.connect();
 const before=await businessFingerprint(database);
 const fixture=(await database.query(`select d.id document_id,d.document_family_id family_id,p.job_id from public.documents d
  join private.knowledge_import_publications p on p.document_id=d.id where d.approval_status='APPROVED' and d.visibility='INTERNAL' order by d.created_at,d.id limit 1`)).rows[0];
 requireQa(fixture,'RETAINED_SYNTHETIC_FIXTURE_REQUIRED');
 const paths=['/api/knowledge/catalog?unknown=1','/api/knowledge/families/not-a-uuid','/api/knowledge/documents/not-a-uuid','/api/knowledge/imports/not-a-uuid/assistance'];
 browser=await chromium.launch({headless:true});

 stage='anonymous_authorization';
 const anonymous=await browser.newContext();
 for(const path of paths)await get(anonymous,base,path,401);
 await anonymous.close();checks.push('anonymous_four_endpoints_denied_before_input');

 stage='staff_authorization';
 for(const account of staff){
  const context=await browser.newContext();
  try{await login(context,account,base);for(const path of paths)await get(context,base,path,403);}finally{await context.close();}
 }
 checks.push('both_staff_four_endpoints_denied_before_input');

 stage='administrator_catalog';
 const context=await browser.newContext();
 try{
  await login(context,admin,base);
  const catalog=catalogEnvelopeSchema.safeParse(await (await get(context,base,'/api/knowledge/catalog')).json());
  requireQa(catalog.success&&catalog.data.catalog.totalDocuments>=1&&catalog.data.catalog.departments.length===9,'CATALOG_DTO_INVALID');
  const expected=(await database.query("select count(*)::int total from public.documents where approval_status='APPROVED'")).rows[0].total;
  requireQa(catalog.data.catalog.totalDocuments===expected,'CATALOG_TOTAL_INVALID');
  const page=catalogEnvelopeSchema.safeParse(await (await get(context,base,'/api/knowledge/catalog?page=10000&pageSize=1')).json());
  requireQa(page.success&&page.data.catalog.families.length===0&&page.data.catalog.totalDocuments===expected,'CATALOG_PAGINATION_INVALID');
  const literal=catalogEnvelopeSchema.safeParse(await (await get(context,base,'/api/knowledge/catalog?q=%25_')).json());
  requireQa(literal.success&&literal.data.catalog.totalDocuments===0,'LITERAL_SEARCH_INVALID');
  checks.push('admin_catalog_strict_dto_real_totals_pagination_literal_search');

  stage='history_and_detail';
  const history=parseCatalogHistoryForFamily(await (await get(context,base,'/api/knowledge/families/'+fixture.family_id)).json(),fixture.family_id);
  requireQa(history&&history.documents.some(document=>document.id===fixture.document_id),'FAMILY_HISTORY_INVALID');
  const detail=parseCatalogDetailForDocument(await (await get(context,base,'/api/knowledge/documents/'+fixture.document_id)).json(),fixture.document_id);
  requireQa(detail&&detail.summary.storageMode==='RAG'&&detail.summary.lastImportAt!==null&&detail.summary.visibility==='INTERNAL','DOCUMENT_METADATA_INVALID');
  checks.push('admin_family_history_receipt_backed_document_metadata');

  stage='invalid_selectors_and_missing';
  for(const query of ['unknown=1','page=0','page=1&page=2','pageSize=51','status=UNKNOWN','q='])await get(context,base,'/api/knowledge/catalog?'+query,400);
  await get(context,base,'/api/knowledge/families/'+fixture.family_id+'?unknown=1',400);
  await get(context,base,'/api/knowledge/documents/'+fixture.document_id+'?relationsPage=0',400);
  await get(context,base,'/api/knowledge/imports/'+fixture.job_id+'/assistance?unknown=1',400);
  for(const path of ['/api/knowledge/families/','/api/knowledge/documents/'])await get(context,base,path+randomUUID(),404);
  await get(context,base,'/api/knowledge/imports/'+randomUUID()+'/assistance',404);
  for(const path of paths.slice(1))await get(context,base,path,404);
  const unsupported=await context.request.post(new URL('/api/knowledge/catalog',base).href,{data:{}});
  requireQa(unsupported.status()===405,'UNSUPPORTED_POST_NOT_DENIED');
  checks.push('invalid_duplicate_bounded_selectors_missing_ids_and_unsupported_post');

  stage='revision_bound_assistance';
  const preview=await (await get(context,base,'/api/knowledge/imports/'+fixture.job_id+'/preview')).json();
  requireQa(preview.preview?.job.id===fixture.job_id,'PRIVATE_PREVIEW_INVALID');
  const binding={jobId:fixture.job_id,jobRevision:preview.preview.job.revision,extractionRevision:preview.preview.extractionRevision};
  const assistance=parseAssistanceEnvelope(await (await get(context,base,'/api/knowledge/imports/'+fixture.job_id+'/assistance')).json(),binding);
  requireQa(assistance&&assistance.metadata.visibility==='INTERNAL'&&assistance.origins.visibility.kind==='DEFAULT'&&assistance.metadata.authorityLevel===null,'BOUND_ASSISTANCE_INVALID');
  requireQa(assistance.departments.length===9&&assistance.families.some(family=>family.code===history.family.code),'ASSISTANCE_REFERENCES_INVALID');
  requireQa(parseAssistanceEnvelope({assistance},{...binding,extractionRevision:binding.extractionRevision+1})===null,'STALE_PROPOSAL_ACCEPTED');
  checks.push('private_source_assistance_exact_revision_origins_actual_references');

  stage='retained_original_and_no_mutations';
  const originalPath='/api/knowledge/imports/'+fixture.job_id+'/original';
  const first=await (await get(context,base,originalPath)).body();
  await get(context,base,'/api/knowledge/imports/'+fixture.job_id+'/assistance');
  const second=await (await get(context,base,originalPath)).body();
  requireQa(first.length>0&&createHash('sha256').update(first).digest('hex')===createHash('sha256').update(second).digest('hex'),'ORIGINAL_BYTES_CHANGED');
  requireQa(before===await businessFingerprint(database),'BUSINESS_STATE_CHANGED');
  checks.push('original_byte_equality_business_history_and_publications_unchanged');
 }finally{await context.close();}
 const result={status:'PASS',checks,environment:'compiled_localhost_3011',database:'owned_isolated_qa',authentication:'actual_development_three_roles',storage:'actual_retained_private_storage',source:'synthetic_internal_only',remoteDatabaseWrites:0,providerCalls:0,publicationWrites:0,auditReadsAllowed:true};
 await writeFile(resolve(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
 const code=error instanceof QaFailure?error.code:error?.name==='TimeoutError'?'BROWSER_TIMEOUT':'CONTROLLED_FAILURE';
 const result={status:'FAIL',stage,code,checks};
 await mkdir(output,{recursive:true});await writeFile(resolve(output,'failure.json'),JSON.stringify(result,null,2));console.error(JSON.stringify(result));process.exitCode=1;
}finally{if(browser)await browser.close().catch(()=>undefined);if(database)await database.end().catch(()=>undefined);}
