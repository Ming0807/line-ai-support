import type {SourceLocation,ExtractionWarning} from '../imports/types';
import type {ChunkDraft} from './types';
import type {EmbeddingCallOptions} from './embedding-client';

/** Server-produced provenance; indexes are zero-based within the exact extraction. */
export type LocatedChunkCoverage=
 | {kind:'PAGE';index:number;start:number;end:number;overlapPrefixLength:number}
 | {kind:'TABLE';index:number;rowStartIndex:number;rowEndIndex:number};
export interface LocatedChunkDraft extends ChunkDraft {
 sourceLocations:SourceLocation[];
 passageTokenCount:number;
 coverage:LocatedChunkCoverage;
}
export interface LocatedPlanBinding {jobId:string;extractionRevision:number}
export interface LocatedChunkPlan {
 schemaVersion:1;chunkerVersion:'located-e5-v1';
 binding:LocatedPlanBinding;sourceChecksum:string;
 model:string;modelRevision:string;embeddingFingerprint:string;
 chunks:LocatedChunkDraft[];
 warnings:ExtractionWarning[];
 digest:string;
}
export interface LocatedPlanOptions extends EmbeddingCallOptions {
 /** Bounded implementation controls for meaningful limit/boundary tests, not browser input. */
 maxChunks?:number;overlapCharacters?:number;
}
export type LocatedPlanErrorCode='KNOWLEDGE_PLAN_INPUT_INVALID'|'KNOWLEDGE_PLAN_SPACE_INVALID'|'KNOWLEDGE_PLAN_LIMIT_EXCEEDED'|'KNOWLEDGE_PLAN_TABLE_ROW_TOO_LARGE'|'KNOWLEDGE_PLAN_GRAPHEME_TOO_LARGE'|'KNOWLEDGE_PLAN_TIMEOUT'|'KNOWLEDGE_PLAN_ABORTED'|'KNOWLEDGE_PLAN_COUNTER_INVALID';
export class LocatedPlanError extends Error {
 constructor(public readonly code:LocatedPlanErrorCode){super(code);this.name='LocatedPlanError';}
}
