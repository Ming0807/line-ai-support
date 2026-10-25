import {expect,it,vi} from 'vitest';
import {createGeneralReplyReview} from '../scripts/qa/general-reply-review-candidate';
const context={question:'ช่วยเตรียมคำร้องและหาแบบให้ด้วย',history:[{role:'user' as const,content:'อยากเขียนเหตุผลให้ชัด'}],text:'เขียนวัตถุประสงค์และลำดับเหตุการณ์ให้กระชับครับ'};
function fixture(output:unknown={verdict:'GENERAL_ONLY'}){
 const generate=vi.fn(async()=>({output,toolCalls:[] as unknown[]}));
 return {generate,review:createGeneralReplyReview({generate})};
}
it('reviews the exact question, history and complete candidate as untrusted data without tools',async()=>{
 const f=fixture(),before=structuredClone(context),signal=new AbortController().signal;
 expect(await f.review(context,signal)).toBe('GENERAL_ONLY');
 const call=f.generate.mock.calls[0] as unknown as [{messages:{role:string;content:string}[];tools:unknown[];signal:AbortSignal}];
 expect(JSON.parse(call[0].messages[1].content)).toEqual({...context,reviewedUniversityEvidence:[]});
 expect(call[0].tools).toEqual([]);expect(call[0].signal).toBe(signal);expect(context).toEqual(before);
});
it.each(['NEEDS_EVIDENCE','UNSAFE_OR_UNHELPFUL'] as const)('preserves rejection %s without authorizing another action',async verdict=>{
 expect(await fixture({verdict}).review(context,new AbortController().signal)).toBe(verdict);
});
it.each([{verdict:'GENERAL_ONLY',text:'replacement'},{verdict:'LOOKUP'},{verdict:'GENERAL_ONLY',ticketId:'invented'},null])('rejects invalid reviewer output %j',async output=>{
 await expect(fixture(output).review(context,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_OUTPUT'});
});
it('rejects tool calls even with a valid verdict',async()=>{
 const f=fixture();f.generate.mockResolvedValueOnce({output:{verdict:'GENERAL_ONLY'},toolCalls:[{name:'send'}]});
 await expect(f.review(context,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_OUTPUT'});
});
it('does not generate for cancellation or oversized input and does not clip',async()=>{
 const f=fixture(),c=new AbortController();c.abort();
 await expect(f.review(context,c.signal)).rejects.toMatchObject({code:'CANCELLED'});
 await expect(f.review({...context,text:'ก'.repeat(20001)},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(f.review({...context,history:[{role:'user',content:'ก'.repeat(40000)}]},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(f.generate).not.toHaveBeenCalled();
});
it('propagates late cancellation and provider failure without an acceptance verdict',async()=>{
 const f=fixture(),c=new AbortController();
 f.generate.mockImplementationOnce(async()=>{c.abort();return {output:{verdict:'GENERAL_ONLY'},toolCalls:[]};});
 await expect(f.review(context,c.signal)).rejects.toMatchObject({code:'CANCELLED'});
 f.generate.mockRejectedValueOnce(Error('unavailable'));
 await expect(f.review(context,new AbortController().signal)).rejects.toThrow('unavailable');
});
