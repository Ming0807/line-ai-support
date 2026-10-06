import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {databaseConnection} from '../../lib/database/connection.ts';
import {assertDevelopmentTarget} from '../../lib/database/development-target.ts';
assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
const runtime=process.env.PLAYWRIGHT_RUNTIME_PATH;assert(runtime,'PLAYWRIGHT_RUNTIME_PATH_REQUIRED');
const {chromium}=createRequire(resolve(runtime,'package.json'))('playwright');
const base=process.env.APP_BASE_URL??'http://localhost:3000';assert(new URL(base).hostname==='localhost','LOCAL_BROWSER_HOST_REQUIRED');
const accounts=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8')).accounts;
const account=accounts.find(item=>item.role==='SUPER_ADMIN');assert(account,'ADMIN_FIXTURE_REQUIRED');
const scopedAccounts=accounts.filter(item=>item.role==='STAFF');assert(scopedAccounts.length===2&&new Set(scopedAccounts.map(item=>item.departmentCode)).size===2,'TWO_DEPARTMENT_STAFF_FIXTURES_REQUIRED');
const database=new Client(databaseConnection(process.env.DIRECT_URL));await database.connect();
const output=resolve('.superpowers/staging/import-preview/versions-browser');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),familyId=randomUUID(),familyCode='TEST_'+familyId.replaceAll('-','').toUpperCase();
const documentIds=[];const checks=[];let stage='login',jobId=null,page=null,directEmbeddingCalls=0;
async function mark(next){stage=next;await writeFile(resolve(output,'progress.json'),JSON.stringify({stage,completedGroups:checks.length},null,2));}
async function waitParent(enabled){await page.waitForFunction(expected=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='วิเคราะห์เอกสาร'&&button.disabled===!expected),enabled);}
async function login(surface,identity){await surface.goto(new URL('/login',base).href);await surface.locator('input[name="email"]').fill(identity.email);await surface.locator('input[name="password"]').fill(identity.password);await surface.locator('button[type="submit"]').click();await surface.waitForURL(url=>url.pathname==='/dashboard',{timeout:45000});}
async function fixtureDocument(title,stream,{current=false,department='REGISTRAR',approved=true}={}){
 const id=randomUUID();
 await database.query(`insert into public.documents(id,document_family_id,department_id,title,document_type,version_name,version_stream,academic_year,audience,student_type,
 status,is_current,approval_status,approved_at,effective_from,extraction_reviewed,requires_review,visibility,checksum,revision)
 values($1,$2,(select id from public.departments where code=$3),$4,'REGULATION','2569',$5,2569,'ALL','ALL',$6,$7,$8,case when $9 then clock_timestamp() else null end,'2026-01-01',$9,not $9,'INTERNAL',$10,4)`,
 [id,familyId,department,title,stream,approved?'ACTIVE':'PENDING_REVIEW',current,approved?'APPROVED':'PENDING',approved,createHash('sha256').update(id).digest('hex')]);documentIds.push(id);return id;
}
try{
 const before=(await database.query('select (select count(*)::int from public.documents) documents,(select count(*)::int from public.knowledge_chunks) chunks')).rows[0];
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('request',request=>{if(/127\.0\.0\.1:8000|localhost:8000/.test(request.url()))directEmbeddingCalls++;});await login(page,account);
 await mark('private_fixture');const original=Buffer.from(`<html><h1>Version QA ${randomUUID()}</h1><p>เอกสารสังเคราะห์สำหรับทดสอบตัวเลือกฉบับเท่านั้น</p></html>`);
 const uploaded=await page.request.post(new URL('/api/knowledge/import',base).href,{headers:{origin:base},multipart:{file:{name:'version-qa.html',mimeType:'text/html',buffer:original}}});assert.equal(uploaded.status(),201);jobId=(await uploaded.json()).job.id;
 const analyzed=await page.request.post(new URL('/api/knowledge/analyze',base).href,{headers:{origin:base},data:{id:jobId,revision:0}});assert.equal(analyzed.status(),200);
 await page.goto(new URL(`/knowledge/import?id=${jobId}`,base).href);
 const review=page.locator('.knowledge-review'),panel=page.locator('.knowledge-version-panel');await panel.waitFor();
 const lookup=()=>panel.getByRole('button',{name:/^(ตรวจรุ่นเอกสาร|ตรวจอีกครั้ง)$/});
 const save=review.getByRole('button',{name:'บันทึกร่างส่วนตัว',exact:true});
 const saveDraft=async()=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/knowledge/imports/${jobId}/review`&&r.request().method()==='PUT');await save.click();const result=await response;assert.equal(result.status(),200);return (await result.json()).review;};
 const look=async()=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/knowledge/imports/${jobId}/versions`);await lookup().click();const result=await response;assert.equal(result.status(),200);const resolution=(await result.json()).resolution;await panel.getByRole('button',{name:'ตรวจอีกครั้ง',exact:true}).waitFor();return resolution;};
 assert(await lookup().isDisabled());await review.getByLabel('ชื่อเอกสาร',{exact:true}).fill('ร่างตรวจรุ่นที่ยังไม่ครบ');await saveDraft();
 const incomplete=await look();assert.equal(incomplete.missingMetadata.length,6);assert.equal(await panel.getByRole('radio').count(),0);checks.push('unfinished_saved_scope_is_explicit_and_never_auto_selected');
 await mark('complete_metadata');
 for(const [label,value] of [['รหัสกลุ่มเอกสาร',familyCode],['หน่วยงาน','REGISTRAR'],['ประเภทเอกสาร','REGULATION'],['สายฉบับ','MAIN'],['กลุ่มผู้ใช้','ALL'],['ประเภทนักศึกษา','ALL'],['ปีการศึกษา','2569']])await review.getByLabel(label,{exact:label!=='รหัสกลุ่มเอกสาร'}).fill(value);
 assert(await lookup().isDisabled());await saveDraft();const absent=await look();assert.equal(absent.family,null);assert.deepEqual(absent.availableActions,['NEW_FAMILY']);assert.equal(await panel.getByRole('radio',{checked:true}).count(),0);
 await panel.getByRole('radio',{name:/^เริ่มกลุ่มเอกสารใหม่/}).check();await review.locator('summary').filter({hasText:'ครอบครัวเอกสารใหม่'}).click();await review.getByLabel('ชื่อครอบครัวใหม่').fill('กลุ่มสังเคราะห์');await review.getByLabel('หมวดครอบครัวใหม่').fill('ทดสอบ');
 let state=await saveDraft();assert.equal(state.saved.draft.action,'NEW_FAMILY');assert.equal(state.saved.draft.metadata.newFamily.name,'กลุ่มสังเคราะห์');checks.push('explicit_custom_new_family_selection_and_incomplete_draft_save');
 await look();await panel.getByRole('button',{name:'ล้างการดำเนินการและเป้าหมาย',exact:true}).click();await review.getByLabel('รหัสกลุ่มเอกสาร').fill('LIBRARY_GUIDE');state=await saveDraft();assert.equal(state.saved.draft.metadata.newFamily,null);assert.equal(state.saved.draft.action,null);
 const seeded=await look();assert.equal(seeded.family.code,'LIBRARY_GUIDE');assert.deepEqual(seeded.availableActions,['ADD_ADDITIONAL','ADD_HISTORICAL']);
 await panel.getByRole('radio',{name:/^เพิ่มเอกสารเพิ่มเติม/}).check();state=await saveDraft();assert.equal(state.saved.draft.action,'ADD_ADDITIONAL');assert.equal(state.saved.draft.target,null);checks.push('fixed_catalog_and_ordinary_additional_without_publication');
 await mark('exact_targets');await panel.getByRole('button',{name:'ล้างการดำเนินการและเป้าหมาย',exact:true}).click();await review.getByLabel('รหัสกลุ่มเอกสาร').fill(familyCode);await saveDraft();
 await database.query("insert into public.document_families(id,code,name,category) values($1,$2,'กลุ่มทดสอบรุ่น','ทดสอบ')",[familyId,familyCode]);
 const baseId=await fixtureDocument('เอกสารหลักทดสอบ','MAIN',{current:true}),amendId=await fixtureDocument('เอกสารแก้ไขทดสอบ','AMEND'),cancelId=await fixtureDocument('เอกสารยกเลิกทดสอบ','CANCEL');
 await fixtureDocument('เอกสารต่างหน่วยงาน','FOREIGN',{current:true,department:'IT'});await fixtureDocument('เอกสารยังไม่อนุมัติ','PENDING',{approved:false});
 await database.query("insert into public.document_relationships(source_document_id,target_document_id,relation_type) values($1,$2,'AMENDS'),($3,$1,'CANCELS')",[amendId,baseId,cancelId]);
 let resolution=await look();assert.equal(resolution.currentStreamOccupied,true);assert.equal(await panel.getByRole('radio',{name:/^เพิ่มเอกสารเพิ่มเติม/}).count(),0);
 for(const [label,action,relationship,targetId] of [['เพิ่มฉบับย้อนหลัง','ADD_HISTORICAL',null,null],['แทนฉบับปัจจุบัน','REPLACE_CURRENT',null,baseId],['เอกสารแก้ไขเพิ่มเติม','AMEND_EXISTING',null,baseId],['ยกเลิกเอกสารเดิม','ADD_ADDITIONAL','CANCELS',amendId]]){
  await panel.getByRole('radio',{name:new RegExp('^'+label)}).check();
  if(targetId){const target=panel.getByLabel('เอกสารเป้าหมาย');assert.equal(await target.inputValue(),'','TARGET_MUST_REQUIRE_EXPLICIT_SELECTION');assert(await save.isDisabled(),'MISSING_TARGET_MUST_NOT_SEND_INVALID_DRAFT');assert(!(await target.textContent()).includes(baseId));assert(!(await target.textContent()).includes('เอกสารต่างหน่วยงาน'));assert(!(await target.textContent()).includes('เอกสารยังไม่อนุมัติ'));assert(!(await target.textContent()).includes('เอกสารยกเลิกทดสอบ'));await target.selectOption(`${targetId}:4`);}
  state=await saveDraft();assert.equal(state.saved.draft.action,action);assert.equal(state.saved.draft.relationship,relationship);assert.deepEqual(state.saved.draft.target,targetId?{documentId:targetId,revision:4}:null);assert(Object.values(state.saved.draft.attestations).every(value=>value===false));
  resolution=await look();
 }
 checks.push('all_five_actions_exact_readable_targets_and_separate_amendment_cancellation');
 await mark('discard_local_target_intent');
 const attestations=review.locator('summary').filter({hasText:'คำยืนยันก่อนตรวจต่อ'});await attestations.click();
 const sourceAttestation=review.getByRole('checkbox',{name:'ตรวจสอบหน่วยงานและแหล่งที่มาจากหลักฐานแล้ว',exact:true});await sourceAttestation.check();
 await panel.getByRole('radio',{name:/^แทนฉบับปัจจุบัน/}).check();assert.equal(await panel.getByLabel('เอกสารเป้าหมาย').inputValue(),'');assert(await save.isDisabled());
 page.once('dialog',dialog=>dialog.accept());const resetResponse=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/knowledge/imports/${jobId}/review`&&r.request().method()==='GET');
 await review.getByRole('button',{name:'ทิ้งการแก้ไขในเครื่อง',exact:true}).click();assert.equal((await resetResponse).status(),200);await look();
 assert.equal(await panel.getByRole('radio',{name:/^ยกเลิกเอกสารเดิม/}).isChecked(),true);assert.equal(await sourceAttestation.isChecked(),false);assert(await page.getByRole('button',{name:'วิเคราะห์เอกสาร',exact:true}).isEnabled());
 checks.push('confirmed_discard_resets_child_intent_and_releases_parent_without_changing_saved_target');
 await mark('stale_target_revision');await database.query('update public.documents set revision=5 where id=$1 and document_family_id=$2',[amendId,familyId]);await look();
 await panel.getByRole('alert').waitFor();assert.equal(await panel.getByRole('button',{name:'ล้างการดำเนินการและเป้าหมาย',exact:true}).count(),1);await waitParent(false);assert(await page.getByRole('button',{name:'วิเคราะห์เอกสาร',exact:true}).isDisabled());
 await panel.getByRole('button',{name:'ล้างการดำเนินการและเป้าหมาย',exact:true}).click();await waitParent(true);assert(await page.getByRole('button',{name:'วิเคราะห์เอกสาร',exact:true}).isEnabled());state=await saveDraft();assert.equal(state.saved.draft.target,null);await look();
 await panel.getByRole('radio',{name:/^ยกเลิกเอกสารเดิม/}).check();assert.equal(await panel.getByLabel('เอกสารเป้าหมาย').inputValue(),'');await panel.getByLabel('เอกสารเป้าหมาย').selectOption(`${amendId}:5`);await saveDraft();await look();
 checks.push('actual_stale_target_revision_locks_save_then_explicit_clear_and_reselection_recovers');
 await mark('foreign_current_stream');await review.getByLabel('สายฉบับ',{exact:true}).fill('FOREIGN');await saveDraft();const foreign=await look();assert.equal(foreign.currentStreamOccupied,true);assert.equal(await panel.getByRole('radio',{name:/^แทนฉบับปัจจุบัน/}).count(),0);assert(!(await panel.textContent()).includes('เลือกแทนฉบับ'));
 await review.getByLabel('สายฉบับ',{exact:true}).fill('MAIN');await saveDraft();await look();checks.push('cross_department_occupancy_does_not_promise_ineligible_replacement');
 await mark('metadata_invalidates');await review.getByLabel('หน่วยงาน',{exact:true}).fill('IT');assert(await lookup().isDisabled());assert.equal(await panel.getByRole('radio').count(),0);await review.getByLabel('หน่วยงาน',{exact:true}).fill('REGISTRAR');
 await look();checks.push('unsaved_metadata_invalidates_results_and_requery_recovers');
 const pattern=`**/api/knowledge/imports/${jobId}/versions?*`;
 await mark('controlled_failure');await page.route(pattern,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'INTERNAL_ERROR'})}));await lookup().click();await panel.getByRole('alert').waitFor();assert(await lookup().isEnabled());assert.equal(await review.getByLabel('ชื่อเอกสาร',{exact:true}).inputValue(),'ร่างตรวจรุ่นที่ยังไม่ครบ');await page.unroute(pattern);await look();checks.push('safe_lookup_failure_retains_draft_and_retry');
 await mark('pending_parent_guard');let release;const held=new Promise(resolve=>{release=resolve;});let entered;const entry=new Promise(resolve=>{entered=resolve;});
 let entryTimer;
 try{
  await page.route(pattern,async route=>{entered();await held;await route.continue();});await lookup().click();
  await Promise.race([entry,new Promise((_resolve,reject)=>{entryTimer=setTimeout(()=>reject(new Error('VERSION_INTERCEPTION_REQUIRED')),10_000);})]);
  await waitParent(false);assert(await page.getByRole('button',{name:'วิเคราะห์เอกสาร',exact:true}).isDisabled());await page.waitForFunction(element=>element.matches(':disabled'),await review.getByLabel('ชื่อเอกสาร',{exact:true}).elementHandle());assert(await review.getByLabel('ชื่อเอกสาร',{exact:true}).isDisabled());
  release();await panel.getByRole('button',{name:'ตรวจอีกครั้ง',exact:true}).waitFor();
 }finally{clearTimeout(entryTimer);release();await page.unroute(pattern);}
 checks.push('lookup_pending_locks_parent_analysis_and_metadata');
 await mark('mismatched_dto');await page.route(pattern,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({resolution:{...resolution,reviewRevision:resolution.reviewRevision+1}})}));await lookup().click();await panel.getByRole('alert').waitFor();assert.equal(await panel.getByRole('radio').count(),0);assert(await lookup().isEnabled());await page.unroute(pattern);await look();checks.push('wrong_snapshot_dto_never_enables_actions');
 await mark('snapshot_conflict');await review.getByLabel('ชื่อเอกสาร',{exact:true}).fill('ร่างในเครื่องต้องอยู่');await saveDraft();
 const current=await page.request.get(new URL(`/api/knowledge/imports/${jobId}/review`,base).href);const latest=(await current.json()).review;
 const competing=await page.request.put(new URL(`/api/knowledge/imports/${jobId}/review`,base).href,{headers:{origin:base},data:{expectedJobRevision:latest.jobRevision,expectedExtractionRevision:latest.extractionRevision,expectedReviewRevision:latest.reviewRevision,draft:latest.saved.draft}});assert.equal(competing.status(),200);
 const conflict=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/knowledge/imports/${jobId}/versions`);await lookup().click();assert.equal((await conflict).status(),409);await panel.getByRole('alert').waitFor();assert.equal(await review.getByLabel('ชื่อเอกสาร',{exact:true}).inputValue(),'ร่างในเครื่องต้องอยู่');assert.equal(await panel.getByRole('radio').count(),0);checks.push('actual_competing_saved_review_409_retains_local_draft');
 await mark('reload_and_layout');await page.reload();await panel.waitFor();await look();
 assert.equal(await panel.getByRole('radio',{name:/^ยกเลิกเอกสารเดิม/}).isChecked(),true);assert.equal(await panel.getByLabel('เอกสารเป้าหมาย').inputValue(),`${amendId}:5`);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});checks.push('saved_target_reload_and_desktop_layout');
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'mobile.png'),fullPage:true});checks.push('mobile_390_no_horizontal_overflow');
 await lookup().focus();assert(await lookup().evaluate(element=>element===document.activeElement));assert.equal(directEmbeddingCalls,0);checks.push('keyboard_and_no_browser_embedding_calls');
 await mark('authorization');const routePath=`/api/knowledge/imports/${jobId}/versions?expectedJobRevision=1&expectedExtractionRevision=1&expectedReviewRevision=1`;
 const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(new URL(routePath,base).href)).status(),401);await anonymous.close();
 for(const identity of scopedAccounts){const surface=await browser.newPage();await login(surface,identity);assert.equal((await surface.request.get(new URL(routePath,base).href)).status(),403);await surface.close();}checks.push('anonymous_and_staff_from_two_departments_denied');
 const counts=(await database.query('select (select count(*)::int from public.documents where id<>all($1::uuid[])) documents,(select count(*)::int from public.knowledge_chunks) chunks',[documentIds])).rows[0];assert.deepEqual(counts,before);checks.push('draft_choices_create_no_published_documents_or_chunks');
 await writeFile(resolve(output,'result.json'),JSON.stringify({status:'PASS',checks,syntheticOriginalRetained:true,syntheticDocumentsCleanedOnExit:true},null,2));console.log(JSON.stringify({status:'PASS',checks,syntheticOriginalRetained:true}));
}catch(error){if(page){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>undefined);await page.locator('.knowledge-review').screenshot({path:resolve(output,'failure-review.png')}).catch(()=>undefined);}const firstLine=String(error?.message??'').split('\n')[0];const line=String(error?.stack??'').match(/knowledge-version-browser\.mjs:(\d+):\d+/)?.[1];await writeFile(resolve(output,'failure.json'),JSON.stringify({stage,diagnostic:firstLine,line},null,2));console.error(JSON.stringify({status:'FAIL',stage,code:error?.code==='ERR_ASSERTION'?'ASSERTION':error?.name==='TimeoutError'?'BROWSER_TIMEOUT':'CONTROLLED_FAILURE',operation:firstLine.match(/^(?:locator|page)\.(\w+):/)?.[1],line,syntheticOriginalRetained:jobId!==null}));process.exitCode=1;}
finally{
 await browser.close();
 // Remove only this run's synthetic INTERNAL metadata fixtures; immutable uploaded original/history is retained.
 if(documentIds.length){await database.query('delete from public.document_relationships where source_document_id=any($1::uuid[]) or target_document_id=any($1::uuid[])',[documentIds]);await database.query('delete from public.documents where id=any($1::uuid[]) and document_family_id=$2',[documentIds,familyId]);}
 await database.query('delete from public.document_families where id=$1 and code=$2',[familyId,familyCode]);await database.end();
}
