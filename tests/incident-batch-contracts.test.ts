import {describe,it,expect} from 'vitest';
import {incidentReplySelectionSchema,incidentReplyOptionsSchema,incidentReplyPreviewSchema} from '../lib/incidents/batch-reply-contracts';
const id='10000000-0000-4000-8000-000000000001';
const second='10000000-0000-4000-8000-000000000002';
const cases=[{ticketId:id,ticketCode:'YRU-00000001',reporterLabel:'Anonymous A'},
 {ticketId:second,ticketCode:'YRU-00000002',reporterLabel:'Anonymous B'}];
const preview=()=>({status:'REVIEW_ONLY',incidentId:id,requestId:id,cases,caseCount:2,recipientCount:2,commonText:'กำลังตรวจสอบ',intervention:false,
 expiresAt:'2026-10-10T12:00:00.000Z',previewReceipt:'opaque',deliveries:cases.map((item,i)=>({recipientCode:`R${i+1}`,cases:[item],
  messages:[{type:'text',text:`อัปเดตเคส: ${item.ticketCode}\n\nกำลังตรวจสอบ`}]}))});
describe('explicit incident reply review contracts',()=>{
 it('canonicalizes selected UUIDs and common text without selecting extra cases',()=>{
  const result=incidentReplySelectionSchema.parse({requestId:id,ticketIds:[id.toUpperCase()],text:'  กำลังตรวจสอบเครือข่าย\nจะแจ้งความคืบหน้าอีกครั้ง  ',intervention:false});
  expect(result.ticketIds).toEqual([id]);expect(result.text).toBe('กำลังตรวจสอบเครือข่าย\nจะแจ้งความคืบหน้าอีกครั้ง');
 });
 it.each([
  {ticketIds:[]},{ticketIds:[id,id.toUpperCase()]},{ticketIds:Array.from({length:101},()=>id)},
  {text:' '},{text:'x'.repeat(4001)},{text:'ข้อความ\u0000แฝง'},{text:'ข้อความ\u202Eแฝง'},
  {intervention:'true'},{actorId:id},{recipientIds:[id]},
 ])('rejects unsafe or caller-invented selection %#',patch=>{
  expect(incidentReplySelectionSchema.safeParse({requestId:id,ticketIds:[id],text:'กำลังตรวจสอบ',intervention:false,...patch}).success).toBe(false);
 });
 it('does not accept hidden technical identities or delivered claims in public DTOs',()=>{
  expect(incidentReplyOptionsSchema.safeParse({lineSessionId:id}).success).toBe(false);
  expect(incidentReplyPreviewSchema.safeParse({status:'SENT',to:'Uprivate'}).success).toBe(false);
 });
 it('accepts an exact complete per-recipient packet partition without technical session IDs',()=>{
  const result=incidentReplyPreviewSchema.parse(preview());expect(result).toEqual(preview());
 });
 it('rejects omitted/duplicate/cross-recipient cases, false counts or edited packet text',()=>{
  const source=preview();
  const variants=[{...source,caseCount:1},{...source,recipientCount:1},{...source,deliveries:source.deliveries.slice(0,1)},
   {...source,deliveries:[source.deliveries[0],{...source.deliveries[1],cases:[cases[0]]}]},
   {...source,deliveries:[{...source.deliveries[0],recipientCode:'R2'},source.deliveries[1]]},
   {...source,deliveries:[{...source.deliveries[0],lineSessionId:id},source.deliveries[1]]},
   {...source,deliveries:[{...source.deliveries[0],messages:[{type:'text',text:'different response'}]},source.deliveries[1]]},
   {...source,deliveries:[{...source.deliveries[0],cases:[{...cases[0],reporterLabel:'Wrong reporter'}]},source.deliveries[1]]}];
  for(const value of variants)expect(incidentReplyPreviewSchema.safeParse(value).success).toBe(false);
 });
});
