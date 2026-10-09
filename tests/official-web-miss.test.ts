import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {AISnapshot} from '../lib/ai/run-worker';
import {sealOfficialWebMiss,officialWebMissStillApplies} from '../lib/knowledge/official-web-miss';
import {internalMissSourceDigest} from '../lib/knowledge/internal-miss';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../lib/knowledge/embedding-space';
import {webSearchAdmissionIdentity} from '../lib/knowledge/web-search-admission';
const key=Buffer.alloc(32,12).toString('base64'),stamp='2026-10-09T08:00:00.000Z';
const source={jobId:randomUUID(),sessionId:randomUUID(),conversationId:randomUUID(),messageId:randomUUID(),revision:1,question:'Wi-Fi ต่อไม่ได้',history:[]} as AISnapshot;
const plan={version:1 as const,purpose:'YRU_INFORMATION' as const,topic:'WIFI_ACCESS' as const,academicYear:null};
const request={consumer:'STUDENT' as const,operationId:source.jobId,ownerId:randomUUID(),purpose:plan.purpose,topic:plan.topic,academicYear:null};
const proof={version:1 as const,policy:'LOCAL_E5_384_THRESHOLD_065_LIMIT_12_V1' as const,evaluatedOn:'2026-10-09',sourceDigest:internalMissSourceDigest(source),signature:'2'.repeat(64),
 scope:{historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null},
 structuredQuery:{version:1 as const,dataset:'university_services' as const,filters:{name:'Wi-Fi'},limit:20},queryVector:[1,...Array<number>(383).fill(0)],fingerprint:LOCAL_EMBEDDING_FINGERPRINT};
function fixture(){
 const attemptId=randomUUID(),result={requestId:randomUUID(),credits:1 as const,results:[]},identity=webSearchAdmissionIdentity(request,key);
 const row={attempt_id:attemptId,request_key:identity.requestKey,owner_digest:identity.ownerDigest,consumer:'STUDENT',purpose:plan.purpose,topic:plan.topic,academic_year:null,
  observation:'SUCCESS',http_status:200,credits:1,provider_request_id:result.requestId,reserved_at:new Date(Date.parse(stamp)-1000)};
 let time=new Date(stamp);
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('clock_timestamp()')?[{observed_at:time}]:[row]}));
 const client={query} as unknown as PoolClient;
 return {client,row,result,attemptId,setTime:(value:string)=>{time=new Date(value);}};
}
it('seals only a durable exact successful empty search, dropping snippets and private provider/owner identifiers',async()=>{
 const f=fixture(),receipt=await sealOfficialWebMiss(f.client,request,f.attemptId,f.result,plan,proof,source,key,stamp);
 expect(receipt.expiresAt).toBe('2026-10-09T08:05:00.000Z');expect(Object.isFrozen(receipt)).toBe(true);
 expect(JSON.stringify(receipt)).not.toContain(f.result.requestId);expect(JSON.stringify(receipt)).not.toContain(request.ownerId);
 expect(await officialWebMissStillApplies(f.client,receipt,proof,source,key)).toBe(true);
});
it('unknown/failed/wrong admission observations and nonempty connector results cannot authorize General',async()=>{
 for(const patch of [{observation:'UNKNOWN'},{observation:'ERROR'},{http_status:429},{credits:null},{purpose:'GENERAL_PUBLIC'},
  {request_key:'0'.repeat(64)},{owner_digest:'0'.repeat(64)},{provider_request_id:randomUUID()},{reserved_at:new Date(Date.parse(stamp)+1)}]){
  const f=fixture();Object.assign(f.row,patch);
  await expect(sealOfficialWebMiss(f.client,request,f.attemptId,f.result,plan,proof,source,key,stamp)).rejects.toThrow('OFFICIAL_WEB_MISS_INVALID');
 }
 const f=fixture();await expect(sealOfficialWebMiss(f.client,request,f.attemptId,{...f.result,results:[{title:'Found',url:'https://nse.yru.ac.th/',content:'',score:1}]},plan,proof,source,key,stamp)).rejects.toThrow('OFFICIAL_WEB_MISS_INVALID');
});
it('receipt tampering, another source/key/internal signature, future or expired DB clocks fail closed',async()=>{
 const f=fixture(),receipt=await sealOfficialWebMiss(f.client,request,f.attemptId,f.result,plan,proof,source,key,stamp);
 for(const value of [{...receipt,signature:'0'.repeat(64)},{...receipt,attemptId:randomUUID()},{...receipt,expiresAt:'2026-10-09T09:00:00.000Z'}])
  expect(await officialWebMissStillApplies(f.client,value,proof,source,key)).toBe(false);
 expect(await officialWebMissStillApplies(f.client,receipt,{...proof,signature:'3'.repeat(64)},source,key)).toBe(false);
 expect(await officialWebMissStillApplies(f.client,receipt,proof,{...source,revision:2},key)).toBe(false);
 expect(await officialWebMissStillApplies(f.client,receipt,proof,source,Buffer.alloc(32,13).toString('base64'))).toBe(false);
 for(const time of ['2026-10-09T07:59:59.999Z','2026-10-09T08:05:00.000Z']){f.setTime(time);expect(await officialWebMissStillApplies(f.client,receipt,proof,source,key)).toBe(false);}
});
it('delayed issuance cannot extend the original database observation lifetime',async()=>{
 const f=fixture();f.setTime('2026-10-09T08:04:00.000Z');
 const receipt=await sealOfficialWebMiss(f.client,request,f.attemptId,f.result,plan,proof,source,key,stamp);
 expect(receipt.observedAt).toBe(stamp);expect(receipt.expiresAt).toBe('2026-10-09T08:05:00.000Z');
 f.setTime('2026-10-09T08:05:00.000Z');await expect(sealOfficialWebMiss(f.client,request,f.attemptId,f.result,plan,proof,source,key,stamp)).rejects.toThrow('OFFICIAL_WEB_MISS_INVALID');
});
