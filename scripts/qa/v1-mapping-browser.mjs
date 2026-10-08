import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import pg from 'pg';

const qaDir=resolve('.superpowers/staging/v1-ui-qa');
const runtime=JSON.parse(await readFile(resolve(qaDir,'runtime.json'),'utf8'));
assert.equal(runtime.baseUrl,'http://127.0.0.1:3012');
const target=new URL(runtime.connectionString);
assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'54422');
assert(/^yru_publication_ui_qa_[a-f0-9]{12}$/.test(runtime.database));
assert.equal(target.pathname.slice(1),runtime.database);
const credentials=JSON.parse(await readFile('.superpowers/staging/dev-staff-credentials.json','utf8'));
assert.equal(credentials.projectRef,process.env.DEV_SUPABASE_PROJECT_REF);
const account=credentials.accounts.find(item=>item.role==='SUPER_ADMIN');
assert(account?.email&&account?.password);

const db=new pg.Client({connectionString:runtime.connectionString});
await db.connect();
let jobId;
try{
 const result=await db.query("select j.id from private.knowledge_import_jobs j where exists(select 1 from private.knowledge_import_revisions r where r.job_id=j.id and r.kind='PARSED') order by j.created_at desc limit 1");
 assert.equal(result.rowCount,1,'NO_RETAINED_IMPORT_JOB');
 jobId=result.rows[0].id;
}finally{await db.end();}

