import 'dotenv/config';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const output=resolve('.superpowers/staging/v1-ui-qa');
const runtime=JSON.parse(await readFile(resolve(output,'runtime.json'),'utf8'));
assert.equal(runtime.baseUrl,'http://127.0.0.1:3012');
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));
assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF);
const {chromium}=createRequire(resolve(process.env.YRU_QA_PLAYWRIGHT_PACKAGE))('playwright');
const browser=await chromium.launch({headless:true,...(process.env.YRU_QA_BROWSER_EXECUTABLE?{executablePath:process.env.YRU_QA_BROWSER_EXECUTABLE}:{})});
const checks=[],issues=[];let stage='start';
const pages=['/dashboard','/tickets','/departments','/knowledge','/knowledge/import','/providers','/activities','/logs','/analytics','/usage','/settings','/incidents'];
const endpoints=['/api/operations/summary','/api/analytics','/api/departments','/api/activities','/api/logs','/api/usage','/api/settings/status','/api/knowledge/structured/status','/api/incidents','/api/incidents/rules'];
await mkdir(resolve(output,'screenshots'),{recursive:true});
try{
 for(const account of credentials.accounts){
  const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();
  const errors=[];page.on('pageerror',()=>errors.push('BROWSER_PAGE_ERROR'));
  try{
   stage='login_'+account.role;await page.goto(runtime.baseUrl+'/login');
   await page.locator('input[name="email"]').fill(account.email);await page.locator('input[name="password"]').fill(account.password);
   await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:45_000});
   checks.push(account.role+'_verified_login');
   stage='endpoints_'+account.role;
   for(const endpoint of endpoints){
    stage='endpoint_'+account.role+'_'+endpoint;
    const response=await context.request.get(runtime.baseUrl+endpoint);const adminOnly=['/api/logs','/api/usage','/api/settings/status','/api/knowledge/structured/status','/api/incidents/rules'].includes(endpoint);
    const expected=adminOnly&&account.role!=='SUPER_ADMIN'?403:200;
    assert.equal(response.status(),expected,'METRICS_HTTP_'+endpoint);
    assert.equal(response.headers()['cache-control'],'private, no-store, max-age=0');
    const body=await response.json();assert(!JSON.stringify(body).includes('sb_secret_'));
    if(endpoint==='/api/knowledge/structured/status'&&expected===200)assert.equal(body.structured.available,true);
   }
   checks.push(account.role+'_actual_private_HTTP');
   if(account.role==='SUPER_ADMIN'){
    for(const width of [1440,390,320]){
     await page.setViewportSize({width,height:width===1440?900:844});
     for(const path of pages){
      stage='page_'+width+'_'+path;const response=await page.goto(runtime.baseUrl+path);assert.equal(response.status(),200);
      await page.locator('h1').first().waitFor();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
      if(overflow)issues.push({page:path,width,code:'HORIZONTAL_OVERFLOW'});
      assert(!await page.getByText('ROOT_BACKEND_SYNC_REQUIRED',{exact:false}).count());
      await page.screenshot({path:resolve(output,'screenshots',path.replaceAll('/','_')+'_'+width+'.png'),fullPage:true});
     }
    }
    checks.push('admin_12_pages_3_viewports');
    stage='upload_preview';await page.setViewportSize({width:1440,height:900});await page.goto(runtime.baseUrl+'/knowledge/import');
    const file={name:'V1-browser-calendar.csv',mimeType:'text/csv',buffer:Buffer.from('academic_year,semester,student_type,event_type,title,start_date,end_date,description\n2569,1,REGULAR,REGISTRATION,ลงทะเบียนทดสอบ,2026-06-01,2026-06-02,เฉพาะ fixture ทดสอบ\n','utf8')};
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole('button',{name:'นำเข้าเอกสาร',exact:true}).click();
    await page.getByRole('heading',{name:'ทบทวนข้อมูลเอกสาร',exact:true}).waitFor({timeout:60_000});
    checks.push('actual_CSV_upload_analysis_preview_review_UI');
   }
   assert.equal(errors.length,0,'NO_BROWSER_PAGE_ERRORS');
  }finally{await context.close();}
 }
 assert.equal(issues.length,0,'RESPONSIVE_OVERFLOW');
 await writeFile(resolve(output,'browser-result.json'),JSON.stringify({status:'PASS',checks,issues,liveLINE:false,fixturePublication:false},null,2));
 console.log(JSON.stringify({status:'PASS',checks,issues,liveLINE:false,fixturePublication:false}));
}catch{
 await writeFile(resolve(output,'browser-result.json'),JSON.stringify({status:'FAIL',stage,checks,issues},null,2));
 console.error(JSON.stringify({status:'FAIL',stage,checks,issues}));process.exitCode=1;
}finally{await browser.close();}
