import {expect,it} from 'vitest';
import {STRUCTURED_DATASETS,STRUCTURED_REGISTRY_VERSION,StructuredPayloadError,validateStructuredPayload} from '../lib/knowledge/structured-payload';

const calendar={academic_year:2569,semester:'1',student_type:'ภาคปกติ',event_type:'REGISTRATION',title:'ลงทะเบียน',start_date:'2026-10-07',end_date:null,description:null};
const fee={academic_year:2569,program_name:'หลักสูตร A',major_name:null,student_group:'ALL',study_type:'ภาคปกติ',fee_amount:'1200.50',currency:'THB',effective_from:'2026-10-07',effective_to:null};
const course={source_program:'A',source_course_code:'00101',source_course_name:'วิชาเดิม',source_credits:'3.000',target_program:'B',target_course_code:'00102',target_course_name:'วิชาใหม่',target_credits:'3',conditions:null};
const service={service_code:'LIBRARY',name:'ห้องสมุด',description:null,location:null,opening_hours:'จันทร์–ศุกร์ 08:00–16:00',phone:null,email:null,url:null};
const system={code:'YRU_PASSPORT',name:'บัญชีมหาวิทยาลัย',description:null,url:'https://passport.yru.ac.th/',support_url:null};
const form={name:'คำร้อง',description:null,form_url:'https://example.org/form?version=1',requirements:null};
const announcement={title:'ประกาศ',summary:null,publish_at:'2026-10-07T01:00:00.000Z',effective_from:'2026-10-08T00:00:00.000Z',effective_to:null,priority:50};

