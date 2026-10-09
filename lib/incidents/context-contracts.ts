import {z} from 'zod';
import {knowledgeScopeSchema} from '../knowledge/retrieval';
import {structuredQuerySchema} from '../knowledge/structured-query';
import type {StructuredSearchResult} from '../knowledge/structured-search';

export const incidentContextSlotSchema=z.enum(['SYSTEM_CODE','SYSTEM_NAME','LOCATION']);
export type IncidentContextSlot=z.infer<typeof incidentContextSlotSchema>;
const claimText=z.string().min(1).max(1000).refine(value=>value.isWellFormed()&&value.trim().length>0&&!/\p{Cc}/u.test(value));
export const incidentContextClaimsSchema=z.strictObject({system:claimText.nullable(),location:claimText.nullable()});
export type IncidentContextClaims=z.infer<typeof incidentContextClaimsSchema>;
export const incidentContextDepartmentSchema=z.string().min(1).max(80).regex(/^[A-Z][A-Z0-9_]{1,79}$/u);
export const incidentContextAttemptSchema=z.strictObject({slot:incidentContextSlotSchema,query:structuredQuerySchema,scope:knowledgeScopeSchema});
export type IncidentContextAttempt=Readonly<z.infer<typeof incidentContextAttemptSchema>>;
export const incidentContextPlanSchema=z.strictObject({claims:incidentContextClaimsSchema,departmentCode:incidentContextDepartmentSchema,attempts:z.array(incidentContextAttemptSchema).max(3)});
export type IncidentContextPlan=Readonly<z.infer<typeof incidentContextPlanSchema>>;
export interface ResolvedIncidentContextValue {
 key:string;
 sourceValue:string;
 familyId:string;
 versionStream:string;
 evidence:NonNullable<Extract<StructuredSearchResult,{status:'READY'}>['evidence']>;
}
export interface ResolvedIncidentContext {system:ResolvedIncidentContextValue|null;location:ResolvedIncidentContextValue|null}
