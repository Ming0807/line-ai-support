import {expect,it,vi} from 'vitest';
import {createKnowledgeProducer,type KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import {aiResultSchema,requiresStructuredCatalog} from '../lib/ai/jobs';
import {createWebLeads,buildWebLeadReply} from '../lib/knowledge/web-leads';
import {projectStaffKnowledgeAdvice} from '../lib/staff/knowledge-assistance-projection';
import {staffKnowledgeAdviceSchema} from '../lib/staff/knowledge-assistance-contracts';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../lib/knowledge/embedding-space';
import type {AISnapshot} from '../lib/ai/run-worker';

const scope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
const query={version:1 as const,dataset:'university_services' as const,filters:{name:'ห้องสมุด'},limit:20};
const vector=[1,...Array<number>(383).fill(0)];
const proposal={version:1 as const,purpose:'YRU_INFORMATION' as const,topic:'LIBRARY_SERVICES' as const,academicYear:null,quote:'ห้องสมุด'};
function leads(){return createWebLeads({version:1,purpose:'YRU_INFORMATION',topic:'LIBRARY_SERVICES',academicYear:null},
 [{title:'Library',url:'https://www.yru.ac.th/library'}],{version:1,policy:'LOCAL_E5_384_THRESHOLD_065_LIMIT_12_V1',evaluatedOn:'2026-10-09',sourceDigest:'1'.repeat(64),signature:'2'.repeat(64),scope,structuredQuery:query,queryVector:vector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT},'2026-10-09T09:00:00.000Z');}
const source:AISnapshot={jobId:'00000000-0000-4000-8000-000000000001',sessionId:'00000000-0000-4000-8000-000000000002',conversationId:'00000000-0000-4000-8000-000000000003',messageId:'00000000-0000-4000-8000-000000000004',revision:0,question:'ขอบริการห้องสมุด',history:[]};
function fixture(overrides:Partial<KnowledgeProducerOptions>={}){
 const generate=vi.fn(async(input:{taskType:string})=>({output:input.taskType==='KNOWLEDGE_SCOPE'?scope:input.taskType==='KNOWLEDGE_METHOD'?{method:'STRUCTURED',query}:proposal,toolCalls:[],providerId:'fixture',modelId:'fixture',fallbackUsed:false}));
 const webFallback=vi.fn(async()=>leads());
 const options={generate:generate as unknown as KnowledgeProducerOptions['generate'],embed:async()=>({vectors:[vector],fingerprint:LOCAL_EMBEDDING_FINGERPRINT,dimensions:384,providerId:'fixture',modelId:'fixture',fallbackUsed:false}),search:async()=>[],structuredSearch:async()=>({status:'EMPTY' as const}),webFallback,...overrides};
 return {produce:createKnowledgeProducer(options),generate,webFallback};
}
it('advances explicit Structured and RAG misses through a closed plan and an owned callback',async()=>{
 const f=fixture();expect(await f.produce(source,new AbortController().signal)).toEqual(leads());
 expect(f.generate.mock.calls.map(([call])=>call.taskType)).toEqual(['KNOWLEDGE_SCOPE','KNOWLEDGE_METHOD','KNOWLEDGE_WEB_PLAN']);
 expect(f.webFallback).toHaveBeenCalledWith({question:source.question,scope,structuredQuery:query,queryVector:vector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,proposal},expect.any(AbortSignal));
});
it('default-off and an unassessed RAG-only selection do not request a web plan',async()=>{
 const off=fixture({webFallback:undefined});expect((await off.produce(source,new AbortController().signal)).kind).toBe('CLARIFY');expect(off.generate).toHaveBeenCalledTimes(2);
 const rag=fixture({structuredSearch:undefined});expect((await rag.produce(source,new AbortController().signal)).kind).toBe('CLARIFY');expect(rag.webFallback).not.toHaveBeenCalled();expect(rag.generate).toHaveBeenCalledTimes(1);
});
it('unavailable owned web callback remains a limitation and missing applicability stays clarification',async()=>{
 const f=fixture({webFallback:async()=>null});expect((await f.produce(source,new AbortController().signal)).kind).toBe('CLARIFY');
 const scoped=fixture();expect((await scoped.produce({...source,question:source.question+' สำหรับนักศึกษา'},new AbortController().signal)).kind).toBe('CLARIFY');expect(scoped.webFallback).not.toHaveBeenCalled();
});
it('malformed semantic proposals never reach an owned search callback',async()=>{
 const f=fixture();f.generate.mockImplementation(async input=>({output:input.taskType==='KNOWLEDGE_SCOPE'?scope:input.taskType==='KNOWLEDGE_METHOD'?{method:'STRUCTURED',query}:{...proposal,url:'https://evil.test/'},toolCalls:[],providerId:'fixture',modelId:'fixture',fallbackUsed:false}));
 expect((await f.produce(source,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.webFallback).not.toHaveBeenCalled();
});
it('only a validated explicit PROCEDURE proposal can advance a RAG method to owned web fallback',async()=>{
 const question='วิธีเข้าใช้บริการห้องสมุด',notApplicable={version:1,kind:'PROCEDURE',topic:'LIBRARY_SERVICES',quote:question};
 const generate=vi.fn(async(input:{taskType:string})=>{const output:unknown=input.taskType==='KNOWLEDGE_SCOPE'?scope:input.taskType==='KNOWLEDGE_METHOD'?{method:'RAG',query:null,notApplicable}:proposal;return {output,toolCalls:[],providerId:'fixture',modelId:'fixture',fallbackUsed:false};});
 const f=fixture({generate:generate as unknown as KnowledgeProducerOptions['generate']});
 expect((await f.produce({...source,question},new AbortController().signal)).kind).toBe('WEB_LEADS');
 expect(f.webFallback).toHaveBeenCalledWith({question,scope,structuredQuery:null,notApplicable,queryVector:vector,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,proposal},expect.any(AbortSignal));
 expect(generate.mock.calls.map(([call])=>call.taskType)).toEqual(['KNOWLEDGE_SCOPE','KNOWLEDGE_METHOD','KNOWLEDGE_WEB_PLAN']);
 const exact=fixture({generate:generate as unknown as KnowledgeProducerOptions['generate']});
 expect((await exact.produce({...source,question:'วิธีเข้าใช้บริการห้องสมุดเวลาเปิดกี่โมง'},new AbortController().signal)).kind).toBe('CLARIFY');expect(exact.webFallback).not.toHaveBeenCalled();
});
it('private lead results require the catalog and reject additional persisted provider data',()=>{
 const parsed=aiResultSchema.parse(leads());expect(requiresStructuredCatalog(parsed)).toBe(true);
 expect(aiResultSchema.safeParse({...leads(),rawSnippet:'private external content'}).success).toBe(false);
});
it('Staff exposes distinct unverified leads and editable canonical links without private receipt fields',()=>{
 const result=projectStaffKnowledgeAdvice(leads(),8);expect(result.status).toBe('WEB_LEADS');expect(result.revision).toBe(8);
 expect(result.draftText).toBe(buildWebLeadReply(leads()).messages.map(m=>m.text).join('\n'));
 expect(result.sources).toEqual([{title:'Library',academicYear:null,url:'https://www.yru.ac.th/library',location:'ผลค้นเว็บ ยังไม่ได้ยืนยัน'}]);
 expect(result.answer).toContain('ยังไม่ได้ยืนยัน');expect(JSON.stringify(result)).not.toMatch(/signature|sourceDigest|queryVector|fingerprint/);
 expect(staffKnowledgeAdviceSchema.safeParse(result).success).toBe(true);
});