it('defines exactly the seven specified datasets with explicit contract version',()=>{
 expect(STRUCTURED_REGISTRY_VERSION).toBe('structured-v1');
 expect(STRUCTURED_DATASETS).toEqual(['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements']);
});
it('validates all seven source payloads without adding backend or inferred values',()=>{
 expect(validateStructuredPayload('academic_calendar_events',calendar)).toEqual(calendar);
 expect(validateStructuredPayload('tuition_fees',fee)).toEqual(fee);
 expect(validateStructuredPayload('transfer_courses',course)).toEqual(course);
 expect(validateStructuredPayload('university_services',service)).toEqual(service);
 expect(validateStructuredPayload('university_systems',system)).toEqual(system);
 expect(validateStructuredPayload('service_forms',form)).toEqual(form);
 expect(validateStructuredPayload('announcements',announcement)).toEqual(announcement);
});
it('preserves exact course codes, meaningful whitespace and decimal scale in a detached result',()=>{
 const input={...course,source_course_code:' 00101 ',source_credits:'0.000',target_credits:'999.999'};
 const parsed=validateStructuredPayload('transfer_courses',input);
 expect(parsed).toEqual(input);expect(parsed).not.toBe(input);parsed.source_course_code='changed';expect(input.source_course_code).toBe(' 00101 ');
 expect(validateStructuredPayload('tuition_fees',{...fee,fee_amount:'9999999999.99'}).fee_amount).toBe('9999999999.99');
});
it('rejects JS numbers, excess scale and noncanonical decimal lexemes without rounding',()=>{
 for(const value of [0,1.2,'1.001','10000000000','-1','+1','1e2','01','00.00','1,000.00',' 1.00 ','NaN','Infinity','.5','1.']){
  expect(()=>validateStructuredPayload('tuition_fees',{...fee,fee_amount:value})).toThrowError(/^STRUCTURED_PAYLOAD_INVALID$/);
 }
 expect(()=>validateStructuredPayload('transfer_courses',{...course,source_credits:'3.0001'})).toThrow(StructuredPayloadError);
});
it('requires all nullable keys and rejects backend identities, lifecycle and unknown fields',()=>{
 const {description:omitted,...missing}=calendar;void omitted;
 expect(()=>validateStructuredPayload('academic_calendar_events',missing)).toThrowError(/^STRUCTURED_PAYLOAD_INVALID$/);
 for(const name of ['id','document_id','department_id','is_current','active','created_at','updated_at','dataset_code','payload_digest']){
  expect(()=>validateStructuredPayload('academic_calendar_events',{...calendar,[name]:'private'})).toThrowError(/^STRUCTURED_PAYLOAD_INVALID$/);
 }
 expect(()=>validateStructuredPayload('academic_calendar_events',{...calendar,description:''})).toThrow(StructuredPayloadError);
 expect(()=>validateStructuredPayload('academic_calendar_events',{...calendar,title:'\u0000private'})).toThrow(StructuredPayloadError);
});
it('rejects invalid civil dates, inferred years and reversed validity intervals',()=>{
 for(const date of ['2026-02-29','2026-13-01','2569-10-07','1799-12-31','2026-10-07T00:00:00Z'])expect(()=>validateStructuredPayload('academic_calendar_events',{...calendar,start_date:date})).toThrow(StructuredPayloadError);
 expect(validateStructuredPayload('academic_calendar_events',{...calendar,start_date:'2024-02-29',end_date:'2024-02-29'}).start_date).toBe('2024-02-29');
 expect(()=>validateStructuredPayload('tuition_fees',{...fee,effective_to:'2026-10-06'})).toThrow(StructuredPayloadError);
 expect(()=>validateStructuredPayload('academic_calendar_events',{...calendar,academic_year:'2569'})).toThrow(StructuredPayloadError);
});
it('uses explicit valid UTC timestamps and reviewed priority without assuming publication equals effect',()=>{
 const earlierEffect={...announcement,effective_from:'2026-10-06T00:00:00.000Z'};
 expect(validateStructuredPayload('announcements',earlierEffect)).toEqual(earlierEffect);
 for(const value of ['2026-10-07','2026-10-07T00:00:00Z','2026-10-07T24:00:00.000Z','2026-02-29T00:00:00.000Z','2026-10-07T07:00:00.000+07:00'])expect(()=>validateStructuredPayload('announcements',{...announcement,publish_at:value})).toThrow(StructuredPayloadError);
 expect(()=>validateStructuredPayload('announcements',{...announcement,priority:101})).toThrow(StructuredPayloadError);
});
it('retains inert HTTPS references and plain source opening hours rather than executing or inventing structures',()=>{
 expect(validateStructuredPayload('service_forms',form).form_url).toBe(form.form_url);
 expect(()=>validateStructuredPayload('university_services',{...service,opening_hours:{monday:'08:00'}})).toThrow(StructuredPayloadError);
 for(const url of ['javascript:alert(1)','http://example.org','https://name:secret@example.org','https://example.org:443/a','https://example.org/a#','https://example.org/a b','https:\\example.org'])expect(()=>validateStructuredPayload('university_systems',{...system,url})).toThrow(StructuredPayloadError);
});
it('rejects unsupported datasets before reading source properties and never exposes private invalid values',()=>{
 const input={get confidential(){throw new Error('PRIVATE_GETTER_WAS_READ');}};
 for(const dataset of ['unknown','__proto__','constructor','tuition_fees; drop table documents'])expect(()=>validateStructuredPayload(dataset,input)).toThrowError(/^STRUCTURED_DATASET_UNSUPPORTED$/);
 let error:unknown;try{validateStructuredPayload('tuition_fees',{...fee,fee_amount:'private original text'});}catch(caught){error=caught;}
 expect(error).toBeInstanceOf(StructuredPayloadError);expect(String(error)).not.toContain('private original text');expect(Object.keys(error??{}).sort()).toEqual(['code','name']);
});
it('accepts explicit own data on null prototypes and rejects hidden/symbol extras or accessors without invoking them',()=>{
 const nullPrototype=Object.assign(Object.create(null),calendar);
 expect(validateStructuredPayload('academic_calendar_events',nullPrototype)).toEqual(calendar);
 const hidden={...calendar};Object.defineProperty(hidden,'document_id',{value:'private',enumerable:false});
 expect(()=>validateStructuredPayload('academic_calendar_events',hidden)).toThrow(StructuredPayloadError);
 const symbolic={...calendar,[Symbol('private')]:true};
 expect(()=>validateStructuredPayload('academic_calendar_events',symbolic)).toThrow(StructuredPayloadError);
 let reads=0;const accessor={...calendar,get title(){reads++;return 'source';}};
 expect(()=>validateStructuredPayload('academic_calendar_events',accessor)).toThrow(StructuredPayloadError);expect(reads).toBe(0);
});
it('requires complete decimal and currency lexemes rather than a prefix before a final line break',()=>{
 for(const ending of ['\n','\r','\r\n','\u2028','\u2029']){
  expect(()=>validateStructuredPayload('tuition_fees',{...fee,fee_amount:`1.20${ending}`})).toThrow(StructuredPayloadError);
  expect(()=>validateStructuredPayload('transfer_courses',{...course,source_credits:`3.000${ending}`})).toThrow(StructuredPayloadError);
  expect(()=>validateStructuredPayload('tuition_fees',{...fee,currency:`THB${ending}`})).toThrow(StructuredPayloadError);
 }
});
it('rejects unpaired UTF-16 surrogates rather than losing source lexemes during UTF-8 persistence',()=>{
 for(const value of ['\uD800','\uDFFF','a\uD800b','\uDFFF\uD800']){
  expect(()=>validateStructuredPayload('academic_calendar_events',{...calendar,title:value})).toThrow(StructuredPayloadError);
  expect(()=>validateStructuredPayload('transfer_courses',{...course,source_course_code:value})).toThrow(StructuredPayloadError);
  expect(()=>validateStructuredPayload('university_services',{...service,description:value})).toThrow(StructuredPayloadError);
 }
 const wellFormed='รหัส 001 💡';
 expect(validateStructuredPayload('academic_calendar_events',{...calendar,title:wellFormed}).title).toBe(wellFormed);
});
