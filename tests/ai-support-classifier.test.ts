import {expect,it,vi} from 'vitest';
import {createSupportClassifier} from '@/lib/ai/support-classifier';
const snapshot={question:'Wi-Fi ต่อไม่ได้',history:[]},departments=[{code:'IT',name:'ไอที'}];
const output={intent:'TROUBLESHOOT',category:'IT_SUPPORT',subcategory:'NETWORK_ACCESS',needsTicket:false,department:'IT',urgency:'medium',needsKnowledgeSearch:true,needsStructuredSearch:false,needsWebSearch:false,confidence:.95,missingContext:'DEVICE',impact:'SINGLE_USER',sensitivity:'GENERAL',facts:[{field:'PROBLEM',source:'U0',quote:'Wi-Fi ต่อไม่ได้'}]};
it('uses the injected configured gateway with a strict no-tools source-minimized proposal',async()=>{
 const generate=vi.fn().mockResolvedValue({output,toolCalls:[]}),classify=createSupportClassifier(generate);
 expect(await classify(snapshot,departments,new AbortController().signal)).toMatchObject({intent:'TROUBLESHOOT',departmentCode:'IT',clarification:'ใช้อุปกรณ์อะไร และระบบปฏิบัติการใดครับ'});
 const request=generate.mock.calls[0][0];expect(request.taskType).toBe('SUPPORT_INTENT');expect(request.timeoutMs).toBe(6000);expect(request.tools).toEqual([]);expect(request.messages[1].content).toContain('U0');expect(request.messages[1].content).not.toContain('sessionId');
});
it('ignores failed, malformed, unsolicited-tool and fabricated-fact completions',async()=>{
 for(const result of [{output:null,toolCalls:[]},{output,toolCalls:[{name:'create_ticket'}]},{output:{...output,facts:[{field:'PROBLEM',source:'U0',quote:'everything is solved'}]},toolCalls:[]}])expect(await createSupportClassifier(vi.fn().mockResolvedValue(result))(snapshot,departments,new AbortController().signal)).toBeNull();
 expect(await createSupportClassifier(vi.fn().mockRejectedValue(Error('private diagnostic')))(snapshot,departments,new AbortController().signal)).toBeNull();
});
it('does not call a provider for cancelled, invalid or oversized input',async()=>{
 const generate=vi.fn(),classify=createSupportClassifier(generate),controller=new AbortController();controller.abort();
 expect(await classify(snapshot,departments,controller.signal)).toBeNull();expect(await classify({...snapshot,question:'x'.repeat(2001)},departments,new AbortController().signal)).toBeNull();expect(generate).not.toHaveBeenCalled();
});
it('cancels an ignoring gateway at the stage deadline and cleans up the caller signal',async()=>{
 vi.useFakeTimers();try{const generate=vi.fn().mockImplementation(()=>new Promise(()=>{})),controller=new AbortController(),classify=createSupportClassifier(generate);
  const result=classify(snapshot,departments,controller.signal);await vi.advanceTimersByTimeAsync(6001);expect(await result).toBeNull();expect(generate.mock.calls[0][0].signal.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});
it('caller cancellation finishes promptly even when a gateway ignores abort',async()=>{
 const generate=vi.fn().mockImplementation(()=>new Promise(()=>{})),controller=new AbortController(),result=createSupportClassifier(generate)(snapshot,departments,controller.signal);
 await Promise.resolve();controller.abort();expect(await result).toBeNull();expect(generate.mock.calls[0][0].signal.aborted).toBe(true);
});
