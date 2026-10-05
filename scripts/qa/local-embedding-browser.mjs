import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const runtime=process.env.PLAYWRIGHT_RUNTIME_PATH;
assert(runtime,'PLAYWRIGHT_RUNTIME_PATH_REQUIRED');
const {chromium}=createRequire(resolve(runtime,'package.json'))('playwright');
const base=process.env.APP_BASE_URL??'http://localhost:3000';
const stored=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));
const account=stored.accounts.find(item=>item.role==='SUPER_ADMIN');assert(account,'LOCAL_ADMIN_CREDENTIAL_REQUIRED');
const output=resolve('.superpowers/staging/embedding-update/browser');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});let stage='login';
const checks=[];const endpointCalls=[];
try{
 const page=await browser.newPage();page.on('request',request=>{if(/127\.0\.0\.1:8000|localhost:8000/.test(request.url()))endpointCalls.push(true);});
 await page.goto(new URL('/login',base).href);
 await page.locator('input[name="email"]').fill(account.email);
 await page.locator('input[name="password"]').fill(account.password);
 await page.locator('button[type="submit"]').click();
 await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:45_000});
 stage='provider_page';await page.goto(new URL('/providers',base).href);await page.getByRole('heading',{name:'Embedding Service',exact:true}).waitFor({timeout:45_000});
 const panel=page.locator('.embedding-service-status');
 assert((await panel.innerText()).includes('intfloat/multilingual-e5-small'));
 assert((await panel.innerText()).includes('384'));assert((await panel.innerText()).includes('Healthy'));
 assert.equal(await page.getByRole('tab',{name:'Embedding',exact:true}).count(),0);
 assert.equal(await page.locator('select[name="purpose"],input[name="embeddingDimensions"]').count(),0);
 assert(!/D:\\AI|127\.0\.0\.1:8000|EMBEDDING_API_KEY/.test(await panel.innerText()));checks.push('read_only_healthy_default_no_embedding_configuration');
 const health=await page.request.get(new URL('/api/knowledge/embedding/health',base).href);
 assert.equal(health.status(),200);assert.equal((await health.json()).embedding.dimension,384);checks.push('authenticated_backend_health_api');
 for(const [name,size] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  await page.setViewportSize(size);await page.screenshot({path:resolve(output,`${name}.png`),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));checks.push(`${name}_no_horizontal_overflow`);
 }
 await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement!==document.body));checks.push('keyboard_focus');
 assert.equal(endpointCalls.length,0);checks.push('no_browser_call_to_fastapi');
 console.log(JSON.stringify({status:'PASS',checks,fixtureCredentialsPrinted:false,databaseRecordsCreated:false}));
}catch{console.error(JSON.stringify({status:'FAIL',stage}));process.exitCode=1;}
finally{await browser.close();}
