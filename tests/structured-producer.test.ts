import {expect,it,vi} from 'vitest';
import {createKnowledgeProducer,type KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import {validateStructuredEvidence} from '../lib/knowledge/structured-citations';
import {canonicalDigest} from '../lib/imports/structured-mapping-contract';
import {aiResultSchema} from '../lib/ai/jobs';
import {buildRuleProof} from '../lib/knowledge/rule-proof';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hash='a'.repeat(64),payload={service_code:'LIBRARY',name:'ห้องสมุด',description:null,location:null,opening_hours:null,phone:null,email:null,url:null};
const scope={historical:false,academicYear:null,asOfDate:null,familyCodes:['LIBRARY'],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
const query={version:1,dataset:'university_services',filters:{name:'ห้องสมุด'},limit:20};
const evidence=validateStructuredEvidence({rowId:id,dataset:'university_services',payload,title:'ห้องสมุด',familyCode:'LIBRARY',academicYear:null,authorityLevel:90,sourceUrl:null,reference:{schemaVersion:1,dataset:'university_services',registryVersion:'structured-v1',mapperVersion:'structured-mapper-v1',rowId:id,documentId:id,documentRevision:0,jobId:id,jobRevision:0,extractionRevision:1,reviewRevision:1,sourceChecksum:hash,extractionDigest:hash,mappingDigest:hash,payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'university_services',payload}),planDigest:hash,tableIndex:0,rowIndex:1,tableFirstRow:1,sourceRow:2,coordinateKind:'CSV_RECORD',sourceLocation:{kind:'CSV',rowStart:1,rowEnd:2,columnStart:1,columnEnd:8,tableIndex:1},ruleProof:{familyId:id,baseDocumentId:id,versionStream:'main',ruleRevision:'0',evaluationDate:'2026-10-08',contextDigest:hash}}});
const snapshot={jobId:id,sessionId:id,conversationId:id,messageId:id,revision:0,question:'ห้องสมุดเปิดกี่โมง',history:[]};
function fixture(selected:unknown={method:'STRUCTURED',query}){
 const outputs=[scope,selected,{answer:'ตรวจสอบห้องสมุดได้ครับ',citationRowIds:[id]}];
 const generate=vi.fn(async()=>({output:outputs.shift(),toolCalls:[],providerId:id,modelId:id,fallbackUsed:false}));
 const embed=vi.fn(async()=>{throw Error('E5_NOT_EXPECTED');}),search=vi.fn(async()=>{throw Error('RAG_NOT_EXPECTED');});
 const structuredSearch=vi.fn(async()=>({status:'READY' as const,evidence:[evidence]}));
 const options={generate:generate as unknown as KnowledgeProducerOptions['generate'],embed,search,structuredSearch};
 return {generate,embed,search,structuredSearch,produce:createKnowledgeProducer(options)};
}
it('produces a durable exact answer without E5/RAG and passes the complete query/scope',async()=>{
 const f=fixture(),result=await f.produce(snapshot,new AbortController().signal);
 expect(result).toMatchObject({kind:'STRUCTURED_ANSWER',query,scope,evidence:[evidence]});expect(f.structuredSearch).toHaveBeenCalledWith({query,scope});expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();expect(aiResultSchema.safeParse(result).success).toBe(true);
});
it('rejects a model invented exact label before database work',async()=>{
 const f=fixture({method:'STRUCTURED',query:{...query,filters:{name:'บริการลับที่ไม่ได้ถาม'}}});
 expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.structuredSearch).not.toHaveBeenCalled();expect(f.embed).not.toHaveBeenCalled();
});
it('never infers required fee context or ALL values from a generic user question',async()=>{
 const f=fixture({method:'STRUCTURED',query:{version:1,dataset:'tuition_fees',filters:{academic_year:2569,program_name:'A',student_group:'ALL',study_type:'REGULAR'},limit:20}});
 expect((await f.produce({...snapshot,question:'ค่าเทอมเท่าไร'},new AbortController().signal)).kind).toBe('CLARIFY');expect(f.structuredSearch).not.toHaveBeenCalled();
});
it('uses safe clarification for unavailable/incomplete exact evidence without generation or embeddings',async()=>{
 for(const status of ['UNAVAILABLE','CONTEXT_INCOMPLETE'] as const){const f=fixture();f.structuredSearch.mockResolvedValue({status} as never);expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.generate).toHaveBeenCalledTimes(2);expect(f.embed).not.toHaveBeenCalled();}
});

