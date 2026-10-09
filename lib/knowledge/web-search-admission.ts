import {createHmac,hkdfSync} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {transaction} from '../database/pool';
import {copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {buildPublicSearchQuery} from './public-search-query';

const requestSchema=z.object({consumer:z.enum(['STUDENT','STAFF']),operationId:z.uuid(),ownerId:z.uuid(),
 purpose:z.enum(['YRU_INFORMATION','GENERAL_PUBLIC']),topic:z.string().max(40),academicYear:z.number().int().nullable()}).strict();
export type WebSearchRequest=z.infer<typeof requestSchema>;
export type WebSearchAdmission=Readonly<{status:'RESERVED';attemptId:string}|{status:'DUPLICATE'|'EXHAUSTED'|'UNAVAILABLE'}>;
const observationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('SUCCESS'),httpStatus:z.literal(200),providerRequestId:z.uuid(),credits:z.literal(1)}).strict(),
 z.object({kind:z.literal('ERROR'),httpStatus:z.number().int().min(100).max(599).nullable()}).strict(),
]);
export type WebSearchObservation=z.infer<typeof observationSchema>;

/** Private server request only; this validates shape, not internal-miss or actor authority. */
export function parseWebSearchRequest(input:unknown):WebSearchRequest{
 try{
  const request=requestSchema.parse(copyStructuredJson(input,4096,64));
  buildPublicSearchQuery({version:1,purpose:request.purpose,topic:request.topic,academicYear:request.academicYear});
  return freezeStructuredData({...request,operationId:request.operationId.toLowerCase(),ownerId:request.ownerId.toLowerCase()});
 }catch{throw new Error('WEB_SEARCH_REQUEST_INVALID');}
}
function admissionDigests(request:WebSearchRequest,encodedKey:string){
 const master=Buffer.from(encodedKey,'base64');
 if(master.length!==32||master.toString('base64')!==encodedKey)throw new Error('WEB_SEARCH_REQUEST_INVALID');
 const key=Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1','web-search-admission',32));
 const digest=(parts:string[])=>createHmac('sha256',key).update(JSON.stringify(parts)).digest('hex');
 return {requestKey:digest(['request',request.consumer,request.operationId,request.purpose]),ownerDigest:digest(['owner',request.consumer,request.ownerId])};
}

/** Commit a retained attempt before HTTP. An uncertain commit grants no permission to send. */
export async function reserveWebSearch(pool:Pool,input:unknown,encodedKey:string):Promise<WebSearchAdmission>{
 try{
  const request=parseWebSearchRequest(input),digests=admissionDigests(request,encodedKey);
  return await transaction(async client=>{
   await client.query("set local statement_timeout='2s';set local lock_timeout='2s'");
   await client.query("select pg_advisory_xact_lock(hashtextextended('web-search-quota:v1',0))");
   if((await client.query('select 1 from private.web_search_attempts where request_key=$1',[digests.requestKey])).rowCount)return {status:'DUPLICATE'};
   const capacity=(await client.query(`select
    (select count(*) from private.web_search_attempts where quota_day=(statement_timestamp() at time zone 'UTC')::date)<50
    and (select count(*) from private.web_search_attempts where quota_month=date_trunc('month',statement_timestamp() at time zone 'UTC')::date)<500 available`)).rows[0];
   if(capacity?.available!==true)return {status:'EXHAUSTED'};
   const row=(await client.query(`insert into private.web_search_attempts(request_key,owner_digest,consumer,purpose,topic,academic_year)
    values($1,$2,$3,$4,$5,$6) returning attempt_id`,[digests.requestKey,digests.ownerDigest,request.consumer,request.purpose,request.topic,request.academicYear])).rows[0];
   if(!row||!z.uuid().safeParse(row.attempt_id).success)throw new Error('WEB_SEARCH_ADMISSION_UNAVAILABLE');
   return {status:'RESERVED',attemptId:row.attempt_id} as const;
  },pool);
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error&&error.code==='P0001'&&'message' in error&&error.message==='WEB_SEARCH_QUOTA_EXHAUSTED')return {status:'EXHAUSTED'};
  return {status:'UNAVAILABLE'};
 }
}

/** Observation is one-way diagnostics: it cannot authorize, refund or retry a search. */
export async function observeWebSearch(pool:Pool,attemptId:string,input:unknown):Promise<boolean>{
 try{
  if(!z.uuid().safeParse(attemptId).success)return false;
  const value=observationSchema.parse(copyStructuredJson(input,2048,32));
  return await transaction(async client=>{
   await client.query("set local statement_timeout='2s';set local lock_timeout='2s'");
   const result=await client.query(`update private.web_search_attempts set observation=$2,http_status=$3,provider_request_id=$4,credits=$5
    where attempt_id=$1 and observation='UNKNOWN' returning attempt_id`,[attemptId,value.kind,value.httpStatus,
     value.kind==='SUCCESS'?value.providerRequestId:null,value.kind==='SUCCESS'?value.credits:null]);
   return result.rowCount===1;
  },pool);
 }catch{return false;}
}
