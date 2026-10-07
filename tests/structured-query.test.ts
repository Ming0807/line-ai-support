import {expect,it} from 'vitest';
import {validateStructuredQuery,assessStructuredQuery,matchesStructuredPayload} from '../lib/knowledge/structured-query';

const query=(dataset:string,filters:Record<string,unknown>)=>({version:1,dataset,filters,limit:20});
const calendar={academic_year:2569,semester:'1',student_type:'ภาคปกติ',event_type:'REGISTRATION',title:'ลงทะเบียน',start_date:'2026-10-07',end_date:null,description:null};
const fee={academic_year:2569,program_name:'หลักสูตร A',major_name:null,student_group:'ALL',study_type:'ภาคปกติ',fee_amount:'9999999999.99',currency:'THB',effective_from:'2026-10-07',effective_to:null};
const course={source_program:'A',source_course_code:'00101',source_course_name:'วิชาเดิม',source_credits:'3.000',target_program:'B',target_course_code:'00102',target_course_name:'วิชาใหม่',target_credits:'3',conditions:null};
const feeFilters={academic_year:2569,program_name:'หลักสูตร A',student_group:'ALL',study_type:'ภาคปกติ'};
const calendarFilters={academic_year:2569,semester:'1',student_type:'ภาคปกติ'};
const courseFilters={source_program:'A',source_course_code:'00101',target_program:'B'};
const fixtures=[
 ['academic_calendar_events',calendarFilters,calendar],
 ['tuition_fees',feeFilters,fee],
 ['transfer_courses',courseFilters,course],
 ['university_services',{service_code:'LIBRARY'},{service_code:'LIBRARY',name:'ห้องสมุด',description:null,location:null,opening_hours:null,phone:null,email:null,url:null}],
 ['university_systems',{code:'YRU_PASSPORT'},{code:'YRU_PASSPORT',name:'บัญชี',description:null,url:'https://passport.yru.ac.th/',support_url:null}],
 ['service_forms',{name:'คำร้อง'},{name:'คำร้อง',description:null,form_url:'https://www.yru.ac.th/form',requirements:null}],
 ['announcements',{title:'ประกาศ'},{title:'ประกาศ',summary:null,publish_at:'2026-10-07T00:00:00.000Z',effective_from:'2026-10-08T00:00:00.000Z',effective_to:null,priority:50}],
] as const;
it.each(fixtures)('matches exact source fields for %s',(dataset,filters,payload)=>{
 const request=query(dataset,{...filters});expect(validateStructuredQuery(request)).toEqual(request);expect(assessStructuredQuery(request)).toEqual({status:'READY'});expect(matchesStructuredPayload(request,payload)).toBe(true);
});
it('requires explicit context instead of guessing year/program/group/study type',()=>{
 expect(assessStructuredQuery(query('tuition_fees',{}))).toEqual({status:'CLARIFICATION_REQUIRED',missing:['academic_year','program_name','student_group','study_type']});
 expect(assessStructuredQuery(query('academic_calendar_events',{academic_year:2569}))).toEqual({status:'CLARIFICATION_REQUIRED',missing:['semester','student_type']});
 for(const dataset of ['university_services','university_systems','service_forms','announcements'])expect(assessStructuredQuery(query(dataset,{})).status).toBe('CLARIFICATION_REQUIRED');
 expect(()=>matchesStructuredPayload(query('tuition_fees',{}),fee)).toThrow(/^STRUCTURED_QUERY_INCOMPLETE$/);
});
it('uses exact money intervals without floating rounding at the maximum supported fee',()=>{
 expect(matchesStructuredPayload(query('tuition_fees',{...feeFilters,fee_amount_min:'9999999999.99',fee_amount_max:'9999999999.99'}),fee)).toBe(true);
 expect(matchesStructuredPayload(query('tuition_fees',{...feeFilters,fee_amount_max:'9999999999.98'}),fee)).toBe(false);
 expect(matchesStructuredPayload(query('tuition_fees',{...feeFilters,fee_amount_min:'0.10',fee_amount_max:'0.1'}),{...fee,fee_amount:'0.10'})).toBe(true);
 expect(()=>validateStructuredQuery(query('tuition_fees',{...feeFilters,fee_amount_min:'1.01',fee_amount_max:'1'}))).toThrow(/^STRUCTURED_QUERY_INVALID$/);
});
it('compares credits by numeric value while preserving codes and payload lexemes',()=>{
 const payload={...course};expect(matchesStructuredPayload(query('transfer_courses',{...courseFilters,source_credits_min:'3',source_credits_max:'3.000',target_credits_min:'3.000'}),payload)).toBe(true);
 expect(payload.source_credits).toBe('3.000');expect(matchesStructuredPayload(query('transfer_courses',{...courseFilters,source_course_code:'101'}),payload)).toBe(false);
 expect(matchesStructuredPayload(query('transfer_courses',{...courseFilters,source_credits_min:'3.001'}),payload)).toBe(false);
});
it('treats null major as exact null rather than absent or all majors',()=>{
 const request=query('tuition_fees',{...feeFilters,major_name:null});expect(matchesStructuredPayload(request,fee)).toBe(true);expect(matchesStructuredPayload(request,{...fee,major_name:'A'})).toBe(false);
 expect(matchesStructuredPayload(query('tuition_fees',feeFilters),{...fee,major_name:'A'})).toBe(true);
});
it('checks calendar occurrence inclusive ends and single-day null ends',()=>{
 expect(matchesStructuredPayload(query('academic_calendar_events',{...calendarFilters,occurs_on:'2026-10-07'}),calendar)).toBe(true);
 expect(matchesStructuredPayload(query('academic_calendar_events',{...calendarFilters,occurs_on:'2026-10-08'}),calendar)).toBe(false);
 expect(matchesStructuredPayload(query('academic_calendar_events',{...calendarFilters,occurs_on:'2026-10-09'}),{...calendar,end_date:'2026-10-09'})).toBe(true);
 expect(matchesStructuredPayload(query('academic_calendar_events',{...calendarFilters,start_date_from:'2026-10-08'}),calendar)).toBe(false);
 expect(()=>validateStructuredQuery(query('academic_calendar_events',{...calendarFilters,start_date_from:'2026-10-08',start_date_to:'2026-10-07'}))).toThrow(/^STRUCTURED_QUERY_INVALID$/);
});
it('checks explicit fee and announcement intervals without consulting the host clock',()=>{
 expect(matchesStructuredPayload(query('tuition_fees',{...feeFilters,effective_on:'2026-10-06'}),fee)).toBe(false);
 expect(matchesStructuredPayload(query('tuition_fees',{...feeFilters,effective_on:'2026-10-07'}),{...fee,effective_to:'2026-10-07'})).toBe(true);
 expect(matchesStructuredPayload(query('tuition_fees',{...feeFilters,effective_on:'2026-10-08'}),{...fee,effective_to:'2026-10-07'})).toBe(false);
 const announcement=fixtures[6][2];expect(matchesStructuredPayload(query('announcements',{effective_at:'2026-10-07T23:59:59.999Z'}),announcement)).toBe(false);
 expect(matchesStructuredPayload(query('announcements',{effective_at:'2026-10-08T00:00:00.000Z',priority_min:50,priority_max:50}),announcement)).toBe(true);
 expect(matchesStructuredPayload(query('announcements',{title:'ประกาศ',priority_min:51}),announcement)).toBe(false);
});
it('rejects invalid payloads rather than treating corrupted data as a nonmatching row',()=>{
 expect(()=>matchesStructuredPayload(query('tuition_fees',feeFilters),{...fee,fee_amount:1.2})).toThrow(/^STRUCTURED_QUERY_INVALID$/);
 expect(()=>matchesStructuredPayload(query('tuition_fees',feeFilters),{...fee,document_id:'forged'})).toThrow(/^STRUCTURED_QUERY_INVALID$/);
});
it('applies the query control-character boundary to URL selectors too',()=>{
 for(const control of ['\u0085','\u009f'])expect(()=>validateStructuredQuery(query('service_forms',{form_url:'https://example.org/form'+control}))).toThrow(/^STRUCTURED_QUERY_INVALID$/);
});
it('does not run payload getters or proxy traps when matching a valid query',()=>{
 let calls=0;const proxied=new Proxy(fee,{ownKeys(){calls++;throw new Error('PRIVATE_SOURCE');}}),accessor=Object.defineProperty({...fee},'program_name',{enumerable:true,get(){calls++;throw new Error('PRIVATE_SOURCE');}});
 for(const input of [proxied,accessor])expect(()=>matchesStructuredPayload(query('tuition_fees',feeFilters),input)).toThrow(/^STRUCTURED_QUERY_INVALID$/);expect(calls).toBe(0);
});
