import {expect,it} from 'vitest';
import {assessStructuredQuery,matchesStructuredPayload,StructuredQueryError,validateStructuredQuery} from '../lib/knowledge/structured-query';

const payloads={
 academic_calendar_events:{academic_year:2569,semester:'1',student_type:'ภาคปกติ',event_type:'REGISTRATION',title:'ลงทะเบียน 2569 💡',start_date:'2026-10-07',end_date:null,description:null},
 tuition_fees:{academic_year:2569,program_name:'หลักสูตร A',major_name:null,student_group:'ALL',study_type:'ภาคปกติ',fee_amount:'1200.50',currency:'THB',effective_from:'2026-10-07',effective_to:null},
 transfer_courses:{source_program:'หลักสูตร A',source_course_code:'00101',source_course_name:'วิชาเดิม',source_credits:'3.000',target_program:'หลักสูตร B',target_course_code:'00102',target_course_name:'วิชาใหม่',target_credits:'3',conditions:null},
 university_services:{service_code:'LIBRARY',name:'ห้องสมุด',description:null,location:null,opening_hours:'จันทร์–ศุกร์ 08:00–16:00',phone:null,email:null,url:null},
 university_systems:{code:'YRU_PASSPORT',name:'บัญชีมหาวิทยาลัย',description:null,url:'https://passport.yru.ac.th/',support_url:null},
 service_forms:{name:'คำร้อง',description:null,form_url:'https://example.org/form?version=1',requirements:null},
 announcements:{title:'ประกาศรับสมัคร',summary:null,publish_at:'2026-10-07T01:00:00.000Z',effective_from:'2026-10-08T00:00:00.000Z',effective_to:null,priority:50},
} as const;
type Dataset=keyof typeof payloads;
const query=(dataset:Dataset,filters:Record<string,unknown>={},limit=20)=>({version:1,dataset,filters,limit});
function expectQueryError(action:()=>unknown,code:'STRUCTURED_QUERY_INVALID'|'STRUCTURED_QUERY_LIMIT_EXCEEDED'|'STRUCTURED_QUERY_INCOMPLETE'){
 let error:unknown;try{action();}catch(caught){error=caught;}
 expect(error).toBeInstanceOf(StructuredQueryError);
 expect(error).toMatchObject({name:'StructuredQueryError',code,message:code});
 expect(String(error)).not.toMatch(/private|source|secret|DROP|credential/i);
 expect(Object.keys(error as object).sort()).toEqual(['code','name']);
}

it('accepts exact allowlisted filters for all seven datasets and rejects cross-dataset selectors',()=>{
 const examples:[Dataset,Record<string,unknown>,Record<string,unknown>][]=[
  ['academic_calendar_events',{academic_year:2569,semester:'1',student_type:'ภาคปกติ',event_type:'REGISTRATION',title:'ลงทะเบียน 2569 💡',occurs_on:'2026-10-07',start_date_from:'2026-10-01',start_date_to:'2026-10-31'},payloads.academic_calendar_events],
  ['tuition_fees',{academic_year:2569,program_name:'หลักสูตร A',major_name:null,student_group:'ALL',study_type:'ภาคปกติ',currency:'THB',fee_amount_min:'1200.50',fee_amount_max:'1200.50',effective_on:'2026-10-07'},payloads.tuition_fees],
  ['transfer_courses',{source_program:'หลักสูตร A',source_course_code:'00101',target_program:'หลักสูตร B',target_course_code:'00102',source_credits_min:'3',source_credits_max:'3.000',target_credits_min:'3',target_credits_max:'3.000'},payloads.transfer_courses],
  ['university_services',{service_code:'LIBRARY',name:'ห้องสมุด'},payloads.university_services],
  ['university_systems',{code:'YRU_PASSPORT',name:'บัญชีมหาวิทยาลัย'},payloads.university_systems],
  ['service_forms',{name:'คำร้อง',form_url:'https://example.org/form?version=1'},payloads.service_forms],
  ['announcements',{title:'ประกาศรับสมัคร',effective_at:'2026-10-08T00:00:00.000Z',priority_min:50,priority_max:50},payloads.announcements],
 ];
 for(const [dataset,filters,payload] of examples){
  const validated=validateStructuredQuery(query(dataset,filters));
  expect(validated).toMatchObject({dataset});
  expect(assessStructuredQuery(validated)).toEqual({status:'READY'});
  expect(matchesStructuredPayload(validated,payload)).toBe(true);
 }
 expectQueryError(()=>validateStructuredQuery(query('academic_calendar_events',{service_code:'LIBRARY'})),'STRUCTURED_QUERY_INVALID');
 expectQueryError(()=>validateStructuredQuery(query('university_systems',{academic_year:2569})),'STRUCTURED_QUERY_INVALID');
});

