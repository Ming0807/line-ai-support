import 'dotenv/config';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,basename,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createServerClient} from '@supabase/ssr';
import {createImportSource} from '../../lib/imports/source';
import {createImportJob} from '../../lib/imports/import-staging';
import {unfinishedReviewDraft} from '../../tests/fixtures/import-review';
import {buildReviewWarnings} from '../../lib/imports/review-warnings';
import type {ImportPreview} from '../../lib/imports/import-extraction';

class QaFailure extends Error{constructor(readonly code:string){super(code);}}
function requireQa(value:unknown,code:string):asserts value{if(!value)throw new QaFailure(code);}
const root=process.cwd(),output=resolve('.superpowers/staging/knowledge-backend-qa'),base='http://127.0.0.1:3011',checks:string[]=[];
let pool:Pool|undefined,jobId:string|undefined,stage='configuration';
async function login(account:{email:string;password:string}){
 const jar=new Map<string,string>(),url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 requireQa(url&&key,'AUTH_CONFIGURATION_REQUIRED');
 const client=createServerClient(url,key,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:entries=>{for(const entry of entries)jar.set(entry.name,entry.value);}}});
 const result=await client.auth.signInWithPassword({email:account.email,password:account.password});requireQa(!result.error&&result.data.user,'ACTUAL_AUTH_FAILED');
 return [...jar].map(([name,value])=>`${name}=${encodeURIComponent(value)}`).join('; ');
}
async function call(path:string,status:number,cookie='',body?:unknown,method=body===undefined?'GET':'POST'){
 const response=await fetch(base+path,{method,headers:{cookie,origin:base,host:'127.0.0.1:3011',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 requireQa(response.status===status,'HTTP_'+status+'_EXPECTED');
 requireQa(response.headers.get('cache-control')==='private, no-store, max-age=0'&&response.headers.get('vary')?.split(/\s*,\s*/).includes('Cookie')&&response.headers.get('x-content-type-options')==='nosniff','PRIVATE_HEADERS_REQUIRED');
 return response.json();
}
try{
 requireQa(basename(dirname(root))==='backend-knowledge-api-qa','OWNED_QA_WORKTREE_REQUIRED');
 const runtime=JSON.parse(await readFile(resolve(output,'runtime.json'),'utf8')),target=new URL(runtime.connectionString);
 requireQa(['postgres:','postgresql:'].includes(target.protocol)&&target.hostname==='127.0.0.1'&&target.port==='54422'&&/^\/yru_publication_ui_qa_[a-f0-9]{12}$/.test(target.pathname)&&target.pathname.slice(1)===runtime.database,'OWNED_LOCAL_QA_DATABASE_REQUIRED');
 const credentials=JSON.parse(await readFile(resolve('.superpowers/staging/dev-staff-credentials.json'),'utf8'));
 requireQa(credentials.projectRef===process.env.DEV_SUPABASE_PROJECT_REF&&credentials.accounts.length===3,'DEVELOPMENT_THREE_ROLES_REQUIRED');
 const admin=credentials.accounts.find((a:{role:string})=>a.role==='SUPER_ADMIN'),staff=credentials.accounts.filter((a:{role:string})=>a.role==='STAFF');requireQa(admin&&staff.length===2,'THREE_ROLES_REQUIRED');
 const path='/api/knowledge/imports/not-a-uuid/structured';stage='anonymous_and_staff_auth';
 await call(path,401);await call(path,401,'',{});
 for(const account of staff){const cookie=await login(account);await call(path+'?unknown=1',403,cookie);await call(path,403,cookie,{});}
 checks.push('anonymous_and_two_actual_staff_roles_denied_before_selector_body');
 const cookie=await login(admin);await call(path,404,cookie);await call(path,404,cookie,{});checks.push('actual_admin_invalid_selector404');
 pool=new Pool({connectionString:runtime.connectionString,max:3,application_name:'structured-http-'+randomUUID()});
 requireQa(process.env.ENCRYPTION_KEY,'ENCRYPTION_CONFIGURATION_REQUIRED');
 const config={pool,key:process.env.ENCRYPTION_KEY,originalBackend:'PRIVATE_DATABASE' as const};stage='private_synthetic_fixture';
 const unique=randomUUID(),source=createImportSource({bytes:Buffer.from(`<html><h1>Private QA ${unique}</h1><p>Synthetic internal mapping only.</p><table><tr><th>code</th><th>name</th><th>url</th></tr><tr><td>0001</td><td>ทะเบียน</td><td>https://example.org/registry</td></tr></table></html>`),filename:'structured-http.html',mimeType:'text/html',sourceUrl:null,acquiredFrom:'UPLOAD',fetchedAt:null});
 const created=await createImportJob(admin.id,source,config);requireQa(!created.duplicate,'OWNED_NEW_FIXTURE_REQUIRED');jobId=created.job.id;
 const preview:ImportPreview=(await call('/api/knowledge/analyze',200,cookie,{id:jobId,revision:0})).preview;
 const endpoint='/api/knowledge/imports/'+jobId,boot=(await call(endpoint+'/structured',200,cookie)).source;
 const {reviewRevision,...mappingSource}=boot;requireQa(reviewRevision===0&&mappingSource.sourceChecksum===source.checksum,'EXACT_BOOTSTRAP_REQUIRED');
 await call(endpoint+'/structured?unknown=1',400,cookie);
 const mapping={version:1,registryVersion:'structured-v1',dataset:'university_systems',source:mappingSource,tables:[{tableIndex:0,dataRanges:[{startRowIndex:1,endRowIndex:1}],excludedRanges:[{startRowIndex:0,endRowIndex:0,reason:'HEADER',note:'Reviewed synthetic header'}],fields:{code:{kind:'COLUMN',columnIndex:0,transform:'TEXT_V1',blank:'REJECT'},name:{kind:'COLUMN',columnIndex:1,transform:'TEXT_V1',blank:'REJECT'},description:{kind:'CONSTANT',value:null,note:'Absent description'},url:{kind:'COLUMN',columnIndex:2,transform:'TEXT_V1',blank:'REJECT'},support_url:{kind:'CONSTANT',value:null,note:'Absent support URL'}}}],excludedTables:[]};
 const request={expectedJobRevision:boot.jobRevision,expectedExtractionRevision:boot.extractionRevision,expectedReviewRevision:0,mapping};stage='compiled_mapping_preview';
 const snapshot=(await call(endpoint+'/structured',200,cookie,request)).snapshot;requireQa(snapshot.publicationAvailable===false&&snapshot.plan.rows[0].payload.code==='0001','EXACT_PRIVATE_PREVIEW_REQUIRED');
 const unchanged=(await pool.query('select revision,(select count(*)::int from private.knowledge_import_reviews where job_id=$1) reviews from private.knowledge_import_jobs where id=$1',[jobId])).rows[0];requireQa(unchanged.revision===boot.jobRevision&&unchanged.reviews===0,'PREVIEW_MUTATED_BUSINESS_STATE');checks.push('compiled_source_bootstrap_preview_cells_no_business_mutation');
 const baseDraft=unfinishedReviewDraft(),draft={...baseDraft,schemaVersion:3,chunkPlan:null,metadata:{...baseDraft.metadata,storageMode:'STRUCTURED',datasetType:'university_systems'},structuredMapping:{mapping,acknowledgment:snapshot.acknowledgment},warningDispositions:buildReviewWarnings(preview).map(w=>({warningKey:w.key,status:'UNRESOLVED',reason:null}))};
 const save={expectedJobRevision:boot.jobRevision,expectedExtractionRevision:boot.extractionRevision,expectedReviewRevision:0,draft};stage='compiled_encrypted_review';
 const saved=(await call(endpoint+'/review',200,cookie,save,'PUT')).review;requireQa(saved.reviewRevision===1&&saved.saved.draft.schemaVersion===3,'REVIEW3_SAVE_REQUIRED');
 const loaded=(await call(endpoint+'/review',200,cookie)).review;requireQa(JSON.stringify(loaded.saved.draft)===JSON.stringify(saved.saved.draft),'ENCRYPTED_ROUNDTRIP_REQUIRED');
 const alias='/api/knowledge/imports/'+jobId.toUpperCase(),aliasSource=(await call(alias+'/structured',200,cookie)).source,aliasReview=(await call(alias+'/review',200,cookie)).review;
 requireQa(aliasSource.jobId===jobId&&aliasReview.reviewRevision===1,'CANONICAL_UUID_ALIAS_REQUIRED');checks.push('compiled_uppercase_uuid_source_and_review_aliases');
 await call(endpoint+'/structured',409,cookie,request);
 await call(endpoint+'/review',409,cookie,{...save,expectedReviewRevision:1,draft:baseDraft},'PUT');
 const repeated=(await call(endpoint+'/structured',200,cookie,{...request,expectedReviewRevision:1})).snapshot;requireQa(repeated.acknowledgment.contentDigest===snapshot.acknowledgment.contentDigest,'STABLE_CONTENT_ACK_REQUIRED');checks.push('compiled_review3_roundtrip_stale409_legacy_downgrade409_stable_ack');
 const largeMapping={...mapping,padding:'x'.repeat(256*1024)};await call(endpoint+'/structured',413,cookie,{...request,expectedReviewRevision:1,mapping:largeMapping});await call(endpoint+'/review',413,cookie,{...save,expectedReviewRevision:1,draft:{...draft,structuredMapping:{mapping:largeMapping,acknowledgment:null}}},'PUT');checks.push('compiled_nested_mapping_limit413_both_routes');
 const publication=await call('/api/knowledge/approve',409,cookie,{id:jobId,expectedJobRevision:boot.jobRevision,expectedExtractionRevision:boot.extractionRevision,expectedReviewRevision:1,confirmPublication:true});requireQa(publication.error==='PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE','EXPLICIT_UNAVAILABLE_REQUIRED');checks.push('compiled_schema3_publication_unavailable_no_downgrade');
 const result={status:'PASS',checks,environment:'compiled_owned_localhost3011',authentication:'actual_development_three_roles_via_ssr',businessDatabase:'owned_isolated_qa',syntheticOriginalBackend:'PRIVATE_DATABASE',providerCalls:0,remoteBusinessWrites:0,publications:0};await mkdir(output,{recursive:true});await writeFile(resolve(output,'structured-http-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){const result={status:'FAIL',stage,code:error instanceof QaFailure?error.code:'CONTROLLED_FAILURE',checks};await mkdir(output,{recursive:true});await writeFile(resolve(output,'structured-http-failure.json'),JSON.stringify(result,null,2));console.error(JSON.stringify(result));process.exitCode=1;
}finally{if(pool){if(jobId){await pool.query('delete from private.activities where metadata->>\'importJobId\'=$1',[jobId]);await pool.query('delete from private.knowledge_import_jobs where id=$1',[jobId]);}await pool.end();}}
