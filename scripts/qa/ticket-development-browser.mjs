import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require=createRequire(process.env.PLAYWRIGHT_RUNTIME_PATH?resolve(process.env.PLAYWRIGHT_RUNTIME_PATH,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const base=new URL('http://localhost:3000');
assert.equal(process.env.YRU_DEPLOYMENT_ENV,'development');
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));
assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF);
assert.equal(credentials.accounts.length,3);
const browser=await chromium.launch({headless:true});
let stage='start';
try{
 for(const account of credentials.accounts){
  const context=await browser.newContext(),page=await context.newPage();
  let ticketError=false;
  page.on('pageerror',()=>{ticketError=true;});
  stage='login';
  await page.goto(new URL('/login',base).href);
  await page.getByLabel('อีเมลบุคลากร').fill(account.email);
  await page.getByLabel('รหัสผ่าน').fill(account.password);
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await page.waitForURL(/\/(?:dashboard|tickets)$/,{timeout:30_000});
  stage='tickets';
  await page.goto(new URL('/tickets',base).href);
  await page.getByRole('heading',{name:'งานรับเรื่อง',exact:true}).waitFor();
  const response=await page.request.get(new URL('/api/tickets',base).href);
  assert.equal(response.status(),200);
  const result=await response.json();
  assert(Array.isArray(result.tickets));
  assert(result.tickets.every(ticket=>Number.isInteger(ticket.revision)));
  assert.equal(ticketError,false,'TICKET_PAGE_RUNTIME_ERROR');
  stage='reload';
  await page.reload();
  await page.getByRole('heading',{name:'งานรับเรื่อง',exact:true}).waitFor();
  assert.equal(ticketError,false,'TICKET_RELOAD_RUNTIME_ERROR');
  console.log(JSON.stringify({stage:'development_ticket_browser_verified',role:account.role,department:account.departmentCode,
   login:true,ticketPage:true,ticketApi:true,reload:true,ticketCount:result.tickets.length}));
  await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
  await page.waitForURL(/\/login$/);
  await context.close();
 }
}catch{
 console.error(JSON.stringify({code:'DEVELOPMENT_TICKET_BROWSER_FAILED',stage}));process.exitCode=1;
}finally{await browser.close();}
