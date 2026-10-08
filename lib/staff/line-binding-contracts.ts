import {z} from 'zod';

// A 32-byte base64url value has 43 characters and two zero padding bits.
export function parseBindingCommand(text:string):string|null {
 return /^yru:staff:bind:([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/.exec(text)?.[1]??null;
}
export const bindingChallengeInput=z.object({requestId:z.uuid()}).strict();
export const bindingStatusSchema=z.object({bound:z.boolean(),pending:z.boolean(),expiresAt:z.iso.datetime().nullable()}).strict().refine(s=>
 (!s.bound||!s.pending)&&s.pending===(s.expiresAt!==null));
export type BindingStatus=z.infer<typeof bindingStatusSchema>;
export const bindingChallengeSchema=z.object({command:z.string().refine(text=>parseBindingCommand(text)!==null),expiresAt:z.iso.datetime()}).strict();
export class BindingError extends Error {
 constructor(public code:'INVALID_REQUEST'|'ALREADY_BOUND'|'CHALLENGE_EXPIRED'|'UNAVAILABLE'){super(code);}
}
