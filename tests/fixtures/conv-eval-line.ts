/**
 * CONV-EVAL-LINE-01 (DEC-206): LINE-realistic Student typing cases. Each step is a fragment received
 * `at` ms after the case start, or `deliver` (the bot runs and its reply is delivered at that time).
 * `calls` lists the questions the model must receive, in order; `fixed` lists replies that must be sent
 * without any model call. With the fake provider this checks the input pipeline (window, carry-over,
 * greeting) end to end in PostgreSQL. The same cases can later be run with a real model (CONV-V2-00/06)
 * once the owner approves that budget; they then also measure answer quality, which this set does not.
 */
export type EvalStep={text:string;at:number}|{deliver:number};
export interface LineEvalCase {id:string;category:'SHORT'|'MISSPELLED'|'BURST'|'GREETING'|'FOLLOW_UP'|'EDGE';steps:EvalStep[];calls:string[];fixed?:('GREETING'|'THANKS')[]}
const one=(id:string,category:LineEvalCase['category'],text:string):LineEvalCase=>({id,category,steps:[{text,at:0}],calls:[text]});

export const LINE_EVAL_CASES:LineEvalCase[]=[
 one('S01','SHORT','ค่าเทอมเท่าไหร่'),
 one('S02','SHORT','กยศ ยื่นที่ไหน'),
 one('S03','SHORT','wifi เข้าไม่ได้'),
 one('S04','SHORT','ลืมรหัส reg'),
 one('S05','SHORT','สอบซ่อมวันไหน'),
 one('S06','SHORT','ขอใบรับรองนักศึกษา'),
 one('S07','SHORT','ห้องสมุดเปิดกี่โมง'),
 one('S08','SHORT','ลงทะเบียนล่าช้าได้มั้ย'),
 one('M01','MISSPELLED','ค่าเทมเท่าไร'),
 one('M02','MISSPELLED','จ่ายค่าเทอมยังไงอ่ะ'),
 one('M03','MISSPELLED','ลงทะเบีนเรียนยังไง'),
 one('M04','MISSPELLED','ดูเกรดเฉลี่ยไง'),
 one('M05','MISSPELLED','เทียบโอนต้องใช้ไรบ้าง'),
 one('M06','MISSPELLED','กยศ.ต้องยื่นเอกสารไรบ้างคับ'),
 one('M07','MISSPELLED','เน็ตมหาลัยใช้ไม่ด้าย'),
 one('M08','MISSPELLED','ยื่นจบทำไง'),
 {id:'B01',category:'BURST',steps:[{text:'คือ',at:0},{text:'ค่าเทอมเท่าไหร่',at:3000}],calls:['คือ\nค่าเทอมเท่าไหร่']},
 {id:'B02',category:'BURST',steps:[{text:'ขอถามหน่อยครับ',at:0},{text:'เทียบโอนยังไง',at:6000}],calls:['ขอถามหน่อยครับ\nเทียบโอนยังไง']},
 {id:'B03',category:'BURST',steps:[{text:'ลงทะเบียน',at:0},{text:'วิชาเลือก',at:1000},{text:'ยังไงครับ',at:2500}],calls:['ลงทะเบียน\nวิชาเลือก\nยังไงครับ']},
 {id:'B04',category:'BURST',steps:[{text:'wifi',at:0},{text:'เข้าไม่ได้',at:800},{text:'ทำไงดี',at:1700}],calls:['wifi\nเข้าไม่ได้\nทำไงดี']},
 {id:'B05',category:'BURST',steps:[{text:'สอบถามค่ะ',at:0},{text:'เรื่องกยศ',at:5000},{text:'ต้องยื่นตอนไหน',at:7000}],calls:['สอบถามค่ะ\nเรื่องกยศ\nต้องยื่นตอนไหน']},
 {id:'B06',category:'BURST',steps:[{text:'ค่าเทอม',at:0},{text:'ภาคพิเศษ',at:2000}],calls:['ค่าเทอม\nภาคพิเศษ']},
 {id:'B07',category:'BURST',steps:[{text:'ค่าเทอมเท่าไหร่',at:0},{text:'ภาคพิเศษครับ',at:4000}],calls:['ค่าเทอมเท่าไหร่\nภาคพิเศษครับ']},
 {id:'B08',category:'BURST',steps:[{text:'เทียบโอนยังไง',at:0},{text:'ต้องใช้เอกสารอะไร',at:20000}],calls:['เทียบโอนยังไง\nต้องใช้เอกสารอะไร']},
 {id:'G01',category:'GREETING',steps:[{text:'สวัสดีครับ',at:0},{text:'เทียบโอนยังไง',at:5000}],calls:['สวัสดีครับ\nเทียบโอนยังไง']},
 {id:'G02',category:'GREETING',steps:[{text:'สวัสดีครับ',at:0},{text:'เทียบโอนยังไง',at:12000}],calls:['สวัสดีครับ\nเทียบโอนยังไง']},
 {id:'G03',category:'GREETING',steps:[{text:'หวัดดีค่ะ',at:0}],calls:[],fixed:['GREETING']},
 {id:'G04',category:'GREETING',steps:[{text:'สวัสดีครับ',at:0},{deliver:9000},{text:'ค่าเทอมเท่าไหร่',at:30000}],calls:['ค่าเทอมเท่าไหร่'],fixed:['GREETING']},
 {id:'G05',category:'GREETING',steps:[{text:'ขอบคุณครับ',at:0}],calls:[],fixed:['THANKS']},
 {id:'G06',category:'GREETING',steps:[{text:'hello',at:0}],calls:[],fixed:['GREETING']},
 {id:'G07',category:'GREETING',steps:[{text:'สวัสดีค่ะแอดมิน 🙏',at:0}],calls:[],fixed:['GREETING']},
 {id:'F01',category:'FOLLOW_UP',steps:[{text:'ค่าเทอมเท่าไหร่',at:0},{deliver:4000},{text:'แล้วภาคพิเศษล่ะ',at:20000}],calls:['ค่าเทอมเท่าไหร่','แล้วภาคพิเศษล่ะ']},
 {id:'F02',category:'FOLLOW_UP',steps:[{text:'ลืมรหัสผ่าน',at:0},{deliver:4000},{text:'ยังไม่ได้ครับ',at:60000}],calls:['ลืมรหัสผ่าน','ยังไม่ได้ครับ']},
 {id:'F03',category:'FOLLOW_UP',steps:[{text:'wifi เข้าไม่ได้',at:0},{deliver:4000},{text:'ขอบคุณครับ',at:30000}],calls:['wifi เข้าไม่ได้'],fixed:['THANKS']},
 {id:'F04',category:'FOLLOW_UP',steps:[{text:'กยศ ยื่นไหน',at:0},{deliver:4000},{text:'อ้อ แล้วถ้ากู้ใหม่ล่ะ',at:25000}],calls:['กยศ ยื่นไหน','อ้อ แล้วถ้ากู้ใหม่ล่ะ']},
 {id:'F05',category:'FOLLOW_UP',steps:[{text:'ห้องสมุดเปิดกี่โมง',at:0},{deliver:4000},{text:'วันเสาร์เปิดไหม',at:15000}],calls:['ห้องสมุดเปิดกี่โมง','วันเสาร์เปิดไหม']},
 {id:'F06',category:'FOLLOW_UP',steps:[{text:'ลงทะเบียนเรียน',at:0},{deliver:4000},{text:'แล้วถ้า',at:20000},{text:'เลยกำหนดล่ะ',at:23000}],calls:['ลงทะเบียนเรียน','แล้วถ้า\nเลยกำหนดล่ะ']},
 {id:'E01',category:'EDGE',steps:[{text:'ครับ',at:0}],calls:['ครับ']},
 {id:'E02',category:'EDGE',steps:[{text:'555',at:0}],calls:['555']},
 {id:'E03',category:'EDGE',steps:[0,2000,4000,6000,8000,10000,12000,14000,16000,18000].map((at,i)=>({text:`ส่วนที่ ${i+1}`,at})),
  calls:[Array.from({length:10},(_,i)=>`ส่วนที่ ${i+1}`).join('\n')]},
 {id:'E04',category:'EDGE',steps:[{text:'ขอบคุณครับ แล้วค่าเทอมเท่าไหร่',at:0}],calls:['ขอบคุณครับ แล้วค่าเทอมเท่าไหร่']},
];
