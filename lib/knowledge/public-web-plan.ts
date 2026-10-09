import {z} from 'zod';
import {copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {knowledgeScopeSchema} from './retrieval';
import {assessStructuredQuery,validateStructuredQuery} from './structured-query';
import {buildPublicSearchQuery} from './public-search-query';

export const publicWebTopicSchema=z.enum(['ACADEMIC_CALENDAR','CREDIT_TRANSFER','TUITION_FEES','REGISTRATION','WIFI_ACCESS','LIBRARY_SERVICES','STUDENT_ACTIVITIES','DORMITORY']);
export const publicWebPlanSchema=z.object({version:z.literal(1),purpose:z.literal('YRU_INFORMATION'),
 topic:publicWebTopicSchema,
 academicYear:z.number().int().min(2400).max(3000).nullable()}).strict();
export const generalWebPlanSchema=z.object({version:z.literal(1),purpose:z.literal('GENERAL_PUBLIC'),
 topic:z.enum(['GENERAL_WIFI_HELP','GENERAL_HTTP_500','GENERAL_DEVICE_NETWORK']),academicYear:z.null()}).strict();
export const generalWebPlanProposalSchema=generalWebPlanSchema.extend({quote:z.string().min(1).max(500)
 .refine(value=>value.trim().length>0&&!/[\p{Cc}\p{Cf}]/u.test(value))}).strict();
export const publicWebPlanProposalSchema=publicWebPlanSchema.extend({quote:z.string().min(1).max(500)
 .refine(value=>value.trim().length>0&&!/[\p{Cc}\p{Cf}]/u.test(value)),general:generalWebPlanProposalSchema.optional()}).strict();
export type PublicWebPlan=z.infer<typeof publicWebPlanSchema>;
export type GeneralWebPlan=z.infer<typeof generalWebPlanSchema>;
const contextSchema=z.object({userText:z.string().min(1).max(12000),scope:knowledgeScopeSchema,query:z.unknown(),proceduralTopic:publicWebTopicSchema.optional()}).strict();
const registry={
 ACADEMIC_CALENDAR:{datasets:['academic_calendar_events'],anchor:/ปฏิทิน(?:\s*วิชาการ)?|academic\s+calendar/iu},
 CREDIT_TRANSFER:{datasets:['transfer_courses'],anchor:/เทียบโอน|credit\s+transfer/iu},
 TUITION_FEES:{datasets:['tuition_fees'],anchor:/ค่าธรรมเนียม|ค่าเทอม|ค่าเล่าเรียน|tuition|fees/iu},
 REGISTRATION:{datasets:['university_services','university_systems','announcements'],anchor:/ลงทะเบียน|registration/iu},
 WIFI_ACCESS:{datasets:['university_services','university_systems'],anchor:/wi[\s-]?fi|ไว[\s-]?ไฟ/iu},
 LIBRARY_SERVICES:{datasets:['university_services'],anchor:/ห้องสมุด|library/iu},
 STUDENT_ACTIVITIES:{datasets:['announcements','academic_calendar_events'],anchor:/กิจกรรมนักศึกษา|student\s+activit/iu},
 DORMITORY:{datasets:['university_services','service_forms','announcements'],anchor:/หอพัก|dormitor/iu},
} satisfies Record<PublicWebPlan['topic'],{datasets:readonly string[];anchor:RegExp}>;
export function hasPublicTopicAnchor(topic:PublicWebPlan['topic'],text:string):boolean{return registry[topic].anchor.test(text.normalize('NFKC'));}

/** Proposal validation only: no actor authority, arbitrary query, URL, history or identity is returned. */
export function validatePublicWebPlan(input:unknown,context:unknown):PublicWebPlan{
 try{
  const proposal=publicWebPlanProposalSchema.parse(copyStructuredJson(input,4096,64));
  const current=contextSchema.parse(copyStructuredJson(context,64*1024,2000));
  const query=current.query===null?null:validateStructuredQuery(current.query);
  const rule=registry[proposal.topic];
  if((query===null?current.proceduralTopic!==proposal.topic:current.proceduralTopic!==undefined||assessStructuredQuery(query).status!=='READY'||!(rule.datasets as readonly string[]).includes(query.dataset))||
   !current.userText.includes(proposal.quote)||!rule.anchor.test(proposal.quote.normalize('NFKC'))||
   current.scope.asOfDate!==null||proposal.academicYear!==current.scope.academicYear)throw new Error();
  if(proposal.academicYear!==null&&!new RegExp(`(?<!\\d)${proposal.academicYear}(?!\\d)`,'u').test(current.userText))throw new Error();
  if(query&&'academic_year' in query.filters&&query.filters.academic_year!==current.scope.academicYear)throw new Error();
  const {version,purpose,topic,academicYear}=proposal,plan={version,purpose,topic,academicYear};
  buildPublicSearchQuery(plan);
  return freezeStructuredData(plan);
 }catch{throw new Error('PUBLIC_WEB_PLAN_INVALID');}
}

const generalExact=/(?:กี่|เท่าไร|เท่าไหร่|หน่วยกิต|วันไหน|วันใด|วันเวลา|วันที่|เมื่อไหร่|เมื่อไร|เมื่อใด|ตอนไหน|ช่วงไหน|ปีไหน|ปีใด|เวลาทำการ|เวลา(?:ทำการ|ใด|ไหน|เปิด|ปิด)|กี่โมง|กำหนด(?:วัน|การ)|สิทธิ|เงื่อนไข|หลักเกณฑ์|ประกาศหลักเกณฑ์|ข้อบังคับ|ข้อกำหนด|นโยบาย|ระเบียบ|กฎ|กติกา|ข้อปฏิบัติ|ประกาศ|จำนวน|รายวิชา|ราคา|ค่าใช้จ่าย|ยอดเงิน|วันหมดเขต|วันที่เปิด|วันที่ปิด|ใช้เวลา.{0,12}(?:เท่าไร|เท่าไหร่|นานแค่ไหน|กี่)|นาน(?:เท่าไร|เท่าไหร่|แค่ไหน)|อีกนาน|\b(?:when|eligib\w*|policy|policies|rules?|requirements?|fees?|amounts?|course\s+counts?|duration|opening\s+hours|business\s+hours)\b|\b(?:how\s+(?:many|much|long)|what\s+(?:date|time)|which\s+(?:day|year))\b)/iu;
export function requestsExactPublicInformation(text:string):boolean{return generalExact.test(text)||generalExact.test(text.normalize('NFKC'));}
const generalProcedure=/(?:วิธี|ขั้นตอน|ทำยังไง|อย่างไร|แก้(?:ปัญหา|ไข)|\b(?:how\s+to|steps?|procedure|troubleshoot\w*|fix)\b)/iu;
const generalFailure=/(?:(?:ต่อ|เข้า|ใช้งาน|เชื่อมต่อ).{0,15}(?:ไม่ได้|ไม่สำเร็จ)|error\s*500|\b(?:failed|cannot|can't|not\s+working)\b)/iu;
const generalWifiAnchor=/wi[\s-]?fi|ไว[\s-]?ไฟ/iu;
const generalDeviceNetworkAnchor=/wi[\s-]?fi|ไว[\s-]?ไฟ|เครือข่าย|อินเทอร์เน็ต|อินเตอร์เน็ต|เน็ต|network|internet|device\s+network/iu;
const cleanGeneralText=z.string().min(1).max(12000).refine(value=>value.trim().length>0&&Buffer.byteLength(value,'utf8')<=12000&&
 !/[\p{Cc}\p{Cf}]/u.test(value.replace(/[\r\n\t]/gu,'')));
function isGeneralTroubleshooting(text:string,topic:GeneralWebPlan['topic']):boolean{
 const normalized=text.normalize('NFKC');
 if(requestsExactPublicInformation(text))return false;
 if(topic==='GENERAL_WIFI_HELP'&&!generalWifiAnchor.test(normalized))return false;
 if(topic==='GENERAL_DEVICE_NETWORK'&&!generalDeviceNetworkAnchor.test(normalized))return false;
 if(topic==='GENERAL_HTTP_500'&&(!/\b500\b/u.test(normalized)||!/(?:error|http\s*500|500\s*error|ข้อผิดพลาด)/iu.test(normalized)))return false;
 return generalProcedure.test(normalized)||generalFailure.test(normalized);
}
/** Validates a separately proposed general troubleshooting plan after a closed official-plan decision. */
export function validateGeneralWebPlan(input:unknown,officialPlan:unknown,userText:unknown):GeneralWebPlan{
 try{
  const proposal=generalWebPlanProposalSchema.parse(copyStructuredJson(input,4096,64));
  const official=publicWebPlanSchema.parse(copyStructuredJson(officialPlan,4096,64));
  const text=cleanGeneralText.parse(userText);
  if(!text.includes(proposal.quote)||!isGeneralTroubleshooting(proposal.quote,proposal.topic)||!isGeneralTroubleshooting(text,proposal.topic)||!hasPublicTopicAnchor(official.topic,text))throw new Error();
  if((proposal.topic==='GENERAL_WIFI_HELP'||proposal.topic==='GENERAL_DEVICE_NETWORK')&&official.topic!=='WIFI_ACCESS')throw new Error();
  if(proposal.topic==='GENERAL_HTTP_500'&&official.topic!=='REGISTRATION')throw new Error();
  const {version,purpose,topic,academicYear}=proposal;
  return freezeStructuredData({version,purpose,topic,academicYear});
 }catch{throw new Error('GENERAL_WEB_PLAN_INVALID');}
}
