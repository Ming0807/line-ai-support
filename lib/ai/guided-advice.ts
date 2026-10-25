import {z} from 'zod';

/** Effect labels are untrusted model proposals, not evidence that an action is safe. */
export const guidedAdviceSchema=z.strictObject({steps:z.array(z.strictObject({
 effect:z.enum(['OBSERVATION','PERSONAL_REVERSIBLE','SHARED_EQUIPMENT_CHANGE','CLEARS_SAVED_ACCESS']),
 text:z.string().min(1).max(20000).refine(value=>value.trim().length>0),
})).min(1).max(6)});

const preconditions={
 OBSERVATION:'',PERSONAL_REVERSIBLE:'',
 SHARED_EQUIPMENT_CHANGE:'ทำขั้นตอนนี้เฉพาะเมื่อคุณมีสิทธิ์จัดการอุปกรณ์และได้รับอนุญาตให้เปลี่ยนแปลง เพราะอาจทำให้ผู้ใช้งานคนอื่นขาดการเชื่อมต่อ หากไม่แน่ใจ อย่าทำขั้นตอนนี้และให้ผู้ดูแลอุปกรณ์ช่วยตรวจสอบก่อนครับ\n',
 CLEARS_SAVED_ACCESS:'ขั้นตอนนี้ทำให้สูญเสียการตั้งค่าการเชื่อมต่อที่บันทึกไว้ ทำเฉพาะเมื่อคุณพร้อมเชื่อมต่อกลับได้ด้วยวิธีหรือข้อมูลที่จำเป็นและยอมรับผลนี้ หากไม่พร้อม อย่าทำขั้นตอนนี้ครับ และไม่ต้องส่งรหัสผ่านหรือข้อมูลลับมาในแชต\n',
} as const;

/** Render complete admitted steps. No truncation, inferred permission or selective step deletion. */
export function renderGuidedAdvice(value:unknown,max=20000):string{
 const parsed=guidedAdviceSchema.safeParse(value);
 if(!parsed.success||!Number.isInteger(max)||max<1||max>20000)throw new Error('GUIDED_ADVICE_INVALID');
 const rendered=parsed.data.steps.map((step,index)=>`${index+1}. ${preconditions[step.effect]}${step.text}`).join('\n\n');
 if(rendered.length>max)throw new Error('GUIDED_ADVICE_INVALID');
 return rendered;
}
