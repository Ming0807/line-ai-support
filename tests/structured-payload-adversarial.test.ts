import {expect,it} from 'vitest';
import {StructuredPayloadError,validateStructuredPayload} from '../lib/knowledge/structured-payload';

const payloads={
 academic_calendar_events:{academic_year:2569,semester:'1',student_type:'ภาคปกติ',event_type:'REGISTRATION',title:'ลงทะเบียน',start_date:'2026-10-07',end_date:null,description:null},
 tuition_fees:{academic_year:2569,program_name:'หลักสูตร A',major_name:null,student_group:'ALL',study_type:'ภาคปกติ',fee_amount:'1200.50',currency:'THB',effective_from:'2026-10-07',effective_to:null},
 transfer_courses:{source_program:'A',source_course_code:'00101',source_course_name:'วิชาเดิม',source_credits:'3.000',target_program:'B',target_course_code:'00102',target_course_name:'วิชาใหม่',target_credits:'3',conditions:null},
 university_services:{service_code:'LIBRARY',name:'ห้องสมุด',description:null,location:null,opening_hours:'จันทร์–ศุกร์ 08:00–16:00',phone:null,email:null,url:null},
 university_systems:{code:'YRU_PASSPORT',name:'บัญชีมหาวิทยาลัย',description:null,url:'https://passport.yru.ac.th/',support_url:null},
 service_forms:{name:'คำร้อง',description:null,form_url:'https://example.org/form?version=1',requirements:null},
 announcements:{title:'ประกาศ',summary:null,publish_at:'2026-10-07T01:00:00.000Z',effective_from:'2026-10-08T00:00:00.000Z',effective_to:null,priority:50},
} satisfies Record<string,Record<string,unknown>>;

const nullableFields={
 academic_calendar_events:['end_date','description'],
 tuition_fees:['major_name','effective_to'],
 transfer_courses:['conditions'],
 university_services:['description','location','opening_hours','phone','email','url'],
 university_systems:['description','support_url'],
 service_forms:['description','requirements'],
 announcements:['summary','effective_to'],
} satisfies Record<keyof typeof payloads,readonly string[]>;

function invalid(dataset:unknown,input:unknown):void{
 expect(()=>validateStructuredPayload(dataset,input)).toThrowError(/^STRUCTURED_PAYLOAD_INVALID$/u);
}

it('requires every source key as an own field while allowing explicit null only for declared nullable fields',()=>{
 for(const [dataset,payload] of Object.entries(payloads)){
  expect(validateStructuredPayload(dataset,payload)).toEqual(payload);
  const nullable=new Set(nullableFields[dataset as keyof typeof nullableFields]);
  for(const [field,value] of Object.entries(payload)){
   const withoutField=Object.fromEntries(Object.entries(payload).filter(([name])=>name!==field));
   invalid(dataset,withoutField);
   if(nullable.has(field)){
    expect(validateStructuredPayload(dataset,{...payload,[field]:null})).toEqual({...payload,[field]:null});
   }else{
    invalid(dataset,{...payload,[field]:null});
   }
   if(typeof value==='string'&&nullable.has(field)){
    invalid(dataset,{...payload,[field]:''});
    invalid(dataset,{...payload,[field]:'   '});
   }
  }
 }
});

it('rejects inherited required fields instead of accepting prototype values as source data',()=>{
 let getterReads=0;
 const inherited=Object.create({get academic_year(){getterReads++;return 2569;}}) as Record<string,unknown>;
 for(const [field,value] of Object.entries(payloads.academic_calendar_events))if(field!=='academic_year')inherited[field]=value;
 invalid('academic_calendar_events',inherited);
 expect(getterReads).toBe(0);
});

it('rejects hostile selectors before reading payload or attempting selector coercion',()=>{
 let payloadReads=0;let coercions=0;
 const input={get title(){payloadReads++;throw new Error('PRIVATE_SOURCE_GETTER');}};
 const selector={get [Symbol.toPrimitive](){coercions++;throw new Error('SELECTOR_COERCION');}};
 for(const dataset of [selector,new String('academic_calendar_events'),Symbol('academic_calendar_events'),null,{},'toString','constructor','__proto__']){
  expect(()=>validateStructuredPayload(dataset,input)).toThrowError(/^STRUCTURED_DATASET_UNSUPPORTED$/u);
 }
 expect(payloadReads).toBe(0);
 expect(coercions).toBe(0);
});

