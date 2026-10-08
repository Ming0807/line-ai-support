import {z} from 'zod';
import {OperationsError,parseActivityQuery,windowSchema} from './contracts';
export interface MetricFilters {from:string;to:string;department?:string}
export function parseMetricQuery(params:URLSearchParams,now=new Date()):MetricFilters {
 const dates=new URLSearchParams();let department:string|undefined;
 const seen=new Set<string>();for(const [key,value] of params){if(seen.has(key)||!['from','to','department'].includes(key))throw new OperationsError('INVALID_REQUEST');seen.add(key);if(key==='department')department=z.uuid().parse(value).toLowerCase();else dates.set(key,value);}
 const {from,to}=parseActivityQuery(dates,now);return {...(department?{department}:{}),from,to};
}
export function parseUsageQuery(params:URLSearchParams,now=new Date()){if(params.has('department'))throw new OperationsError('INVALID_REQUEST');return parseMetricQuery(params,now);}
export function validateMetricFilters(value:MetricFilters){return parseMetricQuery(new URLSearchParams(Object.entries(value)));}
const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),label=z.string().min(1).max(200),timestamp=z.string().datetime();
export const summarySchema=z.strictObject({observedAt:timestamp,window:windowSchema,departmentId:z.uuid().nullable(),counts:z.strictObject({total:count,open:count,waitingStaff:count,handling:count,waitingUser:count,resolved:count,closed:count,critical:count,high:count}),intake:z.array(z.strictObject({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),count})).max(90)});
const samples=z.strictObject({samples:count,averageSeconds:z.number().min(0).nullable()}).refine(value=>value.samples===0?value.averageSeconds===null:value.averageSeconds!==null);
export const analyticsSchema=z.strictObject({observedAt:timestamp,window:windowSchema,departmentId:z.uuid().nullable(),firstStaffResponse:samples,resolution:samples,aiResolutionRate:z.null(),distribution:z.array(z.strictObject({departmentId:z.uuid(),departmentName:label,count})).max(500)});
const tokenCount=z.strictObject({knownTotal:count,unknownCalls:count});
const totals=z.strictObject({calls:count,success:count,errors:count,fallback:count,meanLatencyMs:z.number().min(0).nullable(),inputTokens:tokenCount,outputTokens:tokenCount,cost:z.strictObject({knownTotal:z.string().regex(/^\d+(?:\.\d+)?$/u).max(40),unknownCalls:count})}).refine(value=>value.calls===value.success+value.errors&&value.fallback<=value.calls&&value.inputTokens.unknownCalls<=value.calls&&value.outputTokens.unknownCalls<=value.calls&&value.cost.unknownCalls<=value.calls&&(value.calls===0?value.meanLatencyMs===null:value.meanLatencyMs!==null));
export const usageSchema=z.strictObject({observedAt:timestamp,window:windowSchema,totals,models:z.array(z.strictObject({providerName:label,modelName:label,totals})).max(1000)});
export const departmentsSchema=z.strictObject({observedAt:timestamp,items:z.array(z.strictObject({id:z.uuid(),code:label,name:label,totalTickets:count,openTickets:count,activeStaff:count})).max(500)});
const queueCounts=z.array(z.strictObject({status:z.enum(['PENDING','PROCESSING','DONE','DEAD','SENT','SUPPRESSED','UNKNOWN']),channel:z.enum(['STUDENT','STAFF']).nullable(),count})).max(20);
export const settingsStatusSchema=z.strictObject({observedAt:timestamp,database:z.literal('OBSERVED_OK'),pool:z.strictObject({total:count,idle:count,waiting:count}),queues:z.strictObject({inbox:queueCounts,ai:queueCounts,outbox:queueCounts}),workerLiveness:z.literal('UNKNOWN'),line:z.strictObject({studentConfigured:z.boolean(),staffConfigured:z.boolean()})});
export type OperationsSummary=z.infer<typeof summarySchema>;export type OperationsAnalytics=z.infer<typeof analyticsSchema>;export type OperationsUsage=z.infer<typeof usageSchema>;export type OperationsDepartments=z.infer<typeof departmentsSchema>;export type OperationsSettings=z.infer<typeof settingsStatusSchema>;
