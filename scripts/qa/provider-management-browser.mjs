import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {Client} from 'pg';

const require=createRequire(process.env.PLAYWRIGHT_RUNTIME_PATH?resolve(process.env.PLAYWRIGHT_RUNTIME_PATH,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const base=new URL('http://127.0.0.1:3001');
const credentials=JSON.parse(await readFile(resolve('.superpowers/staging/dev-staff-credentials.json'),'utf8'));
assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF,'DEVELOPMENT_ACCOUNT_PROJECT_MISMATCH');
const accounts=credentials.accounts;
assert.equal(accounts.length,3,'THREE_TEST_ACCOUNTS_REQUIRED');
const admin=accounts.find(account=>account.role==='SUPER_ADMIN');assert(admin,'TEST_ADMIN_REQUIRED');
const pg=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:54422/postgres'});
const providers=[],profiles=[];const fixture=`PRV UI ${randomUUID()}`;
const cases=[];let stage='preflight',browser;
const output=resolve('output/playwright');
function passed(name){cases.push(name);}
async function api(context,path,method='GET',body){
 const response=await context.request.fetch(new URL(path,base).href,{method,headers:{origin:base.origin,'content-type':'application/json'},...(body?{data:body}:{})});
 return {response,value:await response.json()};
}
async function login(account){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 await page.goto(new URL('/login',base).href);
 await page.getByLabel('อีเมล').fill(account.email);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(account.password);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
 await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:30000});
 return {context,page};
}
async function reload(page){await page.reload();await page.getByRole('heading',{name:'ผู้ให้บริการ AI',exact:true}).waitFor();}
async function group(page,id){return page.locator('.provider-card').filter({has:page.locator(`[id="${id}-GENERATION-title"]`)});}
async function addModel(context,providerId,name,purpose='GENERATION'){
 const {response,value}=await api(context,`/api/providers/${providerId}/models`,'POST',{modelId:`fixture/${randomUUID()}`,displayName:name,purpose,
  embeddingDimensions:purpose==='EMBEDDING'?2:null,supportsTools:false,supportsJson:purpose==='GENERATION',supportsVision:false,
  enabled:true,priority:name==='ทดสอบรุ่น A'?10:20,timeoutMs:1000,inputPricePerMillion:null,outputPricePerMillion:null});
 assert.equal(response.status(),200,'CREATE_MODEL_API');return value.id;
}
try{
 await pg.connect();assert.equal((await pg.query('select count(*)::int n from private.ai_providers')).rows[0].n,0,'LOCAL_REGISTRY_MUST_BE_EMPTY');
 for(const account of accounts){
  assert.equal((await pg.query('select exists(select 1 from auth.users where id=$1) or exists(select 1 from public.staff_profiles where id=$1) used',[account.id])).rows[0].used,false,'LOCAL_PROFILE_PREEXISTS');
  await pg.query('insert into auth.users(id) values($1)',[account.id]);profiles.push(account.id);
  const department=account.departmentCode?(await pg.query('select id from public.departments where code=$1',[account.departmentCode])).rows[0]?.id:null;
  await pg.query('insert into public.staff_profiles(id,department_id,role,display_name,active) values($1,$2,$3,$4,true)',[account.id,department,account.role,account.displayName]);
 }
 browser=await chromium.launch({headless:true});await mkdir(output,{recursive:true});
 const {context,page}=await login(admin);const errors=[];
 page.on('pageerror',()=>errors.push('PAGE_ERROR'));
 stage='empty_free_create';await page.goto(new URL('/providers',base).href);
 await page.getByRole('heading',{name:'ยังไม่มีผู้ให้บริการ AI'}).waitFor();
 await page.getByRole('button',{name:'เพิ่มผู้ให้บริการ',exact:true}).click();
 const create=page.locator('.provider-add-panel form');
 assert.equal(await create.locator('select').first().inputValue(),'ZEN','DEFAULT_ZEN');
 assert.equal(await create.locator('[name="costMode"]').inputValue(),'FREE_ONLY','DEFAULT_FREE_ONLY');
 await create.locator('select').first().selectOption('OPENROUTER');
 await create.locator('[name="name"]').fill(`${fixture} OpenRouter`);await create.locator('[name="apiKey"]').fill(`fixture-${randomUUID()}`);
 const created=page.waitForResponse(response=>response.url().endsWith('/api/providers')&&response.request().method()==='POST');
 await create.getByRole('button',{name:'เพิ่มผู้ให้บริการ',exact:true}).click();
 const firstResponse=await created;assert.equal(firstResponse.status(),200,'CREATE_PROVIDER_UI');const first=(await firstResponse.json()).id;providers.push(first);
 await reload(page);passed('empty_UI_and_free_Zen_default_create');
 const secondRequest=await api(context,'/api/providers','POST',{name:`${fixture} Zen`,adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',apiKey:`fixture-${randomUUID()}`,enabled:true,priority:101});
 assert.equal(secondRequest.response.status(),200,'CREATE_SECOND_PROVIDER');const second=secondRequest.value.id;providers.push(second);
 const a=await addModel(context,first,'ทดสอบรุ่น A'),b=await addModel(context,first,'ทดสอบรุ่น B');
 const embedding=await addModel(context,first,'embedding','EMBEDDING');
 // Model slugs use ASCII: display names are Thai, while the provider contract rejects Thai slugs.
 await reload(page);
 stage='ordering';let firstGroup=await group(page,first);
 await firstGroup.getByRole('button',{name:'เลื่อน ทดสอบรุ่น B ขึ้นหนึ่งลำดับ',exact:true}).click();
 await page.waitForFunction(id=>document.getElementById(`${id}-order-down`)===document.activeElement,b);
 const save=page.waitForResponse(response=>response.url().endsWith(`/api/providers/${first}/models/reorder`));
 await firstGroup.getByRole('button',{name:'บันทึกลำดับ',exact:true}).click();assert.equal((await save).status(),200,'SAVE_MODEL_ORDER');
 await reload(page);firstGroup=await group(page,first);
 assert.equal(await firstGroup.locator('.provider-model h3').first().innerText(),'ทดสอบรุ่น B','ORDER_RELOAD');
 assert.deepEqual((await pg.query('select id from private.ai_models where provider_id=$1 and purpose=\'GENERATION\' order by priority,id',[first])).rows.map(row=>row.id),[b,a]);
 const oldEmbeddingPriority=(await pg.query('select priority from private.ai_models where id=$1',[embedding])).rows[0].priority;
 const providerSave=page.waitForResponse(response=>response.url().endsWith('/api/providers/reorder'));
 await page.getByRole('button',{name:`เลื่อน ${fixture} Zen ขึ้นหนึ่งลำดับ`,exact:true}).click();
 await page.getByRole('button',{name:'บันทึกลำดับ',exact:true}).click();assert.equal((await providerSave).status(),200,'SAVE_PROVIDER_ORDER');
 await reload(page);assert.deepEqual((await pg.query('select id from private.ai_providers order by priority,id')).rows.map(row=>row.id),[second,first]);
 assert.equal((await pg.query('select priority from private.ai_models where id=$1',[embedding])).rows[0].priority,oldEmbeddingPriority,'PURPOSE_ISOLATED');
 passed('real_atomic_provider_model_reorder_save_reload_keyboard_focus');
 stage='tabs_preview';await page.getByRole('tab',{name:'Embedding',exact:true}).click();
 const embeddingGroup=page.locator('.provider-card').filter({has:page.locator(`[id="${first}-EMBEDDING-title"]`)});
 await embeddingGroup.locator('.provider-add-model summary').click();assert.equal(await embeddingGroup.locator('.model-form select[name="purpose"]').last().inputValue(),'EMBEDDING','ADD_MATCHES_PURPOSE');
 await page.getByRole('tab',{name:'สร้างคำตอบ',exact:true}).click();
 await page.getByRole('button',{name:'ดูตัวอย่างลำดับ',exact:true}).click();await page.locator('.provider-preview-result').waitFor();
 assert((await page.locator('.provider-preview-result').innerText()).includes('ทดสอบรุ่น A'),'PREVIEW_RESOLVES_INTERNAL_UUID');
 passed('purpose_tabs_and_preview_display_names');
 stage='observations';const registry=(await api(context,'/api/providers')).value.providers;
 const configured=registry.find(provider=>provider.id===first);
 await pg.query(`insert into private.ai_model_observations(provider_id,model_id,provider_revision,model_revision,purpose,action,result,error_code,http_status,latency_ms,observed_at)
  values($1,$2,$3,$4,'GENERATION','GENERATION_TEST','ERROR','RATE_LIMITED',429,8,clock_timestamp())`,[first,a,configured.revision,configured.models.find(model=>model.id===a).revision]);
 const now=new Date().toISOString();await pg.query(`insert into private.ai_provider_quota_observations(provider_id,provider_revision,supported,http_status,error_code,observed_at,counters)
  values($1,$2,true,200,null,$3,$4)`,[first,configured.revision,now,JSON.stringify([{scope:'ACCOUNT',unit:'REQUESTS',window:'DAY',source:'OPENROUTER_KEY',limit:50,remaining:4,resetAt:null,retryAfterSeconds:null,observedAt:now,currency:null}])]);
 await reload(page);firstGroup=await group(page,first);
 assert((await firstGroup.innerText()).includes('HTTP 429'),'ACTUAL_HTTP_DISPLAY');assert((await firstGroup.innerText()).includes('ใกล้ถึงขีดจำกัด'),'QUOTA_NEAR_SCOPE');
 assert((await firstGroup.innerText()).includes('บัญชีร่วม'),'SHARED_QUOTA_SCOPE');
 assert.equal(await firstGroup.getByRole('button',{name:'ทดสอบ Model',exact:true}).first().isEnabled(),true,'UNKNOWN_PRICE_TEST_CAN_REQUEST_SERVER_PREFLIGHT');
 const dto=JSON.stringify((await api(context,'/api/providers')).value);assert(!/api_key_encrypted|"apiKey"|fixture-[a-f0-9]{8}-/u.test(dto),'NO_CREDENTIAL_DTO');
 passed('HTTP429_separate_unknown_price_shared_near_quota_safe_DTO');
 stage='cooldown';const retryAt=new Date(Date.now()+180000).toISOString();
 await pg.query(`update private.ai_models m set cooldown_until=$3,cooldown_observed_at=clock_timestamp(),
  cooldown_provider_network_revision=p.network_revision,cooldown_model_network_revision=m.network_revision,
  pricing_status='FREE',pricing_checked_at=clock_timestamp(),pricing_provider_revision=p.revision,pricing_model_revision=m.revision,
  input_price_per_million=0,output_price_per_million=0,api_format='CHAT'
  from private.ai_providers p where m.id=$1 and p.id=$2 and m.provider_id=p.id`,[a,first,retryAt]);
 await reload(page);firstGroup=await group(page,first);
 const coolingRow=firstGroup.locator('.provider-model').filter({has:page.getByRole('heading',{name:'ทดสอบรุ่น A',exact:true})});
 assert((await coolingRow.innerText()).includes('รออีก'),'COOLDOWN_WAIT_VISIBLE');
 assert.equal(await coolingRow.getByRole('button',{name:'ทดสอบ Model',exact:true}).isDisabled(),true,'COOLDOWN_TEST_DISABLED_WITH_FREE_PRICE');
 const selected=await api(context,`/api/providers/${first}/models/${a}/test`,'POST',{providerRevision:configured.revision,modelRevision:configured.models.find(model=>model.id===a).revision,action:'GENERATION_TEST'});
 assert.equal(selected.response.status(),200);assert.equal(selected.value.observation.errorCode,'COOLDOWN');assert.equal(selected.value.observation.httpStatus,null);
 assert.equal(Number((await pg.query('select count(*) from private.ai_usage_logs where provider_id=$1',[first])).rows[0].count),0,'COOLDOWN_PROBE_NOT_RUNTIME');
 await page.getByRole('button',{name:'ดูตัวอย่างลำดับ',exact:true}).click();
 await page.locator('.provider-preview-result').getByText('รอให้ครบเวลาที่ผู้ให้บริการแจ้ง',{exact:false}).waitFor();
 passed('durable_cooldown_free_test_blocked_API_and_preview');
 stage='compatible_configuration';
 const addPanel=page.locator('.provider-add-panel');
 if(!await addPanel.evaluate(element=>element.open))await addPanel.locator('summary').click();
 await create.locator('select').first().selectOption('COMPATIBLE');
 assert.equal(await create.locator('[name="baseUrl"]').getAttribute('type'),'url','COMPATIBLE_CUSTOM_URL_INPUT');
 await create.locator('[name="name"]').fill(`${fixture} Compatible`);
 await create.locator('[name="baseUrl"]').fill('https://api.openai.com/v1');
 await create.locator('[name="apiKey"]').fill(`fixture-${randomUUID()}`);
 assert.equal(await create.locator('[name="costMode"]').inputValue(),'FREE_ONLY','COMPATIBLE_FREE_DEFAULT');
 const compatibleSave=page.waitForResponse(response=>response.url().endsWith('/api/providers')&&response.request().method()==='POST');
 await create.getByRole('button',{name:'เพิ่มผู้ให้บริการ',exact:true}).click();
 const compatibleResponse=await compatibleSave;assert.equal(compatibleResponse.status(),200,'COMPATIBLE_CREATE_UI');
 const compatible=(await compatibleResponse.json()).id;providers.push(compatible);
 const compatibleModel=await addModel(context,compatible,'Compatible model');await reload(page);
 const compatibleGroup=await group(page,compatible);
 await compatibleGroup.locator('.provider-settings summary').click();
 const compatibleSettings=compatibleGroup.locator('.provider-settings-form');
 assert.equal(await compatibleSettings.locator('[name="baseUrl"]').inputValue(),'https://api.openai.com/v1','COMPATIBLE_ENDPOINT_RELOAD');
 assert.equal(await compatibleSettings.locator('[name="apiKey"]').inputValue(),'','COMPATIBLE_KEY_NEVER_RENDERED');
 await compatibleSettings.locator('[name="baseUrl"]').fill('https://api.openai.com/another/v1');
 assert.equal(await compatibleSettings.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).isDisabled(),true,'COMPATIBLE_NEW_ENDPOINT_NEEDS_KEY');
 await compatibleSettings.locator('[name="baseUrl"]').fill('https://api.openai.com/v1');
 assert.equal(await compatibleSettings.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).isDisabled(),false,'COMPATIBLE_KEY_PRESERVED');
 assert((await compatibleGroup.innerText()).includes('ราคาไม่ทราบ'),'COMPATIBLE_UNKNOWN_PRICE_VISIBLE');
 assert.equal(await compatibleGroup.getByRole('button',{name:'ทดสอบ Model',exact:true}).isDisabled(),true,'COMPATIBLE_FREE_TEST_DISABLED');
 const compatibleSnapshot=(await api(context,'/api/providers')).value.providers.find(provider=>provider.id===compatible);
 const compatibleProbe=await api(context,`/api/providers/${compatible}/models/${compatibleModel}/test`,'POST',{
  providerRevision:compatibleSnapshot.revision,modelRevision:compatibleSnapshot.models[0].revision,action:'GENERATION_TEST'});
 assert.equal(compatibleProbe.response.status(),200);assert.equal(compatibleProbe.value.observation.errorCode,'PRICE_UNKNOWN');assert.equal(compatibleProbe.value.observation.httpStatus,null);
 assert.equal((await pg.query('select count(*)::int n from private.ai_usage_logs where provider_id=$1',[compatible])).rows[0].n,0,'NO_COMPATIBLE_INFERENCE');
 passed('compatible_UI_save_reload_key_boundary_UNKNOWN_free_probe_block');
 stage='screenshots';await page.screenshot({path:resolve(output,'provider-management-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'MOBILE_OVERFLOW');
 await page.screenshot({path:resolve(output,'provider-management-mobile.png'),fullPage:true});
 await page.setViewportSize({width:720,height:700});await page.evaluate(()=>{document.documentElement.style.zoom='2';});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'ZOOM_OVERFLOW');
 await page.screenshot({path:resolve(output,'provider-management-zoom.png'),fullPage:true});assert.equal(errors.length,0,'NO_PAGE_ERRORS');
 passed('desktop_mobile_zoom_layout_no_page_errors');
 await context.close();
 stage='roles';for(const account of accounts.filter(account=>account.role!=='SUPER_ADMIN')){
  const session=await login(account);assert.equal((await api(session.context,'/api/providers')).response.status(),403,'STAFF_DENIED_READ');
  assert.equal((await api(session.context,'/api/providers/reorder','POST',{order:providers.map(id=>({id,revision:0}))})).response.status(),403,'STAFF_DENIED_WRITE');
  assert.equal((await api(session.context,'/api/providers','POST',{name:'Forbidden compatible',adapter:'COMPATIBLE',baseUrl:'https://api.openai.com/v1',apiKey:'forbidden-fixture-key',enabled:true,priority:1})).response.status(),403,'STAFF_DENIED_COMPATIBLE_CREATE');
  assert.equal((await session.page.goto(new URL('/providers',base).href)).status(),404,'STAFF_DENIED_PAGE');await session.context.close();
 }passed('two_real_staff_roles_denied_UI_and_API');
 console.log(JSON.stringify({stage:'provider_management_browser',cases,status:'PASS',fixtureObservations:true,liveInference:false}));
}catch(error){
 const firstLine=error instanceof Error?error.message.split('\n')[0].trim():'';
 const line=error instanceof Error?Number(error.stack?.match(/provider-management-browser\.mjs:(\d+):/)?.[1]??0):0;
 console.error(JSON.stringify({code:'PROVIDER_MANAGEMENT_BROWSER_FAILED',stage,check:/^[A-Z_0-9]+$/.test(firstLine)?firstLine:'BROWSER_OR_ASSERTION',line,cases}));process.exitCode=1;
}finally{
 await browser?.close().catch(()=>undefined);
 try{
  for(const table of ['ai_model_observations','ai_provider_quota_observations','ai_provider_operations','ai_errors','ai_usage_logs','ai_models'])await pg.query(`delete from private.${table} where provider_id=any($1::uuid[])`,[providers]);
  await pg.query('delete from private.ai_providers where id=any($1::uuid[])',[providers]);
  await pg.query('delete from private.activities where actor_id=any($1::uuid[]) and (metadata->>\'providerId\'=any($2::text[]) or metadata->\'providerIds\' ?| $2::text[])',[profiles,providers]);
  for(const id of profiles){await pg.query('delete from public.staff_profiles where id=$1',[id]);await pg.query('delete from auth.users where id=$1',[id]);}
 }catch{console.error(JSON.stringify({code:'PROVIDER_BROWSER_FIXTURE_CLEANUP_FAILED'}));process.exitCode=1;}
 await pg.end();
}
