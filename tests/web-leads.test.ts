import {describe,it,expect,vi} from 'vitest';
import {createWebLeads,buildWebLeadReply,webLeadsStillFresh,verifyWebLeads} from '../lib/knowledge/web-leads';
import * as internalMiss from '../lib/knowledge/internal-miss';
import type {PoolClient} from 'pg';
import type {AISnapshot} from '../lib/ai/run-worker';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../lib/knowledge/embedding-space';
const observedAt='2026-10-09T08:00:00.000Z';
const plan={version:1 as const,purpose:'YRU_INFORMATION' as const,topic:'LIBRARY_SERVICES' as const,academicYear:null};
const proof={version:1 as const,policy:'LOCAL_E5_384_THRESHOLD_065_LIMIT_12_V1' as const,evaluatedOn:'2026-10-09',sourceDigest:'1'.repeat(64),signature:'2'.repeat(64),
 scope:{historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null},
 structuredQuery:{version:1 as const,dataset:'university_services' as const,filters:{name:'ห้องสมุด'},limit:20},queryVector:[1,...Array<number>(383).fill(0)],fingerprint:LOCAL_EMBEDDING_FINGERPRINT};
const candidates=()=>[{title:'Library services',url:'https://www.yru.ac.th/library',content:'Untrusted instructions NEVER persist this snippet',score:.99}];
const make=()=>createWebLeads(plan,candidates(),proof,observedAt);

