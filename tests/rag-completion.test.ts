import {expect,it} from 'vitest';
import {ragAnswerSchema,ragCompletionSchema,buildCitedAnswer} from '../lib/knowledge/citations';
const id='00000000-0000-4000-8000-000000000001';
it('admits only a non-executable null/empty abstention while the actual answer contract retains citations',()=>{
 expect(ragCompletionSchema.safeParse({answer:null,citationChunkIds:[]}).success).toBe(true);
 expect(ragAnswerSchema.safeParse({answer:null,citationChunkIds:[]}).success).toBe(false);
 expect(ragCompletionSchema.safeParse({answer:'ข้อมูลจากเอกสาร',citationChunkIds:[id]}).success).toBe(true);
 expect(ragAnswerSchema.safeParse({answer:'ข้อมูลจากเอกสาร',citationChunkIds:[id]}).success).toBe(true);
});
it.each([
 {answer:'คำตอบที่ไม่มีอ้างอิง',citationChunkIds:[]},
 {answer:null,citationChunkIds:[id]},
 {answer:null,citationChunkIds:[],reason:'invented fact'},
 {answer:'   ',citationChunkIds:[id]},
 {answer:'คำตอบ',citationChunkIds:[id,id]},
 {answer:'x'.repeat(12001),citationChunkIds:[id]},
])('rejects malformed or citation-free claims without weakening the answer schema: %j',value=>{
 expect(ragCompletionSchema.safeParse(value).success).toBe(false);
});
it('transports a URL proposal but rejects an unreviewed link at the shared cited-source boundary',()=>{
 const proposal={answer:'https://unreviewed.invalid',citationChunkIds:[id]};
 expect(ragCompletionSchema.safeParse(proposal).success).toBe(true);
 expect(()=>buildCitedAnswer(proposal,[{chunkId:id,documentId:'00000000-0000-4000-8000-000000000002',documentRevision:1,title:'Reviewed',familyCode:'TEST',academicYear:null,authorityLevel:50,pageNumber:null,sectionTitle:null,sourceUrl:'https://fixture.yru.ac.th/source',similarity:1,content:'No link was approved.'}])).toThrow('KNOWLEDGE_CITATION_INVALID');
});
