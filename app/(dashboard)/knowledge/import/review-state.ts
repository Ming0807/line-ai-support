import type {ImportReviewDraft} from '@/lib/imports/review-schema';
type Mode=NonNullable<ImportReviewDraft['metadata']['storageMode']>;
export function changeReviewMode(draft:ImportReviewDraft,mode:Mode):ImportReviewDraft {
 if(draft.metadata.storageMode===mode)return draft;
 const metadata={...draft.metadata,storageMode:mode,datasetType:mode==='RAG'?null:draft.metadata.datasetType};
 if(draft.schemaVersion===3||mode!=='RAG')return {...draft,schemaVersion:3,metadata,chunkPlan:null,structuredMapping:null};
 if(draft.schemaVersion===2)return {...draft,metadata,chunkPlan:null};
 return {...draft,metadata};
}
export function acknowledgeReviewChunks(draft:ImportReviewDraft,digest:string|null):ImportReviewDraft {
 if(digest!==null&&!/^[a-f0-9]{64}$/u.test(digest))throw Error('INVALID_CHUNK_DIGEST');
 const chunkPlan=digest===null||draft.metadata.storageMode==='STRUCTURED'?null:{digest,chunkerVersion:'located-e5-v1' as const};
 if(draft.schemaVersion===3)return {...draft,chunkPlan};
 return {...draft,schemaVersion:2,chunkPlan};
}
export function restartReviewDraft(empty:ImportReviewDraft,saved:ImportReviewDraft|null):ImportReviewDraft {
 const base=saved?{...empty,metadata:{...saved.metadata,scope:{...saved.metadata.scope}},action:saved.action,target:saved.target,relationship:saved.relationship}:empty;
 const attestations={sourceAuthorityReviewed:false,extractionReviewed:false,applicabilityReviewed:false,sensitivityReviewed:false,versionReviewed:false};
 const floor=Math.max(empty.schemaVersion,saved?.schemaVersion??1);
 if(floor>=3)return {...base,schemaVersion:3,attestations,chunkPlan:null,structuredMapping:null};
 if(floor===2)return {...base,schemaVersion:2,attestations,chunkPlan:null};
 return {...base,schemaVersion:1,attestations};
}
export function reviewPublicationEvidence(draft:ImportReviewDraft|null,structuredAvailable:boolean){
 const mode=draft?.metadata.storageMode??null;
 const chunkPlan=draft&&'chunkPlan' in draft?draft.chunkPlan:null;
 const chunkReady=Boolean(chunkPlan?.chunkerVersion==='located-e5-v1'&&/^[a-f0-9]{64}$/u.test(chunkPlan.digest));
 const mapping=draft?.schemaVersion===3?draft.structuredMapping:null;
 const mappingReady=Boolean(mapping&&mapping.mapping.dataset===draft?.metadata.datasetType&&mapping.acknowledgment?.mapperVersion==='structured-mapper-v1'&&/^[a-f0-9]{64}$/u.test(mapping.acknowledgment.contentDigest));
 const ready=mode==='RAG'?chunkReady&&mapping===null:mode==='STRUCTURED'?structuredAvailable&&mappingReady&&chunkPlan===null:mode==='BOTH'?structuredAvailable&&mappingReady&&chunkReady:false;
 return {ready,chunkReady,mappingReady,mode};
}
