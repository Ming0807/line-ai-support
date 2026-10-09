import {describe,it,expect} from 'vitest';
import {generalWebPlanProposalSchema,requestsExactPublicInformation,validateGeneralWebPlan,validatePublicWebPlan} from '../lib/knowledge/public-web-plan';
const scope={historical:true,academicYear:2569,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
const query={version:1,dataset:'academic_calendar_events',filters:{academic_year:2569,semester:'1',student_type:'REGULAR'},limit:20};
const proposal={version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:2569,quote:'ปฏิทินวิชาการ'};
const context={userText:'ขอปฏิทินวิชาการ ปี 2569 ภาคเรียน 1 ภาคปกติ รหัสส่วนตัวไม่ส่งออก',scope,query};
describe('source-grounded minimized public plan',()=>{
 it('retains only the four closed outgoing fields and freezes the result',()=>{
  const plan=validatePublicWebPlan(proposal,context);
  expect(plan).toEqual({version:1,purpose:'YRU_INFORMATION',topic:'ACADEMIC_CALENDAR',academicYear:2569});expect(Object.isFrozen(plan)).toBe(true);
  expect(JSON.stringify(plan)).not.toContain('quote');expect(JSON.stringify(plan)).not.toContain('รหัสส่วนตัว');
 });
 it('accepts explicit Wi-Fi service lookup without inventing a year or URL',()=>{
  expect(validatePublicWebPlan({...proposal,topic:'WIFI_ACCESS',academicYear:null,quote:'Wi-Fi'},
   {userText:'ขอบริการ Wi-Fi ของมหาวิทยาลัย',scope:{...scope,historical:false,academicYear:null},query:{version:1,dataset:'university_services',filters:{name:'Wi-Fi'},limit:20}}).topic).toBe('WIFI_ACCESS');
 });
 it('does not allow unsupported/general purpose or caller-provided queries/URLs',()=>{
  for(const value of [{...proposal,purpose:'GENERAL_PUBLIC'},{...proposal,topic:'GENERAL_WIFI_HELP'},{...proposal,topic:'UNKNOWN'},
   {...proposal,query:'raw private question'},{...proposal,url:'https://elsewhere.test/'}])expect(()=>validatePublicWebPlan(value,context)).toThrow('PUBLIC_WEB_PLAN_INVALID');
 });
 it('requires an actual USER quote and its registered topic anchor',()=>{
  for(const quote of ['not in source','ปี 2569','รหัสส่วนตัวไม่ส่งออก',''])expect(()=>validatePublicWebPlan({...proposal,quote},context)).toThrow('PUBLIC_WEB_PLAN_INVALID');
  expect(()=>validatePublicWebPlan({...proposal,topic:'TUITION_FEES'},context)).toThrow('PUBLIC_WEB_PLAN_INVALID');
 });
 it('rejects changed/unmentioned years and unsupported historical date granularity',()=>{
  for(const academicYear of [null,2568,'2569'])expect(()=>validatePublicWebPlan({...proposal,academicYear},context)).toThrow('PUBLIC_WEB_PLAN_INVALID');
  expect(()=>validatePublicWebPlan(proposal,{...context,userText:'ปฏิทินวิชาการ'})).toThrow('PUBLIC_WEB_PLAN_INVALID');
  expect(()=>validatePublicWebPlan(proposal,{...context,scope:{...scope,asOfDate:'2026-10-01'}})).toThrow('PUBLIC_WEB_PLAN_INVALID');
 });
 it('requires complete compatible structured selectors and source scope',()=>{
  for(const q of [null,{version:1,dataset:'academic_calendar_events',filters:{academic_year:2569},limit:20},
   {version:1,dataset:'university_systems',filters:{name:'ระบบทดสอบ'},limit:20},
   {...query,filters:{...query.filters,academic_year:2568}}])expect(()=>validatePublicWebPlan(proposal,{...context,query:q})).toThrow('PUBLIC_WEB_PLAN_INVALID');
 });
 it('refuses hostile own JSON without invoking user code',()=>{
  let invoked=false;const value=Object.defineProperty({},'topic',{enumerable:true,get:()=>{invoked=true;return proposal.topic;}});
  for(const input of [value,new Proxy(proposal,{}),Object.create(proposal),{...proposal,toJSON:()=>{invoked=true;return proposal;}}])
   expect(()=>validatePublicWebPlan(input,context)).toThrow('PUBLIC_WEB_PLAN_INVALID');
  expect(invoked).toBe(false);
 });
});

describe('closed general web plan proposals',()=>{
 const officialWifi={version:1 as const,purpose:'YRU_INFORMATION' as const,topic:'WIFI_ACCESS' as const,academicYear:null};
 const officialRegistration={...officialWifi,topic:'REGISTRATION' as const};
 it.each(['Wi-Fi กฎการใช้บริการเป็นอย่างไร','Wi-Fi กติกาการใช้บริการเป็นอย่างไร','Wi-Fi วิธีดูข้อปฏิบัติการใช้บริการ','Wi-Fi วิธีดูประกาศการใช้บริการ',
  'Wi-Fi ขั้นตอนเชื่อมต่ออย่างไร เริ่มใช้เมื่อใด','Wi-Fi ขั้นตอนเชื่อมต่ออย่างไร เริ่มใช้ตอนไหน','Wi-Fi ขั้นตอนเชื่อมต่ออย่างไร เริ่มใช้ช่วงไหน','Wi-Fi ขั้นตอนเชื่อมต่ออย่างไร เริ่มใช้ปีไหน',
  'Wi-Fi troubleshooting steps what date will access start','Wi-Fi troubleshooting steps what time will access start','Wi-Fi troubleshooting steps which day will access start'])('mixed policy/time information cannot open General: %s',text=>{
  expect(()=>validateGeneralWebPlan({version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null,quote:text},officialWifi,text)).toThrow('GENERAL_WEB_PLAN_INVALID');
 });
 it('accepts literal Wi-Fi troubleshooting only after the matching official topic',()=>{
  const question='Wi-Fi ต่อไม่ได้ ต้องทำอย่างไร';
  const input={version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null,quote:'Wi-Fi ต่อไม่ได้ ต้องทำอย่างไร'};
  expect(validateGeneralWebPlan(input,officialWifi,question)).toEqual({version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null});
  expect(Object.isFrozen(validateGeneralWebPlan(input,officialWifi,question))).toBe(true);
  expect(()=>validateGeneralWebPlan(input,officialRegistration,question)).toThrow('GENERAL_WEB_PLAN_INVALID');
 });
 it('accepts device-network help only when the actual Wi-Fi plan and question support it',()=>{
  const question='Wi-Fi บนอุปกรณ์เชื่อมต่อไม่ได้ ขอขั้นตอนแก้ไข';
  const input={version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_DEVICE_NETWORK',academicYear:null,quote:'Wi-Fi บนอุปกรณ์เชื่อมต่อไม่ได้ ขอขั้นตอนแก้ไข'};
  expect(validateGeneralWebPlan(input,officialWifi,question).topic).toBe('GENERAL_DEVICE_NETWORK');
  expect(()=>validateGeneralWebPlan(input,officialRegistration,question)).toThrow('GENERAL_WEB_PLAN_INVALID');
  expect(()=>validateGeneralWebPlan(input,officialWifi,'อินเทอร์เน็ตบนอุปกรณ์เชื่อมต่อไม่ได้ ขอขั้นตอนแก้ไข')).toThrow('GENERAL_WEB_PLAN_INVALID');
 });
 it('requires an explicit literal HTTP 500 failure under Registration',()=>{
  const question='ระบบลงทะเบียนขึ้น error 500 แก้ยังไง';
  const input={version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_HTTP_500',academicYear:null,quote:'ระบบลงทะเบียนขึ้น error 500 แก้ยังไง'};
  expect(validateGeneralWebPlan(input,officialRegistration,question).topic).toBe('GENERAL_HTTP_500');
  expect(()=>validateGeneralWebPlan(input,officialWifi,question)).toThrow('GENERAL_WEB_PLAN_INVALID');
  expect(()=>validateGeneralWebPlan({...input,quote:'ระบบลงทะเบียนขัดข้อง แก้ยังไง'},officialRegistration,question)).toThrow('GENERAL_WEB_PLAN_INVALID');
 });
 it('rejects absent or nonliteral quotes, exact-information asks and university policy requests',()=>{
  const question='Wi-Fi ต่อไม่ได้ ต้องทำอย่างไร';
  const input={version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null,quote:'Wi-Fi ต่อไม่ได้ ต้องทำอย่างไร'};
  for(const [candidate,text] of [[{...input,quote:'Wi-Fi'},question], [input,'Wi-Fi ต่อไม่ได้ วันไหน เจ้าหน้าที่แก้'] ] as const){
   expect(()=>validateGeneralWebPlan(candidate,officialWifi,text)).toThrow('GENERAL_WEB_PLAN_INVALID');
  }
  for(const text of ['Wi-Fi ขอขั้นตอนและระเบียบการใช้บริการ','ขอวิธีตั้งค่า Wi-Fi และวันเวลาที่เปิดให้บริการ'])
   expect(()=>validateGeneralWebPlan({...input,quote:text},officialWifi,text)).toThrow('GENERAL_WEB_PLAN_INVALID');
 });
 it('rejects exact Thai time/date requests even when mixed with troubleshooting steps',()=>{
  const exactAsks=[
   'Wi-Fi ขั้นตอนเชื่อมต่ออย่างไร ใช้ได้เมื่อไหร่',
   'Wi-Fi ต่อไม่ได้ ขอวิธีแก้ ใช้ได้เมื่อไร',
   'Wi-Fi ขั้นตอนเชื่อมต่ออย่างไร วันใด',
   'Wi-Fi ต่อไม่ได้ ขั้นตอนแก้ไขเวลาใด',
   'Wi-Fi ขั้นตอนเชื่อมต่ออย่างไร เวลาทำการ',
   'Wi-Fi ต่อไม่ได้ ขอวิธีดูข้อบังคับการใช้บริการ',
   'Wi-Fi ต่อไม่ได้ ขอขั้นตอนตามนโยบายมหาวิทยาลัย',
   'Wi-Fi ต่อไม่ได้ ขอวิธีแก้ตามประกาศหลักเกณฑ์',
   'Wi-Fi ต่อไม่ได้ ขอวิธีแก้ ต้องใช้เวลานานเท่าไร',
   'Wi-Fi troubleshooting steps how long does it take',
  ];
  for(const text of exactAsks){
   expect(requestsExactPublicInformation(text),`expected exact request: ${text}`).toBe(true);
   expect(()=>validateGeneralWebPlan({version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null,quote:text},officialWifi,text)).toThrow('GENERAL_WEB_PLAN_INVALID');
  }
  expect(requestsExactPublicInformation('Wi-Fi ต่อไม่ได้ ขอขั้นตอนแก้ไข')).toBe(false);
 });
 it('accepts bounded actual USER Support text joined with line-break and tab separators',()=>{
  const question='Wi-Fi ต่อไม่ได้\r\nลองตามขั้นตอนแล้ว\tช่วยแนะนำด้วย';
  expect(validateGeneralWebPlan({version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null,quote:'Wi-Fi ต่อไม่ได้'},officialWifi,question).topic).toBe('GENERAL_WIFI_HELP');
  const input={version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null,quote:'Wi-Fi ต่อไม่ได้'};
  for(const text of [`Wi-Fi ต่อไม่ได้${'ก'.repeat(4000)}`,'Wi-Fi ต่อไม่ได้\u0000','Wi-Fi ต่อไม่ได้\u200b'])
   expect(()=>validateGeneralWebPlan(input,officialWifi,text)).toThrow('GENERAL_WEB_PLAN_INVALID');
 });
 it('keeps general proposal shape strict and validates an optional extension without adding it to the YRU plan',()=>{
  const proposal={version:1,purpose:'YRU_INFORMATION',topic:'WIFI_ACCESS',academicYear:null,quote:'Wi-Fi'};
  const general={version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null,quote:'Wi-Fi ต่อไม่ได้ ต้องทำอย่างไร'};
  expect(generalWebPlanProposalSchema.safeParse({...general,query:'arbitrary'}).success).toBe(false);
  const result=validatePublicWebPlan({...proposal,general},{userText:'Wi-Fi ต่อไม่ได้ ต้องทำอย่างไร',scope:{...scope,historical:false,academicYear:null},query:{version:1,dataset:'university_services',filters:{name:'Wi-Fi'},limit:20}});
  expect(result).toEqual({version:1,purpose:'YRU_INFORMATION',topic:'WIFI_ACCESS',academicYear:null});
  expect(()=>validatePublicWebPlan({...proposal,general:{...general,topic:'UNREGISTERED'}},{userText:'Wi-Fi ต่อไม่ได้ ต้องทำอย่างไร',scope:{...scope,historical:false,academicYear:null},query:{version:1,dataset:'university_services',filters:{name:'Wi-Fi'},limit:20}})).toThrow('PUBLIC_WEB_PLAN_INVALID');
 });
});
