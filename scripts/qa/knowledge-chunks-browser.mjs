import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {databaseConnection} from '../../lib/database/connection.ts';
import {assertDevelopmentTarget} from '../../lib/database/development-target.ts';
assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
const runtime=process.env.PLAYWRIGHT_RUNTIME_PATH;assert(runtime,'PLAYWRIGHT_RUNTIME_PATH_REQUIRED');
const {chromium}=createRequire(resolve(runtime,'package.json'))('playwright');
const base=process.env.APP_BASE_URL??'http://localhost:3000';assert(new URL(base).hostname==='localhost');
const accounts=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8')).accounts;
const admin=accounts.find(account=>account.role==='SUPER_ADMIN'),staff=accounts.filter(account=>account.role==='STAFF');assert(admin&&staff.length===2);
const db=new Client(databaseConnection(process.env.DIRECT_URL));await db.connect();
const before=(await db.query('select (select count(*)::int from public.documents) documents,(select count(*)::int from public.knowledge_chunks) chunks')).rows[0];
const output=resolve('.superpowers/staging/import-preview/chunks-browser');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[];
let stage='login',jobId=null,directEmbeddingCalls=0;
page.on('request',request=>{if(/:8000\//u.test(request.url()))directEmbeddingCalls++;});
async function mark(next){stage=next;await writeFile(resolve(output,'progress.json'),JSON.stringify({stage,checks},null,2));}
async function login(surface,account){await surface.goto(new URL('/login',base).href);await surface.locator('input[name="email"]').fill(account.email);await surface.locator('input[name="password"]').fill(account.password);await surface.locator('button[type="submit"]').click();await surface.waitForURL(url=>url.pathname==='/dashboard',{timeout:45000});}
try{
 await login(page,admin);await mark('fixture');
 const original=Buffer.from(`<html><h1>Chunk QA ${randomUUID()}</h1><p>${'สวัสดี '.repeat(300)}</p><table><tr><td>บริการ</td><td></td></tr><tr><td>ห้องสมุด</td><td>001.20</td></tr></table></html>`);
 const upload=await page.request.post(new URL('/api/knowledge/import',base).href,{headers:{origin:base},multipart:{file:{name:'chunks-qa.html',mimeType:'text/html',buffer:original}}});assert.equal(upload.status(),201,`UPLOAD_STATUS_${upload.status()}`);jobId=(await upload.json()).job.id;
 assert.equal((await page.request.post(new URL('/api/knowledge/analyze',base).href,{headers:{origin:base},data:{id:jobId,revision:0}})).status(),200);
 await page.goto(new URL(`/knowledge/import?id=${jobId}`,base).href);
 const review=page.locator('section[aria-labelledby="review-draft-title"]'),panel=page.locator('.knowledge-chunk-plan');await panel.waitFor();
 const prepare=()=>panel.getByRole('button',{name:/^(เตรียมตัวอย่างแผน|ตรวจแผนอีกครั้ง)$/});
 const save=review.getByRole('button',{name:'บันทึกร่างส่วนตัว',exact:true});
 const saveDraft=async()=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/knowledge/imports/${jobId}/review`&&r.request().method()==='PUT');await save.click();const result=await response;assert.equal(result.status(),200);return (await result.json()).review;};
 const look=async()=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/knowledge/imports/${jobId}/chunks`);await prepare().click();const result=await response;assert.equal(result.status(),200);await panel.getByRole('button',{name:'ตรวจแผนอีกครั้ง',exact:true}).waitFor();return (await result.json()).snapshot;};
 assert(await prepare().isDisabled());await review.getByLabel('ชื่อเอกสาร',{exact:true}).fill('ร่างส่วนตัวสำหรับตรวจ chunk');let state=await saveDraft();assert.equal(state.saved.draft.schemaVersion,1);checks.push('unsaved_draft_blocks_preparation_without_auto_consent');
 await mark('actual_plan');let snapshot=await look();assert(snapshot.plan.chunks.length>3);assert(snapshot.plan.chunks.every(chunk=>chunk.passageTokenCount<=512&&chunk.sourceLocations[0].kind==='HTML'));
 const ack=panel.getByRole('checkbox');assert.equal(await ack.isChecked(),false);assert(await panel.locator('.knowledge-chunk-plan-content').textContent());assert((await panel.locator('.knowledge-chunk-plan-locations').textContent()).includes('HTML'));
 const next=panel.getByRole('button',{name:'ข้อความถัดไป',exact:true});for(let i=1;i<snapshot.plan.chunks.length;i++)await next.click();assert((await panel.locator('.knowledge-chunk-plan-content').textContent()).includes('001.20'));assert((await panel.locator('.knowledge-chunk-plan-content').textContent()).includes('""'));assert(await next.isDisabled());await panel.getByRole('button',{name:'ข้อความก่อนหน้า',exact:true}).click();checks.push('real_E5_plan_pagination_tokens_locations_and_lossless_table_cells');
 await mark('explicit_ack');await ack.check();state=await saveDraft();assert.equal(state.saved.draft.schemaVersion,2);assert.deepEqual(state.saved.draft.chunkPlan,{digest:snapshot.plan.digest,chunkerVersion:'located-e5-v1'});assert(Object.values(state.saved.draft.attestations).every(value=>value===false));checks.push('explicit_ack_server_recomputed_saved_v2_without_approval');
 await mark('withdrawal_save_race');const clear=panel.getByRole('button',{name:'ถอนคำยืนยันเดิม',exact:true});await clear.waitFor();await review.getByLabel('ชื่อเอกสาร',{exact:true}).fill('ตรวจการล็อกคำยืนยันระหว่างบันทึก');
 const reviewPattern=`**/api/knowledge/imports/${jobId}/review`;let releaseSave,saveEntered;const saveHeld=new Promise(resolveHeld=>{releaseSave=resolveHeld;}),saveEntry=new Promise(resolveEntry=>{saveEntered=resolveEntry;});
 try{
  await page.route(reviewPattern,async route=>{if(route.request().method()==='PUT'){saveEntered();await saveHeld;}await route.continue();});
  const savedResponse=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/knowledge/imports/${jobId}/review`&&r.request().method()==='PUT');await save.click();await saveEntry;
  await page.waitForFunction(()=>[...document.querySelectorAll('.knowledge-chunk-plan-clear button')].some(button=>button.disabled));assert(await clear.isDisabled());releaseSave();assert.equal((await savedResponse).status(),200);
 }finally{releaseSave();await page.unroute(reviewPattern);}
 const heldState=(await (await page.request.get(new URL(`/api/knowledge/imports/${jobId}/review`,base).href)).json()).review;assert.equal(heldState.saved.draft.chunkPlan.digest,snapshot.plan.digest);checks.push('saved_ack_cannot_be_withdrawn_during_parent_save_and_silently_overwritten');
 await page.reload();await panel.waitFor();snapshot=await look();assert(await ack.isChecked());checks.push('saved_ack_reload_matches_same_extraction_plan');
 await review.getByLabel('ชื่อเอกสาร',{exact:true}).fill('แก้ metadata โดยไม่เปลี่ยนข้อความ');assert(await prepare().isDisabled());state=await saveDraft();assert.equal(state.saved.draft.chunkPlan.digest,snapshot.plan.digest);await look();assert(await ack.isChecked());checks.push('metadata_save_retains_only_matching_recomputed_plan');
 await mark('pending_guard');const pattern=`**/api/knowledge/imports/${jobId}/chunks?*`;let release,entered;const held=new Promise(resolveHeld=>{release=resolveHeld;}),entry=new Promise(resolveEntry=>{entered=resolveEntry;});
 try{await page.route(pattern,async route=>{entered();await held;await route.continue();});await prepare().click();await Promise.race([entry,new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('INTERCEPTION_REQUIRED')),10000))]);await page.waitForFunction(()=>document.querySelector('section[aria-labelledby="review-draft-title"] input')?.disabled===true);assert(await save.isDisabled());assert(await page.getByRole('button',{name:'วิเคราะห์เอกสาร',exact:true}).isDisabled());release();await panel.getByRole('button',{name:'ตรวจแผนอีกครั้ง',exact:true}).waitFor();}finally{release();await page.unroute(pattern);}checks.push('pending_plan_locks_parent_save_analysis_and_metadata');
 await mark('failures');for(const [status,error,text] of [[503,'CHUNK_PLAN_UNAVAILABLE','ไม่พร้อม'],[408,'CHUNK_PLAN_TIMEOUT','เวลา'],[413,'CHUNK_PLAN_TOO_LARGE','เกิน'],[422,'CHUNK_PLAN_TABLE_ROW_TOO_LARGE','ตาราง'],[422,'CHUNK_PLAN_GRAPHEME_TOO_LARGE','หนึ่งหน่วย']]){
  await mark(`failure_${error}`);
  await page.route(pattern,route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({error})}));await prepare().click();await panel.getByRole('alert').waitFor();assert((await panel.getByRole('alert').textContent()).includes(text));assert.equal(await review.getByLabel('ชื่อเอกสาร',{exact:true}).inputValue(),'แก้ metadata โดยไม่เปลี่ยนข้อความ');await page.unroute(pattern);
 }
 checks.push('fixed_availability_timeout_bounds_failures_retain_draft_and_retry');await look();
 await page.route(pattern,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({snapshot:{...snapshot,reviewRevision:snapshot.reviewRevision+100}})}));await prepare().click();await panel.getByRole('alert').waitFor();assert.equal(await panel.getByRole('checkbox').count(),0);await page.unroute(pattern);await look();checks.push('wrong_snapshot_never_enables_acknowledgment');
 await ack.uncheck();state=await saveDraft();assert.equal(state.saved.draft.chunkPlan,null);await look();assert.equal(await ack.isChecked(),false);checks.push('deliberate_clear_persists_nullable_v2');
 await mark('concurrent_review');const latest=(await (await page.request.get(new URL(`/api/knowledge/imports/${jobId}/review`,base).href)).json()).review;
 assert.equal((await page.request.put(new URL(`/api/knowledge/imports/${jobId}/review`,base).href,{headers:{origin:base},data:{expectedJobRevision:latest.jobRevision,expectedExtractionRevision:latest.extractionRevision,expectedReviewRevision:latest.reviewRevision,draft:latest.saved.draft}})).status(),200);
 const stale=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/knowledge/imports/${jobId}/chunks`);await prepare().click();assert.equal((await stale).status(),409);await panel.getByRole('alert').waitFor();assert.equal(await panel.getByRole('checkbox').count(),0);assert.equal(await review.getByLabel('ชื่อเอกสาร',{exact:true}).inputValue(),'แก้ metadata โดยไม่เปลี่ยนข้อความ');checks.push('actual_competing_review_409_disables_obsolete_plan_preserves_draft');
 await page.reload();await panel.waitFor();await look();await mark('layout');await panel.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});await panel.screenshot({path:resolve(output,'desktop-panel.png')});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'mobile.png'),fullPage:true});await panel.screenshot({path:resolve(output,'mobile-panel.png')});const textRegion=panel.getByRole('region',{name:'ข้อความ 1 ในแผน',exact:true});await textRegion.focus();assert(await textRegion.evaluate(element=>element===document.activeElement));await ack.focus();assert(await ack.evaluate(element=>element===document.activeElement));assert.equal(directEmbeddingCalls,0);checks.push('desktop_mobile_keyboard_no_overflow_no_direct_embedding_calls');
 await mark('roles');const path=`/api/knowledge/imports/${jobId}/chunks?expectedJobRevision=1&expectedExtractionRevision=1&expectedReviewRevision=1`,anonymous=await browser.newContext();assert.equal((await anonymous.request.get(new URL(path,base).href)).status(),401);await anonymous.close();
 for(const account of staff){const surface=await browser.newPage();await login(surface,account);assert.equal((await surface.request.get(new URL(path,base).href)).status(),403);await surface.close();}checks.push('anonymous_and_both_department_staff_denied');
 assert.deepEqual((await db.query('select (select count(*)::int from public.documents) documents,(select count(*)::int from public.knowledge_chunks) chunks')).rows[0],before);checks.push('no_published_document_chunk_or_vector_created');
 await writeFile(resolve(output,'result.json'),JSON.stringify({status:'PASS',checks,syntheticOriginalRetained:true},null,2));console.log(JSON.stringify({status:'PASS',checks,syntheticOriginalRetained:true}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>undefined);const line=String(error?.stack??'').match(/knowledge-chunks-browser\.mjs:(\d+):\d+/)?.[1];await writeFile(resolve(output,'failure.json'),JSON.stringify({stage,line,diagnostic:String(error?.message??'').split('\n')[0]},null,2));console.error(JSON.stringify({status:'FAIL',stage,line,code:error?.code==='ERR_ASSERTION'?'ASSERTION':error?.name==='TimeoutError'?'BROWSER_TIMEOUT':'CONTROLLED_FAILURE',syntheticOriginalRetained:jobId!==null}));process.exitCode=1;}
finally{await browser.close();await db.end();}
