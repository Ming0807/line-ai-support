import {expect,it,vi} from 'vitest';
import {createKnowledgeProducer,type KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import {validateStructuredEvidence} from '../lib/knowledge/structured-citations';
import {canonicalDigest} from '../lib/imports/structured-mapping-contract';
import {aiResultSchema} from '../lib/ai/jobs';

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
 for(const status of ['UNAVAILABLE','EMPTY','CONTEXT_INCOMPLETE'] as const){const f=fixture();f.structuredSearch.mockResolvedValue({status} as never);expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.generate).toHaveBeenCalledTimes(2);expect(f.embed).not.toHaveBeenCalled();}
});
it('rejects oversized full evidence before answer generation and durable save',async()=>{
 const f=fixture();const rows=Array.from({length:20},(_,index)=>{const rowId=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,largePayload={...payload,description:'ก'.repeat(5000)},reference={...evidence.reference,rowId,payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'university_services',payload:largePayload})};return {...evidence,rowId,payload:largePayload,reference};});
 f.structuredSearch.mockResolvedValue({status:'READY',evidence:rows});expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.generate).toHaveBeenCalledTimes(2);expect(f.embed).not.toHaveBeenCalled();
});
