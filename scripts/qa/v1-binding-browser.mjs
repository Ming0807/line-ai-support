import 'dotenv/config';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool.ts';
import {processInboxEvent} from '../../lib/queue/process-inbox.ts';
import {parseBindingCommand} from '../../lib/staff/line-binding-contracts.ts';
const output=resolve('.superpowers/staging/v1-ui-qa');
const runtime=JSON.parse(await readFile(resolve(output,'runtime.json'),'utf8')),target=new URL(runtime.connectionString);
assert.equal(runtime.baseUrl,'http://127.0.0.1:3012');assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'54422');
assert(/^yru_publication_ui_qa_[a-f0-9]{12}$/.test(runtime.database));assert.equal(decodeURIComponent(target.pathname.slice(1)),runtime.database);assert.equal(runtime.migrations,33);
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF);
const key=process.env.ENCRYPTION_KEY,secret=process.env.LINE_STAFF_CHANNEL_SECRET?.trim();assert(key&&secret);
const {chromium}=createRequire(resolve(process.env.YRU_QA_PLAYWRIGHT_PACKAGE))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.YRU_QA_BROWSER_EXECUTABLE});
const pool=new Pool({connectionString:runtime.connectionString,max:3});const checks=[];let stage='start';
try{
 const account=credentials.accounts.find(a=>a.role==='STAFF');assert(account);
 const context=await browser.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();const errors=[];page.on('pageerror',()=>errors.push('PAGE_ERROR'));
 stage='login';await page.goto(runtime.baseUrl+'/login');await page.locator('input[name="email"]').fill(account.email);await page.locator('input[name="password"]').fill(account.password);await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:45000});
 stage='self_settings';assert.equal((await page.goto(runtime.baseUrl+'/settings')).status(),200);await page.getByRole('heading',{name:'เชื่อมต่อ LINE เจ้าหน้าที่'}).waitFor();assert.equal(await page.getByText('Worker liveness',{exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'การตั้งค่า',exact:true}).count(),1);checks.push('staff_self_settings_without_admin_observations');
 const endpoint=runtime.baseUrl+'/api/staff/line-binding';const headers={origin:runtime.baseUrl,'content-type':'application/json'};
 assert.equal((await context.request.delete(endpoint,{headers,data:{}})).status(),200);await page.getByRole('button',{name:'ตรวจสอบสถานะ',exact:true}).click();
 stage='lost_challenge_response';let lostBody,firstRequest;
 await page.route('**/api/staff/line-binding/challenge',async route=>{firstRequest=route.request().postDataJSON();const response=await route.fetch();assert.equal(response.status(),200);lostBody=await response.json();await route.abort('failed');},{times:1});
 await page.getByRole('button',{name:'สร้างรหัสเชื่อมต่อ',exact:true}).click();await page.getByRole('alert').filter({hasText:'ดำเนินการไม่สำเร็จ'}).waitFor();assert.equal(await page.locator('#staff-line-command').count(),0);
 let retriedRequest;const capture=r=>{if(r.url().endsWith('/api/staff/line-binding/challenge')&&r.method()==='POST')retriedRequest=r.postDataJSON();};page.on('request',capture);
 await page.getByRole('button',{name:'สร้างรหัสเชื่อมต่อ',exact:true}).click();await page.locator('#staff-line-command').waitFor();page.off('request',capture);const command=await page.locator('#staff-line-command').inputValue();assert(parseBindingCommand(command));assert.equal(command,lostBody.command);assert.deepEqual(retriedRequest,firstRequest);checks.push('lost_response_same_request_recovers_same_one_use_command');
 await page.getByRole('button',{name:'คัดลอกรหัส',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),command);checks.push('copy_button_actual_clipboard');
 stage='supersede';await page.getByRole('button',{name:'สร้างรหัสใหม่',exact:true}).click();await page.waitForFunction(old=>{const field=document.querySelector('#staff-line-command');return field&&field.value!==old;},command);const current=await page.locator('#staff-line-command').inputValue();assert.notEqual(current,command);
 const userId='U'+randomUUID().replaceAll('-','');
 async function signed(text,eventId=randomUUID()){
  const body=JSON.stringify({events:[{webhookEventId:eventId,type:'message',source:{type:'user',userId},message:{id:randomUUID(),type:'text',text},replyToken:'synthetic-only',timestamp:Date.now()}]});
  const signature=createHmac('sha256',secret).update(body).digest('base64');const request={headers:{'content-type':'application/json','x-line-signature':signature},data:body};
  assert.equal((await context.request.post(runtime.baseUrl+'/api/line/staff/webhook',request)).status(),200);
  const job=(await pool.query("select * from private.claim_inbox('STAFF')")).rows[0];assert(job);assert.equal(job.event_id,eventId,'OWNED_EXPECTED_STAFF_EVENT_ONLY');
  await transaction(c=>processInboxEvent(c,job,key),pool);
  return (await pool.query('select status,last_error_code from private.webhook_inbox where id=$1',[job.id])).rows[0];
 }
 stage='signed_stale_command';assert.equal((await signed(command)).last_error_code,'BINDING_INVALID');assert.equal((await context.request.get(endpoint)).status(),200);checks.push('superseded_command_rejected_through_signed_webhook_and_lease');
 stage='signed_current_command';const result=await signed(current);assert.equal(result.status,'DONE');assert.equal(result.last_error_code,null);await page.getByRole('button',{name:'ตรวจสอบสถานะ',exact:true}).click();await page.getByText('เชื่อมต่อบัญชีเรียบร้อยแล้ว',{exact:true}).waitFor();assert.equal(await page.locator('#staff-line-command').count(),0);checks.push('actual_signed_staff_webhook_commits_binding_and_UI_observes');
 assert.equal((await signed(current)).last_error_code,null);checks.push('same_LINE_duplicate_is_idempotent');
 const observed=await context.request.get(endpoint);assert.equal(observed.headers()['cache-control'],'private, no-store, max-age=0');assert.deepEqual(await observed.json(),{bound:true,pending:false,expiresAt:null});
 stage='responsive';for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?900:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:resolve(output,'screenshots',`staff_binding_${width}.png`),fullPage:true});}checks.push('bound_settings_1440_390_320_no_overflow');
 stage='unlink';page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'ยกเลิกการเชื่อมต่อ',exact:true}).click();await page.getByText('ยกเลิกการเชื่อมต่อแล้ว',{exact:true}).waitFor();assert.deepEqual(await (await context.request.get(endpoint)).json(),{bound:false,pending:false,expiresAt:null});assert.equal((await signed(current)).last_error_code,'BINDING_INVALID');checks.push('explicit_unlink_invalidates_consumed_command');
 assert.equal(errors.length,0);await context.close();
 await writeFile(resolve(output,'binding-browser-result.json'),JSON.stringify({status:'PASS',checks,actualSignedStaffWebhook:true,liveLINE:false},null,2));console.log(JSON.stringify({status:'PASS',checks,actualSignedStaffWebhook:true,liveLINE:false}));
}catch{console.error(JSON.stringify({status:'FAIL',stage,checks}));process.exitCode=1;}
finally{await browser.close();await pool.end();}
