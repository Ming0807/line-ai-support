import 'dotenv/config';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const output=resolve('.superpowers/staging/v1-ui-qa'),runtime=JSON.parse(await readFile(resolve(output,'runtime.json'),'utf8'));
assert.equal(runtime.baseUrl,'http://127.0.0.1:3012');assert.equal(runtime.migrations,34);
const fixture=JSON.parse(await readFile(resolve(output,'support-fixture.json'),'utf8'));assert.equal(fixture.fixturesOnly,true);
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF);
const {chromium}=createRequire(resolve(process.env.YRU_QA_PLAYWRIGHT_PACKAGE))('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.YRU_QA_BROWSER_EXECUTABLE}),checks=[];let stage='start';
await mkdir(resolve(output,'screenshots'),{recursive:true});
try{
 const account=credentials.accounts.find(a=>a.role==='STAFF');assert(account);
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',()=>errors.push('PAGE_ERROR'));
 stage='actual_login';await page.goto(runtime.baseUrl+'/login');await page.locator('input[name="email"]').fill(account.email);await page.locator('input[name="password"]').fill(account.password);await page.locator('button[type="submit"]').click();await page.waitForURL(u=>u.pathname==='/dashboard',{timeout:45000});
 const query=new URLSearchParams(fixture.query),endpoint=`${runtime.baseUrl}/api/analytics?${query}`;
 stage='private_metrics';const response=await context.request.get(endpoint);assert.equal(response.status(),200);assert.equal(response.headers()['cache-control'],'private, no-store, max-age=0');const metrics=await response.json();
 assert.deepEqual(metrics.aiOutcomes,fixture.expected);assert.equal(metrics.aiResolutionRate,fixture.rate);assert(!JSON.stringify(metrics).includes(fixture.ticketId));checks.push('authenticated_actual_scoped_metrics_and_denominator');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:width===1440?900:844});
  stage=`ticket_context_${width}`;assert.equal((await page.goto(`${runtime.baseUrl}/tickets/${fixture.ticketId}`)).status(),200);
  const panel=page.locator('section[aria-labelledby="support-context-heading"]');await panel.getByRole('heading',{name:'รายละเอียดที่ผู้แจ้งให้ไว้',exact:true}).waitFor();assert.equal(await panel.locator('dd').count(),3);assert.equal(await panel.getByText('Android',{exact:true}).count(),1);
  for(const token of ['U0','sourceDigest','stateDigest','v1.','sb_secret_'])assert(!(await panel.innerText()).includes(token));
  stage=`ticket_context_overflow_${width}`;await page.screenshot({path:resolve(output,'screenshots',`support_ticket_${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'TICKET_OVERFLOW');
  stage=`analytics_${width}`;assert.equal((await page.goto(`${runtime.baseUrl}/analytics?${query}`)).status(),200);await page.getByText('อัตราการแก้ปัญหาโดย AI',{exact:true}).waitFor();await page.getByText(`ยืนยันแก้ได้ ${fixture.expected.confirmedSolved} · ยืนยันส่งต่อ ${fixture.expected.confirmedEscalated} จาก ${fixture.expected.samples} เรื่องที่ยืนยัน`,{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'ANALYTICS_OVERFLOW');await page.screenshot({path:resolve(output,'screenshots',`support_analytics_${width}.png`),fullPage:true});
 }
 checks.push('actual_context_and_metrics_1440_390_320');
 stage='empty_window';await page.goto(`${runtime.baseUrl}/analytics?from=2000-01-01&to=2000-01-01`);await page.getByText('ยังไม่มีการยืนยันผล',{exact:true}).waitFor();checks.push('zero_observations_are_unknown');
 assert.equal(errors.length,0);await context.close();
 const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(endpoint)).status(),401);await anonymous.close();checks.push('anonymous_metrics_denied');
 const result={status:'PASS',checks,compiledActualHTTP:true,source:'SYNTHETIC_OWNED_FIXTURES',liveProvider:false,liveLINE:false};await writeFile(resolve(output,'support-browser-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch{console.error(JSON.stringify({status:'FAIL',stage,checks}));process.exitCode=1;}
finally{await browser.close();}
