import type {ModelView} from '@/types/providers';

/** Display evidence only; the test API rechecks account eligibility or trusted pricing. */
export function modelTestBlockReason(input:{keyConfigured:boolean;cooling:boolean;pricingStatus:ModelView['pricingStatus'];purpose:ModelView['purpose'];supportsJson:boolean;embeddingDimensions:number|null;accountFreeUntil?:string|null},now=Date.now()):string|null{
 if(input.cooling)return 'รอให้พ้นช่วงพักของโมเดลก่อนทดสอบอีกครั้ง';
 if(!input.keyConfigured)return 'เพิ่ม API key ในการตั้งค่าผู้ให้บริการก่อนทดสอบ';
 const accountFree=input.purpose==='GENERATION'&&Boolean(input.accountFreeUntil&&Date.parse(input.accountFreeUntil)>now);
 if(input.pricingStatus==='PAID'&&!accountFree)return 'โมเดลนี้มีค่าใช้จ่าย การทดสอบปัจจุบันรองรับโมเดลฟรี';
 if(input.purpose==='GENERATION'&&!input.supportsJson)return 'เปิดความสามารถ JSON ตามที่โมเดลรองรับก่อนทดสอบ';
 if(input.purpose==='EMBEDDING'&&input.embeddingDimensions===null)return 'ระบุจำนวนมิติของโมเดลก่อนทดสอบ';
 return null;
}
