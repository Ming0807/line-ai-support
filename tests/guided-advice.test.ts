import {describe,it,expect} from 'vitest';
import {renderGuidedAdvice} from '../lib/ai/guided-advice';
const step=(effect:string,text='ตรวจดูข้อความที่หน้าจอครับ')=>({effect,text});
describe('backend guided advice rendering',()=>{
 it('retains full ordinary observations without extra permission questions',()=>expect(renderGuidedAdvice({steps:[step('OBSERVATION'),step('PERSONAL_REVERSIBLE','ลองปิดและเปิด Wi-Fi บนโทรศัพท์ของคุณครับ')]})).toBe('1. ตรวจดูข้อความที่หน้าจอครับ\n\n2. ลองปิดและเปิด Wi-Fi บนโทรศัพท์ของคุณครับ'));
 it('places control and impact prerequisites before shared equipment advice',()=>{const text=renderGuidedAdvice({steps:[step('SHARED_EQUIPMENT_CHANGE','รีสตาร์ตเราเตอร์ครับ')]});expect(text.indexOf('มีสิทธิ์')).toBeLessThan(text.indexOf('รีสตาร์ตเราเตอร์'));expect(text).toContain('ผู้ใช้งานคนอื่น');expect(text).toContain('หากไม่แน่ใจ');});
 it('places recovery readiness and loss warning before clearing saved access',()=>{const text=renderGuidedAdvice({steps:[step('CLEARS_SAVED_ACCESS','ลืมเครือข่ายนี้ครับ')]});expect(text.indexOf('เชื่อมต่อกลับ')).toBeLessThan(text.indexOf('ลืมเครือข่ายนี้'));expect(text).toContain('สูญเสีย');expect(text).toContain('ไม่ต้องส่งรหัสผ่าน');});
 it.each(['UNKNOWN','ADMIN_OR_DESTRUCTIVE_CHANGE','',null])('rejects unsupported effect %s without delivering safe subset',effect=>expect(()=>renderGuidedAdvice({steps:[step('OBSERVATION'),{effect,text:'reset'}]})).toThrow('GUIDED_ADVICE_INVALID'));
 it('rejects a model consent override',()=>expect(()=>renderGuidedAdvice({steps:[{...step('SHARED_EQUIPMENT_CHANGE'),authorized:true}]})).toThrow('GUIDED_ADVICE_INVALID'));
 it('rejects a free prose bypass',()=>expect(()=>renderGuidedAdvice({steps:[step('OBSERVATION')],preface:'reset first'})).toThrow('GUIDED_ADVICE_INVALID'));
 it.each([[],Array.from({length:7},()=>step('OBSERVATION'))])('rejects invalid step count',steps=>expect(()=>renderGuidedAdvice({steps})).toThrow('GUIDED_ADVICE_INVALID'));
 it('rejects blank content',()=>expect(()=>renderGuidedAdvice({steps:[step('OBSERVATION','  ')]})).toThrow('GUIDED_ADVICE_INVALID'));
 it('rejects whole output overflow including backend prerequisites without clipping',()=>expect(()=>renderGuidedAdvice({steps:Array.from({length:6},()=>step('CLEARS_SAVED_ACCESS','ก'.repeat(3400)))})).toThrow('GUIDED_ADVICE_INVALID'));
 it('applies the smaller mixed-reply budget to the complete rendered answer',()=>expect(()=>renderGuidedAdvice({steps:[step('OBSERVATION','ก'.repeat(8000)),step('OBSERVATION','ข'.repeat(8000))]},12000)).toThrow('GUIDED_ADVICE_INVALID'));
});