const {chromium}=createRequire(resolve(process.env.YRU_QA_PLAYWRIGHT_PACKAGE))('playwright');
const browser=await chromium.launch({headless:true,...(process.env.YRU_QA_BROWSER_EXECUTABLE?{executablePath:process.env.YRU_QA_BROWSER_EXECUTABLE}:{})});
const evidence={server:'127.0.0.1:3012',login:false,importPageStatus:null,previewApiStatus:null,previewApiKeys:[],reviewHeadingCount:null,structuredPanelCount:null,reviewRequestStatuses:[],datasetSelected:false,headerNoteAdded:false,prepareAcknowledged:false,draftSaved:false,reloadRetainedAcknowledgment:false,transient503PreservedPersistedAcknowledgment:false,transient503BlockedPublish:false,livePublication:false};
let stage='start';
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();
 let pageError=false;page.on('pageerror',()=>{pageError=true;});
 page.on('response',response=>{
  const pathname=new URL(response.url()).pathname;
  const endpoint=pathname.endsWith('/preview')?'preview':pathname.endsWith('/review')?'review':pathname.endsWith('/structured')?'structured':null;
  if(endpoint)evidence.reviewRequestStatuses.push({endpoint,status:response.status()});
 });
 stage='login';
 await page.goto(runtime.baseUrl+'/login');
 await page.locator('input[name="email"]').fill(account.email);
 await page.locator('input[name="password"]').fill(account.password);
 await page.locator('button[type="submit"]').click();
 await page.waitForURL(url=>url.pathname==='/dashboard',{timeout:45_000});
 evidence.login=true;

 stage='open_retained_import';
 const importPage=await page.goto(`${runtime.baseUrl}/knowledge/import?id=${encodeURIComponent(jobId)}`);
 evidence.importPageStatus=importPage?.status()??null;
 const previewResponse=await context.request.get(`${runtime.baseUrl}/api/knowledge/imports/${encodeURIComponent(jobId)}/preview`);
 evidence.previewApiStatus=previewResponse.status();
 const previewBody=await previewResponse.json().catch(()=>null);
 evidence.previewApiKeys=previewBody&&typeof previewBody==='object'?Object.keys(previewBody).sort():[];
 assert.equal(evidence.previewApiStatus,200,'PREVIEW_API_NOT_READY');
 await page.locator('#review-draft-title').waitFor({timeout:30_000});
 evidence.reviewHeadingCount=await page.locator('#review-draft-title').count();
 evidence.structuredPanelCount=await page.locator('.structured-mapping').count();
 assert(evidence.reviewHeadingCount>0,'REVIEW_DRAFT_NOT_RENDERED');
 const panel=page.locator('.structured-mapping');
 await page.getByLabel(/^วิธีใช้เอกสาร/).selectOption('STRUCTURED');
 await panel.waitFor({timeout:30_000});
 await page.locator('.structured-mapping__step-panel').first().waitFor();

 stage='select_dataset_and_table';
 await page.getByLabel(/^ชุดข้อมูลปลายทาง/).selectOption('academic_calendar_events');
 evidence.datasetSelected=true;
 const cards=panel.locator('.structured-mapping__table-card');
 const cardCount=await cards.count();
 assert(cardCount>0,'NO_SOURCE_TABLES');
 // A repeated run starts from the saved selection; reset its table decision deliberately through the UI.
 const firstCard=cards.nth(0);
 const select=firstCard.getByRole('button',{name:'ใช้กับปฏิทินการศึกษา',exact:true});
 if(await select.count())await select.click();
 else{
  await firstCard.getByRole('button',{name:'ไม่ใช้ตารางนี้',exact:true}).click();
  await select.click();
 }
 for(let i=1;i<cardCount;i++){
  const card=cards.nth(i);
  await card.getByRole('button',{name:'ไม่ใช้ตารางนี้',exact:true}).click();
  await card.getByLabel('เหตุผล',{exact:true}).selectOption('NON_DATA');
  await card.getByLabel('หมายเหตุที่เขียนเอง',{exact:true}).fill('ตารางนี้ไม่ใช่แหล่งข้อมูลปฏิทินที่กำลังตรวจ');
 }
 await page.getByRole('button',{name:'ต่อไป: ช่องข้อมูล',exact:true}).click();
 const fieldStep=panel.locator('.structured-mapping__step-panel').filter({hasText:'จับคู่ช่องข้อมูลและเลือกแถว'});
 await fieldStep.waitFor();
 const missing=fieldStep.locator('.structured-mapping__field.is-missing');
 assert.equal(await missing.count(),0,'REQUIRED_FIELDS_NEED_MAPPING');

 stage='add_required_header_note';
 const note='หัวตารางที่ตรวจจากต้นฉบับทดสอบ รอบ '+Date.now();
 const headerNote=fieldStep.getByLabel('หมายเหตุที่เขียนเอง',{exact:true});
 await headerNote.fill(note);
 await fieldStep.getByRole('button',{name:'เพิ่มช่วงแถวที่ยกเว้น',exact:true}).click();
 const reason=fieldStep.getByLabel('เหตุผลยกเว้นแถว',{exact:true});
 await reason.waitFor();
 assert.equal(await reason.inputValue(),'HEADER','HEADER_REASON_NOT_SELECTED');
 const savedRangeNote=fieldStep.getByLabel('หมายเหตุยกเว้นแถว',{exact:true});
 assert.equal(await savedRangeNote.inputValue(),note,'HEADER_NOTE_NOT_RETAINED');
 evidence.headerNoteAdded=true;
 await page.getByRole('button',{name:'ต่อไป: ตรวจทาน',exact:true}).click();

 stage='prepare_mapping';
 await panel.getByRole('button',{name:'ส่งให้ระบบตรวจ',exact:true}).click();
 await panel.getByText('ระบบตรวจและยืนยันรายการนี้แล้ว',{exact:false}).waitFor({timeout:45_000});
 evidence.prepareAcknowledged=true;
 const approval=page.getByRole('button',{name:/อนุมัติและเผยแพร่/});
 evidence.preparePublicationReady=await approval.isEnabled().catch(()=>false);

 stage='save_draft';
 const save=page.getByRole('button',{name:'บันทึกร่างส่วนตัว',exact:true});
 await save.waitFor();
 await save.click();
 await page.getByText('บันทึกร่างตรวจส่วนตัวแล้ว ยังไม่อนุมัติและยังไม่เผยแพร่',{exact:true}).waitFor({timeout:30_000});
 evidence.draftSaved=true;

 stage='reload_acknowledgment';
 await page.reload();
 await panel.waitFor();
 await panel.getByRole('button',{name:'03 ตรวจทาน',exact:true}).click();
 await panel.getByText('ระบบตรวจและยืนยันรายการนี้แล้ว',{exact:false}).waitFor({timeout:45_000});
 evidence.reloadRetainedAcknowledgment=true;
 const persistedBefore=await context.request.get(`${runtime.baseUrl}/api/knowledge/imports/${encodeURIComponent(jobId)}/review`);
 assert.equal(persistedBefore.status(),200,'SAVED_REVIEW_NOT_READABLE');
 const persistedBody=await persistedBefore.json();
 evidence.persistedEnvelopeKeys=Object.keys(persistedBody??{});
 evidence.persistedReviewKeys=Object.keys(persistedBody?.review??{});
 evidence.persistedDraftKeys=Object.keys(persistedBody?.review?.saved?.draft??{});
 const draft=persistedBody?.review?.saved?.draft??null;
 const savedAck=draft?.structuredMapping?.acknowledgment;
 assert(savedAck&&typeof savedAck==='object','PERSISTED_ACK_MISSING_AFTER_RELOAD');

 stage='transient_503_saved_restore';
 let intercepted=false;
 await page.route(`**/api/knowledge/imports/${encodeURIComponent(jobId)}/structured`,async route=>{
  const request=route.request();
  if(request.method()==='POST'&&!intercepted){
   intercepted=true;
   await route.fulfill({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'});
  }else await route.continue();
 });
 await page.reload();
 await panel.waitFor();
 await panel.getByRole('button',{name:'03 ตรวจทาน',exact:true}).click();
 await panel.getByText(/ตรวจการกำหนดข้อมูลไม่ผ่าน|ตรวจผลยืนยันที่บันทึกไว้ไม่สำเร็จ|ร่างที่บันทึกไว้ยังอยู่|ยังไม่สามารถตรวจผลยืนยัน/).waitFor({timeout:45_000});
 assert(intercepted,'RESTORE_POST_NOT_INTERCEPTED');
 evidence.transient503PreservedPersistedAcknowledgment=true;
 const persistedAfter=await context.request.get(`${runtime.baseUrl}/api/knowledge/imports/${encodeURIComponent(jobId)}/review`);
 assert.equal(persistedAfter.status(),200,'SAVED_REVIEW_UNAVAILABLE_AFTER_503');
 const afterBody=await persistedAfter.json();
 const afterDraft=afterBody?.review?.saved?.draft??null;
 const afterAck=afterDraft?.structuredMapping?.acknowledgment;
 assert(afterAck&&typeof afterAck==='object','TRANSIENT_503_CLEARED_PERSISTED_ACK');
 assert.deepEqual(afterAck,savedAck,'TRANSIENT_503_CHANGED_PERSISTED_ACK');
 const publishButton=page.getByRole('button',{name:/อนุมัติและเผยแพร่/});
 evidence.transient503BlockedPublish=!(await publishButton.isEnabled().catch(()=>false));
 assert(evidence.transient503BlockedPublish,'PUBLISH_NOT_BLOCKED_AFTER_TRANSIENT_503');
 stage='save_after_transient_503';
 const metadata=page.locator('details').filter({has:page.locator('summary').filter({hasText:'ข้อมูลขอบเขตและรายละเอียดเพิ่มเติม'})});
 if(!await metadata.getAttribute('open'))await metadata.locator('summary').click();
 await page.getByLabel(/^ชื่อเอกสาร \*/).fill('เอกสาร fixture ตรวจการเก็บร่างหลังระบบขัดข้อง '+Date.now());
 const savedResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/review')&&response.request().method()==='PUT');
 await page.getByRole('button',{name:'บันทึกร่างส่วนตัว',exact:true}).click();
 assert.equal((await savedResponse).status(),200,'SAVE_AFTER_TRANSIENT_FAILED');
 const savedAfter=await context.request.get(`${runtime.baseUrl}/api/knowledge/imports/${encodeURIComponent(jobId)}/review`);
 assert.equal(savedAfter.status(),200);
 const updated=(await savedAfter.json()).review.saved.draft;
 assert.deepEqual(updated.structuredMapping.acknowledgment,savedAck,'CLIENT_SAVE_LOST_ACK_AFTER_TRANSIENT');
 assert.equal(updated.schemaVersion,3);assert.equal(updated.chunkPlan,null);
 evidence.transient503EditedDraftSavedWithoutLosingAck=true;
 evidence.livePublication=false;
 assert.equal(pageError,false,'BROWSER_PAGE_ERROR');
 await context.close();
 await mkdir(qaDir,{recursive:true});
 await writeFile(resolve(qaDir,'mapping-browser-result.json'),JSON.stringify({status:'PASS',stage:'complete',evidence},null,2));
 console.log(JSON.stringify({status:'PASS',stage:'complete',evidence}));
}catch(error){
 await mkdir(qaDir,{recursive:true});
 const safeError=error instanceof Error?error.name:'UNKNOWN_ERROR';
 await writeFile(resolve(qaDir,'mapping-browser-result.json'),JSON.stringify({status:'FAIL',stage,safeError,evidence},null,2));
 console.error(JSON.stringify({status:'FAIL',stage,safeError,evidence}));
 process.exitCode=1;
}finally{await browser.close();}
