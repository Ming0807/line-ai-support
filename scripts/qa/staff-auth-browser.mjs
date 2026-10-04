import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Supply a local Playwright runtime path, or install the runner in the test workspace.
const require=createRequire(process.env.PLAYWRIGHT_RUNTIME_PATH
  ? resolve(process.env.PLAYWRIGHT_RUNTIME_PATH,'package.json') : import.meta.url);
const {chromium}=require('playwright');
const base=new URL(process.env.APP_BASE_URL ?? 'http://localhost:3000');
assert(['localhost','127.0.0.1'].includes(base.hostname),'LOCAL_BROWSER_TARGET_REQUIRED');
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));
assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF,'DEVELOPMENT_PROJECT_REQUIRED');
assert.equal(credentials.accounts.length,3,'THREE_VERIFIED_DEV_ACCOUNTS_REQUIRED');
const roles={SUPER_ADMIN:'ผู้ดูแลระบบสูงสุด',STAFF:'บุคลากร'};
const browser=await chromium.launch({headless:true});
let stage='start',activePage,localPosts=0;
try {
 for(const account of credentials.accounts) {
  const context=await browser.newContext();
  const page=await context.newPage();
  activePage=page; stage='unauthenticated_redirect';
  page.on('request',request=>{if(request.method()==='POST' && new URL(request.url()).origin===base.origin) localPosts++;});
  await page.goto(new URL('/dashboard/queue',base).href);
  await page.waitForURL(/\/login(?:\?|$)/);
  if(account.role==='SUPER_ADMIN') {
   stage='invalid_login_submit';
   await page.getByLabel('อีเมลบุคลากร').fill(account.email);
   await page.getByLabel('รหัสผ่าน').fill('deliberately-invalid-test-password');
   await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
   stage='invalid_login_error';
   await page.getByRole('alert').waitFor();
   assert(new URL(page.url()).pathname==='/login','INVALID_LOGIN_DENIED');
   // The error appears before React finishes the action transition and resets
   // uncontrolled inputs. Wait for the editable form before filling the retry.
   await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).waitFor();
   await page.waitForFunction(()=>document.querySelector('.primary-button')?.disabled===false);
  }
  await page.getByLabel('อีเมลบุคลากร').fill(account.email);
  await page.getByLabel('รหัสผ่าน').fill(account.password);
  stage='valid_login_submit';
  const readiness=await page.locator('form').evaluate(form=>({valid:form.checkValidity(),
   emailPresent:form.elements.namedItem('email').value.length>0,passwordPresent:form.elements.namedItem('password').value.length>0}));
  console.log(JSON.stringify({stage:'browser_login_readiness',...readiness}));
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  stage='valid_login_redirect';
  await page.waitForURL(/\/(?:dashboard(?:\/queue)?|tickets)$/,{timeout:30_000});
  assert((await page.locator('.user-line').innerText()).includes(roles[account.role]),'SERVER_ROLE_RENDERED');
  stage='session_reload';
  await page.reload();
  assert((await page.locator('.user-line').innerText()).includes(account.displayName),'SESSION_RELOAD_PRESERVED');
  await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
  stage='logout_redirect';
  await page.waitForURL(/\/login$/);
  const cookies=await context.cookies();
  assert(!cookies.some(cookie=>/^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)),'AUTH_COOKIES_REMOVED');
  await page.goto(new URL('/dashboard/queue',base).href);
  stage='post_logout_denied';
  await page.waitForURL(/\/login(?:\?|$)/);
  console.log(JSON.stringify({stage:'browser_auth',role:account.role,department:account.departmentCode,
   login:true,serverRole:true,sessionReload:true,logout:true,postLogoutDenied:true}));
  await context.close();
 }
} catch(error) {
 console.error(JSON.stringify({code:'STAFF_BROWSER_AUTH_CHECK_FAILED',stage,
  path:activePage?new URL(activePage.url()).pathname:undefined,errorType:error?.name,
  localPosts,
  accessDenied:activePage?new URL(activePage.url()).searchParams.get('error')==='access_denied':undefined,
  noticeKind:activePage?await activePage.getByRole('alert').allTextContents().then(values=>
   values.some(value=>value.includes('ระบบเข้าสู่ระบบยังไม่พร้อม'))?'CONFIGURATION':
   values.some(value=>value.includes('เข้าสู่ระบบไม่สำเร็จ'))?'AUTH_FAILED':'NONE'):undefined}));
 process.exitCode=1;
} finally {await browser.close();}
