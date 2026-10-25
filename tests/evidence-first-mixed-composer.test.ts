import {expect,it,vi} from 'vitest';
import {createEvidenceFirstMixedComposer} from '../lib/ai/evidence-first-mixed';
import type {AISnapshot} from '../lib/ai/run-worker';
import type {GenerateInput} from '../lib/ai/gateway';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const snapshot:AISnapshot={jobId:id(1),sessionId:id(2),conversationId:id(3),messageId:id(4),revision:0,question:'ช่วยเขียนเหตุผลและหาแบบคำร้องด้วย',history:[]};
function fixture(output:unknown={generalText:'เริ่มจากระบุเรื่องที่ต้องการให้พิจารณา แล้วเรียงเหตุการณ์ที่เกี่ยวข้องให้ชัดครับ'}){
 const generate=vi.fn(async(input:GenerateInput<unknown>)=>{void input;return {output,toolCalls:[] as unknown[]};});
 return {generate,compose:createEvidenceFirstMixedComposer({generate})};
}
it('composes from the exact original source and completed official outcome without receiving the initial invented paragraph',async()=>{
 const f=fixture(),official={kind:'CLARIFY' as const,text:'ยังไม่พบแบบคำร้องที่ตรงกรณีครับ'},signal=new AbortController().signal;
 const result=await f.compose(snapshot,official,signal);
 expect(result).toContain('ระบุเรื่อง');expect(f.generate).toHaveBeenCalledTimes(1);
 const call=f.generate.mock.calls[0][0],payload=JSON.parse(call.messages[1].content);
 expect(payload).toEqual({question:snapshot.question,history:[],officialOutcome:{kind:'CLARIFY',answerProvided:false,text:official.text}});
 expect(call.tools).toEqual([]);expect(call.taskType).toBe('ASSISTANT_GENERAL_COMPOSE');expect(call.signal).toBe(signal);
});
it.each([{generalText:'ควรระบุรหัสนักศึกษาและเบอร์โทรศัพท์ครับ'},{generalText:'ok',query:'invented'},null])('rejects invalid or ungrounded prose %j',async output=>{
 const f=fixture(output);await expect(f.compose(snapshot,{kind:'CLARIFY',text:'ยังไม่พบ'},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_OUTPUT'});
});
it('does not silently drop history or clip oversized official outcome input',async()=>{
 const f=fixture(),current={...snapshot,history:[{role:'user' as const,content:'ก'.repeat(40000)}]};
 await expect(f.compose(current,{kind:'CLARIFY',text:'ยังไม่พบ'},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(f.generate).not.toHaveBeenCalled();
});
it('rejects general or nested mixed input rather than treating it as official evidence',async()=>{
 const f=fixture();
 const official={kind:'CONVERSATION' as const,basis:'GENERAL_MODEL' as const,text:'unreviewed',sourceDigest:'a'.repeat(64)};
 await expect(f.compose(snapshot,official,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(f.generate).not.toHaveBeenCalled();
});
it('does not run after cancellation or accept a result after cancellation',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 await expect(f.compose(snapshot,{kind:'CLARIFY',text:'ยังไม่พบ'},controller.signal)).rejects.toMatchObject({code:'CANCELLED'});
 expect(f.generate).not.toHaveBeenCalled();
});
