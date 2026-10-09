import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {AISnapshot} from '../lib/ai/run-worker';
import {proveInternalMiss,internalMissStillApplies} from '../lib/knowledge/internal-miss';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../lib/knowledge/embedding-space';

const key=Buffer.alloc(32,96).toString('base64');
const snapshot:AISnapshot={jobId:randomUUID(),sessionId:randomUUID(),conversationId:randomUUID(),messageId:randomUUID(),revision:1,question:'ระบบทดสอบ',history:[]};
const candidate={scope:{historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,
 programCode:null,curriculumCode:null,cohort:null},structuredQuery:{version:1,dataset:'university_systems',filters:{name:'ระบบทดสอบ'},limit:20},
 queryVector:[1,...Array<number>(383).fill(0)],fingerprint:LOCAL_EMBEDDING_FINGERPRINT};
function client(){const query=vi.fn(async()=>{throw new Error('SQL_MUST_NOT_RUN');});return {query,db:{query} as unknown as PoolClient};}

describe('private internal-miss boundary',()=>{
 it('invalid master keys stop before SQL',async()=>{
  for(const value of ['',Buffer.alloc(31).toString('base64'),key+'=']){const c=client();
   expect((await proveInternalMiss(c.db,candidate,snapshot,value)).status).toBe('UNAVAILABLE');expect(c.query).not.toHaveBeenCalled();}
 });
 it('rejects unsupported policy candidates instead of inferring missing structured applicability',async()=>{
  for(const value of [{...candidate,structuredQuery:null},{...candidate,structuredQuery:undefined},{...candidate,structuredMiss:candidate.structuredQuery},
   {...candidate,queryVector:[2,...Array<number>(383).fill(0)]},{...candidate,fingerprint:'0'.repeat(64)}]){
   const c=client();expect((await proveInternalMiss(c.db,value,snapshot,key)).status).toBe('UNAVAILABLE');expect(c.query).not.toHaveBeenCalled();}
 });
 it('never invokes accessors, proxies or serialization callbacks',async()=>{
  let calls=0;const getter=Object.defineProperty({},'scope',{enumerable:true,get:()=>{calls++;return candidate.scope;}});
  const proxy=new Proxy(candidate,{get:()=>{calls++;throw new Error('DO_NOT_INVOKE');}});
  for(const value of [getter,proxy,{...candidate,toJSON:()=>{calls++;return candidate;}}]){
   const c=client();expect((await proveInternalMiss(c.db,value,snapshot,key)).status).toBe('UNAVAILABLE');expect(c.query).not.toHaveBeenCalled();}
  expect(calls).toBe(0);
 });
 it('rejects oversized or incomplete source snapshots before SQL',async()=>{
  for(const value of [{...snapshot,question:'ก'.repeat(6000)},{...snapshot,messageId:'not-an-owned-message'},{...snapshot,revision:-1},
   {...snapshot,history:Array.from({length:9},()=>({role:'user' as const,content:'prior'}))}]){
   const c=client();expect((await proveInternalMiss(c.db,candidate,value,key)).status).toBe('UNAVAILABLE');expect(c.query).not.toHaveBeenCalled();}
 });
 it('a plausible fabricated EMPTY receipt has no SQL or search authority',async()=>{
  const c=client(),proof={...candidate,version:1,policy:'LOCAL_E5_384_THRESHOLD_065_LIMIT_12_V1',evaluatedOn:'2026-10-09',sourceDigest:'0'.repeat(64),signature:'0'.repeat(64)};
  expect(await internalMissStillApplies(c.db,proof,snapshot,key)).toBe(false);expect(c.query).not.toHaveBeenCalled();
 });
 it('database/readiness failure returns unavailable rather than a lower-authority miss',async()=>{
  const c=client();expect((await proveInternalMiss(c.db,candidate,snapshot,key)).status).toBe('UNAVAILABLE');expect(c.query).toHaveBeenCalledTimes(1);
 });
});
