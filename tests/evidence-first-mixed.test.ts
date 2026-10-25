import {it,expect,vi} from 'vitest';
import {createAssistantOrchestrator} from '../lib/ai/assistant-orchestrator';
import type {AISnapshot} from '../lib/ai/run-worker';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const snapshot:AISnapshot={jobId:id(1),sessionId:id(2),conversationId:id(3),messageId:id(4),revision:0,
 question:'ช่วยแนะนำวิธีเขียนเหตุผลและหาแบบคำร้องด้วย',history:[]};
it('looks up the official part before composing and never repairs or forwards initial unverified general prose',async()=>{
 const events:string[]=[],signal=new AbortController().signal;
 const decide=vi.fn(async()=>({decision:{action:'MIXED_REPLY' as const,generalText:'ต้องแนบสำเนาบัตรนักศึกษาครับ',query:'แบบคำร้อง'},provenance:'MODEL_PROPOSAL_UNVERIFIED' as const,historyOmittedCount:0}));
 const official={kind:'CLARIFY' as const,text:'ต้องการแบบคำร้องเรื่องใดครับ'};
 const lookup=vi.fn(async()=>{events.push('lookup');return official;});
 const composeMixed=vi.fn(async()=>{events.push('compose');return 'เริ่มจากบอกเรื่องที่ต้องการให้พิจารณาและเรียงเหตุการณ์ให้ชัดครับ';});
 const handoff=vi.fn();
 const result=await createAssistantOrchestrator({decide,lookup,handoff,repairRejectedGeneral:true,composeMixed})(snapshot,signal);
 expect(events).toEqual(['lookup','compose']);expect(decide).toHaveBeenCalledTimes(1);
 expect(composeMixed).toHaveBeenCalledExactlyOnceWith(snapshot,official,signal);
 expect(result).toMatchObject({kind:'MIXED',official,general:{text:'เริ่มจากบอกเรื่องที่ต้องการให้พิจารณาและเรียงเหตุการณ์ให้ชัดครับ'}});
 expect(JSON.stringify(result)).not.toContain('บัตรนักศึกษา');expect(handoff).not.toHaveBeenCalled();
});
it('does not compose if lookup is canceled',async()=>{
 const controller=new AbortController(),composeMixed=vi.fn();
 const decide=vi.fn(async()=>({decision:{action:'MIXED_REPLY' as const,generalText:'unused',query:'official'},provenance:'MODEL_PROPOSAL_UNVERIFIED' as const,historyOmittedCount:0}));
 const lookup=vi.fn(async()=>{controller.abort();return {kind:'CLARIFY' as const,text:'unused'};});
 await expect(createAssistantOrchestrator({decide,lookup,handoff:vi.fn(),composeMixed})(snapshot,controller.signal)).rejects.toMatchObject({code:'CANCELLED'});
 expect(composeMixed).not.toHaveBeenCalled();
});
it('does not attach general prose to a support/action result',async()=>{
 const decide=vi.fn(async()=>({decision:{action:'MIXED_REPLY' as const,generalText:'unused',query:'official'},provenance:'MODEL_PROPOSAL_UNVERIFIED' as const,historyOmittedCount:0}));
 const official={kind:'CLARIFY' as const,text:'support',support:{}},composeMixed=vi.fn();
 // The normal producer validates full support metadata; this unit exercises its branch marker only.
 const lookup=vi.fn(async()=>official) as unknown as Parameters<typeof createAssistantOrchestrator>[0]['lookup'];
 const result=await createAssistantOrchestrator({decide,lookup,handoff:vi.fn(),composeMixed})(snapshot,new AbortController().signal);
 expect(result).toBe(official);expect(composeMixed).not.toHaveBeenCalled();
});
