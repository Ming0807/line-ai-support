import {expect,it} from 'vitest';
import {buildStructuredSelector} from '../lib/knowledge/structured-search';
const request=(dataset:string,filters:Record<string,unknown>)=>({version:1,dataset,filters,limit:20});
it('builds literal fee SQL and keeps labels and exact decimals in parameters',()=>{
 const marker="x' OR true --",result=buildStructuredSelector(request('tuition_fees',{academic_year:2569,program_name:marker,student_group:'ALL',study_type:'REGULAR',fee_amount_min:'0.10'}));
 expect(result.table).toBe('public.tuition_fees');expect(result.predicate).not.toContain(marker);expect(result.filters).toMatchObject({program_name:marker});expect(result.predicate).toContain('r.fee_amount >=');expect(result.predicate).toContain('::numeric');
});
it('uses fixed source selectors for all seven datasets',()=>{
 for(const [dataset,filters,column] of [['academic_calendar_events',{academic_year:2569,semester:'1',student_type:'ALL',occurs_on:'2026-10-08'},'r.start_date'],['transfer_courses',{source_program:'A',source_course_code:'001',target_program:'B'},'r.source_course_code'],['university_services',{name:'บริการ'},'r.name'],['university_systems',{code:'SSO'},'r.code'],['service_forms',{name:'คำร้อง'},'r.name'],['announcements',{title:'ประกาศ',effective_at:'2026-10-08T00:00:00.000Z'},'r.effective_from']] as const){const result=buildStructuredSelector(request(dataset,{...filters}));expect(result.table).toBe(`public.${dataset}`);expect(result.predicate).toContain(column);}
});
it('rejects unknown identifiers and SQL-shaped keys before building any statement',()=>{
 for(const value of [request('pg_authid',{}),request('university_services',{'name OR true':'x'}),{...request('university_services',{name:'บริการ'}),role:'SUPER_ADMIN'}])expect(()=>buildStructuredSelector(value)).toThrow('STRUCTURED_QUERY_INVALID');
});
