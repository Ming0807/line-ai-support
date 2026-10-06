import {z} from 'zod';
/** Browser-safe administrative metadata contracts; no server dependencies. */
export const catalogStatuses=['DRAFT','PENDING_REVIEW','ACTIVE','SUPERSEDED','EXPIRED','ARCHIVED','REJECTED'] as const;
const status=z.enum(catalogStatuses),mode=z.enum(['RAG','STRUCTURED','BOTH']);
const uuid=z.uuid(),count=z.number().int().min(0).max(2_147_483_647),page=z.number().int().min(1).max(10_000),pageSize=z.number().int().min(1).max(50);
const nullableText=(max:number)=>z.string().min(1).max(max).nullable();
const queryText=z.string().trim().min(1).max(120).nullable();
const civil=z.iso.date().nullable();
const timestamp=z.iso.datetime().refine(value=>Number.isFinite(new Date(value).getTime())&&new Date(value).toISOString()===value);
const department=z.object({code:z.string().min(1).max(80),name:z.string().min(1).max(200)}).strict();
export const catalogQuerySchema=z.object({q:queryText,departmentCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/).nullable(),status:status.nullable(),page,pageSize}).strict();
export const catalogPageSchema=z.object({page,pageSize}).strict();
export const catalogRelationsQuerySchema=z.object({relationsPage:page,relationsPageSize:pageSize}).strict();
export const catalogFamilySchema=z.object({id:uuid,code:z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),name:z.string().min(1).max(200),category:z.string().min(1).max(80),defaultStorageMode:mode}).strict();
export const catalogSummarySchema=z.object({id:uuid,familyId:uuid,title:z.string().min(1).max(500),documentType:z.string().min(1).max(80),versionName:z.string().min(1).max(200),versionStream:z.string().min(1).max(120),academicYear:z.number().int().min(2400).max(3000).nullable(),department:department.nullable(),status,isCurrent:z.boolean(),visibility:z.enum(['PUBLIC','INTERNAL','RESTRICTED']),storageMode:mode.nullable(),publishedAt:civil,effectiveFrom:civil,effectiveTo:civil,authorityLevel:z.number().int().min(0).max(100),approvedAt:timestamp.nullable(),sourceUrl:nullableText(2000),sourcePageUrl:nullableText(2000),lastImportAt:timestamp.nullable()}).strict();
const familyPreview=catalogFamilySchema.extend({documentCount:count,hasMoreVersions:z.boolean(),versionsPreview:z.array(catalogSummarySchema).max(5),lastImportAt:timestamp.nullable()}).strict().superRefine((family,context)=>{
 const expectedPreviewCount=Math.min(family.documentCount,5);
 if(family.versionsPreview.length!==expectedPreviewCount||family.hasMoreVersions!==(family.documentCount>5))
  context.addIssue({code:'custom',message:'CATALOG_RESPONSE_INVALID',path:['versionsPreview']});
 for(const [index,version] of family.versionsPreview.entries())if(version.familyId!==family.id)
  context.addIssue({code:'custom',message:'CATALOG_RESPONSE_INVALID',path:['versionsPreview',index,'familyId']});
});
const catalogResponseSchema=z.object({families:z.array(familyPreview).max(50),departments:z.array(department).max(1000),totalFamilies:count,totalDocuments:count,page,pageSize}).strict().superRefine((catalog,context)=>{
 const visibleDocuments=catalog.families.reduce((sum,family)=>sum+family.documentCount,0);
 if(catalog.families.length>catalog.pageSize||catalog.totalFamilies<catalog.families.length||catalog.totalDocuments<visibleDocuments)
  context.addIssue({code:'custom',message:'CATALOG_RESPONSE_INVALID'});
});
export const catalogEnvelopeSchema=z.object({catalog:catalogResponseSchema}).strict();
const historyResponseSchema=z.object({family:catalogFamilySchema,documents:z.array(catalogSummarySchema).max(50),totalDocuments:count,page,pageSize}).strict().superRefine((history,context)=>{
 if(history.documents.length>history.pageSize||history.totalDocuments<history.documents.length)
  context.addIssue({code:'custom',message:'CATALOG_RESPONSE_INVALID'});
 for(const [index,document] of history.documents.entries())if(document.familyId!==history.family.id)
  context.addIssue({code:'custom',message:'CATALOG_RESPONSE_INVALID',path:['documents',index,'familyId']});
});
export const historyEnvelopeSchema=z.object({history:historyResponseSchema}).strict();
const scope=z.object({semester:nullableText(40),audience:z.string().min(1).max(80),studentType:z.string().min(1).max(80),programCode:nullableText(80),curriculumCode:nullableText(80),cohort:z.number().int().min(2400).max(3000).nullable()}).strict();
const review=z.object({officialSource:z.boolean(),extractionReviewed:z.boolean(),requiresReview:z.boolean(),archiveOnly:z.boolean()}).strict();
const relationship=z.object({type:z.enum(['SUPERSEDES','AMENDS','ATTACHMENT_OF','RELATED_TO','CANCELS']),direction:z.enum(['INCOMING','OUTGOING']),documentId:uuid,title:z.string().min(1).max(500),versionName:z.string().min(1).max(200),status}).strict();
const documentResponseSchema=z.object({summary:catalogSummarySchema,scope,review,supersedesDocumentId:uuid.nullable(),createdAt:timestamp,updatedAt:timestamp,relationships:z.array(relationship).max(50),totalRelationships:count,relationsPage:page,relationsPageSize:pageSize}).strict().superRefine((document,context)=>{
 if(document.relationships.length>document.relationsPageSize||document.totalRelationships<document.relationships.length)
  context.addIssue({code:'custom',message:'CATALOG_RESPONSE_INVALID',path:['relationships']});
});
export const documentEnvelopeSchema=z.object({document:documentResponseSchema}).strict();
export type CatalogQuery=z.infer<typeof catalogQuerySchema>;
export type CatalogSummary=z.infer<typeof catalogSummarySchema>;
export type CatalogFamily=z.infer<typeof catalogFamilySchema>;
export type CatalogResponse=z.infer<typeof catalogEnvelopeSchema>['catalog'];
export type CatalogHistory=z.infer<typeof historyEnvelopeSchema>['history'];
export type CatalogDetail=z.infer<typeof documentEnvelopeSchema>['document'];

export function parseCatalogHistoryForFamily(input:unknown,expectedFamilyId:string):CatalogHistory|null {
 try {
  if(!uuid.safeParse(expectedFamilyId).success)return null;
  const parsed=historyEnvelopeSchema.safeParse(input);
  if(!parsed.success||parsed.data.history.family.id!==expectedFamilyId)return null;
  return parsed.data.history;
 }catch{return null;}
}

export function parseCatalogDetailForDocument(input:unknown,expectedDocumentId:string):CatalogDetail|null {
 try {
  if(!uuid.safeParse(expectedDocumentId).success)return null;
  const parsed=documentEnvelopeSchema.safeParse(input);
  if(!parsed.success||parsed.data.document.summary.id!==expectedDocumentId)return null;
  return parsed.data.document;
 }catch{return null;}
}
