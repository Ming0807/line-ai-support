import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Pool} from 'pg';
const output=resolve('.superpowers/staging/v1-ui-qa');
const runtime=JSON.parse(await readFile(resolve(output,'runtime.json'),'utf8')),target=new URL(runtime.connectionString);
assert.equal(runtime.baseUrl,'http://127.0.0.1:3012');assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'54422');assert(/^yru_publication_ui_qa_[a-f0-9]{12}$/.test(runtime.database));assert.equal(decodeURIComponent(target.pathname.slice(1)),runtime.database);assert.equal(runtime.migrations,33);
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF);
const account=credentials.accounts.find(a=>a.role==='STAFF');assert(account);
const pool=new Pool({connectionString:runtime.connectionString});
const profile=(await pool.query('select department_id from public.staff_profiles where id=$1 and active',[account.id])).rows[0];assert(profile?.department_id);
const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',['ASSIST_BROWSER_'+randomUUID()])).rows[0].id;
const conversation=(await pool.query("insert into public.conversations(line_session_id,mode,conversation_type) values($1,'HUMAN','TICKET') returning id",[session])).rows[0].id;
const id=(await pool.query("insert into public.tickets(line_session_id,conversation_id,department_id,assigned_staff_id,problem_summary,category,mode,status) values($1,$2,$3,$4,'กรณีทดสอบสำหรับตรวจร่าง AI','IT_NETWORK','HUMAN','STAFF_HANDLING') returning id",[session,conversation,profile.department_id,account.id])).rows[0].id;
const {chromium}=createRequire(resolve(process.env.YRU_QA_PLAYWRIGHT_PACKAGE))('playwright');const browser=await chromium.launch({headless:true,executablePath:process.env.YRU_QA_BROWSER_EXECUTABLE});let stage='start';const checks=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',()=>errors.push('PAGE_ERROR'));let replies=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/reply'))replies++;});
 stage='login';await page.goto(runtime.baseUrl+'/login');await page.locator('input[name="email"]').fill(account.email);await page.locator('input[name="password"]').fill(account.password);await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:45000});
 stage='actual_private_API';const endpoint=runtime.baseUrl+`/api/tickets/${id}/assist`,headers={origin:runtime.baseUrl};
 assert.equal((await context.request.post(endpoint,{headers,data:{revision:0,sql:'select 1'}})).status(),400);
 const disabled=await context.request.post(endpoint,{headers,data:{revision:0}});assert.equal(disabled.status(),503,'OWNED_SERVER_AI_DISABLED');assert.equal(disabled.headers()['cache-control'],'private, no-store, max-age=0');checks.push('actual_auth_scope_strict_API_and_disabled_provider_guard');
 stage='network_failure';await page.goto(runtime.baseUrl+`/tickets/${id}`);await page.locator('#staff-reply').fill('ข้อความเจ้าหน้าที่ที่ต้องเก็บไว้');
 await page.route('**/api/tickets/*/assist',route=>route.abort('failed'),{times:1});await page.getByRole('button',{name:'ช่วยสรุปและร่างคำตอบ',exact:true}).click();await page.getByRole('alert').filter({hasText:'การเชื่อมต่อขาดหาย'}).waitFor();assert.equal(await page.locator('#staff-reply').inputValue(),'ข้อความเจ้าหน้าที่ที่ต้องเก็บไว้');checks.push('failed_generation_preserves_existing_composer');
 const fixture={revision:0,advice:{ticketSummary:'สรุป fixture',conversationSummary:'บทสนทนา fixture',replyDraft:'กรุณาระบุรายละเอียดเพิ่มเติมครับ',suggestedDepartmentCode:null,suggestedPriority:'MEDIUM',reason:'คำแนะนำ fixture สำหรับทดสอบ UI',uncertainties:[]},historyTruncated:true,knowledgeStatus:'NOT_SEARCHED'};
 stage='fixture_advice';await page.route('**/api/tickets/*/assist',route=>{assert.deepEqual(route.request().postDataJSON(),{revision:0});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)});},{times:1});await page.getByRole('button',{name:'ช่วยสรุปและร่างคำตอบ',exact:true}).click();await page.getByText('ร่างนี้ยังไม่ได้ค้นเอกสารยืนยัน กรุณาตรวจสอบข้อเท็จจริงก่อนใช้',{exact:true}).waitFor();
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'นำร่างไปแก้ไขก่อนส่ง',exact:true}).click();assert.equal(await page.locator('#staff-reply').inputValue(),'ข้อความเจ้าหน้าที่ที่ต้องเก็บไว้');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'นำร่างไปแก้ไขก่อนส่ง',exact:true}).click();assert.equal(await page.locator('#staff-reply').inputValue(),fixture.advice.replyDraft);assert.equal(replies,0);checks.push('fixture_advice_explicit_overwrite_confirmation_and_no_auto_reply');
 stage='responsive';for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?900:844});await page.evaluate(()=>window.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:resolve(output,'screenshots',`staff_assist_${width}.png`),fullPage:true});}checks.push('fixture_1440_390_320_no_overflow');
 stage='stale_revision';await page.route('**/api/tickets/*/assist',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...fixture,revision:1})}),{times:1});await page.getByRole('button',{name:'ช่วยสรุปและร่างคำตอบ',exact:true}).click();await page.getByRole('alert').filter({hasText:'เคสมีข้อมูลใหม่'}).waitFor();assert.equal(await page.getByRole('button',{name:'นำร่างไปแก้ไขก่อนส่ง',exact:true}).count(),0);assert.equal(await page.locator('#staff-reply').inputValue(),fixture.advice.replyDraft);checks.push('stale_response_is_not_applied');
 assert.equal(replies,0);assert.equal(errors.length,0);assert.equal((await pool.query('select count(*)::int n from private.message_outbox where ticket_id=$1',[id])).rows[0].n,0);
 await writeFile(resolve(output,'assist-browser-result.json'),JSON.stringify({status:'PASS',checks,UIAdvice:'FIXTURE',actualPrivateHTTP:true,liveProvider:false,liveLINE:false},null,2));console.log(JSON.stringify({status:'PASS',checks,UIAdvice:'FIXTURE',actualPrivateHTTP:true,liveProvider:false,liveLINE:false}));await context.close();
}catch{console.error(JSON.stringify({status:'FAIL',stage,checks}));process.exitCode=1;}
finally{await browser.close();await pool.end();}
