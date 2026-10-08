import {it,expect,vi} from 'vitest';
import {createSupportProducer} from '../lib/ai/support-producer';
import {projectSupportInput} from '../lib/ai/support-contracts';
import {aiResultSchema} from '../lib/ai/jobs';
import type {AISnapshot} from '../lib/ai/run-worker';
import type {KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import {buildRuleProof} from '../lib/knowledge/rule-proof';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const directory=[{code:'IT',name:'เทคโนโลยีสารสนเทศ'},{code:'LIBRARY',name:'ห้องสมุด'}];
const scope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:'IT',audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
const proposal={intent:'TROUBLESHOOT',category:'IT_SUPPORT',subcategory:'NETWORK_ACCESS',needsTicket:false,department:'IT',urgency:'medium',needsKnowledgeSearch:true,
 needsStructuredSearch:false,needsWebSearch:false,confidence:.99,missingContext:null,impact:'SINGLE_USER',sensitivity:'GENERAL',
 facts:[{field:'PROBLEM',source:'U1',quote:'Wi-Fi ต่อไม่ได้ครับ'},{field:'DEVICE',source:'U0',quote:'มือถือ Android'},{field:'ERROR',source:'U0',quote:'authentication failed'}]};
function snapshot(question='มือถือ Android ขึ้น authentication failed',history:AISnapshot['history']=[{role:'user',content:'Wi-Fi ต่อไม่ได้ครับ'},{role:'assistant',content:'PRIVATE_ASSISTANT_ASSERTION'}]):AISnapshot{
 const base={jobId:id(1),sessionId:id(2),conversationId:id(3),messageId:id(4),revision:0,question,history};
 return {...base,support:{context:{sessionId:base.sessionId,conversationId:base.conversationId,messageId:base.messageId,revision:base.revision},
  input:projectSupportInput(base,directory),sourceDigest:'a'.repeat(64),directoryDigest:'b'.repeat(64),minimumSensitivity:'GENERAL'}};
}
function fixture(p:unknown=proposal,toolCalls:unknown[]=[]){
 const generate=vi.fn(async(input:{taskType:string;messages:{role:string;content:string}[]})=>({output:input.taskType==='SUPPORT_INTENT'?p:
  input.taskType==='KNOWLEDGE_SCOPE'?scope:{answer:'ใช้คู่มือที่ตรวจแล้วครับ',citationChunkIds:[id(5)]},toolCalls,providerId:id(6),modelId:id(7),fallbackUsed:false}));
 const embed=vi.fn(async()=>({vectors:[[1,0]],dimensions:2,fingerprint:'c'.repeat(64),providerId:id(6),modelId:id(7),fallbackUsed:false}));
 const search=vi.fn(async()=>[{chunkId:id(5),documentId:id(8),documentRevision:0,title:'คู่มือ Wi-Fi',familyCode:'WIFI',academicYear:null,authorityLevel:100,pageNumber:1,
  sectionTitle:null,content:'ใช้ขั้นตอนจากคู่มือที่ตรวจแล้ว',sourceUrl:'https://fixture.yru.ac.th/wifi.pdf',similarity:.95,
  ruleProof:buildRuleProof({familyId:id(9),baseDocumentId:id(8),versionStream:'DEFAULT',ruleRevision:'0',evaluationDate:'2026-10-08',members:[{documentId:id(8),revision:0}],effects:[]})}]);
 const produce=createSupportProducer({generate:generate as unknown as KnowledgeProducerOptions['generate'],embed,search});return {generate,embed,search,produce};
}
it('asks the relevant device question without an academic-context prompt or retrieval',async()=>{
 const f=fixture({...proposal,missingContext:'DEVICE',facts:[{field:'PROBLEM',source:'U0',quote:'Wi-Fi ต่อไม่ได้ครับ'}]});
 const result=await f.produce(snapshot('Wi-Fi ต่อไม่ได้ครับ',[]),new AbortController().signal);
 expect(result).toMatchObject({kind:'CLARIFY',support:{proposal:{intent:'TROUBLESHOOT'}}});if(result.kind==='CLARIFY'){expect(result.text).toContain('อุปกรณ์');expect(result.text).not.toMatch(/รุ่น|cohort|หลักสูตร/);}
 expect(f.generate).toHaveBeenCalledTimes(1);expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});
it('retrieves the original actual USER problem plus device/error and retains private source metadata',async()=>{
 const f=fixture(),s=snapshot(),result=await f.produce(s,new AbortController().signal);
 expect(result.kind).toBe('ANSWER');expect(f.embed).toHaveBeenCalledWith(expect.objectContaining({input:['Wi-Fi ต่อไม่ได้ครับ\nมือถือ Android\nauthentication failed']}));
 expect(result).toMatchObject({support:{version:1,sourceDigest:s.support!.sourceDigest,directoryDigest:s.support!.directoryDigest,minimumSensitivity:'GENERAL',deliveredGuidance:false,proposal}});
 expect(aiResultSchema.safeParse(result).success).toBe(true);
 const classified=JSON.parse(f.generate.mock.calls[0][0].messages[1].content);expect(classified.sources).toHaveLength(2);
 const prompts=f.generate.mock.calls.flatMap(([call])=>call.messages.map(m=>m.content)).join('\n');
 for(const value of [s.sessionId,s.jobId,s.messageId,s.support!.sourceDigest,s.support!.directoryDigest])expect(prompts).not.toContain(value);
 expect(f.generate.mock.calls[0][0]).toMatchObject({taskType:'SUPPORT_INTENT',conversationId:s.conversationId,tools:[]});
 expect(classified).not.toHaveProperty('context');expect(JSON.stringify(classified)).not.toContain('PRIVATE_ASSISTANT_ASSERTION');
});
it('does not ask a supplied device detail again',async()=>{
 const f=fixture({...proposal,missingContext:'DEVICE'});expect((await f.produce(snapshot(),new AbortController().signal)).kind).toBe('ANSWER');expect(f.embed).toHaveBeenCalledTimes(1);
});
it('personal cases explain the record limitation without searching or creating a ticket',async()=>{
 const f=fixture({...proposal,intent:'PERSONAL_CASE',needsTicket:true,sensitivity:'SENSITIVE'}),result=await f.produce(snapshot(),new AbortController().signal);
 expect(result.kind).toBe('CLARIFY');if(result.kind==='CLARIFY')expect(result.text).toContain('ข้อมูลส่วนบุคคล');expect(f.generate).toHaveBeenCalledTimes(1);expect(f.embed).not.toHaveBeenCalled();
});
it('invented facts or provider tools cannot grant durable support advice',async()=>{
 for(const f of [fixture({...proposal,facts:[{field:'PROBLEM',source:'U1',quote:'invented problem'}]}),fixture(proposal,[{name:'create_ticket',arguments:{}}])]){
  const result=await f.produce(snapshot(),new AbortController().signal);
  expect(result.kind).toBe('CLARIFY');expect(result).not.toHaveProperty('support');expect(f.embed).not.toHaveBeenCalled();
 }
});
it('a solved statement requires explicit confirmation rather than an automatic outcome',async()=>{
 const f=fixture({...proposal,intent:'SOLVED',missingContext:null}),s=snapshot();s.support!.input.deliveredGuidance=true;
 const result=await f.produce(s,new AbortController().signal);expect(result.kind).toBe('CLARIFY');if(result.kind==='CLARIFY')expect(result.text).toContain('ยืนยัน');
 expect(result).not.toHaveProperty('outcome');expect(f.embed).not.toHaveBeenCalled();
});
it('legacy and Staff snapshots keep the unchanged knowledge path with no support metadata',async()=>{
 const f=fixture(),s=snapshot();delete s.support;s.question='IT คู่มือ';const result=await f.produce(s,new AbortController().signal);
 expect(result.kind).toBe('ANSWER');expect(result).not.toHaveProperty('support');expect(f.generate.mock.calls.some(([call])=>call.taskType==='SUPPORT_INTENT')).toBe(false);
});
it('strict durable support metadata rejects additional authority fields and malformed hashes',()=>{
 const support={version:1,sourceDigest:'a'.repeat(64),directoryDigest:'b'.repeat(64),minimumSensitivity:'GENERAL',deliveredGuidance:false,proposal};
 expect(aiResultSchema.safeParse({kind:'CLARIFY',text:'ถามเพิ่มครับ',support}).success).toBe(true);
 expect(aiResultSchema.safeParse({kind:'CLARIFY',text:'ถามเพิ่มครับ',support:{...support,executeSQL:'select 1'}}).success).toBe(false);
 expect(aiResultSchema.safeParse({kind:'CLARIFY',text:'ถามเพิ่มครับ',support:{...support,sourceDigest:'bad'}}).success).toBe(false);
});
it('an INFORMATION problem quote cannot erase a year explicitly requested in the current question',async()=>{
 const p={...proposal,intent:'INFORMATION',subcategory:'SERVICE',facts:[{field:'PROBLEM',source:'U0',quote:'คู่มือ IT'}]},f=fixture(p),s=snapshot('ขอคู่มือ IT ย้อนหลังปี2568',[]);
 f.generate.mockResolvedValueOnce({output:p,toolCalls:[],providerId:id(6),modelId:id(7),fallbackUsed:false});
 f.generate.mockResolvedValueOnce({output:{...scope,historical:true,academicYear:2568},toolCalls:[],providerId:id(6),modelId:id(7),fallbackUsed:false});
 const result=await f.produce(s,new AbortController().signal);expect(result.kind).toBe('ANSWER');
 expect(f.embed).toHaveBeenCalledWith(expect.objectContaining({input:['ขอคู่มือ IT ย้อนหลังปี2568']}));
});
it('troubleshooting retrieval retains a compact query while scope retains the full selected USER problem and current question',async()=>{
 const f=fixture(),s=snapshot('มือถือ Android ขึ้น authentication failed',[{role:'user',content:'Wi-Fi ต่อไม่ได้ครับ ในปี2568'}]);
 f.generate.mockResolvedValueOnce({output:proposal,toolCalls:[],providerId:id(6),modelId:id(7),fallbackUsed:false});
 f.generate.mockResolvedValueOnce({output:{...scope,historical:true,academicYear:2568},toolCalls:[],providerId:id(6),modelId:id(7),fallbackUsed:false});
 const result=await f.produce(s,new AbortController().signal);expect(result.kind).toBe('ANSWER');
 expect(JSON.parse(f.generate.mock.calls[1][0].messages[1].content).question).toContain('ในปี2568');
 expect(f.embed).toHaveBeenCalledWith(expect.objectContaining({input:['Wi-Fi ต่อไม่ได้ครับ\nมือถือ Android\nauthentication failed']}));
});