it('requires an explicit complete selector context before matching and never supplies defaults',()=>{
 const incomplete=query('academic_calendar_events',{title:'ลงทะเบียน'});
 expect(assessStructuredQuery(incomplete)).toEqual({status:'CLARIFICATION_REQUIRED',missing:['academic_year','semester','student_type']});
 expectQueryError(()=>matchesStructuredPayload(incomplete,payloads.academic_calendar_events),'STRUCTURED_QUERY_INCOMPLETE');
 const missingProgram=query('tuition_fees',{academic_year:2569,student_group:'ALL',study_type:'ภาคปกติ'});
 expect(assessStructuredQuery(missingProgram)).toEqual({status:'CLARIFICATION_REQUIRED',missing:['program_name']});
 expect(assessStructuredQuery(query('transfer_courses',{source_program:'A',source_course_code:'00101'}))).toEqual({status:'CLARIFICATION_REQUIRED',missing:['target_program']});
 expect(assessStructuredQuery(query('university_services',{}))).toEqual({status:'CLARIFICATION_REQUIRED',missing:['service_code|name|location']});
 expect(assessStructuredQuery(query('university_systems',{}))).toEqual({status:'CLARIFICATION_REQUIRED',missing:['code|name']});
 expect(assessStructuredQuery(query('service_forms',{}))).toEqual({status:'CLARIFICATION_REQUIRED',missing:['name|form_url']});
 expect(assessStructuredQuery(query('announcements',{}))).toEqual({status:'CLARIFICATION_REQUIRED',missing:['title|effective_at']});
});

it('enforces the exact root grammar, required keys, canonical types, and bounded limit',()=>{
 const valid=query('university_services',{service_code:'LIBRARY'},1);
 expect(validateStructuredQuery(valid).limit).toBe(1);
 expect(validateStructuredQuery({...valid,limit:20}).limit).toBe(20);
 for(const bad of [
  {...valid,version:'1'}, {...valid,version:2}, {...valid,limit:0}, {...valid,limit:21}, {...valid,limit:1.5},
  {...valid,limit:'2'}, {...valid,dataset:'constructor'}, {...valid,filters:undefined},
  {dataset:'university_services',filters:{service_code:'LIBRARY'},limit:1},
  {...valid,extra:'ignored'}, {...valid,sql:'SELECT 1'},
 ])expectQueryError(()=>validateStructuredQuery(bad),'STRUCTURED_QUERY_INVALID');
 expectQueryError(()=>validateStructuredQuery(query('university_services',{service_code:'LIBRARY'},21)),'STRUCTURED_QUERY_INVALID');
});

it('preserves literal Thai, whitespace, exact codes and null major equality without coercion',()=>{
 const textQuery=validateStructuredQuery(query('academic_calendar_events',{academic_year:2569,semester:'1',student_type:'ภาคปกติ',title:' ลงทะเบียน 💡 '}));
 expect(textQuery).toMatchObject({filters:{title:' ลงทะเบียน 💡 '}});
 expect(matchesStructuredPayload(textQuery,payloads.academic_calendar_events)).toBe(false);
 const nullMajor=query('tuition_fees',{academic_year:2569,program_name:'หลักสูตร A',major_name:null,student_group:'ALL',study_type:'ภาคปกติ'});
 expect(matchesStructuredPayload(nullMajor,payloads.tuition_fees)).toBe(true);
 expect(matchesStructuredPayload({...nullMajor,filters:{...nullMajor.filters,major_name:'สาขา A'}},payloads.tuition_fees)).toBe(false);
 expect(matchesStructuredPayload(query('transfer_courses',{source_program:'หลักสูตร A',source_course_code:'00101',target_program:'หลักสูตร B'}),payloads.transfer_courses)).toBe(true);
 expect(matchesStructuredPayload(query('transfer_courses',{source_program:'หลักสูตร A',source_course_code:'101',target_program:'หลักสูตร B'}),payloads.transfer_courses)).toBe(false);
 expect(validateStructuredQuery(query('academic_calendar_events',{academic_year:2569}))).toMatchObject({filters:{academic_year:2569}});
 for(const bad of [true,'2569',{},null])expectQueryError(()=>validateStructuredQuery(query('academic_calendar_events',{academic_year:bad})),'STRUCTURED_QUERY_INVALID');
 expectQueryError(()=>validateStructuredQuery(query('tuition_fees',{academic_year:2569,program_name:'หลักสูตร A',major_name:undefined})),'STRUCTURED_QUERY_INVALID');
 expectQueryError(()=>validateStructuredQuery(query('university_services',{service_code:null})),'STRUCTURED_QUERY_INVALID');
});

