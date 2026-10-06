import {z} from 'zod';
import type {ImportReviewDraft} from './review-schema';
/** Pure browser contract: never import source.ts, encrypted originals or server modules. */
const text=(max:number)=>z.string().trim().min(1).max(max).nullable();
const code=z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/);
const year=z.number().int().min(2400).max(3000).nullable();
const civil=z.iso.date().refine(value=>new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value).nullable();
const official=z.string().max(2000).refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&(u.hostname==='yru.ac.th'||u.hostname.endsWith('.yru.ac.th'));}catch{return false;}}).nullable();
const metadata=z.object({title:text(500),familyCode:code.nullable(),newFamily:z.null(),departmentCode:code.nullable(),documentType:text(80),versionName:text(200),versionStream:text(120),academicYear:year,
 scope:z.object({semester:text(40),audience:text(80),studentType:text(80),programCode:text(80),curriculumCode:text(80),cohort:year}).strict(),
 publishedAt:civil,effectiveFrom:civil,effectiveTo:civil,authorityLevel:z.number().int().min(0).max(100).nullable(),sourceUrl:official,sourcePageUrl:official,
 visibility:z.enum(['PUBLIC','INTERNAL','RESTRICTED']).nullable(),storageMode:z.enum(['RAG','STRUCTURED','BOTH']).nullable(),datasetType:z.enum(['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements']).nullable(),
}).strict().refine(value=>value.effectiveTo===null||value.effectiveFrom!==null&&value.effectiveTo>=value.effectiveFrom);
const fields=['title','familyCode','departmentCode','documentType','versionName','versionStream','academicYear','publishedAt','effectiveFrom','effectiveTo','authorityLevel','sourceUrl','sourcePageUrl','visibility','storageMode','datasetType'] as const;
const assistance=z.object({jobId:z.uuid(),jobRevision:z.number().int().min(1).max(999_999_999),extractionRevision:z.number().int().min(1).max(999_999_999),metadata,
 origins:z.partialRecord(z.enum(fields),z.object({kind:z.enum(['EXTRACTED','CLASSIFIED','DEFAULT']),label:z.string().min(1).max(120)}).strict()),
 families:z.array(z.object({code,name:z.string().min(1).max(200),category:z.string().min(1).max(80)}).strict()).max(1000),
 departments:z.array(z.object({code,name:z.string().min(1).max(200)}).strict()).max(1000),
}).strict().superRefine((value,ctx)=>{
 for(const key of fields)if((value.metadata[key]!==null)!==Object.hasOwn(value.origins,key))ctx.addIssue({code:'custom',message:'INVALID_PROPOSAL_ORIGIN',path:['origins',key]});
 if(value.metadata.familyCode!==null&&!value.families.some(f=>f.code===value.metadata.familyCode))ctx.addIssue({code:'custom',message:'UNKNOWN_FAMILY'});
 if(value.metadata.departmentCode!==null&&!value.departments.some(d=>d.code===value.metadata.departmentCode))ctx.addIssue({code:'custom',message:'UNKNOWN_DEPARTMENT'});
 for(const rows of [value.families,value.departments])if(new Set(rows.map(v=>v.code)).size!==rows.length)ctx.addIssue({code:'custom',message:'DUPLICATE_REFERENCE'});
});
export const assistanceEnvelopeSchema=z.object({assistance}).strict();
export type ImportAssistance=z.infer<typeof assistance>;
export function parseAssistanceEnvelope(input:unknown,binding:{jobId:string;jobRevision:number;extractionRevision:number}):ImportAssistance|null{
 const parsed=assistanceEnvelopeSchema.safeParse(input);if(!parsed.success)return null;const a=parsed.data.assistance;
 return a.jobId===binding.jobId&&a.jobRevision===binding.jobRevision&&a.extractionRevision===binding.extractionRevision?a:null;
}
/** Only missing metadata. Consent/version/warnings are deliberately outside this helper. */
export function applyImportAssistance(draft:ImportReviewDraft,a:ImportAssistance):ImportReviewDraft{
 const next=structuredClone(draft);
 for(const field of fields)if(next.metadata[field]===null&&a.metadata[field]!==null){
  if(field==='effectiveFrom'&&next.metadata.effectiveTo!==null&&a.metadata.effectiveFrom!==null&&a.metadata.effectiveFrom>next.metadata.effectiveTo)continue;
  if(field==='effectiveTo'&&(next.metadata.effectiveFrom===null||a.metadata.effectiveTo!==null&&a.metadata.effectiveTo<next.metadata.effectiveFrom))continue;
  Object.assign(next.metadata,{[field]:a.metadata[field]});
 }
 return next;
}
const required=[['title','ชื่อเอกสาร'],['familyCode','กลุ่มเอกสาร'],['departmentCode','หน่วยงาน'],['documentType','ประเภทเอกสาร'],['versionName','ชื่อฉบับ'],['versionStream','สายฉบับ'],['publishedAt','วันที่ประกาศ'],['effectiveFrom','วันที่เริ่มมีผล'],['authorityLevel','แหล่งอำนาจเอกสาร'],['visibility','ผู้ที่ใช้ข้อมูลนี้ได้'],['storageMode','วิธีใช้เอกสาร']] as const;
export function requiredReviewFields(m:ImportReviewDraft['metadata']):Array<{key:string;label:string}>{
 const missing=required.filter(([key])=>m[key]===null).map(([key,label])=>({key:key as string,label:label as string}));
 if(m.scope.audience===null)missing.push({key:'scope.audience',label:'กลุ่มผู้ใช้'});
 if(m.scope.studentType===null)missing.push({key:'scope.studentType',label:'ประเภทนักศึกษา'});
 if(m.visibility==='PUBLIC'&&m.sourceUrl===null)missing.push({key:'sourceUrl',label:'URL แหล่งที่มาทางการสำหรับตอบนักศึกษา'});
 return missing;
}
