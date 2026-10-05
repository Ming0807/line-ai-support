import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {databaseConnection} from '../../lib/database/connection.ts';
import {assertDevelopmentTarget} from '../../lib/database/development-target.ts';
assertDevelopmentTarget({environment:process.env.YRU_DEPLOYMENT_ENV,projectRef:process.env.DEV_SUPABASE_PROJECT_REF,supabaseUrl:process.env.SUPABASE_URL,directUrl:process.env.DIRECT_URL},'tqgbodenouvcwepoxwbu');
const runtime=process.env.PLAYWRIGHT_RUNTIME_PATH;assert(runtime,'PLAYWRIGHT_RUNTIME_PATH_REQUIRED');
const {chromium}=createRequire(resolve(runtime,'package.json'))('playwright');
const base=process.env.APP_BASE_URL??'http://localhost:3000';assert(new URL(base).hostname==='localhost','LOCAL_BROWSER_HOST_REQUIRED');
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));
const account=credentials.accounts.find(item=>item.role==='SUPER_ADMIN');assert(account,'ADMIN_FIXTURE_REQUIRED');
const output=resolve('.superpowers/staging/import-preview/browser');await mkdir(output,{recursive:true});
const database=new Client(databaseConnection(process.env.DIRECT_URL));await database.connect();
const browser=await chromium.launch({headless:true});let stage='login';const checks=[];let jobId=null;let directEmbeddingCalls=0;
const countPublished=async()=>{const row=(await database.query('select (select count(*)::int from public.documents) documents,(select count(*)::int from public.knowledge_chunks) chunks')).rows[0];return row;};
async function login(page,identity){
 await page.goto(new URL('/login',base).href);await page.locator('input[name="email"]').fill(identity.email);await page.locator('input[name="password"]').fill(identity.password);
 await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:45000});
}
try{
 const before=await countPublished();
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('request',request=>{if(/127\.0\.0\.1:8000|localhost:8000/.test(request.url()))directEmbeddingCalls++;});
 await login(page,account);stage='upload_page';await page.goto(new URL('/knowledge/import',base).href);
 const fixtureId=randomUUID(),filename=`qa-private-import-${fixtureId}.html`;
 // Distinct bytes, not only a distinct name: immutable-original dedup uses checksum.
 const original=Buffer.from(`<html><!-- synthetic fixture ${fixtureId} --><h1>คู่มือ WiFi</h1><p>ขั้นตอนทดสอบการเชื่อมต่อเครือข่าย</p><table><tr><td>บริการ</td><td>สถานที่</td></tr><tr><td>WiFi</td><td>ห้องสมุด</td></tr></table></html>`);
 await page.getByLabel('เลือกไฟล์ PDF, Word, Excel, CSV หรือ HTML').setInputFiles({name:filename,mimeType:'text/html',buffer:original});
 await page.getByLabel('URL แหล่งที่มาทางการ (ถ้ามี)',{exact:true}).fill('https://nse.yru.ac.th/guide');
 const receipt=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/knowledge/import'&&response.request().method()==='POST');
 await page.getByRole('button',{name:'รับต้นฉบับเพื่อเตรียมตรวจ',exact:true}).click();const staged=await receipt;assert([200,201].includes(staged.status()));jobId=(await staged.json()).job.id;checks.push('private_upload_receipt');
 stage='analyze';const analyzed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/knowledge/analyze');
 await page.getByRole('button',{name:'วิเคราะห์เอกสาร',exact:true}).click();const analyzedResponse=await analyzed;assert.equal(analyzedResponse.status(),200);
 const first=(await analyzedResponse.json()).preview;assert.equal(first.extractionRevision,1);assert(first.extraction.locations.pages.every(location=>location.kind==='HTML'));assert.equal(first.analysis.approved,false);
 await page.getByLabel('ข้อความในหน้า 1').waitFor();checks.push('supervised_analysis_located_private_preview');
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
  }finally{await context.close();}
 }
 checks.push('ordinary_roles_page_and_private_api_denied');assert.deepEqual(await countPublished(),before);checks.push('no_publication_or_chunk_indexing');
 console.log(JSON.stringify({status:'PASS',checks,retainedSyntheticOriginals:1,approvedCorpus:false,credentialsPrinted:false,productionTarget:false}));
}catch(error){const firstLine=(error?.message??'').split('\n')[0];console.error(JSON.stringify({status:'FAIL',stage,code:error?.code==='ERR_ASSERTION'?'ASSERTION':error?.name==='TimeoutError'?'BROWSER_TIMEOUT':'CONTROLLED_FAILURE',assertion:/^[A-Z_]+$/.test(firstLine)?firstLine:undefined,syntheticOriginalRetained:jobId!==null}));process.exitCode=1;}
finally{await browser.close();await database.end();}
