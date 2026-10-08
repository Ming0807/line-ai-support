import {z} from 'zod';
import {ticketStatusSchema,sensitivitySchema} from '../../types/tickets';
export class IncidentError extends Error {
 constructor(readonly code:'INCIDENT_INPUT_INVALID'|'NOT_FOUND'|'CONFLICT'|'INVALID_REQUEST'|'FORBIDDEN'|'UNAVAILABLE'){super(code);}
}
const code=z.string().min(1).max(100).regex(/^[A-Za-z0-9_:-]+$/u);
export const incidentVectorSchema=z.array(z.number().finite()).length(384).refine(vector=>Math.abs(Math.hypot(...vector)-1)<=.001);
const canonicalUuid=z.uuid().transform(value=>value.toLowerCase());
export const ticketDescriptorSchema=z.strictObject({id:canonicalUuid,revision:z.number().int().nonnegative(),departmentId:canonicalUuid,category:code,
 systemCode:code.nullable(),locationCode:code.nullable(),sensitivity:sensitivitySchema,status:ticketStatusSchema,
 createdAt:z.iso.datetime(),anonymousSessionKey:z.string().min(1).max(200),vector:incidentVectorSchema});
export type TicketDescriptor=z.infer<typeof ticketDescriptorSchema>;
export const incidentConfigSchema=z.strictObject({minReports:z.number().int().min(2).max(100),minDistinctSessions:z.number().int().min(2).max(100),
 windowMinutes:z.number().int().min(1).max(1440),minSimilarity:z.number().finite().min(.5).max(1)}).refine(r=>r.minDistinctSessions<=r.minReports);
export type IncidentConfig=z.infer<typeof incidentConfigSchema>;
export const DEFAULT_INCIDENT_CONFIG:Readonly<IncidentConfig>=Object.freeze({minReports:5,minDistinctSessions:5,windowMinutes:15,minSimilarity:.85});
export const incidentStatusSchema=z.enum(['DETECTED','INVESTIGATING','MONITORING','RESOLVED','CLOSED']);
export type IncidentStatus=z.infer<typeof incidentStatusSchema>;
export const incidentQuerySchema=z.strictObject({status:incidentStatusSchema.optional(),severity:z.enum(['MEDIUM','HIGH','CRITICAL']).optional(),department:z.uuid().optional(),
 page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)});
export function parseIncidentQuery(params:URLSearchParams){
 const values:Record<string,string>={};for(const [key,value] of params){if(Object.hasOwn(values,key))throw new IncidentError('INVALID_REQUEST');values[key]=value;}
 return incidentQuerySchema.parse(values);
}
export const impactSchema=z.strictObject({campusWide:z.boolean(),criticalService:z.boolean(),confirmedOutage:z.boolean()});
export const impactVerificationSchema=impactSchema.extend({verificationNote:z.string().trim().min(10).max(1000).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value))});
export type VerifiedImpact=z.infer<typeof impactSchema>;
export interface IncidentCandidate {
 members:{ticketId:string;revision:number;cosineSimilarity:number}[];
 reportCount:number;distinctSessionCount:number;maxSensitivity:z.infer<typeof sensitivitySchema>;severity:'MEDIUM'|'HIGH'|'CRITICAL';
}
