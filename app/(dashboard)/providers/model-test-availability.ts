import type {ModelView} from '@/types/providers';

/** A cached price is display evidence. The test API refreshes trusted pricing before inference. */
export function modelTestBlockReason(input:{keyConfigured:boolean;cooling:boolean;pricingStatus:ModelView['pricingStatus'];purpose:ModelView['purpose'];supportsJson:boolean;embeddingDimensions:number|null}):string|null{
 if(input.cooling)return 'รอให้พ้นช่วงพักของโมเดลก่อนทดสอบอีกครั้ง';
 if(!input.keyConfigured)return 'เพิ่ม API key ในการตั้งค่าผู้ให้บริการก่อนทดสอบ';
 if(input.pricingStatus==='PAID')return 'โมเดลนี้มีค่าใช้จ่าย การทดสอบปัจจุบันรองรับโมเดลฟรี';
 if(input.purpose==='GENERATION'&&!input.supportsJson)return 'เปิดความสามารถ JSON ตามที่โมเดลรองรับก่อนทดสอบ';
 if(input.purpose==='EMBEDDING'&&input.embeddingDimensions===null)return 'ระบุจำนวนมิติของโมเดลก่อนทดสอบ';
 return null;
}
