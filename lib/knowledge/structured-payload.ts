import {z} from 'zod';
import type {DatasetType} from '../imports/types';

/** Source-valued payloads only. Installation, authorization and publication are separate. */
export const STRUCTURED_REGISTRY_VERSION='structured-v1' as const;
export const STRUCTURED_DATASETS=Object.freeze(['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements'] as const satisfies readonly DatasetType[]);
export type StructuredDataset=typeof STRUCTURED_DATASETS[number];
export class StructuredPayloadError extends Error {
 constructor(readonly code:'STRUCTURED_DATASET_UNSUPPORTED'|'STRUCTURED_PAYLOAD_INVALID'){
  super(code);this.name='StructuredPayloadError';
 }
}

const controls=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const text=(max:number)=>z.string().min(1).max(max).refine(value=>value.isWellFormed()&&value.length<=max&&value.trim().length>0&&!controls.test(value));
const academicYear=z.number().int().min(2400).max(3000);
const decimal=(integerDigits:number,scale:number)=>z.string().regex(new RegExp(`^(?:0|[1-9][0-9]{0,${integerDigits-1}})(?:\\.[0-9]{1,${scale}})?$`));
const civil=z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value=>validDate(value,false));
const timestamp=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u).refine(value=>validDate(value,true));
function validDate(value:string,withTime:boolean):boolean{
 const year=Number(value.slice(0,4));if(year<1800||year>2400)return false;
 try{const parsed=new Date(withTime?value:`${value}T00:00:00.000Z`);return Number.isFinite(parsed.getTime())&&(withTime?parsed.toISOString():parsed.toISOString().slice(0,10))===value;}catch{return false;}
}
const https=text(2000).refine(value=>{
 try{
  if(!/^https:\/\//iu.test(value)||/[\s\\#]/u.test(value))return false;
  const authority=value.slice(value.indexOf('//')+2).split(/[/?]/u)[0];
  if(!authority||authority.includes('@')||/:[0-9]*$/u.test(authority))return false;
  const url=new URL(value);
  return url.protocol==='https:'&&url.hostname.length>0&&!url.username&&!url.password&&!url.port&&!url.hash;
 }catch{return false;}
});
const email=z.email().max(254).refine(value=>/^[\u0021-\u007E]+$/u.test(value));

export const structuredPayloadSchemas=Object.freeze({
 academic_calendar_events:z.object({academic_year:academicYear,semester:text(80),student_type:text(80),event_type:text(200),title:text(500),start_date:civil,end_date:civil.nullable(),description:text(5000).nullable()}).strict()
  .refine(value=>value.end_date===null||value.end_date>=value.start_date),
 tuition_fees:z.object({academic_year:academicYear,program_name:text(500),major_name:text(500).nullable(),student_group:text(200),study_type:text(200),fee_amount:decimal(10,2),currency:z.string().regex(/^[A-Z]{3}$/u),effective_from:civil,effective_to:civil.nullable()}).strict()
  .refine(value=>value.effective_to===null||value.effective_to>=value.effective_from),
 transfer_courses:z.object({source_program:text(500),source_course_code:text(200),source_course_name:text(500),source_credits:decimal(3,3),target_program:text(500),target_course_code:text(200),target_course_name:text(500),target_credits:decimal(3,3),conditions:text(5000).nullable()}).strict(),
 university_services:z.object({service_code:text(200),name:text(500),description:text(5000).nullable(),location:text(500).nullable(),opening_hours:text(2000).nullable(),phone:text(100).nullable(),email:email.nullable(),url:https.nullable()}).strict(),
 university_systems:z.object({code:text(200),name:text(500),description:text(5000).nullable(),url:https,support_url:https.nullable()}).strict(),
 service_forms:z.object({name:text(500),description:text(5000).nullable(),form_url:https,requirements:text(5000).nullable()}).strict(),
 announcements:z.object({title:text(500),summary:text(5000).nullable(),publish_at:timestamp,effective_from:timestamp,effective_to:timestamp.nullable(),priority:z.number().int().min(0).max(100)}).strict()
  .refine(value=>value.effective_to===null||value.effective_to>=value.effective_from),
});
export type StructuredPayloads={[K in StructuredDataset]:z.infer<typeof structuredPayloadSchemas[K]>};
export function isStructuredDataset(value:unknown):value is StructuredDataset {
 return typeof value==='string'&&STRUCTURED_DATASETS.some(dataset=>dataset===value);
}
export function validateStructuredPayload<K extends StructuredDataset>(dataset:K,input:unknown):StructuredPayloads[K];
export function validateStructuredPayload(dataset:unknown,input:unknown):StructuredPayloads[StructuredDataset];
export function validateStructuredPayload(dataset:unknown,input:unknown):StructuredPayloads[StructuredDataset]{
 if(!isStructuredDataset(dataset))throw new StructuredPayloadError('STRUCTURED_DATASET_UNSUPPORTED');
 try{
  if(input===null||typeof input!=='object'||Array.isArray(input))throw new StructuredPayloadError('STRUCTURED_PAYLOAD_INVALID');
  const prototype=Object.getPrototypeOf(input);
  if(prototype!==Object.prototype&&prototype!==null)throw new StructuredPayloadError('STRUCTURED_PAYLOAD_INVALID');
  const schema=structuredPayloadSchemas[dataset],keys=Reflect.ownKeys(input),snapshot:Record<string,unknown>={};
  if(keys.length!==Object.keys(schema.shape).length)throw new StructuredPayloadError('STRUCTURED_PAYLOAD_INVALID');
  for(const key of keys){
   if(typeof key!=='string'||!Object.hasOwn(schema.shape,key))throw new StructuredPayloadError('STRUCTURED_PAYLOAD_INVALID');
   const descriptor=Object.getOwnPropertyDescriptor(input,key);
   if(!descriptor||!('value' in descriptor))throw new StructuredPayloadError('STRUCTURED_PAYLOAD_INVALID');
   snapshot[key]=descriptor.value;
  }
  const result=schema.safeParse(snapshot);
  if(result.success)return result.data;
 }catch{/* Never surface original text, getters or raw schema diagnostics. */}
 throw new StructuredPayloadError('STRUCTURED_PAYLOAD_INVALID');
}