it('converts throwing getters and proxy traps into fixed errors without leaking source text',()=>{
 const secret='PRIVATE_ORIGINAL_CELL_97d22';
 const getterInput={...payloads.tuition_fees,get fee_amount(){throw new Error(secret);}};
 const proxyInput=new Proxy({...payloads.tuition_fees},{ownKeys(){throw new Error(secret);}});
 for(const input of [getterInput,proxyInput]){
  let caught:unknown;
  try{validateStructuredPayload('tuition_fees',input);}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(StructuredPayloadError);
  expect(caught).toMatchObject({name:'StructuredPayloadError',code:'STRUCTURED_PAYLOAD_INVALID',message:'STRUCTURED_PAYLOAD_INVALID'});
  expect(String(caught)).not.toContain(secret);
  expect(Object.keys(caught as object).sort()).toEqual(['code','name']);
 }
});

it('preserves canonical fee and credit decimal lexemes at their exact precision and bounds',()=>{
 for(const value of ['0','0.0','0.00','1','1.2','1.20','9999999999','9999999999.99']){
  expect(validateStructuredPayload('tuition_fees',{...payloads.tuition_fees,fee_amount:value}).fee_amount).toBe(value);
 }
 for(const value of ['0','0.0','0.00','0.000','1','1.2','1.23','1.234','999','999.999']){
  expect(validateStructuredPayload('transfer_courses',{...payloads.transfer_courses,source_credits:value}).source_credits).toBe(value);
 }
});

it('rejects numeric coercion, non-finite values, signed values, exponents and decimal overflow',()=>{
 let coercionCalls=0;
 const coercible={toString(){coercionCalls++;return '1.25';},valueOf(){coercionCalls++;return 1.25;}};
 const coercionAttacks=[Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY,1,1.25,new Number(1.25),coercible,'-0','-1','+1','1e2','01','00.00','1,000.00',' 1.00 ','NaN','Infinity','.5','1.'];
 const feeAttacks=[...coercionAttacks,'10000000000','10000000000.00','1.001'];
 const creditAttacks=[...coercionAttacks,'1000','1000.000','1.0001'];
 for(const value of feeAttacks){
  invalid('tuition_fees',{...payloads.tuition_fees,fee_amount:value});
 }
 for(const value of creditAttacks){
  invalid('transfer_courses',{...payloads.transfer_courses,target_credits:value});
 }
 expect(coercionCalls).toBe(0);
});

it('keeps academic years and priorities finite, integral and within their reviewed bounds',()=>{
 for(const year of [2400,3000])expect(validateStructuredPayload('academic_calendar_events',{...payloads.academic_calendar_events,academic_year:year}).academic_year).toBe(year);
 for(const year of [2399,3001,Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY,'2569',new Number(2569)])invalid('academic_calendar_events',{...payloads.academic_calendar_events,academic_year:year});
 for(const priority of [0,100])expect(validateStructuredPayload('announcements',{...payloads.announcements,priority}).priority).toBe(priority);
 for(const priority of [-1,101,Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY,'50',new Number(50)])invalid('announcements',{...payloads.announcements,priority});
});

it('checks Gregorian leap days and both civil-date boundaries without Buddhist-era inference',()=>{
 for(const date of ['1800-01-01','2000-02-29','2400-02-29','2400-12-31']){
  expect(validateStructuredPayload('academic_calendar_events',{...payloads.academic_calendar_events,start_date:date}).start_date).toBe(date);
 }
 for(const date of ['1799-12-31','1900-02-29','2100-02-29','2401-01-01','2569-10-07','2026-02-29']){
  invalid('academic_calendar_events',{...payloads.academic_calendar_events,start_date:date});
 }
});

