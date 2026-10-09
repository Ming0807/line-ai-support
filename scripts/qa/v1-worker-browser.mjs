import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Client} from 'pg';
const output=resolve('.superpowers/staging/v1-ui-qa'),runtime=JSON.parse(await readFile(resolve(output,'runtime.json'),'utf8'));
const target=new URL(runtime.connectionString);
assert.equal(runtime.baseUrl,'http://127.0.0.1:3012');assert.equal(runtime.migrations,35);assert.equal(runtime.retained,true);
assert(/^yru_publication_ui_qa_[a-f0-9]{12}$/u.test(runtime.database));assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'54422');assert.equal(decodeURIComponent(target.pathname.slice(1)),runtime.database);
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF);
const {chromium}=createRequire(resolve(process.env.YRU_QA_PLAYWRIGHT_PACKAGE))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.YRU_QA_BROWSER_EXECUTABLE}),client=new Client({connectionString:runtime.connectionString}),checks=[];
let connected=false,prior,stage='start';
async function login(role){
 const account=credentials.accounts.find(item=>item.role===role);assert(account);
 const context=await browser.newContext(),page=await context.newPage();await page.goto(runtime.baseUrl+'/login');
 await page.locator('input[name="email"]').fill(account.email);await page.locator('input[name="password"]').fill(account.password);await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:45000});return {context,page};
}
try{
 await client.connect();connected=true;
 assert.equal((await client.query('select current_database() name')).rows[0].name,runtime.database);
 assert.equal((await client.query('select pg_get_userbyid(datdba) owner from pg_database where datname=current_database()')).rows[0].owner,'postgres');
 prior=(await client.query('select worker,observed_at from private.worker_observations')).rows;
 await client.query('delete from private.worker_observations');
 stage='super_login';const {context,page}=await login('SUPER_ADMIN'),errors=[];page.on('pageerror',()=>errors.push('PAGE_ERROR'));
 stage='empty_observations';let response=await context.request.get(runtime.baseUrl+'/api/settings/status');assert.equal(response.status(),200);assert.equal(response.headers()['cache-control'],'private, no-store, max-age=0');
 let dto=await response.json();assert.equal(dto.workerObservations.length,4);assert(dto.workerObservations.every(row=>row.lastObservedAt===null));assert.equal(dto.workerLiveness,'UNKNOWN');
 await page.goto(runtime.baseUrl+'/settings');let panel=page.locator('section[aria-labelledby="worker-observations-heading"]');assert.equal(await panel.getByText('ยังไม่มีข้อมูลการทำงาน',{exact:true}).count(),4);checks.push('actual_empty_observations_are_unknown');
 // Explicit isolated schema fixtures exercise old/known and impossible future observations.
 await client.query("insert into private.worker_observations(worker,observed_at) values('INBOX','2026-10-01T02:03:04Z'),('AI',clock_timestamp()+interval '1 day')");
 stage='observed_api';response=await context.request.get(runtime.baseUrl+'/api/settings/status');assert.equal(response.status(),200);dto=await response.json();assert.equal(dto.workerObservations[0].lastObservedAt,'2026-10-01T02:03:04.000Z');assert.equal(dto.workerObservations[2].lastObservedAt,null);assert.equal(dto.workerLiveness,'UNKNOWN');checks.push('actual_observed_timestamp_and_future_exclusion');
 for(const width of [1440,390,320]){
  stage=`settings_${width}`;await page.setViewportSize({width,height:width===1440?900:844});assert.equal((await page.goto(runtime.baseUrl+'/settings')).status(),200);panel=page.locator('section[aria-labelledby="worker-observations-heading"]');
  assert.equal(await panel.locator('tbody tr').count(),4);assert.equal(await panel.locator('time[datetime="2026-10-01T02:03:04.000Z"]').count(),1);assert.equal(await panel.getByText('ยังไม่มีข้อมูลการทำงาน',{exact:true}).count(),3);
  for(const forbidden of ['worker ทำงานปกติ','worker หยุดทำงาน','sb_secret_','postgresql://'])assert(!(await panel.innerText()).includes(forbidden));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'SETTINGS_OVERFLOW');await page.screenshot({path:resolve(output,'screenshots',`worker_settings_${width}.png`),fullPage:true});
 }
 assert.equal(errors.length,0);await context.close();checks.push('compiled_settings_1440_390_320');
 stage='staff_denial';const staff=await login('STAFF');assert.equal((await staff.context.request.get(runtime.baseUrl+'/api/settings/status')).status(),403);await staff.page.goto(runtime.baseUrl+'/settings');assert.equal(await staff.page.locator('section[aria-labelledby="worker-observations-heading"]').count(),0);await staff.context.close();
 const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(runtime.baseUrl+'/api/settings/status')).status(),401);await anonymous.close();checks.push('staff_and_anonymous_private_reads_denied');
 const result={status:'PASS',checks,compiledActualHTTP:true,source:'SYNTHETIC_OWNED_OBSERVATION_FIXTURES',liveWorkerLiveness:false};await writeFile(resolve(output,'worker-browser-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch{console.error(JSON.stringify({status:'FAIL',stage,checks}));process.exitCode=1;}
finally{
 if(connected&&prior)try{await client.query('delete from private.worker_observations');for(const row of prior)await client.query('insert into private.worker_observations(worker,observed_at) values($1,$2)',[row.worker,row.observed_at]);}catch{console.error('OWNED_OBSERVATION_FIXTURE_RESTORE_FAILED');process.exitCode=1;}
 await browser.close();if(connected)await client.end();
}
