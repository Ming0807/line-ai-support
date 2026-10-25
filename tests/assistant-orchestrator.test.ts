import {expect,it,vi} from 'vitest';
import {createAssistantOrchestrator} from '../lib/ai/assistant-orchestrator';
import type {AISnapshot,AIWorkerOptions} from '../lib/ai/run-worker';
import type {AssistantDecision,AssistantHandoffReason} from '../lib/ai/assistant-decision';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const snapshot:AISnapshot={jobId:id(1),sessionId:id(2),conversationId:id(3),messageId:id(4),revision:0,question:'Wi-Fi คืออะไร',history:[]};
function fixture(decision:AssistantDecision){
 const decide=vi.fn(async()=>({decision,provenance:'MODEL_PROPOSAL_UNVERIFIED' as const,historyOmittedCount:0}));
 const lookup=vi.fn<Parameters<typeof createAssistantOrchestrator>[0]['lookup']>(async()=>({kind:'CLARIFY',text:'ยังไม่มีเอกสาร'})),handoff=vi.fn<(snapshot:AISnapshot,signal:AbortSignal,reason:AssistantHandoffReason)=>ReturnType<AIWorkerOptions['produce']>>(async()=>({kind:'CLARIFY',text:'กรุณายืนยันการส่งต่อ'}));
 return {decide,lookup,handoff,produce:createAssistantOrchestrator({decide,lookup,handoff})};
}
it('answers general questions without evidence calls or support mutation',async()=>{
 const f=fixture({action:'GENERAL_REPLY',text:'Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์ครับ'}),result=await f.produce(snapshot,new AbortController().signal);
 expect(result).toMatchObject({kind:'CONVERSATION',basis:'GENERAL_MODEL'});expect(result).not.toHaveProperty('support');expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
});
it('repairs the captured rejected general identifier once instead of turning model invention into an unrelated lookup',async()=>{
 const rejected={action:'GENERAL_REPLY' as const,text:'ลองรีสตาร์ทมือถือครับ ใช้ Wi-Fi ของมหาวิทยาลัย (เช่น YRU-WiFI) หรือเครือข่ายส่วนตัวครับ'};
 const f=fixture(rejected),safe={action:'GENERAL_REPLY' as const,text:'ลองรีสตาร์ทมือถือแล้วเชื่อมต่อเครือข่ายเดิมอีกครั้งครับ'};
 f.decide.mockResolvedValueOnce({decision:rejected,provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0})
  .mockResolvedValueOnce({decision:safe,provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0});
 const current={...snapshot,question:'ควรลองอะไรต่อ โดยไม่ล้างการตั้งค่าทั้งหมด',history:[{role:'user' as const,content:'มือถือ Android ต่อ Wi-Fi แล้วไม่มีอินเทอร์เน็ต เครื่องอื่นใช้ได้ ลองปิดเปิด Wi-Fi แล้ว'}]};
 const before=structuredClone(current),signal=new AbortController().signal;
 const result=await createAssistantOrchestrator({...f,repairRejectedGeneral:true})(current,signal);
 expect(result).toMatchObject({kind:'CONVERSATION',text:safe.text});expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
 expect(f.decide).toHaveBeenCalledTimes(2);expect(f.decide).toHaveBeenLastCalledWith({question:current.question,history:current.history},signal,{reason:'INSTITUTIONAL_TOPIC',rejectedProposal:rejected});
 expect(current).toEqual(before);
});
it('does not loop or infer an official lookup when the one repaired general proposal is still rejected',async()=>{
 const f=fixture({action:'GENERAL_REPLY',text:'Wi-Fi ของมหาวิทยาลัย เช่น YRU-WiFI'});
 const result=await createAssistantOrchestrator({...f,repairRejectedGeneral:true})(snapshot,new AbortController().signal);
 expect(result.kind).toBe('CLARIFY');expect(f.decide).toHaveBeenCalledTimes(2);expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
 expect(JSON.stringify(result)).not.toContain('YRU-WiFI');
});
it('accepts one repaired necessary clarification without an evidence call',async()=>{
 const f=fixture({action:'GENERAL_REPLY',text:'Wi-Fi ของมหาวิทยาลัย เช่น YRU-WiFI'}),text='เป็นเครือข่ายส่วนตัวหรือเครือข่ายที่มีผู้ดูแลครับ';
 f.decide.mockResolvedValueOnce({decision:{action:'GENERAL_REPLY',text:'Wi-Fi ของมหาวิทยาลัย เช่น YRU-WiFI'},provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0})
  .mockResolvedValueOnce({decision:{action:'CLARIFY',text},provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0});
 expect(await createAssistantOrchestrator({...f,repairRejectedGeneral:true})(snapshot,new AbortController().signal)).toMatchObject({kind:'CONVERSATION',text});
 expect(f.decide).toHaveBeenCalledTimes(2);expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
});
it.each(['transport','schema'])('does not attempt repair after an initial %s failure',async failure=>{
 const f=fixture({action:'GENERAL_REPLY',text:'unused'});f.decide.mockRejectedValueOnce(Error(failure));
 const result=await createAssistantOrchestrator({...f,repairRejectedGeneral:true})(snapshot,new AbortController().signal);
 expect(result.kind).toBe('CLARIFY');expect(f.decide).toHaveBeenCalledTimes(1);expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
});
it('fails safely after a repair failure without further generation or inferred actions',async()=>{
 const rejected={action:'GENERAL_REPLY' as const,text:'Wi-Fi ของมหาวิทยาลัย เช่น YRU-WiFI'},f=fixture(rejected);
 f.decide.mockResolvedValueOnce({decision:rejected,provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0}).mockRejectedValueOnce(Error('private detail'));
 const result=await createAssistantOrchestrator({...f,repairRejectedGeneral:true})(snapshot,new AbortController().signal);
 expect(result.kind).toBe('CLARIFY');expect(JSON.stringify(result)).not.toContain('private detail');expect(f.decide).toHaveBeenCalledTimes(2);
 expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
});
it('keeps valid MIXED on the unchanged source path without an extra decision',async()=>{
 const f=fixture({action:'MIXED_REPLY',generalText:'เขียนเป้าหมายของคำร้องให้ชัดเจนครับ',query:'ข้อมูลทางการ'}),signal=new AbortController().signal;
 expect(await createAssistantOrchestrator({...f,repairRejectedGeneral:true})(snapshot,signal)).toMatchObject({kind:'MIXED',general:{text:'เขียนเป้าหมายของคำร้องให้ชัดเจนครับ'},official:{kind:'CLARIFY',text:'ยังไม่มีเอกสาร'}});
 expect(f.decide).toHaveBeenCalledTimes(1);expect(f.lookup).toHaveBeenCalledExactlyOnceWith(snapshot,signal,'ข้อมูลทางการ');expect(f.handoff).not.toHaveBeenCalled();
});
it.each([
 'การเตรียมตัวก่อนยื่นคำร้องทั่วไป คุณควรระบุชื่อ-นามสกุล รหัสนักศึกษา คณะ สาขาวิชา และเบอร์โทรศัพท์ให้ชัดเจนครับ',
 'สำหรับการเตรียมตัวก่อนยื่นคำร้องทั่วไปนะครับ เบื้องต้นคุณควรระบุวัตถุประสงค์ของการยื่นคำร้องให้ชัดเจน รวบรวมข้อมูลส่วนตัวและรายละเอียดที่เกี่ยวข้องให้ครบถ้วน เช่น รหัสนักศึกษา ชื่อ-นามสกุล คณะ และเบอร์ติดต่อ พร้อมทั้งตรวจสอบความถูกต้องของข้อมูลก่อนนำส่งครับ',
])('repairs captured MIXED institutional field advice before searching or delivering it: %s',async generalText=>{
 const rejected={action:'MIXED_REPLY' as const,generalText,query:'ลิงก์แบบคำร้องทั่วไป มหาวิทยาลัยราชภัฏยะลา'};
 const safe={action:'MIXED_REPLY' as const,generalText:'เขียนเป้าหมายและข้อเท็จจริงที่ต้องการให้พิจารณาให้กระชับ แล้วตรวจคำแนะนำของแบบที่ใช้ครับ',query:'ค้นแบบคำร้องที่เผยแพร่'};
 const f=fixture(rejected),current={...snapshot,question:'ช่วยแนะนำการเตรียมตัวก่อนยื่นคำร้องทั่วไปและหาลิงก์แบบคำร้องให้ด้วยครับ'},signal=new AbortController().signal;
 f.decide.mockResolvedValueOnce({decision:rejected,provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0}).mockResolvedValueOnce({decision:safe,provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0});
 const result=await createAssistantOrchestrator({...f,repairRejectedGeneral:true})(current,signal);
 expect(result).toMatchObject({kind:'MIXED',general:{text:safe.generalText},official:{kind:'CLARIFY'}});
 expect(f.decide).toHaveBeenCalledTimes(2);expect(f.decide).toHaveBeenLastCalledWith({question:current.question,history:current.history},signal,{reason:'INSTITUTIONAL_REQUIREMENT',rejectedProposal:rejected});
 expect(f.lookup).toHaveBeenCalledExactlyOnceWith(current,signal,safe.query);expect(JSON.stringify(result)).not.toContain('รหัสนักศึกษา');expect(f.handoff).not.toHaveBeenCalled();
});
it('does not silently lose requested general help to a pure LOOKUP returned against the MIXED repair contract',async()=>{
 const rejected={action:'MIXED_REPLY' as const,generalText:'ควรระบุรหัสนักศึกษาครับ',query:'แบบคำร้องทั่วไป'},f=fixture(rejected);
 f.decide.mockResolvedValueOnce({decision:rejected,provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0}).mockResolvedValueOnce({decision:{action:'LOOKUP',query:'ค้นอย่างเดียว'},provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0});
 const result=await createAssistantOrchestrator({...f,repairRejectedGeneral:true})({...snapshot,question:'ช่วยเตรียมตัวก่อนยื่นคำร้องและหาแบบให้ด้วย'},new AbortController().signal);
 expect(result.kind).toBe('CLARIFY');expect(f.decide).toHaveBeenCalledTimes(2);expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
});
it('does not opt legacy callers into the extra generation',async()=>{
 const f=fixture({action:'GENERAL_REPLY',text:'ค่าเทอมคือ500บาทครับ'}),signal=new AbortController().signal;
 await f.produce(snapshot,signal);expect(f.decide).toHaveBeenCalledTimes(1);expect(f.lookup).toHaveBeenCalledExactlyOnceWith(snapshot,signal);
});
it('keeps an actual official need on the normal source path when a repaired decision explicitly requests lookup',async()=>{
 const f=fixture({action:'CLARIFY',text:'ค่าเทอมคือ 500 บาท'}),query='ค่าธรรมเนียมที่มหาวิทยาลัยประกาศ';
 f.decide.mockResolvedValueOnce({decision:{action:'CLARIFY',text:'ค่าเทอมคือ 500 บาท'},provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0})
  .mockResolvedValueOnce({decision:{action:'LOOKUP',query},provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0});
 const current={...snapshot,question:'ขอค่าธรรมเนียมที่มหาวิทยาลัยประกาศ'},signal=new AbortController().signal;
 await createAssistantOrchestrator({...f,repairRejectedGeneral:true})(current,signal);
 expect(f.lookup).toHaveBeenCalledExactlyOnceWith(current,signal,query);expect(f.handoff).not.toHaveBeenCalled();
});
it('propagates cancellation during one-shot general repair without lookup, handoff or delivery',async()=>{
 const f=fixture({action:'GENERAL_REPLY',text:'Wi-Fi ของมหาวิทยาลัย เช่น YRU-WiFI'}),controller=new AbortController();
 f.decide.mockImplementationOnce(async()=>({decision:{action:'GENERAL_REPLY',text:'Wi-Fi ของมหาวิทยาลัย เช่น YRU-WiFI'},provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0}))
  .mockImplementationOnce(async()=>{controller.abort();return {decision:{action:'GENERAL_REPLY',text:'คำตอบที่มาช้า'},provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0};});
 await expect(createAssistantOrchestrator({...f,repairRejectedGeneral:true})(snapshot,controller.signal)).rejects.toMatchObject({code:'CANCELLED'});
 expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
});
it.each(['GENERAL_REPLY','CLARIFY'] as const)('keeps ordinary diagnostic field wording in %s without official fallback',async action=>{
 const text='The required information for diagnosing this connection is the program version and phone model.';
 const f=fixture({action,text}),current={...snapshot,question:'I am debugging an Android app that fails to connect; can you help?'};
 expect(await f.produce(current,new AbortController().signal)).toMatchObject({kind:'CONVERSATION',text});
 expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
});
it('delivers numbered device advice intact without an unrelated official lookup',async()=>{
 const text='1. ปิดเครื่องแล้วเปิดใหม่เพื่อรีเซ็ตสแต็กเครือข่าย 2. ลืมเครือข่ายแล้วต่อใหม่ครับ';
 const f=fixture({action:'GENERAL_REPLY',text});
 expect(await f.produce({...snapshot,question:'มือถือ Android ต่อ Wi-Fi ได้แต่ไม่มีอินเทอร์เน็ต'},new AbortController().signal)).toMatchObject({kind:'CONVERSATION',text});
 expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
});
it('uses original question and history for lookup, never invented scope from a model query',async()=>{
 const f=fixture({action:'LOOKUP',query:'invented program 9999'});await f.produce(snapshot,new AbortController().signal);
 expect(f.lookup.mock.calls[0]?.[0]).toEqual(snapshot);expect(f.handoff).not.toHaveBeenCalled();
});
it.each(['LOOKUP','MIXED_REPLY'] as const)('passes %s query only as a retrieval hint beside the unchanged source snapshot',async action=>{
 const query='คำร้องเทียบโอนรายวิชาต้องเตรียมเอกสารอะไรบ้าง';
 const f=fixture(action==='LOOKUP'?{action,query}:{action,query,generalText:'ระบุเหตุผลของคำร้องให้ชัดเจนครับ'});
 const context={...snapshot,question:'แล้วต้องเตรียมอะไรบ้าง',history:[{role:'user' as const,content:'อยากยื่นคำร้องเทียบโอนรายวิชา'}]};
 const original=structuredClone(context),signal=new AbortController().signal;
 await f.produce(context,signal);
 expect(f.lookup).toHaveBeenCalledWith(original,signal,query);
 expect(context).toEqual(original);expect(f.handoff).not.toHaveBeenCalled();
});
it('routes an unsupported general official claim through evidence instead of delivering it',async()=>{
 const f=fixture({action:'GENERAL_REPLY',text:'ค่าเทอมคือ 500 บาท'});expect((await f.produce(snapshot,new AbortController().signal)).kind).toBe('CLARIFY');expect(f.lookup).toHaveBeenCalledTimes(1);
});
it.each(['GENERAL_REPLY','CLARIFY','MIXED_REPLY'] as const)('does not deliver unsupported mandatory personal fields through %s',async action=>{
 const text='รวบรวมข้อมูลและข้อเท็จจริงที่จำเป็น เช่น รหัสนักศึกษา ชื่อ-นามสกุล คณะ สาขา และเบอร์ติดต่อที่สะดวก';
 const f=fixture(action==='MIXED_REPLY'?{action,generalText:text,query:'ตำแหน่งแบบคำร้อง'}:{action,text});
 const current={...snapshot,question:'ช่วยแนะนำการเตรียมตัวก่อนยื่นคำร้องทั่วไปและหาลิงก์แบบคำร้องให้ด้วยครับ'},signal=new AbortController().signal;
 const result=await f.produce(current,signal);
 if(action==='MIXED_REPLY')expect(result).toMatchObject({kind:'MIXED',official:{kind:'CLARIFY',text:'ยังไม่มีเอกสาร'}});
 else expect(result).toEqual({kind:'CLARIFY',text:'ยังไม่มีเอกสาร'});
 expect(JSON.stringify(result)).not.toContain(text);
 expect(f.lookup).toHaveBeenCalledOnce();expect(f.lookup.mock.calls[0]?.[0]).toEqual(current);
 expect(f.handoff).not.toHaveBeenCalled();
});
it('uses existing confirmation producer for handoff without inventing a ticket receipt',async()=>{
 const f=fixture({action:'HANDOFF',reason:'PERSONAL_RECORD'});expect(await f.produce(snapshot,new AbortController().signal)).toEqual({kind:'CLARIFY',text:'กรุณายืนยันการส่งต่อ'});expect(f.handoff).toHaveBeenCalledTimes(1);expect(f.lookup).not.toHaveBeenCalled();
});
it('provider failure does not trigger a staff handoff',async()=>{
 const f=fixture({action:'CLARIFY',text:'รายละเอียดใดครับ'});f.decide.mockRejectedValueOnce(Error('upstream private detail'));
 const result=await f.produce(snapshot,new AbortController().signal);expect(result.kind).toBe('CLARIFY');expect(JSON.stringify(result)).not.toContain('upstream');expect(f.handoff).not.toHaveBeenCalled();
});
it('cancellation never returns a deliverable reply',async()=>{
 const f=fixture({action:'GENERAL_REPLY',text:'สวัสดีครับ'});await expect(f.produce(snapshot,AbortSignal.abort())).rejects.toMatchObject({code:'CANCELLED'});expect(f.decide).not.toHaveBeenCalled();
});
it('does not deliver a declarative statement disguised as a clarification',async()=>{
 const f=fixture({action:'CLARIFY',text:'มหาวิทยาลัยรับสมัครถึงพรุ่งนี้ครับ'});
 const result=await f.produce(snapshot,new AbortController().signal);expect(f.lookup).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain('พรุ่งนี้');
});
it('binds a relevant clarification to the current source instead of an unbound plain reply',async()=>{
 const f=fixture({action:'CLARIFY',text:'ใช้อุปกรณ์อะไรอยู่ครับ'});
 expect(await f.produce(snapshot,new AbortController().signal)).toMatchObject({kind:'CONVERSATION',text:'ใช้อุปกรณ์อะไรอยู่ครับ'});
});
it('keeps an independent general segment when official evidence is unavailable',async()=>{
 const f=fixture({action:'MIXED_REPLY',generalText:'Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์',query:'official question'});
 expect(await f.produce(snapshot,new AbortController().signal)).toMatchObject({kind:'MIXED',general:{kind:'CONVERSATION',text:'Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์'},official:{kind:'CLARIFY',text:'ยังไม่มีเอกสาร'}});
 expect(f.lookup.mock.calls[0]?.[0]).toEqual(snapshot);
});
it('discloses the rejected general portion without dropping verified official output or inventing requirements',async()=>{
 const f=fixture({action:'MIXED_REPLY',generalText:'รวบรวมเอกสารประกอบ เช่น สำเนาบัตรประชาชนครับ',query:'แบบคำร้อง'});
 const official={kind:'CLARIFY' as const,text:'ข้อมูลทางการที่ตรวจสอบแล้ว'};f.lookup.mockResolvedValueOnce(official);
 const result=await f.produce({...snapshot,question:'ช่วยเตรียมตัวและหาแบบคำร้อง'},new AbortController().signal);
 expect(result).toMatchObject({kind:'MIXED',general:{text:expect.stringContaining('ยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบ')},official});
 expect(JSON.stringify(result)).not.toContain('สำเนาบัตร');expect(f.decide).toHaveBeenCalledTimes(1);expect(f.lookup).toHaveBeenCalledTimes(1);
});
it('discloses unavailable evidence-first composition without discarding the official result',async()=>{
 const f=fixture({action:'MIXED_REPLY',generalText:'untrusted',query:'แบบคำร้อง'});
 const composeMixed=vi.fn(async()=>null);
 const result=await createAssistantOrchestrator({...f,composeMixed})(snapshot,new AbortController().signal);
 expect(result).toMatchObject({kind:'MIXED',general:{text:expect.stringContaining('ยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบ')},official:{kind:'CLARIFY',text:'ยังไม่มีเอกสาร'}});
 expect(composeMixed).toHaveBeenCalledTimes(1);expect(f.decide).toHaveBeenCalledTimes(1);
});
it('retains safe general prose with an honest official limitation when lookup fails',async()=>{
 const f=fixture({action:'MIXED_REPLY',generalText:'Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์',query:'official question'});
 f.lookup.mockRejectedValueOnce(Error('private upstream detail'));
 const result=await f.produce(snapshot,new AbortController().signal);
 expect(result).toMatchObject({kind:'MIXED',general:{text:'Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์'},official:{kind:'CLARIFY'}});
 expect(JSON.stringify(result)).not.toContain('private upstream detail');expect(f.handoff).not.toHaveBeenCalled();
});
it('never delivers the general portion after canceled mixed lookup',async()=>{
 const f=fixture({action:'MIXED_REPLY',generalText:'Wi-Fi ใช้คลื่นวิทยุเชื่อมอุปกรณ์',query:'official question'}),controller=new AbortController();
 f.lookup.mockImplementationOnce(async()=>{controller.abort();throw Error('late lookup');});
 await expect(f.produce(snapshot,controller.signal)).rejects.toMatchObject({code:'CANCELLED'});
});
it('preserves a relevant Thai request-form clarification without forcing a knowledge search',async()=>{
 const text='ช่วยบอกหน่อยว่าลองแก้ด้วยวิธีไหนไปแล้วบ้างครับ',f=fixture({action:'CLARIFY',text});
 expect(await f.produce(snapshot,new AbortController().signal)).toMatchObject({kind:'CONVERSATION',text});
 expect(f.lookup).not.toHaveBeenCalled();
});
it('preserves a polite request for device information without interrogative wording',async()=>{
 const text='ขอทราบอุปกรณ์ที่ใช้งานอยู่ เช่น โน้ตบุ๊ก สมาร์ทโฟน หรือแท็บเล็ต เพื่อให้ผมแนะนำขั้นตอนการตรวจสอบเบื้องต้นได้อย่างถูกต้องครับ';
 const f=fixture({action:'CLARIFY',text});
 expect(await f.produce(snapshot,new AbortController().signal)).toMatchObject({kind:'CONVERSATION',text});
 expect(f.lookup).not.toHaveBeenCalled();
});
it('still rejects unsupported claims prefixed by a polite information request',async()=>{
 const f=fixture({action:'CLARIFY',text:'ขอทราบอุปกรณ์ที่ใช้ครับ ค่าเทอมคือ 500 บาท'});
 await f.produce(snapshot,new AbortController().signal);
 expect(f.lookup).toHaveBeenCalledTimes(1);
});
it('carries the selected handoff reason to the source-validating producer',async()=>{
 const f=fixture({action:'HANDOFF',reason:'PERSONAL_RECORD'}),signal=new AbortController().signal;
 await f.produce(snapshot,signal);
 expect(f.handoff.mock.calls[0]).toEqual([snapshot,signal,'PERSONAL_RECORD']);
});
it.each([
 'เข้าใจครับ เพื่อให้ผมช่วยตรวจสอบเพิ่มเติม รบกวนแจ้งให้ผมทราบหน่อยนะครับว่า เป็น Wi-Fi ของที่บ้าน หอพัก หรือของมหาวิทยาลัยครับ',
 'กรุณาระบุชื่อเครือข่ายที่กำลังเชื่อมต่อครับ',
 'โปรดบอกข้อความที่แสดงบนหน้าจอครับ',
 'รบกวนแจ้งชื่อเครือข่ายของมหาวิทยาลัยที่คุณใช้วันนี้ครับ',
])('keeps a source-bound polite diagnostic request without an unrelated lookup: %s',async text=>{
 const f=fixture({action:'CLARIFY',text});
 const context={...snapshot,question:'ลองปิดเปิด Wi-Fi แล้ว ยังเป็นเหมือนเดิม',history:[
  {role:'user' as const,content:'มือถือ Android ต่อ Wi-Fi ไม่ได้และขึ้นว่าเชื่อมต่อแล้วแต่ไม่มีอินเทอร์เน็ต'},
  {role:'assistant' as const,content:'ลองปิดเปิด Wi-Fi ก่อนครับ ถ้ายังไม่ได้ แจ้งว่าเป็นเครือข่ายที่บ้านหรือมหาวิทยาลัยครับ'},
 ]};
 expect(await f.produce(context,new AbortController().signal)).toMatchObject({kind:'CONVERSATION',text});
 expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
});
it.each(['GENERAL_REPLY','CLARIFY'] as const)('requires evidence for a relative university deadline in %s',async action=>{
 const text='รบกวนแจ้งชื่อเครือข่ายครับ มหาวิทยาลัยรับสมัครถึงพรุ่งนี้ครับ';
 const f=fixture({action,text});const result=await f.produce(snapshot,new AbortController().signal);
 expect(f.lookup).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain('พรุ่งนี้');
});
it.each([
 'ขอสอบถามเพิ่มเติมครับว่า ตอนนี้ใช้งาน Wi-Fi ของมหาวิทยาลัย หรือ Wi-Fi เครือข่ายส่วนตัวครับ เพื่อจะได้แนะนำวิธีตรวจสอบเบื้องต้นได้อย่างถูกต้องครับ',
 'สะดวกแจ้งชื่อเครือข่ายที่ใช้อยู่ครับ',
 'โปรดส่งข้อความที่แสดงบนหน้าจอครับ',
 'Please provide your operating system.',
])('delivers a safe typed clarification without guessing its grammatical surface: %s',async text=>{
 const f=fixture({action:'CLARIFY',text});
 expect(await f.produce(snapshot,new AbortController().signal)).toMatchObject({kind:'CONVERSATION',basis:'GENERAL_MODEL',text});
 expect(f.lookup).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
});
it.each(['GENERAL_REPLY','CLARIFY'] as const)('requires evidence for the captured invented institutional SSID example in %s',async action=>{
 const text='ขอสอบถามเพิ่มเติมครับว่า ตอนนี้ใช้งาน Wi-Fi ของมหาวิทยาลัย (เช่น YRU-WiFi) หรือ Wi-Fi เครือข่ายส่วนตัวครับ เพื่อจะได้แนะนำวิธีตรวจสอบเบื้องต้นได้อย่างถูกต้องครับ';
 const f=fixture({action,text});await f.produce(snapshot,new AbortController().signal);
 expect(f.lookup).toHaveBeenCalledTimes(1);expect(f.handoff).not.toHaveBeenCalled();
});
