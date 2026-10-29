import {z} from 'zod';

const name=z.string().trim().min(1).max(120),staffCode=z.string().trim().min(1).max(64);
const revision=z.number().int().min(0).max(2147483647),reason=z.string().trim().min(1).max(2000);
export const submitApplicationSchema=z.strictObject({applicantName:name,staffCode,departmentId:z.uuid(),requestId:z.uuid()});
export const decideApplicationSchema=z.discriminatedUnion('decision',[
 z.strictObject({decision:z.literal('APPROVE'),departmentId:z.uuid(),reason:reason.optional(),revision,requestId:z.uuid()}),
 z.strictObject({decision:z.literal('REJECT'),reason,revision,requestId:z.uuid()}),
]);
export const suspendApplicationSchema=z.strictObject({reason,revision,requestId:z.uuid()});
const canonicalInteger=(fallback:number,max:number)=>z.union([
 z.number().int().min(1).max(max),
 z.string().regex(/^[1-9][0-9]*$/u).max(7).transform(Number).pipe(z.number().int().min(1).max(max)),
]).default(fallback);
export const applicationQuerySchema=z.strictObject({status:z.enum(['PENDING','APPROVED','REJECTED','SUSPENDED']).optional(),
 page:canonicalInteger(1,100),pageSize:canonicalInteger(20,100)});
export class StaffApplicationError extends Error{
 constructor(public code:'INVALID_REQUEST'|'UNAUTHENTICATED'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'UNAVAILABLE'|'STAFF_ACCOUNT_INACTIVE'|'IDENTITY_CHANGED'|'ALREADY_STAFF'){
  super(code);
 }
}