it('compares scaled decimal strings exactly, inclusively, and rejects reversed ranges',()=>{
 const exact=query('tuition_fees',{academic_year:2569,program_name:'หลักสูตร A',student_group:'ALL',study_type:'ภาคปกติ',fee_amount_min:'1200.50',fee_amount_max:'1200.50'});
 expect(matchesStructuredPayload(exact,payloads.tuition_fees)).toBe(true);
 expect(matchesStructuredPayload(query('tuition_fees',{academic_year:2569,program_name:'หลักสูตร A',student_group:'ALL',study_type:'ภาคปกติ',fee_amount_min:'1200.51'}),payloads.tuition_fees)).toBe(false);
 expect(matchesStructuredPayload(query('transfer_courses',{source_program:'หลักสูตร A',source_course_code:'00101',target_program:'หลักสูตร B',source_credits_min:'3.000',source_credits_max:'3.000'}),payloads.transfer_courses)).toBe(true);
 for(const [min,max] of [['1201','1200'],['01','2'],['1e2','200'],['1.001','2']] as [string,string][]){
  expectQueryError(()=>validateStructuredQuery(query('tuition_fees',{fee_amount_min:min,fee_amount_max:max})),'STRUCTURED_QUERY_INVALID');
 }
 expectQueryError(()=>validateStructuredQuery(query('announcements',{priority_min:60,priority_max:50})),'STRUCTURED_QUERY_INVALID');
});

it('uses inclusive dates and UTC instants with the specified null interval meanings',()=>{
 const calendar=query('academic_calendar_events',{academic_year:2569,semester:'1',student_type:'ภาคปกติ',occurs_on:'2026-10-07'});
 expect(matchesStructuredPayload(calendar,payloads.academic_calendar_events)).toBe(true);
 expect(matchesStructuredPayload({...calendar,filters:{...calendar.filters,occurs_on:'2026-10-08'}},payloads.academic_calendar_events)).toBe(false);
 const fee=query('tuition_fees',{academic_year:2569,program_name:'หลักสูตร A',student_group:'ALL',study_type:'ภาคปกติ',effective_on:'2026-10-07'});
 expect(matchesStructuredPayload(fee,payloads.tuition_fees)).toBe(true);
 expect(matchesStructuredPayload({...fee,filters:{...fee.filters,effective_on:'2026-10-06'}},payloads.tuition_fees)).toBe(false);
 const announcement=query('announcements',{title:'ประกาศรับสมัคร',effective_at:'2026-10-08T00:00:00.000Z'});
 expect(matchesStructuredPayload(announcement,payloads.announcements)).toBe(true);
 expect(matchesStructuredPayload({...announcement,filters:{...announcement.filters,effective_at:'2026-10-07T23:59:59.999Z'}},payloads.announcements)).toBe(false);
 expect(validateStructuredQuery(query('announcements',{effective_at:'2026-10-07T00:00:00.000Z'}))).toMatchObject({filters:{effective_at:'2026-10-07T00:00:00.000Z'}});
 expectQueryError(()=>validateStructuredQuery(query('academic_calendar_events',{academic_year:2569,semester:'1',student_type:'ภาคปกติ',occurs_on:'2026-02-30'})),'STRUCTURED_QUERY_INVALID');
});

