import {expect,it} from 'vitest';
import {validateStructuredProcedure,structuredProcedureApplies} from '../lib/knowledge/structured-not-applicable';
import type {AISnapshot} from '../lib/ai/run-worker';
const proposal=(quote:string,topic='WIFI_ACCESS')=>({version:1,kind:'PROCEDURE',topic,quote});
const source=(question:string,history:AISnapshot['history']=[]):AISnapshot=>({jobId:'00000000-0000-4000-8000-000000000001',sessionId:'00000000-0000-4000-8000-000000000002',conversationId:'00000000-0000-4000-8000-000000000003',messageId:'00000000-0000-4000-8000-000000000004',revision:0,question,history});
it('validates a literal closed procedural proposal without retaining USER text',()=>{
 const question='Wi-Fi ต่อไม่ได้',certificate=validateStructuredProcedure(proposal(question),question);
 expect(certificate).toMatchObject({version:1,kind:'PROCEDURE',topic:'WIFI_ACCESS',questionDigest:expect.stringMatching(/^[a-f0-9]{64}$/)});
 expect(JSON.stringify(certificate)).not.toContain(question);expect(Object.isFrozen(certificate)).toBe(true);expect(structuredProcedureApplies(certificate,source(question))).toBe(true);
});
it.each([['CREDIT_TRANSFER','ขอขั้นตอนเทียบโอนผลการเรียน'],['TUITION_FEES','ขอวิธีชำระค่าเทอม'],['REGISTRATION','ลงทะเบียนเข้าไม่ได้ error 500'],['LIBRARY_SERVICES','วิธีเข้าใช้บริการห้องสมุด'],['ACADEMIC_CALENDAR','วิธีดูปฏิทินวิชาการปี 2569']])('accepts explicit %s procedures', (topic,question)=>{
 expect(structuredProcedureApplies(validateStructuredProcedure(proposal(question,topic),question),source(question))).toBe(true);
});
it.each(['ขอปฏิทินวิชาการ','วิธีดูปฏิทินวันไหนเปิดเทอม','วิธีเทียบโอนได้กี่หน่วยกิต','วิธีเช็กสิทธิเทียบโอน','วิธีชำระค่าเทอมเท่าไร','วิธีดูเวลาเปิดห้องสมุด'])('exact or ambiguous information cannot become NOT_APPLICABLE: %s',question=>{
 const topic=question.includes('ปฏิทิน')?'ACADEMIC_CALENDAR':question.includes('เทียบโอน')?'CREDIT_TRANSFER':question.includes('ค่าเทอม')?'TUITION_FEES':'LIBRARY_SERVICES';
 expect(()=>validateStructuredProcedure(proposal(question,topic),question)).toThrow('STRUCTURED_PROCEDURE_INVALID');
});
it('requires actual topic/quote and strict own JSON with no arbitrary URLs or inferred selectors',()=>{
 const question='Wi-Fi ต่อไม่ได้';let invoked=false;const accessor=Object.defineProperty({},'quote',{enumerable:true,get:()=>{invoked=true;return question;}});
 for(const input of [proposal('Wi-Fi ไม่ทำงาน'),proposal(question,'CREDIT_TRANSFER'),{...proposal(question),url:'https://evil.test/'},{...proposal(question),academicYear:2569},{...proposal(question),kind:'RAG'},accessor,Object.create(proposal(question))])
  expect(()=>validateStructuredProcedure(input,question)).toThrow('STRUCTURED_PROCEDURE_INVALID');
 expect(invoked).toBe(false);
});
it.each(['Wi-Fi ขั้นตอนเชื่อมต่ออย่างไร ใช้ได้เมื่อไหร่','Wi-Fi ขั้นตอนเชื่อมต่ออย่างไร ใช้ได้เมื่อไร','Wi-Fi ขั้นตอนเชื่อมต่ออย่างไร เปิดวันใด','วิธีเข้าใช้ห้องสมุด เวลาทำการคืออะไร',
 'Wi-Fi กฎการใช้บริการเป็นอย่างไร','Wi-Fi กติกาการใช้บริการเป็นอย่างไร','Wi-Fi ขอวิธีดูข้อปฏิบัติการใช้บริการ','Wi-Fi ขอวิธีดูประกาศการใช้บริการ'])('mixed exact-time/policy question must retain clarification: %s',question=>{
 const topic=question.includes('Wi-Fi')?'WIFI_ACCESS':'LIBRARY_SERVICES';
 expect(()=>validateStructuredProcedure(proposal(question,topic),question)).toThrow('STRUCTURED_PROCEDURE_INVALID');
});
it('certificate revalidation permits only current or exactly combined prior actual USER context',()=>{
 const prior='Wi-Fi ต่อไม่ได้',current='ลองตามขั้นตอนแล้ว',certificate=validateStructuredProcedure(proposal(prior),prior+'\n'+current);
 expect(structuredProcedureApplies(certificate,source(current,[{role:'user',content:prior}]))).toBe(true);
 expect(structuredProcedureApplies(certificate,source(current,[{role:'assistant',content:prior}]))).toBe(false);
 expect(structuredProcedureApplies(certificate,source('คำถามใหม่',[{role:'user',content:prior}]))).toBe(false);
 expect(structuredProcedureApplies({...certificate,questionDigest:'0'.repeat(64)},source(current,[{role:'user',content:prior}]))).toBe(false);
 expect(structuredProcedureApplies({...certificate,topic:'CREDIT_TRANSFER'},source(current,[{role:'user',content:prior}]))).toBe(false);
});
