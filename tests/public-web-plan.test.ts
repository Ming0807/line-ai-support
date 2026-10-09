import {describe,it,expect} from 'vitest';
import {validatePublicWebPlan} from '../lib/knowledge/public-web-plan';
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