it('returns detached frozen snapshots and does not observe later caller mutation',()=>{
 const filters={service_code:'LIBRARY'};const input=query('university_services',filters);
 const validated=validateStructuredQuery(input);
 expect(Object.isFrozen(validated)).toBe(true);expect(Object.isFrozen(validated.filters)).toBe(true);
 expect(validated).not.toBe(input);expect(validated.filters).not.toBe(filters);
 filters.service_code='CHANGED';input.limit=1;
 expect(validated).toMatchObject({filters:{service_code:'LIBRARY'},limit:20});
 expect(matchesStructuredPayload(validated,payloads.university_services)).toBe(true);
});

it('rejects accessors, proxies and hostile object shapes without exposing values or running getters',()=>{
 let getterReads=0,trapReads=0;
 const root={...query('university_services',{service_code:'LIBRARY'}),get limit(){getterReads++;throw new Error('PRIVATE_SOURCE');}};
 const nested=query('university_services',{service_code:'LIBRARY'});Object.defineProperty(nested.filters,'service_code',{get(){getterReads++;throw new Error('PRIVATE_SOURCE');},enumerable:true});
 const proxied=new Proxy(query('university_services',{service_code:'LIBRARY'}),{ownKeys(){trapReads++;throw new Error('PRIVATE_SOURCE');}});
 const inherited=Object.assign(Object.create({private:'inherited'}),query('university_services',{service_code:'LIBRARY'}));
 const hidden=query('university_services',{service_code:'LIBRARY'});Object.defineProperty(hidden.filters,'hidden',{value:'PRIVATE_SOURCE',enumerable:false});
 const symbolic=query('university_services',{service_code:'LIBRARY'});Object.defineProperty(symbolic.filters,Symbol('private'),{value:'PRIVATE_SOURCE'});
 for(const input of [root,nested,proxied,inherited,hidden,symbolic])expectQueryError(()=>validateStructuredQuery(input),'STRUCTURED_QUERY_INVALID');
 expect(getterReads).toBe(0);expect(trapReads).toBe(0);
});

it('rejects non-JSON values and enforces byte/node limits before interpreting selectors',()=>{
 const nonJson=[
  query('university_services',{service_code:undefined}),query('university_services',{service_code:()=> 'LIBRARY'}),
  query('university_services',{service_code:BigInt(1)}),query('university_services',{service_code:NaN}),
  query('university_services',{service_code:new Date('2026-10-07T00:00:00.000Z')}),
  query('university_services',{service_code:new Number(1)}),
 ];
 for(const input of nonJson)expectQueryError(()=>validateStructuredQuery(input),'STRUCTURED_QUERY_INVALID');
 expectQueryError(()=>validateStructuredQuery(query('university_services',{service_code:'💡'.repeat(9000)})),'STRUCTURED_QUERY_LIMIT_EXCEEDED');
 const manyNodes=query('university_services',Object.fromEntries(Array.from({length:260},(_,index)=>[`unknown_${index}`,index])));
 expectQueryError(()=>validateStructuredQuery(manyNodes),'STRUCTURED_QUERY_LIMIT_EXCEEDED');
});

it('rejects malformed UTF-16, Cc controls, invalid dates/timestamps and decimal coercion',()=>{
 for(const value of ['\uD800','\uDFFF','a\uD800b','x\u0000y','x\u001fy','x\u007fy','x\u0085y','x\u009fy']){
  expectQueryError(()=>validateStructuredQuery(query('university_services',{name:value})),'STRUCTURED_QUERY_INVALID');
 }
 for(const date of ['2026-02-30','2569-10-07','2026-10-07T00:00:00Z'])expectQueryError(()=>validateStructuredQuery(query('academic_calendar_events',{academic_year:2569,semester:'1',student_type:'ภาคปกติ',occurs_on:date})),'STRUCTURED_QUERY_INVALID');
 for(const timestamp of ['2026-10-07T00:00:00.000+07:00','2026-10-07T00:00:00Z','2026-02-30T00:00:00.000Z'])expectQueryError(()=>validateStructuredQuery(query('announcements',{effective_at:timestamp})),'STRUCTURED_QUERY_INVALID');
 expectQueryError(()=>validateStructuredQuery(query('tuition_fees',{fee_amount_min:1200.5,fee_amount_max:'2000'})),'STRUCTURED_QUERY_INVALID');
});
