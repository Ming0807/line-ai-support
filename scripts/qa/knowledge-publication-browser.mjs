import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Client} from 'pg';

const OUTPUT=resolve('.superpowers/staging/import-preview/publication-browser');
const CREDENTIALS=resolve('.superpowers/staging/dev-staff-credentials.json');
const DATABASE_PREFIX='yru_publication_ui_qa_';
const EXPECTED_EMBEDDING_FINGERPRINT='42259817e85c6d44dc81af6b26fe209c9b744c6342eb4ac1c6bbd2bcdd032f82';
const APPROVE_PATH='/api/knowledge/approve';
const APPROVE_BODY_KEYS=['id','expectedJobRevision','expectedExtractionRevision','expectedReviewRevision','confirmPublication'];
const RECEIPT_KEYS=['jobId','jobRevision','extractionRevision','reviewRevision','documentId','familyId','storageMode','action','relationship','planDigest','createdAt'];

class QaFailure extends Error{
 constructor(code){super(code);this.name='QaFailure';this.code=code;}
}

function requireQa(condition,code){if(!condition)throw new QaFailure(code);}
function expectStatus(response,statuses,code){requireQa(statuses.includes(response.status()),code);}
function apiUrl(base,path){return new URL(path,base).href;}
function pathIs(url,path){try{return new URL(url).pathname===path;}catch{return false;}}
function validLocalBase(value){
 let parsed;
 try{parsed=new URL(value);}catch{throw new QaFailure('APP_BASE_URL_INVALID');}
 requireQa(parsed.protocol==='http:'&&parsed.hostname==='localhost'&&parsed.port==='3001'&&parsed.pathname==='/'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash,'APP_BASE_URL_MUST_BE_LOCALHOST_3001');
 return parsed.origin;
}
function validDatabaseTarget(value){
 let parsed;
 try{parsed=new URL(value);}catch{throw new QaFailure('PUB_QA_DATABASE_URL_INVALID');}
 requireQa(['postgres:','postgresql:'].includes(parsed.protocol)&&['localhost','127.0.0.1'].includes(parsed.hostname)&&parsed.port==='54422'&&!parsed.hash,'PUB_QA_DATABASE_URL_MUST_BE_LOCAL');
 const databaseName=decodeURIComponent(parsed.pathname.replace(/^\/+/u,''));
 requireQa(new RegExp('^'+DATABASE_PREFIX+'[a-f0-9]{12}$','u').test(databaseName),'PUB_QA_DATABASE_NAME_INVALID');
 return {databaseName,connectionString:value};
}
function fixedErrorCode(error){
 if(error instanceof QaFailure)return error.code;
 if(error?.name==='TimeoutError')return 'BROWSER_TIMEOUT';
 if(error?.name==='AssertionError')return 'ASSERTION';
 return 'CONTROLLED_FAILURE';
}
async function readJson(response,code){
 expectStatus(response,[200,201],code);
 try{return await response.json();}catch{throw new QaFailure(code);}
}
async function writeProgress(stage,checkCount){
 await writeFile(resolve(OUTPUT,'progress.json'),JSON.stringify({stage,checkCount},null,2));
}
function addCheck(checks,name){checks.push(name);}
function receiptEqual(left,right){
 return RECEIPT_KEYS.every(key=>left?.[key]===right?.[key]);
}
function sameApprovalBody(left,right){
 return APPROVE_BODY_KEYS.every(key=>left?.[key]===right?.[key])&&
  Object.keys(left??{}).length===APPROVE_BODY_KEYS.length&&Object.keys(right??{}).length===APPROVE_BODY_KEYS.length;
}
function publicationRoutePath(jobId){return '/api/knowledge/imports/'+encodeURIComponent(jobId)+'/publication';}
function reviewRoutePath(jobId){return '/api/knowledge/imports/'+encodeURIComponent(jobId)+'/review';}
function planRoutePath(jobId,binding){
 const query=new URLSearchParams({
  expectedJobRevision:String(binding.jobRevision),
  expectedExtractionRevision:String(binding.extractionRevision),
  expectedReviewRevision:String(binding.reviewRevision),
 });
 return '/api/knowledge/imports/'+encodeURIComponent(jobId)+'/chunks?'+query.toString();
}
function makeDraft(warnings,nonce){
 const unique=nonce.replaceAll('-','').slice(0,16).toUpperCase();
 return {
  schemaVersion:2,
  metadata:{
   title:'Synthetic INTERNAL publication browser QA '+unique,
   familyCode:'PUBQA_'+unique,
   newFamily:{name:'Synthetic internal browser QA',category:'QA'},
   departmentCode:'IT',
   documentType:'GUIDE',
   versionName:'Reviewed browser fixture',
   versionStream:'ALL',
   academicYear:null,
   scope:{semester:null,audience:'ALL',studentType:'ALL',programCode:null,curriculumCode:null,cohort:null},
   publishedAt:'2026-10-06',
   effectiveFrom:'2026-10-06',
   effectiveTo:null,
   authorityLevel:70,
   sourceUrl:null,
   sourcePageUrl:null,
   visibility:'INTERNAL',
   storageMode:'RAG',
   datasetType:null,
  },
  action:'NEW_FAMILY',
  target:null,
  relationship:null,
  attestations:{
   sourceAuthorityReviewed:true,
   extractionReviewed:true,
   applicabilityReviewed:true,
   sensitivityReviewed:true,
   versionReviewed:true,
  },
  warningDispositions:warnings.map(warning=>({
   warningKey:warning.key,
   status:'CORRECTED',
   reason:'Synthetic original and measured extraction checked for isolated QA.',
  })),
  chunkPlan:null,
 };
}
function syntheticHtml(nonce){
 const marker=nonce.replaceAll('-','');
 return Buffer.from([
  '<!doctype html>',
  '<html lang=\"th\"><head><meta charset=\"utf-8\"><title>Synthetic INTERNAL QA</title></head><body>',
  '<h1>เอกสารสังเคราะห์สำหรับทดสอบการอนุมัติ '+marker+'</h1>',
  '<p>เอกสารนี้สร้างขึ้นเพื่อทดสอบขั้นตอนทบทวนและอนุมัติในฐานข้อมูลแยกสำหรับ QA เท่านั้น ไม่มีเนื้อหาจากเอกสารมหาวิทยาลัยจริง และไม่มีการอนุมัติชุดความรู้จริง</p>',
  '<p>ขั้นตอนสังเคราะห์: ผู้ตรวจอ่านต้นฉบับที่เก็บไว้ ตรวจข้อความและตำแหน่งจากตัวอ่าน ยืนยันขอบเขตภายใน แล้วตรวจผลจากใบรับรองหลังอนุมัติ</p>',
  '<table><tr><td>รายการทดสอบ</td><td>ผลที่คาด</td><td></td></tr><tr><td>ยืนยันด้วยมือ</td><td>ต้องเลือกช่องยืนยันเอง</td><td></td></tr></table>',
  '</body></html>',
 ].join('\n'),'utf8');
}
async function login(page,account,base){
 await page.goto(apiUrl(base,'/login'));
 await page.locator('input[name=\"email\"]').fill(account.email);
 await page.locator('input[name=\"password\"]').fill(account.password);
 await page.locator('button[type=\"submit\"]').click();
 await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:45_000});
}
async function publishableApiDraft(page,base,jobId){
 const reviewPath=reviewRoutePath(jobId);
 const fetched=await page.request.get(apiUrl(base,reviewPath),{headers:{accept:'application/json'}});
 const fetchedBody=await readJson(fetched,'REVIEW_GET_FAILED');
 const current=fetchedBody.review;
 requireQa(current&&Array.isArray(current.warnings),'REVIEW_DTO_INVALID');
 const draft=makeDraft(current.warnings,jobId);
 const save=async(nextDraft,binding,code)=>{
  const response=await page.request.put(apiUrl(base,reviewPath),{
   headers:{origin:base,accept:'application/json','content-type':'application/json'},
   data:{
    expectedJobRevision:binding.jobRevision,
    expectedExtractionRevision:binding.extractionRevision,
    expectedReviewRevision:binding.reviewRevision,
    draft:nextDraft,
   },
  });
  const body=await readJson(response,code);
  return body.review;
 };
 const first=await save(draft,{
  jobRevision:current.jobRevision,
  extractionRevision:current.extractionRevision,
  reviewRevision:current.reviewRevision,
 },'INITIAL_REVIEW_SAVE_FAILED');
 const planResponse=await page.request.get(apiUrl(base,planRoutePath(jobId,first)),{headers:{accept:'application/json'}});
 const planBody=await readJson(planResponse,'LOCATED_PLAN_FAILED');
 const snapshot=planBody.snapshot;
 requireQa(snapshot&&snapshot.plan&&Array.isArray(snapshot.plan.chunks)&&snapshot.plan.chunks.length>0,'LOCATED_PLAN_DTO_INVALID');
 requireQa(snapshot.plan.embeddingFingerprint===EXPECTED_EMBEDDING_FINGERPRINT,'LOCATED_PLAN_E5_FINGERPRINT_MISMATCH');
 requireQa(snapshot.plan.chunks.every(chunk=>typeof chunk.content==='string'&&chunk.passageTokenCount<=512&&chunk.sourceLocations?.length>0),'LOCATED_PLAN_CHUNK_INVALID');
 const acknowledged={...draft,chunkPlan:{digest:snapshot.plan.digest,chunkerVersion:'located-e5-v1'}};
 const saved=await save(acknowledged,{
  jobRevision:first.jobRevision,
  extractionRevision:first.extractionRevision,
  reviewRevision:first.reviewRevision,
 },'ACKNOWLEDGED_REVIEW_SAVE_FAILED');
 requireQa(saved.saved?.draft?.schemaVersion===2&&saved.saved.draft.chunkPlan?.digest===snapshot.plan.digest,'SAVED_V2_PLAN_ACK_INVALID');
 requireQa(Object.values(saved.saved.draft.attestations).every(Boolean),'ATTESTATION_FIXTURE_INCOMPLETE');
 return {saved,plan:snapshot.plan,draft:acknowledged};
}
async function waitForPromise(promise,code,timeoutMs=12_000){
 let timer;
 try{
  await Promise.race([
   promise,
   new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new QaFailure(code)),timeoutMs);}),
  ]);
 }finally{clearTimeout(timer);}
}
async function run(){
 let stage='environment';
 const checks=[];
 let browser=null;
 let page=null;
 let database=null;
 let routeRelease=null;
 try{
  await mkdir(OUTPUT,{recursive:true});
  const base=validLocalBase(process.env.APP_BASE_URL??'http://localhost:3001');
  const dbTarget=validDatabaseTarget(process.env.PUB_QA_DATABASE_URL??'');
  const runtime=process.env.PLAYWRIGHT_RUNTIME_PATH;
  requireQa(typeof runtime==='string'&&runtime.length>0,'PLAYWRIGHT_RUNTIME_PATH_REQUIRED');
  const credentials=JSON.parse(await readFile(CREDENTIALS,'utf8'));
  const accounts=credentials.accounts;
  requireQa(credentials.projectRef==='tqgbodenouvcwepoxwbu','DEVELOPMENT_AUTH_PROJECT_MISMATCH');
  const admin=accounts.find(account=>account.role==='SUPER_ADMIN');
  const staff=accounts.filter(account=>account.role==='STAFF');
  requireQa(admin&&typeof admin.email==='string'&&typeof admin.password==='string'&&staff.length===2&&staff.every(account=>account.email&&account.password),'DEVELOPMENT_AUTH_FIXTURE_INVALID');
  const {chromium}=createRequire(resolve(runtime,'package.json'))('playwright');
  database=new Client({connectionString:dbTarget.connectionString,application_name:'pub04_approval_browser_qa',connectionTimeoutMillis:10_000});
  await database.connect();
  const databaseCheck=(await database.query('select current_database() as name')).rows[0];
  requireQa(databaseCheck?.name===dbTarget.databaseName,'CONNECTED_DATABASE_MISMATCH');
  addCheck(checks,'local_only_environment_and_owned_database_verified');
  await writeProgress(stage,checks.length);
  browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(45_000);
  let browserProviderRequests=0;
  let approvalPostRequests=0;
  let pageErrorSeen=false;
  page.on('pageerror',()=>{pageErrorSeen=true;});
  page.on('request',request=>{
   try{
    const url=new URL(request.url());
    if((url.hostname==='localhost'||url.hostname==='127.0.0.1')&&url.port==='8000')browserProviderRequests++;
    if(url.pathname===APPROVE_PATH&&request.method()==='POST'){
     approvalPostRequests++;
    }
   }catch{/* Ignore non-URL browser events without logging them. */}
  });
  stage='login_and_synthetic_source';
  await writeProgress(stage,checks.length);
  await login(page,admin,base);
  const nonce=randomUUID();
  const original=syntheticHtml(nonce);
  const filename='synthetic-internal-publication-qa-'+nonce.replaceAll('-','')+'.html';
  await page.goto(apiUrl(base,'/knowledge/import'));
  await page.getByLabel('เลือกไฟล์ PDF, Word, Excel, CSV หรือ HTML').setInputFiles({name:filename,mimeType:'text/html',buffer:original});
  const initialPublicationPattern='**/api/knowledge/imports/*/publication';
  let initialEnteredResolve;
  const initialEntered=new Promise(resolveEntered=>{initialEnteredResolve=resolveEntered;});
  let initialReleaseResolve;
  const initialHeld=new Promise(resolveHeld=>{initialReleaseResolve=resolveHeld;});
  let initialGateUsed=false;
  const initialPublicationGate=async route=>{
   if(!initialGateUsed&&route.request().method()==='GET'){
    initialGateUsed=true;
    initialEnteredResolve();
    await initialHeld;
    const response=await route.fetch();
    await route.fulfill({response});
   }else await route.continue();
  };
  await page.route(initialPublicationPattern,initialPublicationGate);
  const uploadWait=page.waitForResponse(response=>pathIs(response.url(),'/api/knowledge/import')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'รับต้นฉบับเพื่อเตรียมตรวจ',exact:true}).click();
  const upload=await uploadWait;
  expectStatus(upload,[201],'SYNTHETIC_UPLOAD_FAILED');
  const uploaded=await readJson(upload,'SYNTHETIC_UPLOAD_DTO_INVALID');
  const jobId=uploaded?.job?.id;
  requireQa(typeof jobId==='string'&&/^[0-9a-f-]{36}$/u.test(jobId),'SYNTHETIC_JOB_DTO_INVALID');
  const analyzeControl=page.getByRole('button',{name:'วิเคราะห์เอกสาร',exact:true});
  await analyzeControl.waitFor({state:'visible'});
  await waitForPromise(initialEntered,'INITIAL_PUBLICATION_READ_NOT_STARTED');
  requireQa(await analyzeControl.isDisabled(),'ANALYZE_ENABLED_BEFORE_RECEIPT_READ');
  const initialReceiptResponse=page.waitForResponse(response=>pathIs(response.url(),publicationRoutePath(jobId))&&response.request().method()==='GET');
  initialReleaseResolve();
  expectStatus(await initialReceiptResponse,[200],'INITIAL_PUBLICATION_READ_FAILED');
  await page.unroute(initialPublicationPattern,initialPublicationGate);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent?.trim()==='วิเคราะห์เอกสาร'&&button.disabled===false));
  requireQa(await analyzeControl.isEnabled(),'ANALYZE_DID_NOT_UNLOCK_AFTER_NULL_RECEIPT');
  const analysisWait=page.waitForResponse(response=>pathIs(response.url(),'/api/knowledge/analyze')&&response.request().method()==='POST');
  await analyzeControl.click();
  expectStatus(await analysisWait,[200],'SYNTHETIC_ANALYSIS_FAILED');
  stage='parsed_source_render';
  await writeProgress(stage,checks.length);
   const sourceText=page.locator('.knowledge-page-editor textarea');
  await sourceText.waitFor({state:'visible'});
  await page.locator('section[aria-labelledby=\"review-draft-title\"]').waitFor();
  addCheck(checks,'fresh_analyze_waits_for_real_null_receipt_then_uses_supervised_analysis');
  await writeProgress(stage,checks.length);

  stage='review_and_receipt_preflight_fail_closed';
  const reviewPath=reviewRoutePath(jobId);
  const publicationPath=publicationRoutePath(jobId);
  const reviewFailure=route=>route.request().method()==='GET'
   ?route.fulfill({status:503,contentType:'application/json',body:'{\"error\":\"INTERNAL_ERROR\"}'})
   :route.continue();
  const publicationFailure=route=>route.request().method()==='GET'
   ?route.fulfill({status:503,contentType:'application/json',body:'{\"error\":\"INTERNAL_ERROR\"}'})
   :route.continue();
  await page.route('**'+reviewPath,reviewFailure);
  await page.route('**'+publicationPath,publicationFailure);
  const failedReviewRead=page.waitForResponse(response=>pathIs(response.url(),reviewPath)&&response.request().method()==='GET');
  const failedPublicationRead=page.waitForResponse(response=>pathIs(response.url(),publicationPath)&&response.request().method()==='GET');
  await page.goto(apiUrl(base,'/knowledge/import?id='+encodeURIComponent(jobId)));
  expectStatus(await failedReviewRead,[503],'REVIEW_PREFLIGHT_FAILURE_NOT_INJECTED');
  expectStatus(await failedPublicationRead,[503],'PUBLICATION_PREFLIGHT_FAILURE_NOT_INJECTED');
  const sourceReceipt=page.locator('.knowledge-receipt');
  await sourceReceipt.getByRole('alert').waitFor();
  const reviewSection=page.locator('section[aria-labelledby=\"review-draft-title\"]');
  await reviewSection.getByRole('alert').waitFor();
   const extractionTitle=page.locator('.knowledge-title-editor input');
   const reason=page.locator('.knowledge-reason-field textarea');
  const firstCell=page.locator('.knowledge-extraction-editor .knowledge-cell-label input').first();
  const analyzeAfterFailure=page.getByRole('button',{name:'วิเคราะห์เอกสาร',exact:true});
  const saveDraftAfterFailure=reviewSection.getByRole('button',{name:'บันทึกร่างส่วนตัว',exact:true});
  const saveEditAfterFailure=page.getByRole('button',{name:'บันทึกข้อความแก้ไข',exact:true});
  requireQa(await analyzeAfterFailure.isDisabled()&&await sourceText.isDisabled()&&await extractionTitle.isDisabled()&&await reason.isDisabled()&&await firstCell.isDisabled()&&await saveEditAfterFailure.isDisabled(),'SOURCE_FAILURE_DID_NOT_LOCK_IMPORT_EDITORS');
  requireQa(await reviewSection.getByLabel('ชื่อเอกสาร',{exact:true}).count()===0&&await saveDraftAfterFailure.count()===0,'FAILED_REVIEW_LOAD_EXPOSED_EDITABLE_DRAFT');
  await page.unroute('**'+publicationPath,publicationFailure);
  const sourceRecovery=sourceReceipt.getByRole('button',{name:'ตรวจสถานะต้นฉบับอีกครั้ง',exact:true});
  const sourceRecoveryResponse=page.waitForResponse(response=>pathIs(response.url(),publicationPath)&&response.request().method()==='GET');
  await sourceRecovery.click();
  expectStatus(await sourceRecoveryResponse,[200],'SOURCE_STATUS_RECOVERY_FAILED');
  requireQa(await analyzeAfterFailure.isEnabled()&&await sourceText.isEnabled(),'SOURCE_STATUS_RECOVERY_DID_NOT_UNLOCK_SOURCE');
  await page.unroute('**'+reviewPath,reviewFailure);
  const reviewRecovery=reviewSection.getByRole('button',{name:'โหลดข้อมูลตรวจอีกครั้ง',exact:true});
  const reviewRecoveryResponse=page.waitForResponse(response=>pathIs(response.url(),reviewPath)&&response.request().method()==='GET');
  await reviewRecovery.click();
  expectStatus(await reviewRecoveryResponse,[200],'REVIEW_STATUS_RECOVERY_FAILED');
  await reviewSection.getByLabel('ชื่อเอกสาร',{exact:true}).waitFor({state:'visible'});
  const reviewFixture=await publishableApiDraft(page,base,jobId);
  const publicationBefore=await page.request.get(apiUrl(base,publicationPath),{headers:{accept:'application/json'}});
  const publicationBeforeBody=await readJson(publicationBefore,'PUBLICATION_GET_FAILED');
  requireQa(publicationBeforeBody.publication?.receipt===null,'SYNTHETIC_FIXTURE_ALREADY_COMPLETED');
  await page.reload();
  await reviewSection.getByLabel('ชื่อเอกสาร',{exact:true}).waitFor({state:'visible'});
  const approval=page.locator('section[aria-labelledby=\"knowledge-approval-title\"]');
  const start=approval.getByRole('button',{name:'ตรวจข้อมูลและเริ่มยืนยัน',exact:true});
  await start.waitFor({state:'visible'});
  await page.waitForFunction(element=>element instanceof HTMLButtonElement&&!element.disabled,await start.elementHandle());
  addCheck(checks,'review_and_publication_503_fail_closed_and_recover_with_source_retry');
  await writeProgress(stage,checks.length);

  stage='open_and_cross_job_dto';
  const wrongReceipt={
   jobId:randomUUID(),
   jobRevision:reviewFixture.saved.jobRevision,
   extractionRevision:reviewFixture.saved.extractionRevision,
   reviewRevision:reviewFixture.saved.reviewRevision,
   documentId:randomUUID(),
   familyId:randomUUID(),
   storageMode:'RAG',
   action:'NEW_FAMILY',
   relationship:null,
   planDigest:reviewFixture.plan.digest,
   createdAt:new Date().toISOString(),
  };
  const publicationPattern='**'+publicationRoutePath(jobId);
  const wrongReceiptHandler=async route=>{
   if(route.request().method()==='GET'){
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({publication:{receipt:wrongReceipt}})});
   }else await route.continue();
  };
  await page.route(publicationPattern,wrongReceiptHandler);
  const receiptRetry=approval.getByRole('button',{name:'ตรวจใบรับรองอีกครั้ง',exact:true});
  const wrongDtoResponse=page.waitForResponse(response=>pathIs(response.url(),publicationRoutePath(jobId))&&response.request().method()==='GET');
  await receiptRetry.click();
  expectStatus(await wrongDtoResponse,[200],'CROSS_JOB_RECEIPT_FIXTURE_NOT_RETURNED');
  await approval.getByRole('alert').waitFor();
  requireQa(await approval.getByRole('button',{name:'ตรวจข้อมูลและเริ่มยืนยัน',exact:true}).count()===0,'CROSS_JOB_RECEIPT_ENABLED_APPROVAL');
  await page.unroute(publicationPattern,wrongReceiptHandler);
  const recoveryRead=page.waitForResponse(response=>pathIs(response.url(),publicationRoutePath(jobId))&&response.request().method()==='GET');
  await approval.getByRole('button',{name:'ตรวจใบรับรองอีกครั้ง',exact:true}).click();
  expectStatus(await recoveryRead,[200],'PUBLICATION_RECEIPT_RETRY_FAILED');
  await start.waitFor({state:'visible'});
  requireQa(await start.isEnabled(),'APPROVAL_NOT_READY_AFTER_VALID_RECEIPT_READ');
  addCheck(checks,'cross_job_receipt_dto_fails_closed_then_real_null_receipt_recovers');
  await writeProgress(stage,checks.length);

  stage='confirmation_dirty_and_layout_batch_one';
  const title=reviewSection.getByLabel('ชื่อเอกสาร',{exact:true});
  const savedTitle=reviewFixture.draft.metadata.title;
  const checkboxName='ฉันตรวจข้อมูลและยืนยันให้นำฉบับที่บันทึกไว้นี้เข้าสู่การอนุมัติ';
  const submit=approval.getByRole('button',{name:'ยืนยันการอนุมัติ',exact:true});
  const back=approval.getByRole('button',{name:'กลับไปตรวจทาน',exact:true});
  const noPostCount=approvalPostRequests;
  await start.click();
  const confirmation=approval.getByRole('region',{name:'ตรวจทานข้อมูลก่อนยืนยัน',exact:true});
  await confirmation.waitFor();
  const checkbox=confirmation.getByRole('checkbox',{name:checkboxName,exact:true});
  requireQa(!(await checkbox.isChecked())&&await submit.isDisabled(),'CONFIRMATION_DID_NOT_START_UNCHECKED');
  requireQa(approvalPostRequests===noPostCount,'OPEN_CONFIRMATION_POSTED');
  const confirmationHeading=confirmation.getByRole('heading',{name:'ตรวจทานข้อมูลก่อนยืนยัน',exact:true});
  requireQa(await confirmationHeading.evaluate(element=>element===document.activeElement),'CONFIRMATION_HEADING_NOT_FOCUSED');
  await page.screenshot({path:resolve(OUTPUT,'batch-1-before-approval-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  requireQa(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'MOBILE_PREAPPROVAL_HORIZONTAL_OVERFLOW');
  await checkbox.focus();
  requireQa(await checkbox.evaluate(element=>element===document.activeElement),'MOBILE_CHECKBOX_NOT_KEYBOARD_FOCUSABLE');
  await checkbox.press('Space');
  requireQa(await checkbox.isChecked(),'KEYBOARD_CHECKBOX_DID_NOT_TOGGLE');
  await checkbox.press('Space');
  requireQa(!(await checkbox.isChecked())&&await submit.isDisabled(),'KEYBOARD_UNCHECK_DID_NOT_RESET_CONFIRMATION');
  await page.screenshot({path:resolve(OUTPUT,'batch-1-before-approval-mobile.png'),fullPage:true});
  await back.click();
  requireQa(await confirmation.count()===0&&approvalPostRequests===noPostCount,'CANCELED_CONFIRMATION_POSTED');
  await page.setViewportSize({width:1440,height:1000});
  await title.fill(savedTitle+' unsaved');
  requireQa(await start.isDisabled()&&await approval.getByRole('region',{name:'ตรวจทานข้อมูลก่อนยืนยัน',exact:true}).count()===0,'DIRTY_DRAFT_DID_NOT_BLOCK_AND_RESET_CONFIRMATION');
  requireQa(approvalPostRequests===noPostCount,'DIRTY_DRAFT_POSTED');
  page.once('dialog',dialog=>dialog.accept());
  await reviewSection.getByRole('button',{name:'ทิ้งการแก้ไขในเครื่อง',exact:true}).click();
   await page.waitForFunction(({labelText,expected})=>[...document.querySelectorAll('section[aria-labelledby="review-draft-title"] label')].some(label=>label.textContent?.trim()===labelText&&label.querySelector('input')?.value===expected),{labelText:'ชื่อเอกสาร',expected:savedTitle});
  requireQa(await start.isEnabled()&&approvalPostRequests===noPostCount,'DISCARD_DID_NOT_RESTORE_SAVED_APPROVAL_BINDING');
  requireQa(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'DESKTOP_PREAPPROVAL_HORIZONTAL_OVERFLOW');
  await start.click();
  await confirmation.waitFor();
  requireQa(!(await checkbox.isChecked())&&await submit.isDisabled(),'CONFIRMATION_REOPENED_CHECKED');
  addCheck(checks,'unchecked_cancel_dirty_reset_keyboard_and_390_1440_layout_verified');
  await writeProgress(stage,checks.length);

  stage='fixed_failures_and_pending_parent_guard';
  await checkbox.check();
  const approvePattern='**'+APPROVE_PATH;
  let enteredResolve;
  const entered=new Promise(resolveEntered=>{enteredResolve=resolveEntered;});
  let releaseResolve;
  const held=new Promise(resolveHeld=>{releaseResolve=resolveHeld;});
  routeRelease=()=>releaseResolve();
  const heldFailure=async route=>{
   enteredResolve();
   await held;
   await route.fulfill({status:503,contentType:'application/json',body:'{\"error\":\"INTERNAL_ERROR\"}'});
  };
  await page.route(approvePattern,heldFailure);
  const heldResponse=page.waitForResponse(response=>pathIs(response.url(),APPROVE_PATH)&&response.request().method()==='POST');
  await submit.click();
  await waitForPromise(entered,'APPROVAL_POST_INTERCEPTION_MISSING');
  const titleHandle=await title.elementHandle();
  await page.waitForFunction(element=>element instanceof HTMLInputElement&&element.disabled,titleHandle);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent?.trim()==='วิเคราะห์เอกสาร'&&button.disabled));
  requireQa(await title.isDisabled()&&await analyzeControl.isDisabled()&&await reviewSection.getByRole('button',{name:'บันทึกร่างส่วนตัว',exact:true}).isDisabled(),'PENDING_APPROVAL_DID_NOT_LOCK_PARENT');
  routeRelease();
  expectStatus(await heldResponse,[503],'MOCKED_503_STATUS_MISMATCH');
  await page.unroute(approvePattern,heldFailure);
  routeRelease=null;
  const statuses=[
   {status:422,text:'ข้อมูลตรวจทานยังไม่ผ่านเงื่อนไขการอนุมัติ'},
   {status:409,text:'ข้อมูลตรวจทานหรือแผนเอกสารเปลี่ยนไป'},
  ];
  for(const item of statuses){
   const fixedFailure=route=>route.fulfill({status:item.status,contentType:'application/json',body:'{\"error\":\"CONTROLLED_QA_FAILURE\"}'});
   await page.route(approvePattern,fixedFailure);
   const responsePromise=page.waitForResponse(response=>pathIs(response.url(),APPROVE_PATH)&&response.request().method()==='POST');
   await submit.waitFor({state:'visible'});
   await submit.click();
   const response=await responsePromise;
   expectStatus(response,[item.status],'MOCKED_APPROVAL_STATUS_MISMATCH');
   const alert=approval.getByRole('alert');
   await alert.waitFor();
   requireQa((await alert.textContent())?.includes(item.text),'FIXED_FAILURE_MESSAGE_MISSING');
   requireQa(await title.inputValue()===savedTitle&&await checkbox.isChecked(),'FIXED_FAILURE_DID_NOT_PRESERVE_REVIEW_DRAFT');
   await page.unroute(approvePattern,fixedFailure);
  }
  requireQa(await title.inputValue()===savedTitle,'FINAL_FIXED_FAILURE_CHANGED_DRAFT_TITLE');
  addCheck(checks,'held_503_parent_guard_and_fixed_503_422_409_preserve_draft');
  await writeProgress(stage,checks.length);

  stage='real_approval_uncertain_response_and_receipt';
  const actualHandler=async route=>{
   const response=await route.fetch();
   if(response.status()===200)await route.abort('connectionreset');
   else await route.fulfill({response});
  };
  await page.route(approvePattern,actualHandler);
  const realPost=page.waitForRequest(request=>pathIs(request.url(),APPROVE_PATH)&&request.method()==='POST');
  await submit.click();
  const submittedRequest=await realPost;
  const actualRequestBody=submittedRequest.postDataJSON();
  const expectedApprovalBody={
   id:jobId,
   expectedJobRevision:reviewFixture.saved.jobRevision,
   expectedExtractionRevision:reviewFixture.saved.extractionRevision,
   expectedReviewRevision:reviewFixture.saved.reviewRevision,
   confirmPublication:true,
  };
  requireQa(sameApprovalBody(actualRequestBody,expectedApprovalBody),'UI_APPROVAL_DTO_MISMATCH');
  await approval.getByRole('alert').filter({hasText:'การเชื่อมต่อขาดหาย'}).waitFor();
  await page.unroute(approvePattern,actualHandler);
  const retryReceipt=approval.getByRole('button',{name:'ตรวจใบรับรองอีกครั้ง',exact:true});
  await retryReceipt.waitFor({state:'visible'});
  const completedRead=page.waitForResponse(response=>pathIs(response.url(),publicationRoutePath(jobId))&&response.request().method()==='GET');
  await retryReceipt.click();
  expectStatus(await completedRead,[200],'COMPLETED_RECEIPT_READ_FAILED');
  await approval.getByText('เสร็จแล้ว',{exact:true}).waitFor();
  const receiptResponse=await page.request.get(apiUrl(base,publicationRoutePath(jobId)),{headers:{accept:'application/json'}});
  const receiptEnvelope=await readJson(receiptResponse,'COMPLETED_RECEIPT_DTO_INVALID');
  const receipt=receiptEnvelope.publication?.receipt;
  requireQa(receipt&&receipt.jobId===jobId&&receipt.planDigest===reviewFixture.plan.digest&&receipt.storageMode==='RAG'&&receipt.action==='NEW_FAMILY','COMPLETED_RECEIPT_BINDING_MISMATCH');
  requireQa(receipt.jobRevision===expectedApprovalBody.expectedJobRevision&&receipt.extractionRevision===expectedApprovalBody.expectedExtractionRevision&&receipt.reviewRevision===expectedApprovalBody.expectedReviewRevision,'COMPLETED_RECEIPT_COUNTER_MISMATCH');
  requireQa(await approval.getByRole('button',{name:'ยืนยันการอนุมัติ',exact:true}).count()===0,'COMPLETED_UI_STILL_OFFERS_APPROVAL');
  addCheck(checks,'real_E5_backed_INTERNAL_approval_recovered_from_uncertain_response');
  await writeProgress(stage,checks.length);

  stage='exact_replay_original_and_database_evidence';
  const replayResponse=await page.request.post(apiUrl(base,APPROVE_PATH),{
   headers:{origin:base,accept:'application/json','content-type':'application/json'},
   data:actualRequestBody,
  });
  expectStatus(replayResponse,[200],'EXACT_APPROVAL_REPLAY_FAILED');
  const replayBody=await readJson(replayResponse,'EXACT_APPROVAL_REPLAY_DTO_INVALID');
  requireQa(replayBody.publication?.replayed===true&&receiptEqual(replayBody.publication.receipt,receipt),'EXACT_REPLAY_DID_NOT_RETURN_SAME_RECEIPT');
  const originalResponse=await page.request.get(apiUrl(base,'/api/knowledge/imports/'+encodeURIComponent(jobId)+'/original'));
  expectStatus(originalResponse,[200],'RETAINED_ORIGINAL_UNAVAILABLE');
  const recoveredBytes=await originalResponse.body();
  requireQa(Buffer.from(recoveredBytes).equals(original),'RETAINED_ORIGINAL_BYTES_CHANGED');
  const stored=(await database.query(
   'select j.publication_status,p.storage_mode,d.visibility,d.approval_status,d.requires_review,d.checksum,'+
   'count(c.id)::int chunk_count,'+
   'count(c.id) filter(where c.embedding_dimensions=384 and c.embedding_fingerprint=$2 and extensions.vector_dims(c.embedding_e5)=384 '+
   'and extensions.vector_norm(c.embedding_e5) between 0.999 and 1.001 and c.passage_token_count between 1 and 512 '+
   'and jsonb_array_length(c.source_locations)>0)::int verified_chunk_count '+
   'from private.knowledge_import_jobs j join private.knowledge_import_publications p on p.job_id=j.id '+
   'join public.documents d on d.id=p.document_id left join public.knowledge_chunks c on c.document_id=d.id '+
   'where j.id=$1 group by j.publication_status,p.storage_mode,d.visibility,d.approval_status,d.requires_review,d.checksum',
   [jobId,reviewFixture.plan.embeddingFingerprint],
  )).rows[0];
  requireQa(stored?.publication_status==='COMPLETED'&&stored.storage_mode==='RAG'&&stored.visibility==='INTERNAL'&&stored.approval_status==='APPROVED'&&stored.requires_review===false,'DATABASE_PUBLICATION_STATE_INVALID');
  requireQa(stored.checksum===reviewFixture.plan.sourceChecksum&&stored.chunk_count===reviewFixture.plan.chunks.length&&stored.verified_chunk_count===reviewFixture.plan.chunks.length,'DATABASE_E5_CHUNK_PROVENANCE_INVALID');
  const familyCount=(await database.query(
   'select count(*)::int count from public.documents d join public.document_families f on f.id=d.document_family_id where f.code=$1',
   [reviewFixture.draft.metadata.familyCode],
  )).rows[0]?.count;
  requireQa(familyCount===1,'EXACT_REPLAY_CREATED_DUPLICATE_DOCUMENT');
  requireQa(receiptEqual(replayBody.publication.receipt,receipt),'RECEIPT_CHANGED_AFTER_READ');
  requireQa(browserProviderRequests===0,'BROWSER_CALLED_EMBEDDING_PROVIDER_DIRECTLY');
  addCheck(checks,'exact_replay_same_receipt_original_bytes_and_INTERNAL_E5_storage_verified');
  await page.reload();
  await approval.getByText('เสร็จแล้ว',{exact:true}).waitFor();
  await page.screenshot({path:resolve(OUTPUT,'batch-2-completed-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  requireQa(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'MOBILE_COMPLETED_HORIZONTAL_OVERFLOW');
  await page.screenshot({path:resolve(OUTPUT,'batch-2-completed-mobile.png'),fullPage:true});
  addCheck(checks,'completed_receipt_desktop_mobile_layout_verified');
  await writeProgress(stage,checks.length);

  stage='anonymous_and_staff_authorization';
  const requestBody=actualRequestBody;
  const anonymous=await browser.newContext({viewport:{width:1280,height:900}});
  const anonymousGet=await anonymous.request.get(apiUrl(base,publicationRoutePath(jobId)));
  expectStatus(anonymousGet,[401],'ANONYMOUS_PUBLICATION_GET_NOT_DENIED');
  const anonymousPost=await anonymous.request.post(apiUrl(base,APPROVE_PATH),{
   headers:{origin:base,'content-type':'application/json'},
   data:requestBody,
  });
  expectStatus(anonymousPost,[401],'ANONYMOUS_APPROVAL_POST_NOT_DENIED');
  await anonymous.close();
  for(const identity of staff){
   const staffPage=await browser.newPage({viewport:{width:1280,height:900}});
   staffPage.setDefaultTimeout(20_000);
   await login(staffPage,identity,base);
   const staffGet=await staffPage.request.get(apiUrl(base,publicationRoutePath(jobId)));
   expectStatus(staffGet,[403],'STAFF_PUBLICATION_GET_NOT_DENIED');
   const staffPost=await staffPage.request.post(apiUrl(base,APPROVE_PATH),{
    headers:{origin:base,'content-type':'application/json'},
    data:requestBody,
   });
   expectStatus(staffPost,[403],'STAFF_APPROVAL_POST_NOT_DENIED');
   await staffPage.close();
  }
  requireQa(!pageErrorSeen,'BROWSER_PAGE_ERROR_SEEN');
  addCheck(checks,'anonymous_and_both_staff_denied_approval_and_receipt');
  const result={
   status:'PASS',
   checks,
   environment:'localhost_only',
   database:'isolated_publication_qa',
   visibility:'INTERNAL',
   publicationStatus:'COMPLETED',
   retainedOriginalBytes:true,
   exactReplay:true,
   remoteOrPaidProviderCalls:0,
  };
  await writeFile(resolve(OUTPUT,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
 }catch(error){
  const code=fixedErrorCode(error);
  const sourceLine=Number(error?.stack?.match(/knowledge-publication-browser\.mjs:(\d+):/u)?.[1])||null;
  if(routeRelease)routeRelease();
  if(page)await page.screenshot({path:resolve(OUTPUT,'failure.png'),fullPage:true}).catch(()=>undefined);
  await writeFile(resolve(OUTPUT,'failure.json'),JSON.stringify({status:'FAIL',stage,code,sourceLine},null,2)).catch(()=>undefined);
  console.error(JSON.stringify({status:'FAIL',stage,code,sourceLine}));
  process.exitCode=1;
 }finally{
  if(browser)await browser.close().catch(()=>undefined);
  if(database)await database.end().catch(()=>undefined);
 }
}

await run();