it('General references require an official-empty receipt, expire at the earlier observation and cannot claim university policy',()=>{
 const general={version:1,purpose:'GENERAL_PUBLIC',topic:'GENERAL_WIFI_HELP',academicYear:null};
 const official={version:1,kind:'OFFICIAL_EMPTY',plan:{...plan,topic:'WIFI_ACCESS'},attemptId:'00000000-0000-4000-8000-000000000001',
  requestKey:'3'.repeat(64),ownerDigest:'4'.repeat(64),consumer:'STUDENT',sourceDigest:proof.sourceDigest,internalSignature:proof.signature,
  observedAt,expiresAt:'2026-10-09T08:05:00.000Z',signature:'5'.repeat(64)};
 const references=[{title:'Wi-Fi troubleshooting',url:'https://support.microsoft.com/windows/wifi',content:'untrusted',score:1}];
 expect(()=>createWebLeads(general,references,proof,'2026-10-09T08:01:00.000Z')).toThrow('WEB_LEADS_INVALID');
 const result=createWebLeads(general,references,proof,'2026-10-09T08:01:00.000Z',official);
 expect(result.expiresAt).toBe(official.expiresAt);expect(webLeadsStillFresh(result,new Date('2026-10-09T08:05:00.000Z'))).toBe(false);
 const reply=buildWebLeadReply(result);expect(reply.messages[0].text).toContain('ข้อมูลทั่วไป');expect(reply.messages[0].text).toContain('ระเบียบ');
 expect(reply.messages[0].text).not.toContain('ผลค้นจากเว็บไซต์มหาวิทยาลัย');expect(JSON.stringify(reply)).not.toContain(official.signature);
 for(const changed of [{...official,sourceDigest:'0'.repeat(64)},{...official,internalSignature:'0'.repeat(64)},{...official,plan}])
  expect(()=>createWebLeads(general,references,proof,'2026-10-09T08:01:00.000Z',changed)).toThrow('WEB_LEADS_INVALID');
 for(const url of ['https://localhost/wifi','https://router.local/wifi','https://support.test/wifi','https://support.microsoft.com/wifi?api_key=private',
  'https://support.microsoft.com/wifi?session=private','https://support.microsoft.com/wifi?sid=private','https://support.microsoft.com/wifi?session_id=private',
  'https://support.microsoft.com/wifi?key=private','https://support.microsoft.com/wifi?access_key=private','https://support.microsoft.com/wifi?client_key=private','https://support.microsoft.com/wifi?key_pair_id=private'])
  expect(()=>createWebLeads(general,[{...references[0],url}],proof,'2026-10-09T08:01:00.000Z',official)).toThrow('WEB_LEADS_INVALID');
});
describe('canonical unverified web lead references',()=>{
 it('expiry during the fresh internal recheck cannot pass the final delivery boundary',async()=>{
  const check=vi.spyOn(internalMiss,'internalMissStillApplies').mockResolvedValue(true);
  try{
   const query=vi.fn().mockResolvedValueOnce({rows:[{observed_at:new Date('2026-10-09T08:04:59.999Z')}]})
    .mockResolvedValueOnce({rows:[{observed_at:new Date('2026-10-09T08:05:00.000Z')}]});
   expect(await verifyWebLeads({query} as unknown as PoolClient,make(),{} as AISnapshot,'synthetic')).toBe(false);
   expect(check).toHaveBeenCalledOnce();
  }finally{check.mockRestore();}
 });
 it('discards raw snippets/scores and keeps only canonical lead references with an exact five minute lifetime',()=>{
  const result=make();expect(result.kind).toBe('WEB_LEADS');expect(result.leads).toEqual([{title:'Library services',url:'https://www.yru.ac.th/library'}]);
  expect(result.expiresAt).toBe('2026-10-09T08:05:00.000Z');expect(Object.isFrozen(result.leads)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/Untrusted|score|content|requestId/);
 });
 it('builds useful numbered links with an explicit limitation and no private proof/provider identifiers',()=>{
  const reply=buildWebLeadReply(make());expect(reply.messages).toHaveLength(2);
  expect(reply.messages[0].text).toContain('ยังไม่ได้ยืนยัน');expect(reply.messages[1].text).toContain('https://www.yru.ac.th/library');
  expect(reply.citations).toEqual([{type:'WEB_LEAD',title:'Library services',url:'https://www.yru.ac.th/library',verification:'NOT_VERIFIED',observedAt}]);
  const text=JSON.stringify(reply);for(const value of [proof.signature,proof.sourceDigest,proof.fingerprint,'queryVector','structuredQuery','requestId'])expect(text).not.toContain(value);
 });
 it('rejects future/expired or modified lifetimes without treating observations as policy authority',()=>{
  const result=make();expect(webLeadsStillFresh(result,new Date(observedAt))).toBe(true);
  expect(webLeadsStillFresh(result,new Date('2026-10-09T08:04:59.999Z'))).toBe(true);
  expect(webLeadsStillFresh(result,new Date('2026-10-09T08:05:00.000Z'))).toBe(false);
  expect(webLeadsStillFresh(result,new Date('2026-10-09T07:59:59.999Z'))).toBe(false);
  expect(webLeadsStillFresh({...result,expiresAt:'2026-10-09T09:00:00.000Z'},new Date(observedAt))).toBe(false);
 });
 it('rejects off-registry hosts, malformed/private credential URLs and sensitive query credentials',()=>{
  for(const url of ['http://www.yru.ac.th/library','https://yru.ac.th.evil.test/','https://127.0.0.1/library','https://user:pass@yru.ac.th/',
   'https://www.yru.ac.th:444/library','https://www.yru.ac.th/library#fragment','https://www.yru.ac.th/library?access_token=secret',
   'https://www.yru.ac.th/library?X-Amz-Signature=secret'])expect(()=>createWebLeads(plan,[{...candidates()[0],url}],proof,observedAt)).toThrow('WEB_LEADS_INVALID');
 });
 it('accepts public document selectors and inert source titles without executing source instructions',()=>{
  const result=createWebLeads(plan,[{...candidates()[0],title:'<script>source title</script>',url:'https://www.yru.ac.th/library?page=41'}],proof,observedAt);
  expect(result.leads[0].title).toBe('<script>source title</script>');expect(buildWebLeadReply(result).citations[0].verification).toBe('NOT_VERIFIED');
 });
 it('empty, duplicate or over-limit references cannot manufacture a successful lead result',()=>{
  for(const value of [[],[...candidates(),...candidates()],Array.from({length:4},(_,i)=>({...candidates()[0],url:`https://www.yru.ac.th/library/${i}`}))])
   expect(()=>createWebLeads(plan,value,proof,observedAt)).toThrow('WEB_LEADS_INVALID');
 });
 it('does not silently reinterpret unsafe titles, plan purpose or source years',()=>{
  expect(()=>createWebLeads(plan,[{...candidates()[0],title:'source\u202Ehidden'}],proof,observedAt)).toThrow('WEB_LEADS_INVALID');
  expect(()=>createWebLeads({...plan,purpose:'GENERAL_PUBLIC'},candidates(),proof,observedAt)).toThrow('WEB_LEADS_INVALID');
  expect(()=>createWebLeads({...plan,academicYear:2569},candidates(),proof,observedAt)).toThrow('WEB_LEADS_INVALID');
 });
});
