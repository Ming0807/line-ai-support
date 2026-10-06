import type {ImportReviewDraft} from '../../lib/imports/review-schema';
export function unfinishedReviewDraft():ImportReviewDraft{return {
 schemaVersion:1,metadata:{title:null,familyCode:null,newFamily:null,departmentCode:null,documentType:null,versionName:null,versionStream:null,academicYear:null,
 scope:{semester:null,audience:null,studentType:null,programCode:null,curriculumCode:null,cohort:null},publishedAt:null,effectiveFrom:null,effectiveTo:null,authorityLevel:null,
 sourceUrl:null,sourcePageUrl:null,visibility:null,storageMode:null,datasetType:null},action:null,target:null,relationship:null,
 attestations:{sourceAuthorityReviewed:false,extractionReviewed:false,applicabilityReviewed:false,sensitivityReviewed:false,versionReviewed:false},warningDispositions:[],
};}
