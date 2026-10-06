import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {databaseConnection} from '../../lib/database/connection.ts';
import {assertDevelopmentTarget} from '../../lib/database/development-target.ts';
import {unfinishedReviewDraft} from '../../tests/fixtures/import-review.ts';
assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
const runtime=process.env.PLAYWRIGHT_RUNTIME_PATH;assert(runtime,'PLAYWRIGHT_RUNTIME_PATH_REQUIRED');
const {chromium}=createRequire(resolve(runtime,'package.json'))('playwright');
const base=process.env.APP_BASE_URL??'http://localhost:3000';assert(new URL(base).hostname==='localhost','LOCAL_BROWSER_HOST_REQUIRED');
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));
const account=credentials.accounts.find(item=>item.role==='SUPER_ADMIN');assert(account,'ADMIN_FIXTURE_REQUIRED');
const output=resolve('.superpowers/staging/import-preview/browser');await mkdir(output,{recursive:true});
const database=new Client(databaseConnection(process.env.DIRECT_URL));await database.connect();
const browser=await chromium.launch({headless:true});let stage='login';const checks=[];let jobId=null;let directEmbeddingCalls=0;let activePage=null;
const countPublished=async()=>{const row=(await database.query('select (select count(*)::int from public.documents) documents,(select count(*)::int from public.knowledge_chunks) chunks')).rows[0];return row;};
async function login(page,identity){
 await page.goto(new URL('/login',base).href);await page.locator('input[name="email"]').fill(identity.email);await page.locator('input[name="password"]').fill(identity.password);
 await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:45000});
}
try{
 const before=await countPublished();
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 activePage=page;
 page.on('request',request=>{if(/127\.0\.0\.1:8000|localhost:8000/.test(request.url()))directEmbeddingCalls++;});
 await login(page,account);stage='upload_page';await page.goto(new URL('/knowledge/import',base).href);
 const fixtureId=randomUUID(),filename=`qa-private-import-${fixtureId}.html`;
 // Distinct bytes, not only a distinct name: immutable-original dedup uses checksum.
 const original=Buffer.from(`<html><!-- synthetic fixture ${fixtureId} --><h1>คู่มือ WiFi</h1><p>ขั้นตอนทดสอบการเชื่อมต่อเครือข่าย</p><table><tr><td>บริการ</td><td>สถานที่</td></tr><tr><td>WiFi</td><td>ห้องสมุด</td></tr></table></html>`);
 await page.getByLabel('เลือกไฟล์ PDF, Word, Excel, CSV หรือ HTML').setInputFiles({name:filename,mimeType:'text/html',buffer:original});
 await page.getByLabel('URL แหล่งที่มาทางการ (ถ้ามี)',{exact:true}).fill('https://nse.yru.ac.th/guide');
 const receipt=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/knowledge/import'&&response.request().method()==='POST');
 await page.getByRole('button',{name:'รับต้นฉบับเพื่อเตรียมตรวจ',exact:true}).click();const staged=await receipt;assert([200,201].includes(staged.status()));jobId=(await staged.json()).job.id;checks.push('private_upload_receipt');
 let injectedLoadFailure=false;
 const reviewUrl=new URL(`/api/knowledge/imports/${jobId}/review`,base).href;
 const failFirstReviewLoad=async route=>{
  if(!injectedLoadFailure&&route.request().method()==='GET'){
   injectedLoadFailure=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'INTERNAL_ERROR'})});
  }else await route.continue();
 };
 await page.route(reviewUrl,failFirstReviewLoad);
 stage='analyze';const analyzed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/knowledge/analyze');
 await page.getByRole('button',{name:'วิเคราะห์เอกสาร',exact:true}).click();const analyzedResponse=await analyzed;assert.equal(analyzedResponse.status(),200);
 const first=(await analyzedResponse.json()).preview;assert.equal(first.extractionRevision,1);assert(first.extraction.locations.pages.every(location=>location.kind==='HTML'));assert.equal(first.analysis.approved,false);
 await page.getByLabel('ข้อความในหน้า 1').waitFor();checks.push('supervised_analysis_located_private_preview');
 stage='review_failed_load_retry';
 const retry=page.getByRole('button',{name:'โหลดข้อมูลตรวจอีกครั้ง',exact:true});await retry.waitFor();assert(await retry.isEnabled(),'FAILED_REVIEW_LOAD_MUST_ALLOW_RETRY');
 const parentAnalyze=page.getByRole('button',{name:'วิเคราะห์เอกสาร',exact:true});await parentAnalyze.click({trial:true});assert(await parentAnalyze.isEnabled(),'FAILED_REVIEW_LOAD_MUST_RELEASE_PARENT');
 const recovered=page.waitForResponse(response=>response.url()===reviewUrl&&response.request().method()==='GET');await retry.click();assert.equal((await recovered).status(),200);
 await page.getByLabel('ชื่อเอกสาร',{exact:true}).fill('');await page.unroute(reviewUrl,failFirstReviewLoad);checks.push('failed_review_get_retry_and_parent_release');
 stage='edit';const changed=first.extraction.pages[0].text+'\nข้อความแก้ไขสำหรับทดสอบ';
 await page.getByLabel('ข้อความในหน้า 1').fill(changed);await page.getByLabel('เหตุผลการแก้ไข').fill('ทดสอบการเก็บข้อความแก้ไขและประวัติ');
 await page.getByLabel('ตาราง 1 แถว 2 คอลัมน์ 2',{exact:true}).fill('ห้องสมุดเพื่อการทดสอบ');
 const saved=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/knowledge/imports/${jobId}/edit`);
 await page.getByRole('button',{name:'บันทึกข้อความแก้ไข',exact:true}).click();const savedResponse=await saved;assert.equal(savedResponse.status(),200);
 const edited=(await savedResponse.json()).preview;assert.equal(edited.extractionRevision,2);assert.deepEqual(edited.extraction.locations,first.extraction.locations);assert.equal(edited.extraction.tables[0].rows[1][1],'ห้องสมุดเพื่อการทดสอบ');assert(edited.extraction.report.warnings.every(warning=>warning.disposition==='UNRESOLVED'));checks.push('reason_bound_page_and_cell_edit_retains_locations_and_warnings');
 stage='reload';await page.goto(new URL(`/knowledge/import?id=${jobId}`,base).href);await page.getByLabel('ข้อความในหน้า 1').waitFor();assert.equal(await page.getByLabel('ข้อความในหน้า 1').inputValue(),changed);assert.equal(await page.getByLabel('ตาราง 1 แถว 2 คอลัมน์ 2',{exact:true}).inputValue(),'ห้องสมุดเพื่อการทดสอบ');checks.push('deep_link_reload_persists_revision');
 const stale=await page.request.patch(new URL(`/api/knowledge/imports/${jobId}/edit`,base).href,{headers:{origin:base},data:{revision:1,edit:{reason:'Stale fixture',pages:[{index:0,text:'stale'}]}}});assert.equal(stale.status(),409);checks.push('stale_write_conflict');
 const forbidden=await page.request.post(new URL('/api/knowledge/analyze',base).href,{headers:{origin:'https://foreign.invalid'},data:{id:jobId,revision:2}});assert.equal(forbidden.status(),403);checks.push('foreign_origin_denied');
 stage='conflict_reload';
 const draft=changed+'\nข้อความร่างของผู้ตรวจ';
 await page.getByLabel('ข้อความในหน้า 1').fill(draft);await page.getByLabel('เหตุผลการแก้ไข').fill('ตรวจข้อความร่างกับการแก้พร้อมกัน');
 const latest=changed+'\nข้อความฉบับล่าสุดจากอีกหน้าจอ',latestTitle='คู่มือฉบับจากอีกหน้าจอ';
 const concurrent=await page.request.patch(new URL(`/api/knowledge/imports/${jobId}/edit`,base).href,{headers:{origin:base},data:{revision:2,edit:{reason:'Concurrent fixture',title:latestTitle,pages:[{index:0,text:latest}]}}});assert.equal(concurrent.status(),200);
 const rejected=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/knowledge/imports/${jobId}/edit`);
 await page.getByRole('button',{name:'บันทึกข้อความแก้ไข',exact:true}).click();assert.equal((await rejected).status(),409);assert.equal(await page.getByLabel('ข้อความในหน้า 1').inputValue(),draft);
 page.once('dialog',dialog=>dialog.accept());
 const reloaded=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/knowledge/imports/${jobId}/preview`);
 await page.getByRole('button',{name:'โหลดฉบับล่าสุดและเก็บข้อความร่าง',exact:true}).click();assert.equal((await reloaded).status(),200);
 await page.getByRole('heading',{name:'เปรียบเทียบข้อความร่างกับฉบับล่าสุด',exact:true}).waitFor();assert.equal(await page.getByLabel('ข้อความในหน้า 1').inputValue(),draft);assert.equal(await page.getByLabel('ชื่อเรื่องที่อ่านได้',{exact:true}).inputValue(),latestTitle);
 const saveButton=page.getByRole('button',{name:'บันทึกข้อความแก้ไข',exact:true});assert(await saveButton.isDisabled());
 await page.getByRole('button',{name:'คงข้อความร่างนี้',exact:true}).click();assert(await saveButton.isEnabled());
 stage='conflict_reacknowledgement';const finalDraft=draft+'\nแก้หลังเลือกเก็บร่าง';
 await page.getByLabel('ข้อความในหน้า 1').fill(finalDraft);assert(await saveButton.isDisabled());
 assert.equal(await page.locator('.knowledge-conflict-values pre').nth(1).textContent(),finalDraft,'CONFLICT_COMPARISON_MUST_SHOW_CURRENT_DRAFT');
 await page.getByRole('button',{name:'คงข้อความร่างนี้',exact:true}).click();
 const resolved=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/knowledge/imports/${jobId}/edit`);await saveButton.click();const resolvedResponse=await resolved;assert.equal(resolvedResponse.status(),200);
 const merged=(await resolvedResponse.json()).preview;assert.equal(merged.extractionRevision,4);assert.equal(merged.extraction.title,latestTitle);assert.equal(merged.extraction.pages[0].text,finalDraft);checks.push('conflict_drafts_latest_untouched_fields_and_reacknowledgement');
 stage='private_review_draft';
 const reviewSection=page.locator('.knowledge-review');
 const title=reviewSection.getByLabel('ชื่อเอกสาร',{exact:true});await title.fill('ร่างตรวจที่ยังไม่ครบ');
 stage='private_review_source_details';await reviewSection.locator('summary').filter({hasText:'แหล่งอ้างอิงและการใช้ข้อมูล'}).click();
 await reviewSection.getByLabel('รูปแบบการจัดเก็บ').selectOption('BOTH');
 await reviewSection.getByLabel('ชุดข้อมูล').selectOption('transfer_courses');
 assert.deepEqual(await reviewSection.getByLabel('ชุดข้อมูล').locator('option').evaluateAll(options=>options.map(item=>item.value).filter(Boolean)),['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements']);
 assert.deepEqual(await reviewSection.locator('input[type="checkbox"]').evaluateAll(inputs=>inputs.map(input=>input.checked)),[false,false,false,false,false]);
 const saveReview=reviewSection.getByRole('button',{name:'บันทึกร่างส่วนตัว',exact:true});
 const waitReviewPut=()=>page.waitForResponse(response=>response.url()===reviewUrl&&response.request().method()==='PUT');
 stage='private_review_first_save';const firstReview=waitReviewPut();await saveReview.click();const firstReviewResponse=await firstReview;assert.equal(firstReviewResponse.status(),200);
 let review=(await firstReviewResponse.json()).review;assert.equal(review.reviewRevision,1);assert.equal(review.jobRevision,4);assert.equal(review.extractionRevision,4);
 assert.equal(review.saved.draft.action,null);assert.equal(review.saved.draft.metadata.effectiveFrom,null);assert.equal(review.saved.draft.metadata.publishedAt,null);assert.equal(review.saved.draft.metadata.authorityLevel,null);
 assert(Object.values(review.saved.draft.attestations).every(value=>value===false));assert.equal(review.saved.draft.metadata.storageMode,'BOTH');assert.equal(review.saved.draft.metadata.datasetType,'transfer_courses');
 stage='private_review_first_reload';await page.goto(new URL(`/knowledge/import?id=${jobId}`,base).href);await title.waitFor();assert.equal(await title.inputValue(),'ร่างตรวจที่ยังไม่ครบ');
 checks.push('nullable_metadata_false_attestations_both_seven_datasets_private_save_reload');
 stage='omitted_warning_dispositions';
 const omittedDraft=structuredClone(review.saved.draft);omittedDraft.warningDispositions=[];
 const omitted=await page.request.put(reviewUrl,{headers:{origin:base},data:{expectedJobRevision:4,expectedExtractionRevision:4,expectedReviewRevision:1,draft:omittedDraft}});assert.equal(omitted.status(),200);review=(await omitted.json()).review;assert(review.warnings.length>0,'SYNTHETIC_REVIEW_WARNINGS_REQUIRED');
 await page.goto(new URL(`/knowledge/import?id=${jobId}`,base).href);await title.fill('ร่างตรวจเหตุผลคำเตือน');
 await reviewSection.locator('summary').filter({hasText:'คำเตือนที่ต้องพิจารณา'}).click();
 const dispositions=reviewSection.getByLabel('ผลการพิจารณา');assert.equal(await dispositions.count(),review.warnings.length);
 for(let index=0;index<review.warnings.length;index++)assert.equal(await dispositions.nth(index).inputValue(),'UNRESOLVED');
 await dispositions.first().selectOption('FALSE_POSITIVE');const reason=reviewSection.getByLabel('เหตุผลประกอบ',{exact:true}).first();
 await saveReview.click();await reviewSection.getByRole('alert').filter({hasText:'ระบุเหตุผลให้ครบ'}).waitFor();
 await reason.fill('  เหตุผลประกอบจากการตรวจ fixture  ');const warningSaved=waitReviewPut();await saveReview.click();const warningResponse=await warningSaved;assert.equal(warningResponse.status(),200);review=(await warningResponse.json()).review;
 assert.equal(review.reviewRevision,3);assert.equal(review.saved.draft.warningDispositions[0].reason,'เหตุผลประกอบจากการตรวจ fixture');
 assert(review.warnings.every(warning=>warning.disposition===undefined),'REVIEW_MUST_NOT_MUTATE_IMMUTABLE_WARNING_EVIDENCE');
 checks.push('omitted_warnings_visible_unresolved_reason_required_and_trimmed');
 stage='review_dirty_parent_guard';await title.fill('ร่างที่ต้องเก็บระหว่างตรวจ');let discardDialog=0;
 const rejectDiscard=async dialog=>{discardDialog++;await dialog.dismiss();};page.once('dialog',rejectDiscard);
 await page.locator('.knowledge-job-open').filter({hasText:filename}).click();assert.equal(discardDialog,1);assert.equal(await title.inputValue(),'ร่างที่ต้องเก็บระหว่างตรวจ');checks.push('unsaved_review_selection_cancel_retains_draft');
 stage='review_revision_conflict';
 const competingDraft=structuredClone(review.saved.draft);competingDraft.metadata.title='ร่างตรวจจากอีกหน้าจอ';
 const competing=await page.request.put(reviewUrl,{headers:{origin:base},data:{expectedJobRevision:4,expectedExtractionRevision:4,expectedReviewRevision:3,draft:competingDraft}});assert.equal(competing.status(),200);review=(await competing.json()).review;
 const conflictPut=waitReviewPut();await saveReview.click();assert.equal((await conflictPut).status(),409);assert.equal(await title.inputValue(),'ร่างที่ต้องเก็บระหว่างตรวจ');assert(await saveReview.isDisabled());
 await reviewSection.getByRole('button',{name:'โหลดฉบับล่าสุด',exact:true}).click();
 await reviewSection.getByRole('button',{name:'ยืนยันโหลดและทิ้งร่าง',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.knowledge-review input')?.value==='ร่างตรวจจากอีกหน้าจอ');checks.push('review_cas_conflict_retention_and_explicit_reload');
 stage='review_extraction_revision_mismatch';
 await title.fill('ร่างจากข้อความฉบับก่อนแก้');
 const changedAgain=finalDraft+'\nฉบับแก้ใหม่ระหว่างตรวจ metadata';
 const updated=await page.request.patch(new URL(`/api/knowledge/imports/${jobId}/edit`,base).href,{headers:{origin:base},data:{revision:4,edit:{reason:'Review mismatch fixture',pages:[{index:0,text:changedAgain}]}}});assert.equal(updated.status(),200);assert.equal((await updated.json()).preview.extractionRevision,5);
 const mismatchPut=waitReviewPut();await saveReview.click();assert.equal((await mismatchPut).status(),409);assert.equal(await page.getByLabel('ข้อความในหน้า 1').inputValue(),finalDraft);
 await reviewSection.getByRole('button',{name:'โหลดฉบับล่าสุด',exact:true}).click();await reviewSection.getByRole('button',{name:'ยืนยันโหลดและทิ้งร่าง',exact:true}).click();
 const refreshPreview=reviewSection.getByRole('button',{name:'โหลดข้อความและคำเตือนฉบับล่าสุด',exact:true});await refreshPreview.waitFor();assert(await saveReview.isDisabled());assert.equal(await title.inputValue(),'ร่างจากข้อความฉบับก่อนแก้');assert.equal(await page.getByLabel('ข้อความในหน้า 1').inputValue(),finalDraft);
 page.once('dialog',dialog=>dialog.accept());await refreshPreview.click();await page.waitForFunction(value=>document.querySelector('.knowledge-extraction-editor textarea')?.value===value,changedAgain);
 const startCurrent=reviewSection.getByRole('button',{name:'เริ่มตรวจฉบับปัจจุบัน',exact:true});await startCurrent.waitFor();assert(await title.isDisabled());await startCurrent.click();await title.fill('ร่างตรวจฉบับปัจจุบัน');
 const currentPut=waitReviewPut();await saveReview.click();const currentResponse=await currentPut;assert.equal(currentResponse.status(),200);review=(await currentResponse.json()).review;assert.equal(review.reviewRevision,5);assert.equal(review.jobRevision,5);assert.equal(review.extractionRevision,5);assert(Object.values(review.saved.draft.attestations).every(value=>value===false));
 const history=(await database.query('select job_revision,extraction_revision,review_revision from private.knowledge_import_reviews where job_id=$1 order by review_revision',[jobId])).rows;
 assert.deepEqual(history.map(row=>row.review_revision),[1,2,3,4,5]);assert(history.slice(0,4).every(row=>row.job_revision===4&&row.extraction_revision===4));checks.push('concurrent_extraction_blocks_old_preview_until_explicit_refresh_and_recheck');
 stage='private_review_http_permissions';
 const privateRead=await page.request.get(reviewUrl);assert.equal(privateRead.status(),200);assert(privateRead.headers()['cache-control'].includes('no-store'));assert(privateRead.headers().vary.includes('Cookie'));
 const foreignReview=await page.request.put(reviewUrl,{headers:{origin:'https://foreign.invalid'},data:{}});assert.equal(foreignReview.status(),403);
 const anonymousContext=await browser.newContext();try{const anonymousPage=await anonymousContext.newPage();assert.equal((await anonymousPage.request.get(reviewUrl)).status(),401);assert.equal((await anonymousPage.request.put(reviewUrl,{headers:{origin:base},data:{}})).status(),401);}finally{await anonymousContext.close();}
 assert.deepEqual(await countPublished(),before);checks.push('private_review_no_store_foreign_origin_and_anonymous_denial');
 const attachment=await page.request.get(new URL(`/api/knowledge/imports/${jobId}/original`,base).href);assert.equal(attachment.status(),200);assert.deepEqual(await attachment.body(),original);assert(attachment.headers()['content-disposition'].startsWith('attachment;'));checks.push('authenticated_original_exact_private_attachment');
 stage='browser_storage_denial';
 const ref=(await database.query('select original_id from private.knowledge_import_jobs where id=$1',[jobId])).rows[0];
 const publishable=process.env.SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 const anon=createClient(process.env.SUPABASE_URL,publishable,{auth:{persistSession:false,autoRefreshToken:false}});
 const denied=await anon.storage.from('knowledge-originals').download(`${jobId}/${ref.original_id}.yrue`);
 assert(denied.error&&!denied.data,'ANONYMOUS_STORAGE_READ_MUST_FAIL');checks.push('anonymous_storage_object_denied');
 for(const [name,size] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  stage=`${name}_layout`;
  await page.setViewportSize(size);await page.screenshot({path:resolve(output,`${name}.png`),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));checks.push(`${name}_no_horizontal_overflow`);
 }
 stage='keyboard';
 await page.getByRole('button',{name:'อัปโหลดไฟล์',exact:true}).focus();await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'URL เว็บไซต์');assert.equal(directEmbeddingCalls,0);checks.push('keyboard_mode_navigation_and_backend_only_embedding');
 stage='ordinary_role_denial';
 for(const identity of credentials.accounts.filter(item=>item.role!=='SUPER_ADMIN')){
  const context=await browser.newContext();const other=await context.newPage();try{await login(other,identity);const route=await other.goto(new URL(`/knowledge/import?id=${jobId}`,base).href);assert.equal(route?.status(),404);
   const preview=await other.request.get(new URL(`/api/knowledge/imports/${jobId}/preview`,base).href);assert.equal(preview.status(),403);
   assert.equal((await other.request.get(reviewUrl)).status(),403);assert.equal((await other.request.put(reviewUrl,{headers:{origin:base},data:{expectedJobRevision:5,expectedExtractionRevision:5,expectedReviewRevision:5,draft:unfinishedReviewDraft()}})).status(),403);
  }finally{await context.close();}
 }
 checks.push('ordinary_roles_page_and_private_api_denied');assert.deepEqual(await countPublished(),before);checks.push('no_publication_or_chunk_indexing');
 console.log(JSON.stringify({status:'PASS',checks,retainedSyntheticOriginals:1,approvedCorpus:false,credentialsPrinted:false,productionTarget:false}));
}catch(error){const firstLine=(error?.message??'').split('\n')[0];
 if(activePage&&!activePage.isClosed()){
  await activePage.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>undefined);
  const surface=await activePage.locator('.knowledge-review').evaluate(element=>({text:element.innerText,controls:Array.from(element.querySelectorAll('input,select,button')).map(control=>({name:control.closest('label')?.textContent??control.textContent,disabled:control.disabled})),details:Array.from(element.querySelectorAll('details')).map(item=>({summary:item.querySelector('summary')?.textContent,open:item.open}))})).catch(()=>null);
  await writeFile(resolve(output,'failure.json'),JSON.stringify({stage,jobId,surface},null,2));
 }
 console.error(JSON.stringify({status:'FAIL',stage,code:error?.code==='ERR_ASSERTION'?'ASSERTION':error?.name==='TimeoutError'?'BROWSER_TIMEOUT':'CONTROLLED_FAILURE',operation:firstLine.match(/^(?:locator|page)\.(\w+):/)?.[1],assertion:/^[A-Z_]+$/.test(firstLine)?firstLine:undefined,syntheticOriginalRetained:jobId!==null}));process.exitCode=1;}
finally{await browser.close();await database.end();}
