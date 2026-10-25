import {expect,it} from 'vitest';
import {z} from 'zod';
import {lookupPlanSchema,decodeLookupSelection} from '../lib/knowledge/lookup-plan';
import {createChatCompletionsAdapter} from '../lib/ai/providers/chat-completions';
import {structuredProcedureProposalSchema} from '../lib/knowledge/structured-not-applicable';
const selection={method:'STRUCTURED',query:{version:1,dataset:'tuition_fees',filters:[{field:'academic_year',value:2569}],limit:20},notApplicable:null};
it('constrains the captured procedural tag confusion in the decoder while retaining strict backend rejection',()=>{
 const schema=z.toJSONSchema(structuredProcedureProposalSchema);
 expect(schema.properties?.kind).toEqual({type:'string',enum:['PROCEDURE']});
 const proposal={version:1,kind:'CREDIT_TRANSFER',topic:'CREDIT_TRANSFER',quote:'ยื่นคำร้องขอเทียบโอนรายวิชา ปี2569'};
 expect(structuredProcedureProposalSchema.safeParse(proposal).success).toBe(false);
 expect(structuredProcedureProposalSchema.safeParse({...proposal,kind:'PROCEDURE'}).success).toBe(true);
});
it('keeps form discovery separate from exact selectors and procedural exceptions',()=>{
 expect(decodeLookupSelection({method:'DISCOVER_FORMS',query:null,notApplicable:null})).toEqual({method:'DISCOVER_FORMS',query:null});
 expect(()=>decodeLookupSelection({method:'DISCOVER_FORMS',query:selection.query,notApplicable:null})).toThrow();
});
it('exposes dataset-specific filter names in the provider wire contract',()=>{
 const scope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
 const plan=(field:string)=>({scope,selection:{...selection,query:{version:1,dataset:'service_forms',filters:[{field,value:'คำร้อง'}],limit:20}}});
 expect(lookupPlanSchema.safeParse(plan('name')).success).toBe(true);
 expect(lookupPlanSchema.safeParse(plan('form_type')).success).toBe(false);
 expect(lookupPlanSchema.safeParse(plan('program_name')).success).toBe(false);
 expect(lookupPlanSchema.safeParse({...plan('name'),selection:{...plan('name').selection,method:'RAG'}}).success).toBe(false);
 expect(lookupPlanSchema.safeParse({...plan('name'),selection:{...plan('name').selection,query:{...selection.query,filters:[{field:'academic_year',value:'2569'}]}}}).success).toBe(false);
});
it.each(['DISCOVER_CALENDAR','DISCOVER_SERVICES','DISCOVER_FORM_PURPOSE'])('accepts separate bounded %s discovery without pretending Query1 is complete',method=>{
 expect(decodeLookupSelection({method,query:null,notApplicable:null})).toEqual({method,query:null});
 expect(()=>decodeLookupSelection({method,query:selection.query,notApplicable:null})).toThrow();
});
it('converts explicit filter pairs through the registered query validator',()=>{
 expect(decodeLookupSelection(selection)).toEqual({method:'STRUCTURED',query:{version:1,dataset:'tuition_fees',filters:{academic_year:2569},limit:20}});
});
it('rejects duplicate filter keys, wrong dataset fields and coercion',()=>{
 for(const filters of [[{field:'academic_year',value:2569},{field:'academic_year',value:2570}],[{field:'sql',value:'select 1'}],[{field:'academic_year',value:'2569'}]])expect(()=>decodeLookupSelection({...selection,query:{...selection.query,filters}})).toThrow();
});
it('its complete wire schema passes the actual strict adapter before controlled HTTP',async()=>{
 let sent=false;
 const adapter=createChatCompletionsAdapter({fetchImpl:async()=>{sent=true;return new Response(null,{status:429});}});
 await expect(adapter.generate({modelId:'synthetic',baseUrl:'https://opencode.ai/zen/v1',apiKey:'synthetic',messages:[{role:'user',content:'test'}],responseSchema:{name:'lookup_plan',schema:z.toJSONSchema(lookupPlanSchema)},signal:new AbortController().signal})).rejects.toMatchObject({code:'RATE_LIMITED',httpStatus:429});expect(sent).toBe(true);
});
