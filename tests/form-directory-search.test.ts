import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {discoverPublicForms,discoverPublicStructured,searchStructured} from '../lib/knowledge/structured-search';
const scope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
it('retains exact Query1 minimum selectors while providing a separately bounded directory',async()=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{ambiguous:false,incomplete:false,rows:[]} ]});
 const client={query} as unknown as PoolClient;
 expect(await searchStructured(client,{scope,query:{version:1,dataset:'service_forms',filters:{},limit:20}},'fixture')).toMatchObject({status:'CLARIFICATION_REQUIRED'});
 expect(query).not.toHaveBeenCalled();
 expect(await discoverPublicForms(client,{scope},'fixture')).toEqual({status:'EMPTY'});
 const statement=query.mock.calls[2][0];expect(statement.values[18]).toBe('service_forms');expect(statement.values[19]).toBe(21);
 expect(statement.text).toContain('private.structured_row_provenance');expect(statement.text).toContain('private.knowledge_import_publications');
});
it('does not truncate a directory exceeding twenty matching rows',async()=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{ambiguous:false,incomplete:false,rows:Array.from({length:21},()=>({}))}]});
 expect(await discoverPublicForms({query} as unknown as PoolClient,{scope},'fixture')).toEqual({status:'CONTEXT_INCOMPLETE'});
});
it('keeps exact calendar minimum selectors and binds an explicitly grounded discovery year',async()=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{ambiguous:false,incomplete:false,rows:[]} ]});
 const client={query} as unknown as PoolClient;
 expect(await searchStructured(client,{scope,query:{version:1,dataset:'academic_calendar_events',filters:{academic_year:2569},limit:20}},'fixture')).toMatchObject({status:'CLARIFICATION_REQUIRED',missing:['semester','student_type']});
 expect(query).not.toHaveBeenCalled();
 expect(await discoverPublicStructured(client,{scope:{...scope,historical:true,academicYear:2569},dataset:'academic_calendar_events'},'fixture')).toEqual({status:'EMPTY'});
 const statement=query.mock.calls[2][0];expect(statement.values[18]).toBe('academic_calendar_events');expect(statement.values[19]).toBe(21);
 expect(JSON.parse(statement.values[17])).toEqual({academic_year:2569});
 expect(statement.text).toContain('private.structured_row_provenance');expect(statement.text).toContain('private.knowledge_import_publications');
});
it('rejects unrestricted discovery datasets and arbitrary filters before SQL',async()=>{
 const query=vi.fn(),client={query} as unknown as PoolClient;
 for(const input of [{dataset:'tuition_fees',scope},{dataset:'service_forms',scope,filters:{name:'invented'}}])
  await expect(discoverPublicStructured(client,input as never,'fixture')).rejects.toThrow();
 expect(query).not.toHaveBeenCalled();
});
