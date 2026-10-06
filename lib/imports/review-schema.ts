import {z} from 'zod';
import {isValidKnowledgeDate} from '../knowledge/metadata-filter';
import {isOfficialYruUrl} from './source';
import {datasetTypes} from './types';

export const REVIEW_LIMITS={requestBytes:2*1024*1024,payloadBytes:1024*1024} as const;
const revision=z.number().int().min(0).max(999_999_999);
const text=(max:number)=>z.string().min(1).max(max).refine(value=>value.trim()===value&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value));
const nullableText=(max:number)=>text(max).nullable();
const code=z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/);
const year=z.number().int().min(2400).max(3000).nullable();
const date=z.string().refine(isValidKnowledgeDate).nullable();
const sourceUrl=z.string().max(2000).refine(isOfficialYruUrl).nullable();
export const reviewActions=['NEW_FAMILY','ADD_ADDITIONAL','REPLACE_CURRENT','ADD_HISTORICAL','AMEND_EXISTING'] as const;
const metadata=z.object({
 title:nullableText(500),familyCode:code.nullable(),newFamily:z.object({name:nullableText(200),category:nullableText(80)}).strict().nullable(),
 departmentCode:code.nullable(),documentType:nullableText(80),versionName:nullableText(200),versionStream:nullableText(120),academicYear:year,
 scope:z.object({semester:nullableText(40),audience:nullableText(80),studentType:nullableText(80),programCode:nullableText(80),curriculumCode:nullableText(80),cohort:year}).strict(),
 publishedAt:date,effectiveFrom:date,effectiveTo:date,authorityLevel:z.number().int().min(0).max(100).nullable(),sourceUrl,sourcePageUrl:sourceUrl,
 visibility:z.enum(['PUBLIC','INTERNAL','RESTRICTED']).nullable(),storageMode:z.enum(['RAG','STRUCTURED','BOTH']).nullable(),datasetType:z.enum(datasetTypes).nullable(),
}).strict().refine(value=>value.effectiveTo===null||(value.effectiveFrom!==null&&value.effectiveTo>=value.effectiveFrom));
const disposition=z.object({warningKey:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(['UNRESOLVED','CORRECTED','FALSE_POSITIVE']),reason:nullableText(500)}).strict()
 .refine(value=>value.status==='UNRESOLVED'||value.reason!==null);
export const reviewDraftSchema=z.object({
 schemaVersion:z.literal(1),metadata,action:z.enum(reviewActions).nullable(),target:z.object({documentId:z.uuid(),revision}).strict().nullable(),relationship:z.literal('CANCELS').nullable(),
 attestations:z.object({sourceAuthorityReviewed:z.boolean(),extractionReviewed:z.boolean(),applicabilityReviewed:z.boolean(),sensitivityReviewed:z.boolean(),versionReviewed:z.boolean()}).strict(),
 warningDispositions:z.array(disposition).max(10_000),
}).strict().superRefine((value,ctx)=>{
 const issue=(path:(string|number)[])=>ctx.addIssue({code:'custom',message:'IMPORT_REVIEW_INVALID',path});
 const requiresTarget=value.action==='REPLACE_CURRENT'||value.action==='AMEND_EXISTING'||value.relationship==='CANCELS';
 if(requiresTarget!==(value.target!==null))issue(['target']);
 if(value.relationship==='CANCELS'&&value.action!=='ADD_ADDITIONAL')issue(['relationship']);
 if(value.metadata.newFamily!==null&&value.action!=='NEW_FAMILY')issue(['metadata','newFamily']);
 const keys=new Set<string>();for(const [index,item] of value.warningDispositions.entries()){
  if(keys.has(item.warningKey))issue(['warningDispositions',index,'warningKey']);keys.add(item.warningKey);
 }
 if(Buffer.byteLength(JSON.stringify(value),'utf8')>REVIEW_LIMITS.payloadBytes)issue([]);
});
export const reviewSaveSchema=z.object({expectedJobRevision:revision,expectedExtractionRevision:revision.min(1),expectedReviewRevision:revision,draft:reviewDraftSchema}).strict();
export type ImportReviewDraft=z.infer<typeof reviewDraftSchema>;
export type ImportReviewSave=z.infer<typeof reviewSaveSchema>;