function cascadeFixture(status:unknown={status:'EMPTY'}){
 const calls:string[]=[],proof=buildRuleProof({familyId:id,baseDocumentId:id,versionStream:'main',ruleRevision:'0',evaluationDate:'2026-10-08',members:[{documentId:id,revision:0}],effects:[]});
 const rag={chunkId:id,documentId:id,documentRevision:0,title:'ห้องสมุด',familyCode:'LIBRARY',academicYear:null,authorityLevel:90,pageNumber:1,sectionTitle:'เวลาเปิดบริการ',content:'ห้องสมุดเปิดเวลา 08:30 น.',sourceUrl:null,similarity:0.9,ruleProof:proof};
 const generate=vi.fn(async(input:{taskType:string})=>({output:input.taskType==='KNOWLEDGE_SCOPE'?scope:input.taskType==='KNOWLEDGE_METHOD'?{method:'STRUCTURED',query}:{answer:'ห้องสมุดเปิดเวลา 08:30 น.',citationChunkIds:[id]},toolCalls:[],providerId:id,modelId:id,fallbackUsed:false}));
 const structuredSearch=vi.fn(async()=>{calls.push('structured');return status as Awaited<ReturnType<NonNullable<KnowledgeProducerOptions['structuredSearch']>>>;});
 const embed=vi.fn(async()=>{calls.push('embed');return {vectors:[[1,0,0]],fingerprint:hash,dimensions:3,providerId:id,modelId:id,fallbackUsed:false};});
 const search=vi.fn(async()=>{calls.push('rag');return [rag];});
 return {generate,structuredSearch,embed,search,calls,produce:createKnowledgeProducer({generate:generate as KnowledgeProducerOptions['generate'],structuredSearch,embed,search})};
}
it('continues a complete Structured miss into reviewed RAG with the same grounded scope',async()=>{
 const f=cascadeFixture(),result=await f.produce(snapshot,new AbortController().signal);
 expect(result).toMatchObject({kind:'ANSWER',scope,structuredMiss:query,output:{citationChunkIds:[id]}});expect(aiResultSchema.safeParse(result).success).toBe(true);
 expect(f.calls).toEqual(['structured','embed','rag']);expect(f.search).toHaveBeenCalledWith(expect.objectContaining({scope}));expect(f.generate.mock.calls.map(([input])=>input.taskType)).toEqual(['KNOWLEDGE_SCOPE','KNOWLEDGE_METHOD','KNOWLEDGE_ANSWER']);
});
it('clarifies after both authorized internal searches miss without inventing an answer',async()=>{
 const f=cascadeFixture();f.search.mockImplementation(async()=>{f.calls.push('rag');return [];});
 expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.calls).toEqual(['structured','embed','rag']);expect(f.generate).toHaveBeenCalledTimes(2);
});
it('never treats structured ambiguity, incomplete proof or exception as permission to try RAG',async()=>{
 for(const status of [{status:'CLARIFICATION_REQUIRED',missing:['audience']},{status:'CONTEXT_INCOMPLETE'},{status:'UNAVAILABLE'},{status:'READY',evidence:[]}]){
  const f=cascadeFixture(status);expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.calls).toEqual(['structured']);expect(f.generate).toHaveBeenCalledTimes(2);
 }
 const f=cascadeFixture();f.structuredSearch.mockRejectedValue(new Error('CONNECTION_UNAVAILABLE'));expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.embed).not.toHaveBeenCalled();
});
it('stops on incomplete RAG proof after a structured miss without answer generation',async()=>{
 const f=cascadeFixture();f.search.mockImplementation(async()=>{f.calls.push('rag');throw new Error('KNOWLEDGE_CONTEXT_INCOMPLETE');});
 expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.calls).toEqual(['structured','embed','rag']);expect(f.generate).toHaveBeenCalledTimes(2);
});
it('cancellation after a structured miss cannot start lower-tier work',async()=>{
 const f=cascadeFixture(),controller=new AbortController();f.structuredSearch.mockImplementation(async()=>{controller.abort();return {status:'EMPTY'};});
 await expect(f.produce(snapshot,controller.signal)).rejects.toMatchObject({code:'CANCELLED'});expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});
it('rejects oversized full evidence before answer generation and durable save',async()=>{
 const f=fixture();const rows=Array.from({length:20},(_,index)=>{const rowId=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,largePayload={...payload,description:'ก'.repeat(5000)},reference={...evidence.reference,rowId,payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'university_services',payload:largePayload})};return {...evidence,rowId,payload:largePayload,reference};});
 f.structuredSearch.mockResolvedValue({status:'READY',evidence:rows});expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.generate).toHaveBeenCalledTimes(2);expect(f.embed).not.toHaveBeenCalled();
});
