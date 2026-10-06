import type {LocatedChunkPlan} from '../knowledge/located-plan-types';
export interface ImportChunkPlanSnapshot {
 jobId:string;jobRevision:number;extractionRevision:number;reviewRevision:number;
 plan:LocatedChunkPlan;
}
