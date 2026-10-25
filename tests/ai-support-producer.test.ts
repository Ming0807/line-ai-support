import {it,expect,vi} from 'vitest';
import {createSupportProducer} from '../lib/ai/support-producer';
import {createAssistantOrchestrator} from '../lib/ai/assistant-orchestrator';
import type {AssistantDecision} from '../lib/ai/assistant-decision';
import {projectSupportInput} from '../lib/ai/support-contracts';
import {aiResultSchema} from '../lib/ai/jobs';
import type {AISnapshot} from '../lib/ai/run-worker';
import type {KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import {buildRuleProof} from '../lib/knowledge/rule-proof';
import {AIProviderError} from '../lib/ai/types';
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
function fixture(p:unknown=proposal,toolCalls:unknown[]=[],handoff:unknown={reason:'NONE',departmentCode:null,confidence:.99,facts:[]}){
 const generate=vi.fn(async(input:{taskType:string;responseName?:string;messages:{role:string;content:string}[]})=>({output:input.responseName==='assistant_handoff'?{handoff}:input.taskType==='SUPPORT_INTENT'?p:
  input.taskType==='KNOWLEDGE_SCOPE'?scope:{answer:'ใช้คู่มือที่ตรวจแล้วครับ',citationChunkIds:[id(5)]},toolCalls,providerId:id(6),modelId:id(7),fallbackUsed:false}));
 const embed=vi.fn(async()=>({vectors:[[1,0]],dimensions:2,fingerprint:'c'.repeat(64),providerId:id(6),modelId:id(7),fallbackUsed:false}));
 const search=vi.fn(async()=>[{chunkId:id(5),documentId:id(8),documentRevision:0,title:'คู่มือ Wi-Fi',familyCode:'WIFI',academicYear:null,authorityLevel:100,pageNumber:1,
  sectionTitle:null,content:'ใช้ขั้นตอนจากคู่มือที่ตรวจแล้ว',sourceUrl:'https://fixture.yru.ac.th/wifi.pdf',similarity:.95,
  ruleProof:buildRuleProof({familyId:id(9),baseDocumentId:id(8),versionStream:'DEFAULT',ruleRevision:'0',evaluationDate:'2026-10-08',members:[{documentId:id(8),revision:0}],effects:[]})}]);
 const produce=createSupportProducer({generate:generate as unknown as KnowledgeProducerOptions['generate'],embed,search});return {generate,embed,search,produce};
}
it.each([false,true])('a repaired handoff uses only original USER facts and permits only confirmation (real attempt=%s)',async realAttempt=>{
 const question=realAttempt?'ปิดเปิด Wi-Fi แล้ว ยังใช้ไม่ได้':'มือถือ Android ต่อ Wi-Fi ไม่ได้';
 const facts=[{field:'PROBLEM',source:'U1',quote:'Wi-Fi ต่อไม่ได้ครับ'},{field:'ATTEMPTS',source:'U0',quote:'ปิดเปิด Wi-Fi แล้ว'}];
 const f=fixture(proposal,[],{reason:'UNRESOLVED_CONFIRMED',departmentCode:'IT',confidence:.99,facts});
 const decide=vi.fn(async()=>({decision:{action:'GENERAL_REPLY',text:'ผมรีเซ็ตบัญชีเรียบร้อยแล้ว ปิดเปิด Wi-Fi แล้ว'} as AssistantDecision,provenance:'MODEL_PROPOSAL_UNVERIFIED' as const,historyOmittedCount:0}));
 decide.mockResolvedValueOnce({decision:{action:'GENERAL_REPLY',text:'ผมรีเซ็ตบัญชีเรียบร้อยแล้ว ปิดเปิด Wi-Fi แล้ว'},provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0})
  .mockResolvedValueOnce({decision:{action:'HANDOFF',reason:'UNRESOLVED_CONFIRMED'},provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0});
 const lookup=vi.fn(),current=snapshot(question),signal=new AbortController().signal;
 const result=await createAssistantOrchestrator({decide,lookup,repairRejectedGeneral:true,
  handoff:(original,abort,handoffReason)=>createSupportProducer({generate:f.generate as unknown as KnowledgeProducerOptions['generate'],embed:f.embed,search:f.search},{handoffReason})(original,abort)})(current,signal);
 expect(decide).toHaveBeenCalledTimes(2);expect(result.kind).toBe('CLARIFY');
 if(realAttempt){expect(result).toMatchObject({support:{proposal:{intent:'ESCALATE'}}});if(result.kind==='CLARIFY')expect(result.text).toContain('ยืนยัน');}
 else expect(result).not.toHaveProperty('support');
 const payload=JSON.parse(f.generate.mock.calls[0][0].messages[1].content);
 expect(payload.sources).toEqual(current.support!.input.sources);expect(JSON.stringify(payload)).not.toContain('ผมรีเซ็ต');
 expect(result).not.toHaveProperty('ticketId');expect(result).not.toHaveProperty('action');expect(lookup).not.toHaveBeenCalled();
 expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});
it('a selected handoff cannot silently turn into troubleshooting retrieval when interpretation disagrees',async()=>{
 const f=fixture();
 const produce=createSupportProducer({generate:f.generate as unknown as KnowledgeProducerOptions['generate'],embed:f.embed,search:f.search},{handoffReason:'USER_REQUEST'});
 const result=await produce(snapshot(),new AbortController().signal);
 expect(result.kind).toBe('CLARIFY');expect(result).not.toHaveProperty('support');
 expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
 expect(f.generate.mock.calls[0][0].messages[0].content).toContain('USER_REQUEST');
});
it('does not blame missing user details when the handoff provider is unavailable',async()=>{
 const f=fixture();f.generate.mockRejectedValueOnce(new AIProviderError('TIMEOUT'));
 const produce=createSupportProducer({generate:f.generate as unknown as KnowledgeProducerOptions['generate'],embed:f.embed,search:f.search},{handoffReason:'UNRESOLVED_CONFIRMED'});
 const result=await produce(snapshot('ลองปิดเปิดแล้ว ยังใช้ไม่ได้'),new AbortController().signal);
 expect(result).toMatchObject({kind:'CLARIFY',text:expect.stringContaining('บริการ AI เตรียมเรื่องส่งต่อไม่สำเร็จ')});
 expect(JSON.stringify(result)).not.toContain('TIMEOUT');expect(result).not.toHaveProperty('support');
 expect(f.generate).toHaveBeenCalledTimes(1);expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});
it('a personal handoff retains only source-validated metadata and the record limitation',async()=>{
 const f=fixture({...proposal,intent:'PERSONAL_CASE',needsTicket:true,sensitivity:'SENSITIVE'},[],{reason:'PERSONAL_RECORD',departmentCode:'IT',confidence:.99,facts:proposal.facts});
 const produce=createSupportProducer({generate:f.generate as unknown as KnowledgeProducerOptions['generate'],embed:f.embed,search:f.search},{handoffReason:'PERSONAL_RECORD'});
 const result=await produce(snapshot(),new AbortController().signal);
 expect(result).toMatchObject({kind:'CLARIFY',support:{proposal:{intent:'PERSONAL_CASE',needsTicket:true}}});
 expect(f.generate.mock.calls[0][0].responseName).toBe('assistant_handoff');
 expect(result).toMatchObject({support:{proposal:{sensitivity:'SENSITIVE',needsKnowledgeSearch:false,needsStructuredSearch:false}}});
 expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});
it('an unresolved handoff cannot present failed attempts without a quoted actual USER attempt',async()=>{
 const f=fixture({...proposal,intent:'ESCALATE',needsTicket:true},[],{reason:'UNRESOLVED_CONFIRMED',departmentCode:'IT',confidence:.99,facts:proposal.facts});
 const produce=createSupportProducer({generate:f.generate as unknown as KnowledgeProducerOptions['generate'],embed:f.embed,search:f.search},{handoffReason:'UNRESOLVED_CONFIRMED'});
 const result=await produce(snapshot(),new AbortController().signal);
 expect(result.kind).toBe('CLARIFY');expect(result).not.toHaveProperty('support');
 expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});
it('a quoted real attempt permits only a handoff confirmation proposal and no ticket action',async()=>{
 const facts=[{field:'PROBLEM',source:'U1',quote:'Wi-Fi ต่อไม่ได้ครับ'},{field:'ATTEMPTS',source:'U0',quote:'ปิดเปิด Wi-Fi แล้ว'}];
 const f=fixture({...proposal,intent:'ESCALATE',needsTicket:true,facts},[],{reason:'UNRESOLVED_CONFIRMED',departmentCode:'IT',confidence:.99,facts});
 const produce=createSupportProducer({generate:f.generate as unknown as KnowledgeProducerOptions['generate'],embed:f.embed,search:f.search},{handoffReason:'UNRESOLVED_CONFIRMED'});
 const result=await produce(snapshot('ปิดเปิด Wi-Fi แล้ว ยังใช้ไม่ได้ ช่วยส่งต่อเจ้าหน้าที่', [{role:'user',content:'Wi-Fi ต่อไม่ได้ครับ'}]),new AbortController().signal);
 expect(result).toMatchObject({kind:'CLARIFY',support:{proposal:{intent:'ESCALATE'}}});
 expect(result).not.toHaveProperty('ticketId');expect(result).not.toHaveProperty('action');
 expect(f.embed).not.toHaveBeenCalled();expect(f.search).not.toHaveBeenCalled();
});
it('processes the complete long Thai current message instead of silently suppressing it',async()=>{
 const question='ก'.repeat(4990)+' ท้ายสำคัญ',f=fixture({...proposal,missingContext:'DEVICE',facts:[{field:'PROBLEM',source:'U0',quote:'ท้ายสำคัญ'}]});
 const result=await f.produce(snapshot(question,[]),new AbortController().signal);
 expect(result.kind).toBe('CLARIFY');expect(result).toHaveProperty('support');
 const input=JSON.parse(f.generate.mock.calls[0][0].messages[1].content);
 expect(input.sources[0].text===question).toBe(true);expect(input.sources[0].text.endsWith('ท้ายสำคัญ')).toBe(true);
});
it('gives an explicit complete-input limit before inference when the current JSON cannot fit',async()=>{
 const f=fixture(),result=await f.produce(snapshot('x'.repeat(20000),[]),new AbortController().signal);
 expect(result.kind).toBe('CLARIFY');if(result.kind==='CLARIFY')expect(result.text).toMatch(/ข้อความครบ.*เกินขนาด/u);
 expect(f.generate).not.toHaveBeenCalled();expect(f.embed).not.toHaveBeenCalled();
});
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
