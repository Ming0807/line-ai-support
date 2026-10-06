import type {ImportReviewDraft} from './review-schema';
import type {KnowledgeMetadata} from '../knowledge/types';
export interface VersionFamily {id:string;code:string;name:string;category:string}
export interface VersionDocument {
 documentId:string;revision:number;title:string;departmentCode:string|null;documentType:string;versionName:string;versionStream:string;academicYear:number|null;
 scope:{semester:string|null;audience:string;studentType:string;programCode:string|null;curriculumCode:string|null;cohort:number|null};
 status:KnowledgeMetadata['status'];isCurrent:boolean;approved:boolean;isAmendment:boolean;isCancellation:boolean;effectiveFrom:string|null;effectiveTo:string|null;
}
export type VersionTargetAction='REPLACE_CURRENT'|'AMEND_EXISTING'|'CANCELS';
export interface VersionCandidate extends VersionDocument {matchingScope:boolean;targetActions:VersionTargetAction[]}
export interface VersionChoices {
 family:VersionFamily|null;missingMetadata:string[];availableActions:('NEW_FAMILY'|'ADD_ADDITIONAL'|'ADD_HISTORICAL')[];
 candidates:VersionCandidate[];limitExceeded:boolean;currentStreamOccupied:boolean;
}
export function buildVersionCandidates(metadata:ImportReviewDraft['metadata'],family:VersionFamily|null,documents:VersionDocument[]):VersionChoices {
 const missingMetadata:string[]=[];
 for(const field of ['familyCode','departmentCode','documentType','versionStream'] as const)if(metadata[field]===null)missingMetadata.push(field);
 for(const field of ['audience','studentType'] as const)if(metadata.scope[field]===null)missingMetadata.push(field);
 const currentStreamOccupied=documents.some(row=>row.isCurrent&&row.versionStream===metadata.versionStream);
 const result:VersionChoices={family:family?{...family}:null,missingMetadata,availableActions:[],candidates:[],limitExceeded:documents.length>100,currentStreamOccupied};
 if(missingMetadata.length||result.limitExceeded)return result;
 if(!family){result.availableActions=['NEW_FAMILY'];return result;}
 result.availableActions=currentStreamOccupied?['ADD_HISTORICAL']:['ADD_ADDITIONAL','ADD_HISTORICAL'];
 result.candidates=documents.map(row=>{
  const matchingScope=row.departmentCode===metadata.departmentCode&&row.documentType===metadata.documentType&&
   (['semester','audience','studentType','programCode','curriculumCode','cohort'] as const).every(field=>row.scope[field]===metadata.scope[field]);
  const eligible=matchingScope&&row.approved&&!row.isCancellation&&['ACTIVE','SUPERSEDED','EXPIRED'].includes(row.status);
  const currentBase=eligible&&row.isCurrent&&row.status==='ACTIVE'&&!row.isAmendment;
  const sameYear=row.academicYear===metadata.academicYear;
  const targetActions:VersionTargetAction[]=[];
  if(currentBase&&row.versionStream===metadata.versionStream)targetActions.push('REPLACE_CURRENT');
  if(currentBase&&sameYear)targetActions.push('AMEND_EXISTING');
  if(eligible&&sameYear)targetActions.push('CANCELS');
  return {...row,scope:{...row.scope},matchingScope,targetActions};
 });
 return result;
}
