import {z} from 'zod';
import {knowledgeScopeSchema} from './retrieval';
import {validateStructuredQuery,structuredQuerySchema} from './structured-query';
import {structuredProcedureProposalSchema} from './structured-not-applicable';
// Teach the provider the same per-dataset vocabulary that execution accepts.
// Pair values use the original field schema too; missing selectors stay absent.
const queryOptions=structuredQuerySchema.options.map(query=>{
 const fields=Object.entries(query.shape.filters.shape).map(([field,schema])=>z.strictObject({field:z.literal(field),value:schema.unwrap()}));
 return z.strictObject({version:z.literal(1),dataset:query.shape.dataset,
  filters:z.array(z.discriminatedUnion('field',fields as [typeof fields[number],...typeof fields[number][]])).max(12)
   .refine(filters=>new Set(filters.map(filter=>filter.field)).size===filters.length),
  limit:z.number().int().min(1).max(20)});
});
const wireQuery=z.discriminatedUnion('dataset',queryOptions as [typeof queryOptions[number],...typeof queryOptions[number][]]);
const selection=z.discriminatedUnion('method',[
 z.strictObject({method:z.enum(['DISCOVER_FORMS','DISCOVER_CALENDAR','DISCOVER_SERVICES','DISCOVER_FORM_PURPOSE']),query:z.null(),notApplicable:z.null()}),
 z.strictObject({method:z.literal('RAG'),query:z.null(),notApplicable:structuredProcedureProposalSchema.nullable()}),
 z.strictObject({method:z.literal('STRUCTURED'),query:wireQuery,notApplicable:z.null()}),
]);
export const lookupPlanSchema=z.strictObject({scope:knowledgeScopeSchema,selection});
export function decodeLookupSelection(input:unknown){
 const parsed=selection.parse(input);
 if(parsed.method!=='RAG'&&parsed.method!=='STRUCTURED')return {method:parsed.method,query:null};
 if(parsed.method==='RAG'){
  if(parsed.query!==null)throw Error('LOOKUP_PLAN_INVALID');
  return {method:parsed.method,query:null,...(parsed.notApplicable?{notApplicable:parsed.notApplicable}:{})};
 }
 if(!parsed.query||parsed.notApplicable!==null)throw Error('LOOKUP_PLAN_INVALID');
 const {filters,...query}=parsed.query;
 if(new Set(filters.map(f=>f.field)).size!==filters.length)throw Error('LOOKUP_PLAN_INVALID');
 return {method:parsed.method,query:validateStructuredQuery({...query,filters:Object.fromEntries(filters.map(f=>[f.field,f.value]))})};
}
