import {expect,it,vi} from 'vitest';
import {routingProposalSchema,projectRoutingContext,resolveRoutingProposal,type SemanticCandidate} from '@/lib/conversation/semantic-routing-contracts';
import {createSemanticRoutingClassifier} from '@/lib/conversation/semantic-routing-provider';
const candidates:SemanticCandidate[]=[{conversationId:'private-conversation-a',conversationRevision:2,mode:'HUMAN',topicLabel:'private-ticket-number',ticketId:'private-ticket',ticketRevision:3,ticketStatus:'STAFF_HANDLING',topic:'การลงทะเบียน',summary:'ลงทะเบียนไม่ได้',history:[{id:'private-message',content:'ลงทะเบียนไม่ได้ครับ',createdAt:'2026-10-08T12:00:00Z'}]},
 {conversationId:'private-conversation-b',conversationRevision:0,mode:'AI',topicLabel:null,ticketId:null,ticketRevision:null,ticketStatus:null,topic:'ห้องสมุด',summary:null,history:[]}];
it('projects ordered conversational turns separately from USER evidence for an assistant-reference follow-up',()=>{
 const history=[{id:'private-user',content:'ช่วยอธิบาย Wi-Fi',createdAt:'2026-10-08T12:00:00Z',senderType:'USER' as const},
  {id:'private-assistant',content:'Wi-Fi เชื่อมอุปกรณ์ด้วยคลื่นวิทยุ',createdAt:'2026-10-08T12:01:00Z',senderType:'AI' as const}];
 const context=projectRoutingContext([{...candidates[1],history}])[0];
 expect(context.previousUserMessages).toEqual(['ช่วยอธิบาย Wi-Fi']);
 expect(context).toMatchObject({recentMessages:[{role:'user',content:history[0].content},{role:'assistant',content:history[1].content}]});
 expect(JSON.stringify(context)).not.toContain('private-');
});
it('provides contextual acknowledgement and assistant-reference guidance instead of unconditional social NEW',async()=>{
 const generate=vi.fn().mockResolvedValue({output:{decision:'CONTINUE',candidateCode:'C2',confidence:.99},toolCalls:[]});
 await createSemanticRoutingClassifier(generate)({question:'ขอสั้นลง',contexts:projectRoutingContext(candidates)},new AbortController().signal);
 const prompt=generate.mock.calls[0][0].messages[0].content;
 expect(prompt).toContain('actually SENT assistant');
 expect(prompt).toContain('Contextual thanks');
 expect(prompt).not.toContain('social greeting, thanks');
});
it('accepts strict consistent semantic decisions; rejects tools, unknown fields and bogus candidate spellings',()=>{
 expect(routingProposalSchema.parse({decision:'NEW',candidateCode:null,confidence:.95})).toEqual({decision:'NEW',candidateCode:null,confidence:.95});
 for(const value of [{decision:'CONTINUE',candidateCode:null,confidence:1},{decision:'NEW',candidateCode:'C1',confidence:1},{decision:'CONTINUE',candidateCode:'C65',confidence:1},{decision:'CONTINUE',candidateCode:'private-conversation-a',confidence:1},{decision:'NEW',candidateCode:null,confidence:1,sql:'select 1'},{decision:'NEW',candidateCode:null,confidence:Infinity}])expect(routingProposalSchema.safeParse(value).success).toBe(false);
});
it('projects ephemeral labels and bounded actual USER text without explicit IDs, ticket numbers or unrelated fields',()=>{
 const projected=projectRoutingContext(candidates);expect(projected.map(c=>c.code)).toEqual(['C1','C2']);expect(JSON.stringify(projected)).not.toContain('private-');
 const large=projectRoutingContext([{...candidates[0],summary:'ก'.repeat(10000),history:Array.from({length:20},()=>({id:'private',content:'x'.repeat(10000),createdAt:'now'}))}]);expect(large[0].summary?.length).toBe(10000);expect(large[0].previousUserMessages.map(text=>text.length)).toEqual([10000,10000]);
});
it('maps only a high-confidence exact current candidate, never latest-ticket or keyword guessing',()=>{
 expect(resolveRoutingProposal({decision:'CONTINUE',candidateCode:'C2',confidence:.9},candidates)).toEqual({selectedConversationId:'private-conversation-b',newTopic:false,confidence:.9});
 expect(resolveRoutingProposal({decision:'NEW',candidateCode:null,confidence:.9},candidates)).toEqual({newTopic:true,confidence:.9});
 for(const value of [{decision:'CONTINUE',candidateCode:'C3',confidence:1},{decision:'CONTINUE',candidateCode:'C1',confidence:.79},{decision:'ASK',candidateCode:null,confidence:1}])expect(resolveRoutingProposal(value,candidates)).toBeNull();
 expect(resolveRoutingProposal({decision:'CONTINUE',candidateCode:'C1',confidence:1},Array(13).fill(candidates[0]))).toBeNull();
});
it('classifier uses a bounded no-tools gateway prompt with minimized context and rejects unsolicited tool calls',async()=>{
 const generate=vi.fn().mockResolvedValue({output:{decision:'NEW',candidateCode:null,confidence:.9},toolCalls:[]});
 const classify=createSemanticRoutingClassifier(generate);const signal=new AbortController().signal;
 expect(await classify({question:'ห้องสมุดปิดกี่โมง',contexts:projectRoutingContext(candidates)},signal)).toEqual({decision:'NEW',candidateCode:null,confidence:.9});
 const input=generate.mock.calls[0][0];expect(input.timeoutMs).toBe(25000);expect(input.signal).toBe(signal);expect(input.tools).toBeUndefined();expect(JSON.stringify(input.messages)).not.toContain('private-');
 generate.mockResolvedValue({output:{decision:'NEW',candidateCode:null,confidence:.9},toolCalls:[{name:'create_ticket'}]});expect(await classify({question:'test',contexts:[]},signal)).toBeNull();
});
it('classifier fails safely on malformed output, failures, cancellation or excessive serialized context',async()=>{
 const generate=vi.fn().mockRejectedValue(Error('private diagnostic'));const classify=createSemanticRoutingClassifier(generate),controller=new AbortController();
 expect(await classify({question:'test',contexts:[]},controller.signal)).toBeNull();controller.abort();generate.mockClear();expect(await classify({question:'test',contexts:[]},controller.signal)).toBeNull();expect(generate).not.toHaveBeenCalled();
 expect(await classify({question:'x'.repeat(20001),contexts:[]},new AbortController().signal)).toBeNull();expect(generate).not.toHaveBeenCalled();
});
it('classifies the complete long Thai current question and whole prior source without truncation',async()=>{
 const generate=vi.fn().mockResolvedValue({output:{decision:'NEW',candidateCode:null,confidence:.99},toolCalls:[]});
 const question='ก'.repeat(4990)+' ท้ายสำคัญ',previous='ต้นสำคัญ '+ 'x'.repeat(4000)+' ท้ายเดิม';
 const contexts=projectRoutingContext([{...candidates[0],history:[{id:'private',createdAt:'now',content:previous}]}]);
 expect(await createSemanticRoutingClassifier(generate)({question,contexts},new AbortController().signal)).toMatchObject({decision:'NEW'});
 const payload=JSON.parse(generate.mock.calls[0][0].messages[1].content);
 expect(payload.question===question).toBe(true);expect(payload.contexts[0].previousUserMessages[0]===previous).toBe(true);
});
