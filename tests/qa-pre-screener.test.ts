import {expect,it} from 'vitest';
import {screenTurn,screenRecord,summarize,scanStaging} from '../scripts/qa/qa-pre-screener';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const base={resultKind:'CONVERSATION',elapsedMs:5000};
it('flags provider failures and availability fallback text for review',()=>{
 const row=screenTurn('X',0,{...base,question:'ถามอะไรก็ได้',text:'ตอนนี้บริการ AI ตอบคำถามนี้ไม่สำเร็จครับ ลองส่งอีกครั้งได้',attempts:[{status:'SUCCESS',error_code:null},{status:'FAILED',error_code:'TIMEOUT'}]});
 expect(row.flags.map(f=>f.code)).toEqual(['PROVIDER_FAILURE','AVAILABILITY_FALLBACK_TEXT']);
 expect(row.flags.every(f=>f.severity==='REVIEW')).toBe(true);
});
it('flags the A12 class: clarification despite an explicit academic year',()=>{
 const row=screenTurn('A12',0,{...base,resultKind:'CLARIFY',question:'ปฏิทินมหาวิทยาลัยปีการศึกษา 2569 ระบุวันเปิดภาคเรียนเมื่อไร',text:'รบกวนระบุภาคเรียน และ ประเภทนักศึกษาเพิ่มเติมครับ'});
 expect(row.flags.map(f=>f.code)).toContain('CLARIFY_WITH_EXPLICIT_YEAR');
});
it('does not flag a clarify without a year or an ordinary pass',()=>{
 expect(screenTurn('B1',0,{...base,resultKind:'CLARIFY',question:'ค่าเทอมเท่าไร',text:'รบกวนระบุปีการศึกษา และ ชื่อหลักสูตร และ กลุ่มนักศึกษา และ รูปแบบการศึกษาเพิ่มเติมครับ'}).flags).toEqual([]);
 expect(screenTurn('A1',0,{...base,question:'สวัสดีครับ',text:'สวัสดีครับ มีอะไรให้ช่วยไหมครับ'}).flags).toEqual([]);
});
it('flags an unsourced official fee/time claim but not a cited one or arithmetic',()=>{
 const uncited=screenTurn('X',0,{...base,question:'ค่าธรรมเนียมสมัครปริญญาตรีปีการศึกษา 2569 ภาคปกติเป็นเท่าไร',text:'ค่าธรรมเนียมคือ 12,345.00 บาท'});
 expect(uncited.flags.map(f=>f.code)).toContain('OFFICIAL_CLAIM_NO_CITATION');
 const arithmetic=screenTurn('X',0,{...base,question:'ถ้ามี 800 บาท ใช้ไป 15% จะเหลือเท่าไร',text:'เหลือ 680 บาทครับ'});
 expect(arithmetic.flags.map(f=>f.code)).not.toContain('OFFICIAL_CLAIM_NO_CITATION');
 const cited=screenTurn('X',0,{...base,question:'ห้องสมุดเปิดกี่โมง',text:'เวลาทำการ 09:00-16:00\nแหล่งอ้างอิง:\n1. คู่มือ https://fixture.yru.ac.th/x'});
 expect(cited.flags.map(f=>f.code)).not.toContain('OFFICIAL_CLAIM_NO_CITATION');
});
it('classifies honest no-document answers as informational, never review',()=>{
 const row=screenTurn('B2',0,{...base,question:'นักศึกษามีสิทธิ์ได้ทุนประเภทนี้ไหม',text:'ตอนนี้ยังไม่พบเอกสารทางการที่ยืนยันคำตอบได้ รบกวนระบุชื่อเรื่องหรือประกาศทางการ'});
 expect(row.flags.map(f=>f.code)).toEqual(['NO_DOCUMENT_ANSWER']);
 expect(row.flags[0].severity).toBe('INFO');
});
it('records slow turns as informational only',()=>{
 const row=screenTurn('X',0,{...base,elapsedMs:25000,question:'ถาม',text:'ตอบ'});
 expect(row.flags.map(f=>f.code)).toEqual(['SLOW_TURN']);
});
it('summarizes records and scans a staging directory end to end',()=>{
 const rows=screenRecord({caseId:'R',turns:[{...base,question:'คำถาม',text:'ยังไม่พบเอกสารทางการครับ'},{...base,question:'อีกเรื่อง',text:'ตอบปกติ'}]});
 expect(summarize(rows)).toEqual({flaggedTurns:1,totalTurns:2,counts:{NO_DOCUMENT_ANSWER:1}});
 const dir=join(tmpdir(),`qa-screener-${Date.now()}`);mkdirSync(dir);
 try{
  writeFileSync(join(dir,'assistant-owned-eval-sol-test.json'),JSON.stringify({records:[{caseId:'T1',turns:[{...base,resultKind:'CLARIFY',question:'ปฏิทินปีการศึกษา 2569 วันเปิดภาคเรียน',text:'ระบุเพิ่ม'}]}]}));
  writeFileSync(join(dir,'root-announcement-x-review-test.json'),JSON.stringify({records:[{caseId:'T1',status:'PASS_TRAJECTORY_SAFE_MISS_USEFUL'}]}));
  const result=scanStaging(dir);
  expect(result.reviewFlagged.some(row=>row.caseId==='T1'&&row.flags.some(f=>f.code==='CLARIFY_WITH_EXPLICIT_YEAR'))).toBe(true);
  expect(result.missedKnownMisses).toEqual([]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('retains report identity, digest and turn index and never merges same case across profiles',()=>{
 const dir=join(tmpdir(),`qa-screener-profiles-${Date.now()}`);mkdirSync(dir);
 try{
  const a='assistant-owned-eval-sol-a.json',b='assistant-owned-eval-sol-b.json';
  const report=(question:string)=>JSON.stringify({records:[{caseId:'A12',turns:[{...base,resultKind:'CLARIFY',question,text:'ระบุเพิ่ม'}]}]});
  writeFileSync(join(dir,a),report('ปีการศึกษา 2568 ถามวันเปิดภาคเรียน'));
  writeFileSync(join(dir,b),report('ปีการศึกษา 2569 ถามวันเปิดภาคเรียน'));
  const result=scanStaging(dir);
  expect(result.profiles).toHaveLength(2);
  expect(result.profiles.map(profile=>profile.turns[0])).toEqual(expect.arrayContaining([
   expect.objectContaining({reportPath:a,reportSha256:createHash('sha256').update(report('ปีการศึกษา 2568 ถามวันเปิดภาคเรียน')).digest('hex'),caseId:'A12',turnIndex:0}),
   expect.objectContaining({reportPath:b,reportSha256:createHash('sha256').update(report('ปีการศึกษา 2569 ถามวันเปิดภาคเรียน')).digest('hex'),caseId:'A12',turnIndex:0}),
  ]));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('reports malformed artifacts and oversized turns as diagnostics and keeps valid profiles usable',()=>{
 const dir=join(tmpdir(),`qa-screener-malformed-${Date.now()}`);mkdirSync(dir);
 try{
  writeFileSync(join(dir,'assistant-owned-eval-sol-bad.json'),'{not json');
  writeFileSync(join(dir,'assistant-owned-eval-sol-shape.json'),JSON.stringify({records:[{caseId:'x',turns:'not-an-array'}]}));
  writeFileSync(join(dir,'assistant-owned-eval-sol-large-turn.json'),JSON.stringify({records:[{caseId:'large',turns:[{...base,question:'q'.repeat(20_001),text:'answer'}]}]}));
  writeFileSync(join(dir,'assistant-owned-eval-sol-good.json'),JSON.stringify({records:[{caseId:'ok',turns:[{...base,question:'secret question',text:'ตอบ'}]}]}));
  const result=scanStaging(dir);
  expect(result.profiles.find(profile=>profile.reportPath==='assistant-owned-eval-sol-good.json')).toBeDefined();
  expect(result.diagnostics.map(d=>d.code)).toEqual(expect.arrayContaining(['MALFORMED_JSON','INVALID_RECORD_SHAPE','INVALID_TURN_SHAPE']));
  expect(JSON.stringify(result)).not.toContain('secret question');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('uses saved runtime observations and does not let unbound or broad PASS statuses mask misses',()=>{
 const dir=join(tmpdir(),`qa-screener-binding-${Date.now()}`);mkdirSync(dir);
 try{
  const name='assistant-owned-eval-sol-run.json';
  const contents=JSON.stringify({records:[
   {caseId:'A',turns:[{...base,question:'question',text:'fallback',observations:[{action:'RUNTIME',result:'ERROR',error_code:'TIMEOUT'}]}]},
   {caseId:'B',turns:[{...base,resultKind:'CLARIFY',question:'ปีการศึกษา 2569 วันเปิดภาคเรียน',text:'ระบุเพิ่ม'}]},
   {caseId:'C',turns:[{...base,question:'question',text:'ตอบ'}]},
  ]});
  writeFileSync(join(dir,name),contents);
  const digest=createHash('sha256').update(contents).digest('hex');
  writeFileSync(join(dir,'root-announcement-bound-review.json'),JSON.stringify({records:[
   {caseId:'A',report:name,sha256:digest,status:'PASS_SAFE_MISS_NOT_USEFUL'},
   {caseId:'B',report:name,sha256:'0'.repeat(64),status:'PASS'},
   {caseId:'C',report:name,sha256:digest,status:'PASS_SAFE_MISS_NOT_USEFUL'},
  ]}));
  writeFileSync(join(dir,'root-announcement-unbound-review.json'),JSON.stringify({records:[{caseId:'B',status:'PASS'}]}));
  const result=scanStaging(dir),profile=result.profiles[0];
  expect(profile.turns[0].flags.map(f=>f.code)).toContain('PROVIDER_FAILURE');
  expect(profile.reviewBindings).toEqual(expect.arrayContaining([
   expect.objectContaining({caseId:'A',binding:'BOUND',status:'PASS_SAFE_MISS_NOT_USEFUL',outcome:'NON_PASS'}),
   expect.objectContaining({caseId:'B',binding:'UNBOUND',outcome:'UNBOUND'}),
   expect.objectContaining({caseId:'C',binding:'BOUND',status:'PASS_SAFE_MISS_NOT_USEFUL',outcome:'NON_PASS'}),
  ]));
  expect(result.missedKnownMisses).toContainEqual(expect.objectContaining({caseId:'C',status:'PASS_SAFE_MISS_NOT_USEFUL'}));
  expect(result.diagnostics.map(d=>d.code)).toContain('REVIEW_UNBOUND');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('queues the captured honest mixed partial for completeness review',()=>{
 const text='ผมยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบอย่างมั่นใจครับ จึงยังไม่ยืนยันส่วนนั้น ส่วนข้อมูลทางการมีผลการตรวจสอบดังนี้ครับ รายละเอียดทางการพร้อมแล้ว';
 const row=screenTurn('A10',0,{...base,question:'ขอข้อมูลทางการและคำแนะนำทั่วไป',text});
 expect(row.flags.map(flag=>flag.code)).toContain('MIXED_PARTIAL_ANSWER');
});

it('treats a saved FAILURE observation as a runtime failure without requiring an error code',()=>{
 const row=screenTurn('A10',0,{...base,question:'คำถาม',text:'ตอบ',observations:[{action:'RUNTIME',result:'FAILURE',error_code:null}]});
 expect(row.flags.map(flag=>flag.code)).toContain('PROVIDER_FAILURE');
});

it('does not mark SHA-bound reviews for sibling reports as unbound',()=>{
 const dir=join(tmpdir(),`qa-screener-sibling-reviews-${Date.now()}`);mkdirSync(dir);
 try{
  const names=['assistant-owned-eval-sol-a10-r1.json','assistant-owned-eval-sol-a10-r2.json','assistant-owned-eval-sol-a10-r3.json'];
  const contents=names.map((_,index)=>JSON.stringify({records:[{caseId:'A10',turns:[{...base,question:'official and general help',
   text:'ผมยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบอย่างมั่นใจครับ จึงยังไม่ยืนยันส่วนนั้น ส่วนข้อมูลทางการมีผลการตรวจสอบดังนี้ครับ'+` Round ${index}`}]}]}));
  names.forEach((name,index)=>writeFileSync(join(dir,name),contents[index]));
  const records=names.map((name,index)=>({caseId:'A10',report:name,sha256:createHash('sha256').update(contents[index]).digest('hex'),status:'PASS_SAFE_MISS_NOT_USEFUL'}));
  writeFileSync(join(dir,'root-announcement-a10-review.json'),JSON.stringify({records}));
  const result=scanStaging(dir);
  expect(result.profiles).toHaveLength(3);
  expect(result.profiles.every(profile=>profile.reviewBindings.length===1&&profile.reviewBindings[0].binding==='BOUND')).toBe(true);
  expect(result.diagnostics.filter(item=>item.code==='REVIEW_UNBOUND')).toEqual([]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
