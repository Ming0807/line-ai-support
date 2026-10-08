import {expect,it,vi} from 'vitest';
import {routingProposalSchema,projectRoutingContext,resolveRoutingProposal,type SemanticCandidate} from '@/lib/conversation/semantic-routing-contracts';
import {createSemanticRoutingClassifier} from '@/lib/conversation/semantic-routing-provider';
const candidates:SemanticCandidate[]=[{conversationId:'private-conversation-a',conversationRevision:2,mode:'HUMAN',topicLabel:'private-ticket-number',ticketId:'private-ticket',ticketRevision:3,ticketStatus:'STAFF_HANDLING',topic:'การลงทะเบียน',summary:'ลงทะเบียนไม่ได้',history:[{id:'private-message',content:'ลงทะเบียนไม่ได้ครับ',createdAt:'2026-10-08T12:00:00Z'}]},
 {conversationId:'private-conversation-b',conversationRevision:0,mode:'AI',topicLabel:null,ticketId:null,ticketRevision:null,ticketStatus:null,topic:'ห้องสมุด',summary:null,history:[]}];
it('accepts strict consistent semantic decisions; rejects tools, unknown fields and bogus candidate spellings',()=>{
 expect(routingProposalSchema.parse({decision:'NEW',candidateCode:null,confidence:.95})).toEqual({decision:'NEW',candidateCode:null,confidence:.95});
 for(const value of [{decision:'CONTINUE',candidateCode:null,confidence:1},{decision:'NEW',candidateCode:'C1',confidence:1},{decision:'CONTINUE',candidateCode:'C13',confidence:1},{decision:'CONTINUE',candidateCode:'private-conversation-a',confidence:1},{decision:'NEW',candidateCode:null,confidence:1,sql:'select 1'},{decision:'NEW',candidateCode:null,confidence:Infinity}])expect(routingProposalSchema.safeParse(value).success).toBe(false);
});
it('projects ephemeral labels and bounded actual USER text without explicit IDs, ticket numbers or unrelated fields',()=>{
 const projected=projectRoutingContext(candidates);expect(projected.map(c=>c.code)).toEqual(['C1','C2']);expect(JSON.stringify(projected)).not.toContain('private-');
 const large=projectRoutingContext([{...candidates[0],summary:'ก'.repeat(10000),history:Array.from({length:20},()=>({id:'private',content:'x'.repeat(10000),createdAt:'now'}))}]);expect(JSON.stringify(large).length).toBeLessThan(1500);
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
 const input=generate.mock.calls[0][0];expect(input.timeoutMs).toBe(8000);expect(input.signal).toBe(signal);expect(input.tools).toBeUndefined();expect(JSON.stringify(input.messages)).not.toContain('private-');
 generate.mockResolvedValue({output:{decision:'NEW',candidateCode:null,confidence:.9},toolCalls:[{name:'create_ticket'}]});expect(await classify({question:'test',contexts:[]},signal)).toBeNull();
});
it('classifier fails safely on malformed output, failures, cancellation or excessive serialized context',async()=>{
 const generate=vi.fn().mockRejectedValue(Error('private diagnostic'));const classify=createSemanticRoutingClassifier(generate),controller=new AbortController();
 expect(await classify({question:'test',contexts:[]},controller.signal)).toBeNull();controller.abort();generate.mockClear();expect(await classify({question:'test',contexts:[]},controller.signal)).toBeNull();expect(generate).not.toHaveBeenCalled();
 expect(await classify({question:'x'.repeat(2001),contexts:[]},new AbortController().signal)).toBeNull();expect(generate).not.toHaveBeenCalled();
});
