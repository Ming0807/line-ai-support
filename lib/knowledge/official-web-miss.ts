import {createHmac,hkdfSync,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {AISnapshot} from '../ai/run-worker';
import {copyStructuredJson,freezeStructuredData,canonicalDigest} from '../imports/structured-mapping-contract';
import {publicWebPlanSchema} from './public-web-plan';
import {internalMissProofSchema,internalMissSourceDigest} from './internal-miss';
import {parseWebSearchRequest,readSuccessfulWebSearch} from './web-search-admission';
const hash=z.string().regex(/^[a-f0-9]{64}$/u);
const instant=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
 .refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value);
export const officialWebMissSchema=z.object({version:z.literal(1),kind:z.literal('OFFICIAL_EMPTY'),plan:publicWebPlanSchema,
 attemptId:z.uuid(),requestKey:hash,ownerDigest:hash,consumer:z.enum(['STUDENT','STAFF']),sourceDigest:hash,internalSignature:hash,
 observedAt:instant,expiresAt:instant,signature:hash}).strict().refine(value=>Date.parse(value.expiresAt)-Date.parse(value.observedAt)===300000);
export type OfficialWebMiss=z.infer<typeof officialWebMissSchema>;
function sign(body:unknown,encodedKey:string):string{
 const master=Buffer.from(encodedKey,'base64');if(master.length!==32||master.toString('base64')!==encodedKey)throw new Error();
 const key=Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1','official-web-empty-receipt-v1',32));
 return createHmac('sha256',key).update(canonicalDigest('official-web-empty-receipt-v1',body)).digest('hex');
}
async function clock(client:PoolClient):Promise<Date>{
 const time=(await client.query('select clock_timestamp() observed_at')).rows[0]?.observed_at;
 if(!(time instanceof Date)||!Number.isFinite(time.getTime()))throw new Error();return time;
}
/** Caller owns fresh actor/source/internal EMPTY checks and catalog lock; only owned callback issues this receipt. */
export async function sealOfficialWebMiss(client:PoolClient,requestInput:unknown,attemptId:string,resultInput:unknown,planInput:unknown,
 proofInput:unknown,source:AISnapshot,key:string,observedAtInput:unknown):Promise<OfficialWebMiss>{
 try{
  const plan=publicWebPlanSchema.parse(copyStructuredJson(planInput,4096,64)),request=parseWebSearchRequest(requestInput),
   proof=internalMissProofSchema.parse(copyStructuredJson(proofInput,64*1024,2200)),result=z.object({requestId:z.uuid(),credits:z.literal(1),results:z.array(z.never()).max(0)}).strict().parse(copyStructuredJson(resultInput,4096,64));
  if(request.purpose!==plan.purpose||request.topic!==plan.topic||request.academicYear!==plan.academicYear||plan.academicYear!==proof.scope.academicYear||
   proof.sourceDigest!==internalMissSourceDigest(source))throw new Error();
  const admission=await readSuccessfulWebSearch(client,attemptId,request,key,result.requestId),now=await clock(client),observedAt=instant.parse(observedAtInput),observed=Date.parse(observedAt);
  if(observed<admission.reservedAt.getTime()||now.getTime()<observed||now.getTime()>=observed+300000)throw new Error();
  const body={version:1 as const,kind:'OFFICIAL_EMPTY' as const,plan,attemptId,requestKey:admission.requestKey,ownerDigest:admission.ownerDigest,
   consumer:request.consumer,sourceDigest:proof.sourceDigest,internalSignature:proof.signature,observedAt,expiresAt:new Date(observed+300000).toISOString()};
  return freezeStructuredData(officialWebMissSchema.parse({...body,signature:sign(body,key)}));
 }catch{throw new Error('OFFICIAL_WEB_MISS_INVALID');}
}
/** Authenticate retained EMPTY observation under fresh authorized source; caller separately repeats actual internal searches. */
export async function officialWebMissStillApplies(client:PoolClient,input:unknown,proofInput:unknown,source:AISnapshot,key:string):Promise<boolean>{
 try{
  const value=officialWebMissSchema.parse(copyStructuredJson(input,8192,128)),proof=internalMissProofSchema.parse(copyStructuredJson(proofInput,64*1024,2200)),{signature,...body}=value;
  if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(body,key),'hex'))||value.sourceDigest!==internalMissSourceDigest(source)||
   value.sourceDigest!==proof.sourceDigest||value.internalSignature!==proof.signature||value.plan.academicYear!==proof.scope.academicYear)return false;
  const fresh=(time:Date)=>time.getTime()>=Date.parse(value.observedAt)&&time.getTime()<Date.parse(value.expiresAt);
  if(!fresh(await clock(client)))return false;
  const row=(await client.query('select * from private.web_search_attempts where attempt_id=$1',[value.attemptId])).rows[0];
  if(!row||row.attempt_id!==value.attemptId||row.request_key!==value.requestKey||row.owner_digest!==value.ownerDigest||row.consumer!==value.consumer||
   row.purpose!==value.plan.purpose||row.topic!==value.plan.topic||row.academic_year!==value.plan.academicYear||row.observation!=='SUCCESS'||row.http_status!==200||
   row.credits!==1||!z.uuid().safeParse(row.provider_request_id).success||!(row.reserved_at instanceof Date)||row.reserved_at.getTime()>Date.parse(value.observedAt))return false;
  return fresh(await clock(client));
 }catch{return false;}
}
