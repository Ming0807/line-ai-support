import {expect,it,vi} from 'vitest';
import {projectRoutingContext,resolveRoutingProposal,type SemanticCandidate} from '../lib/conversation/semantic-routing-contracts';
import {createSemanticRoutingClassifier} from '../lib/conversation/semantic-routing-provider';
import {contextChoiceOptions,contextChoiceText,resolveTypedRouteChoice} from '../lib/conversation/quick-reply';

const candidates=(count:number):SemanticCandidate[]=>Array.from({length:count},(_,i)=>({
 conversationId:`context-${i+1}`,conversationRevision:0,mode:'AI',topicLabel:`หัวข้อ ${i+1}`,topic:`หัวข้อ ${i+1}`,
 ticketId:null,ticketRevision:null,ticketStatus:null,summary:null,history:[],
}));
it('routes among fifteen contexts independently from the thirteen-button transport limit',async()=>{
 const source=candidates(15),generate=vi.fn().mockResolvedValue({output:{decision:'CONTINUE',candidateCode:'C15',confidence:.99},toolCalls:[]});
 const proposal=await createSemanticRoutingClassifier(generate)({question:'ขอรายละเอียดเรื่องที่สิบห้า',contexts:projectRoutingContext(source)},new AbortController().signal);
 expect(generate).toHaveBeenCalledTimes(1);
 expect(resolveRoutingProposal(proposal,source)).toEqual({selectedConversationId:'context-15',newTopic:false,confidence:.99});
 expect(contextChoiceOptions(source).length).toBeLessThanOrEqual(13);
});
it('accepts the exact C64 boundary without widening the prompt budget',async()=>{
 const source=candidates(64),generate=vi.fn().mockResolvedValue({output:{decision:'CONTINUE',candidateCode:'C64',confidence:.99},toolCalls:[]});
 const proposal=await createSemanticRoutingClassifier(generate)({question:'ขอรายละเอียดหัวข้อสุดท้าย',contexts:projectRoutingContext(source)},new AbortController().signal);
 expect(generate).toHaveBeenCalledTimes(1);
 expect(resolveRoutingProposal(proposal,source)).toEqual({selectedConversationId:'context-64',newTopic:false,confidence:.99});
 expect(generate.mock.calls[0][0].messages[1].content.length).toBeLessThanOrEqual(19000);
});
it('makes every context reachable through bounded named pages',()=>{
 const source=candidates(35),ids=new Set<string>();
 for(let page=0;page<4;page++){
  const options=contextChoiceOptions(source,page);expect(options.length).toBeLessThanOrEqual(13);
  for(const option of options.filter(o=>o.value.action==='CONTINUE'))ids.add(option.value.conversationId);
  if(page<3)expect(options.some(o=>o.value.action==='ROUTE_PAGE'&&o.value.page===String(page+1))).toBe(true);
 }
 expect(ids).toEqual(new Set(source.map(c=>c.conversationId)));
});
it('explicit NEW and unique named recovery remain available beyond twelve contexts',()=>{
 const source=candidates(15);
 expect(resolveTypedRouteChoice('เริ่มเรื่องใหม่',source)).toEqual({action:'NEW'});
 expect(resolveTypedRouteChoice('ต่อ หัวข้อ 15',source)).toEqual({action:'CONTINUE',conversationId:'context-15'});
});
it('shows topic names on clarification buttons instead of numbered-memory labels',()=>{
 const source=candidates(2),options=contextChoiceOptions(source);
 expect(options[1].label).toContain('หัวข้อ 1');expect(options[1].label).not.toBe('ต่อ เรื่อง 1');
 expect(contextChoiceText('ยังไม่แน่ใจว่าต่อเรื่องไหน',source)).toContain('หัวข้อ 2');
});
it('keeps emoji and Thai topic labels inside the LINE payload limit without cutting a grapheme',()=>{
 const source=candidates(2).map(c=>({...c,topicLabel:'🧑‍💻🧑‍💻🧑‍💻🧑‍💻 ทดสอบ'}));
 const options=contextChoiceOptions(source);
 expect(options.every(option=>option.label.length<=20)).toBe(true);
 expect(new Set(options.map(option=>option.label)).size).toBe(options.length);
 expect(options.every(option=>!option.label.endsWith('\u200d'))).toBe(true);
});
it('compacts whole older history to fit a bounded prompt without clipping the current question or dropping candidates',async()=>{
 const source=candidates(15).map(candidate=>({...candidate,history:Array.from({length:8},(_,i)=>({id:`message-${i}`,content:`turn${i} `+'ก'.repeat(180),createdAt:`2026-10-28T00:00:0${i}Z`,senderType:i%2?'AI' as const:'USER' as const}))}));
 const question='ช่วยอธิบายคำตอบก่อนหน้านี้ต่อ';
 const generate=vi.fn().mockResolvedValue({output:{decision:'CONTINUE',candidateCode:'C15',confidence:.99},toolCalls:[]});
 await createSemanticRoutingClassifier(generate)({question,contexts:projectRoutingContext(source)},new AbortController().signal);
 expect(generate).toHaveBeenCalledTimes(1);
 const payload=generate.mock.calls[0][0].messages[1].content,parsed=JSON.parse(payload);
 expect(payload.length).toBeLessThanOrEqual(19000);expect(parsed.question).toBe(question);expect(parsed.contexts).toHaveLength(15);
 expect(parsed.contexts[14].recentMessages.at(-1).content).toBe(source[14].history.at(-1)!.content);
});
it('reports a prompt capacity failure distinctly instead of a semantic ASK or silent null',async()=>{
 const generate=vi.fn(),source=candidates(1);source[0].topic='ก'.repeat(20000);
 await expect(createSemanticRoutingClassifier(generate)({question:'เรื่องเดิม',contexts:projectRoutingContext(source)},new AbortController().signal))
  .rejects.toMatchObject({name:'SemanticRoutingUnavailableError',reason:'PROMPT_LIMIT'});
 expect(generate).not.toHaveBeenCalled();
});
it('large old assistant answers cannot freeze every context when whole USER context fits',async()=>{
 const source=candidates(15).map(candidate=>({...candidate,history:[
  {id:'u',content:'คำถามเกี่ยวกับ '+candidate.topic,createdAt:'2026-10-28T00:00:00Z',senderType:'USER' as const},
  {id:'a',content:'คำตอบยาว'.repeat(500),createdAt:'2026-10-28T00:00:01Z',senderType:'AI' as const},
 ]}));
 const generate=vi.fn().mockResolvedValue({output:{decision:'NEW',candidateCode:null,confidence:.99},toolCalls:[]});
 await createSemanticRoutingClassifier(generate)({question:'ถามเรื่องใหม่',contexts:projectRoutingContext(source)},new AbortController().signal);
 expect(generate).toHaveBeenCalledTimes(1);
 const payload=JSON.parse(generate.mock.calls[0][0].messages[1].content);
 expect(payload.contexts).toHaveLength(15);expect(payload.contexts[14].previousUserMessages).toEqual([source[14].history[0].content]);
});
