import {expect,it} from 'vitest';
import {mixedRepairResponseSchema,screenMixedRepair} from '../lib/ai/mixed-repair';
const context={question:'ช่วยแนะนำการเตรียมตัวก่อนยื่นคำร้องและหาแบบให้ด้วย',history:[]};
const wire=(generalText:string[])=>({decision:{action:'MIXED_REPLY',generalText,query:'ค้นแบบคำร้องที่ตรงเรื่อง'}});
it('withholds whole actual escaped field and attachment contributions while retaining independent help',()=>{
 const parts=['ระบุชื่อและข้อมูลติดต่อของคุณให้ครบถ้วนครับ','รวบรวมข้อมูลและเอกสารส่วนตัว เช่น สำเนาบัตรประจำตัวนักศึกษา ก่อนยื่นครับ','เขียนวัตถุประสงค์และข้อเท็จจริงของเรื่องให้ชัดเจนครับ'];
 const input=wire(parts),before=structuredClone(input);
 expect(screenMixedRepair(input,context)).toEqual({decision:{action:'MIXED_REPLY',generalText:parts[2],query:input.decision.query},acceptedParts:1,rejectedParts:2,reason:null});
 expect(input).toEqual(before);
});
it('keeps whole safe model contributions without rewriting them or inventing a replacement',()=>{
 const parts=['ควรระบุรหัสนักศึกษาและคณะครับ','เขียนเป้าหมายและข้อเท็จจริงของเรื่องให้ชัดเจนครับ','ตรวจคำแนะนำของแบบที่ใช้ก่อนยื่นครับ'],input=wire(parts),before=structuredClone(input);
 expect(screenMixedRepair(input,context)).toEqual({decision:{action:'MIXED_REPLY',generalText:parts.slice(1).join(' '),query:input.decision.query},acceptedParts:2,rejectedParts:1,reason:null});
 expect(input).toEqual(before);
});
it('returns no fabricated safe help when every model contribution is rejected',()=>{
 expect(screenMixedRepair(wire(['ควรระบุรหัสนักศึกษาครับ','เปิดแบบที่ https://fixture.invalid/form']),context)).toMatchObject({decision:null,acceptedParts:0,rejectedParts:2});
});
it.each([['คุณควรระบุ','รหัสนักศึกษาให้ครบครับ'],['คุณควรระบุ\nรหัสนักศึกษาให้ครบครับ']])('rejects an unsafe prescription assembled from whitespace/fragments: %j',(...parts)=>{
 expect(screenMixedRepair(wire(parts),context)?.decision).toBeNull();
});
it.each([[],Array<string>(7).fill('ข้อความ'),['x'.repeat(12001)],Array<string>(6).fill('x'.repeat(2000))])('rejects oversized/empty parts without clipping to a valid response: %j',(...parts)=>{
 expect(mixedRepairResponseSchema.safeParse(wire(parts)).success).toBe(false);expect(screenMixedRepair(wire(parts),context)).toBeNull();
});
it('preserves a complete contribution above 2000 characters within the existing 12000-character total contract',()=>{
 const text='คำอธิบายทั่วไปโดยละเอียดครับ '.repeat(150);
 expect(text.length).toBeGreaterThan(2000);expect(text.length).toBeLessThan(12000);
 expect(screenMixedRepair(wire([text]),context)?.decision?.generalText).toBe(text);
});
it('rejects string-only or extra-field correction contracts',()=>{
 expect(screenMixedRepair({decision:{action:'MIXED_REPLY',generalText:'ข้อความ',query:'ค้น'}},context)).toBeNull();
 expect(screenMixedRepair({...wire(['ข้อความ']),verified:true},context)).toBeNull();
});
it('retains general resume advice while prior USER form context remains conservative',()=>{
 const input=wire(['ควรระบุชื่อ-นามสกุลและเบอร์ติดต่อให้ชัดเจนครับ']);
 expect(screenMixedRepair(input,{question:'ช่วยแนะนำเรซูเม่',history:[]})?.decision).not.toBeNull();
 expect(screenMixedRepair(input,{question:'แล้วควรเตรียมอะไรต่อ',history:[{role:'user',content:'จะยื่นคำร้องของมหาวิทยาลัย'}]})?.decision).toBeNull();
});
