import {z} from 'zod';
import {copyStructuredJson,freezeStructuredData,StructuredMappingError} from '../imports/structured-mapping-contract';
import {structuredPayloadSchemas,validateStructuredPayload,type StructuredDataset} from './structured-payload';

export const STRUCTURED_QUERY_LIMITS=Object.freeze({bytes:32*1024,nodes:256,results:20});
export class StructuredQueryError extends Error {
 constructor(readonly code:'STRUCTURED_QUERY_INVALID'|'STRUCTURED_QUERY_LIMIT_EXCEEDED'|'STRUCTURED_QUERY_INCOMPLETE'){super(code);this.name='StructuredQueryError';}
}
const text=(max:number)=>z.string().min(1).max(max).refine(value=>value.isWellFormed()&&value.trim().length>0&&!/\p{Cc}/u.test(value));
const year=structuredPayloadSchemas.academic_calendar_events.shape.academic_year;
const date=structuredPayloadSchemas.academic_calendar_events.shape.start_date;
const instant=structuredPayloadSchemas.announcements.shape.effective_from;
const fee=structuredPayloadSchemas.tuition_fees.shape.fee_amount;
const credits=structuredPayloadSchemas.transfer_courses.shape.source_credits;
const priority=structuredPayloadSchemas.announcements.shape.priority;
const request=<D extends StructuredDataset,S extends z.ZodRawShape>(dataset:D,shape:S)=>z.object({version:z.literal(1),dataset:z.literal(dataset),filters:z.object(shape).strict(),limit:z.number().int().min(1).max(STRUCTURED_QUERY_LIMITS.results)}).strict();
export const structuredQuerySchema=z.discriminatedUnion('dataset',[
 request('academic_calendar_events',{academic_year:year.optional(),semester:text(80).optional(),student_type:text(80).optional(),event_type:text(200).optional(),title:text(500).optional(),occurs_on:date.optional(),start_date_from:date.optional(),start_date_to:date.optional()}),
 request('tuition_fees',{academic_year:year.optional(),program_name:text(500).optional(),major_name:text(500).nullable().optional(),student_group:text(200).optional(),study_type:text(200).optional(),currency:structuredPayloadSchemas.tuition_fees.shape.currency.optional(),fee_amount_min:fee.optional(),fee_amount_max:fee.optional(),effective_on:date.optional()}),
 request('transfer_courses',{source_program:text(500).optional(),source_course_code:text(200).optional(),target_program:text(500).optional(),target_course_code:text(200).optional(),source_credits_min:credits.optional(),source_credits_max:credits.optional(),target_credits_min:credits.optional(),target_credits_max:credits.optional()}),
 request('university_services',{service_code:text(200).optional(),name:text(500).optional()}),
 request('university_systems',{code:text(200).optional(),name:text(500).optional()}),
 request('service_forms',{name:text(500).optional(),form_url:structuredPayloadSchemas.service_forms.shape.form_url.refine(value=>!/\p{Cc}/u.test(value)).optional()}),
 request('announcements',{title:text(500).optional(),effective_at:instant.optional(),priority_min:priority.optional(),priority_max:priority.optional()}),
]);
const schema=structuredQuerySchema;
export type StructuredQuery=z.infer<typeof schema>;
type Range={from:string;to:string;field:string;scale?:number};
const ranges:Record<StructuredDataset,readonly Range[]>={
 academic_calendar_events:[{from:'start_date_from',to:'start_date_to',field:'start_date'}],
 tuition_fees:[{from:'fee_amount_min',to:'fee_amount_max',field:'fee_amount',scale:2}],
 transfer_courses:[{from:'source_credits_min',to:'source_credits_max',field:'source_credits',scale:3},{from:'target_credits_min',to:'target_credits_max',field:'target_credits',scale:3}],
 university_services:[],university_systems:[],service_forms:[],announcements:[{from:'priority_min',to:'priority_max',field:'priority'}],
};
function compare(left:unknown,right:unknown,scale?:number):number {
 if(typeof left==='number'&&typeof right==='number')return left<right?-1:left>right?1:0;
 if(typeof left!=='string'||typeof right!=='string')throw new StructuredQueryError('STRUCTURED_QUERY_INVALID');
 if(scale===undefined)return left<right?-1:left>right?1:0;
 const scaled=(value:string)=>{const [whole,fraction='']=value.split('.');return BigInt(whole+fraction.padEnd(scale,'0'));};
 const a=scaled(left),b=scaled(right);return a<b?-1:a>b?1:0;
}
export function validateStructuredQuery(input:unknown):StructuredQuery {
 try{
  const parsed=schema.parse(copyStructuredJson(input,STRUCTURED_QUERY_LIMITS.bytes,STRUCTURED_QUERY_LIMITS.nodes));
  const filters:Record<string,unknown>=parsed.filters;
  for(const range of ranges[parsed.dataset])if(Object.hasOwn(filters,range.from)&&Object.hasOwn(filters,range.to)&&compare(filters[range.from],filters[range.to],range.scale)>0)throw new StructuredQueryError('STRUCTURED_QUERY_INVALID');
  return freezeStructuredData(parsed);
 }catch(error){if(error instanceof StructuredMappingError&&error.code==='STRUCTURED_MAPPING_LIMIT_EXCEEDED')throw new StructuredQueryError('STRUCTURED_QUERY_LIMIT_EXCEEDED');throw new StructuredQueryError('STRUCTURED_QUERY_INVALID');}
}
function assessment(query:StructuredQuery):{status:'READY'}|{status:'CLARIFICATION_REQUIRED';missing:string[]} {
 const required:Partial<Record<StructuredDataset,readonly string[]>>={academic_calendar_events:['academic_year','semester','student_type'],tuition_fees:['academic_year','program_name','student_group','study_type'],transfer_courses:['source_program','source_course_code','target_program']};
 const choices:Partial<Record<StructuredDataset,readonly string[]>>={university_services:['service_code','name'],university_systems:['code','name'],service_forms:['name','form_url'],announcements:['title','effective_at']};
 const missing=(required[query.dataset]??[]).filter(key=>!Object.hasOwn(query.filters,key));
 const group=choices[query.dataset];if(group&&!group.some(key=>Object.hasOwn(query.filters,key)))missing.push(group.join('|'));
 return missing.length?{status:'CLARIFICATION_REQUIRED',missing}:{status:'READY'};
}
export function assessStructuredQuery(input:unknown){return freezeStructuredData(assessment(validateStructuredQuery(input)));}