it('accepts only canonical valid UTC timestamps and inclusive effective interval boundaries',()=>{
 for(const timestamp of ['1800-01-01T00:00:00.000Z','2000-02-29T23:59:59.999Z','2400-12-31T23:59:59.999Z']){
  const payload={...payloads.announcements,publish_at:timestamp,effective_from:timestamp,effective_to:timestamp};
  expect(validateStructuredPayload('announcements',payload)).toEqual(payload);
 }
 for(const timestamp of ['1799-12-31T23:59:59.999Z','2401-01-01T00:00:00.000Z','1900-02-29T00:00:00.000Z','2026-02-29T00:00:00.000Z','2026-10-07T24:00:00.000Z','2026-10-07T23:59:60.000Z','2026-10-07T00:00:00Z','2026-10-07T00:00:00.000z','2026-10-07T07:00:00.000+07:00','2026-10-07T00:00:00.000+00:00']){
  invalid('announcements',{...payloads.announcements,publish_at:timestamp});
 }
 invalid('announcements',{...payloads.announcements,effective_to:'2026-10-07T23:59:59.999Z'});
});

it('preserves source text and allows only tab, newline and carriage-return controls',()=>{
 const source='  ลงทะเบียน\t\r\nรอบพิเศษ  ';
 expect(validateStructuredPayload('academic_calendar_events',{...payloads.academic_calendar_events,title:source}).title).toBe(source);
 for(const control of ['\u0000','\u0008','\u000B','\u000C','\u000E','\u001F','\u007F']){
  invalid('university_services',{...payloads.university_services,opening_hours:`morning${control}evening`});
 }
 expect(validateStructuredPayload('university_services',{...payloads.university_services,opening_hours:'morning\tevening\r\nnext day'}).opening_hours).toBe('morning\tevening\r\nnext day');
});

it('enforces source text bounds in JavaScript UTF-16 code units',()=>{
 const exactBound='💡'.repeat(250);
 expect(exactBound.length).toBe(500);
 expect(validateStructuredPayload('academic_calendar_events',{...payloads.academic_calendar_events,title:exactBound}).title).toBe(exactBound);
 invalid('academic_calendar_events',{...payloads.academic_calendar_events,title:`${exactBound}a`});
});

it('rejects URL authority ambiguity while preserving valid HTTPS source lexemes',()=>{
 const preserved='HTTPS://Example.ORG/path/%2F?q=One&lang=th';
 expect(validateStructuredPayload('university_systems',{...payloads.university_systems,url:preserved}).url).toBe(preserved);
 const invalidUrls=[
  'http://example.org/','javascript:alert(1)','https://user@example.org/','https://user:secret@example.org/',
  'https://example.org:443/','https://example.org:00443/path','https://example.org:/path',
  'https://example.org/#section','https://example.org/#','https://example.org/path with space',
  'https://example.org/path\\tail','https:\\example.org\\path',
  'https://example.org/line\nbreak','https://example.org/tab\tbreak','https://example.org/nul\u0000byte',
 ];
 for(const url of invalidUrls)invalid('university_systems',{...payloads.university_systems,url});
 invalid('university_systems',{...payloads.university_systems,url:'https:///missing-authority'});
});

it('enforces the 2,000 UTF-16 code-unit URL bound without rewriting accepted URLs',()=>{
 const exactBound=`https://example.org/${'a'.repeat(1980)}`;
 expect(exactBound.length).toBe(2000);
 expect(validateStructuredPayload('service_forms',{...payloads.service_forms,form_url:exactBound}).form_url).toBe(exactBound);
 invalid('service_forms',{...payloads.service_forms,form_url:`${exactBound}a`});
});

it('rejects backend identity, lifecycle and provenance-shaped keys on every fixed dataset',()=>{
 const backendOwned=['id','document_id','department_id','created_at','updated_at','active','is_current','provenance','publication_id'];
 for(const [dataset,payload] of Object.entries(payloads)){
  for(const field of backendOwned)invalid(dataset,{...payload,[field]:'backend-owned'});
 }
 const withProtoKey=JSON.parse(JSON.stringify(payloads.academic_calendar_events)) as Record<string,unknown>;
 Object.defineProperty(withProtoKey,'__proto__',{value:{is_current:true},enumerable:true});
 invalid('academic_calendar_events',withProtoKey);
});
