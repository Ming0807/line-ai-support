import {z} from 'zod';

export const STAFF_LINE_LOGIN_PROVIDER='custom:line-staff';
export interface VerifiedStaffAuth {userId:string;lineIdentity:{identityId:string;subject:string}|null}
const userSchema=z.object({id:z.uuid(),is_anonymous:z.boolean().optional(),identities:z.array(z.unknown()).optional()}).passthrough();
const identitySchema=z.object({identity_id:z.uuid(),user_id:z.uuid(),provider:z.literal(STAFF_LINE_LOGIN_PROVIDER),
 id:z.string().regex(/^U[0-9a-fA-F]{32}$/u),identity_data:z.object({sub:z.string()}).passthrough()}).passthrough();

/** Projection of an ALREADY server-getUser-verified user, not a token verifier.
 * Business transactions independently recheck the matching auth.identities row.
 * Editable metadata, emails and display names can never establish LINE identity.
 */
export function projectVerifiedLineStaffUser(value:unknown):VerifiedStaffAuth|null{
 const parsed=userSchema.safeParse(value);if(!parsed.success||parsed.data.is_anonymous)return null;
 const user=parsed.data,candidates=(user.identities??[]).filter(identity=>identity!==null&&typeof identity==='object'
  &&'provider'in identity&&identity.provider===STAFF_LINE_LOGIN_PROVIDER);
 if(!candidates.length)return {userId:user.id,lineIdentity:null};
 if(candidates.length!==1)return null;
 const line=identitySchema.safeParse(candidates[0]);
 if(!line.success||line.data.user_id!==user.id||line.data.id!==line.data.identity_data.sub)return null;
 return {userId:user.id,lineIdentity:{identityId:line.data.identity_id,subject:line.data.identity_data.sub}};
}