/** Predicate only. The caller must separately prove live document eligibility and authorization. */
export function matchesStructuredPayload(input:unknown,payloadInput:unknown):boolean {
 const query=validateStructuredQuery(input);if(assessment(query).status!=='READY')throw new StructuredQueryError('STRUCTURED_QUERY_INCOMPLETE');
 let payload:Record<string,unknown>;
 try{payload=validateStructuredPayload(query.dataset,copyStructuredJson(payloadInput,64*1024,256));}catch{throw new StructuredQueryError('STRUCTURED_QUERY_INVALID');}
 const filters:Record<string,unknown>=query.filters;
 for(const field of Object.keys(payload))if(Object.hasOwn(filters,field)&&filters[field]!==payload[field])return false;
 for(const range of ranges[query.dataset]){
  if(Object.hasOwn(filters,range.from)&&compare(payload[range.field],filters[range.from],range.scale)<0)return false;
  if(Object.hasOwn(filters,range.to)&&compare(payload[range.field],filters[range.to],range.scale)>0)return false;
 }
 if(query.dataset==='academic_calendar_events'&&filters.occurs_on!==undefined){
  if(compare(filters.occurs_on,payload.start_date)<0||compare(filters.occurs_on,payload.end_date??payload.start_date)>0)return false;
 }
 if(query.dataset==='tuition_fees'&&filters.effective_on!==undefined){
  if(compare(filters.effective_on,payload.effective_from)<0||payload.effective_to!==null&&compare(filters.effective_on,payload.effective_to)>0)return false;
 }
 if(query.dataset==='announcements'&&filters.effective_at!==undefined){
  if(compare(filters.effective_at,payload.effective_from)<0||payload.effective_to!==null&&compare(filters.effective_at,payload.effective_to)>0)return false;
 }
 return true;
}
