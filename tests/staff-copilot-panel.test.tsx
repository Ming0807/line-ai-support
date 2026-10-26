import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {StaffCopilotAdvice} from '../lib/staff/staff-copilot-contracts';
import {createStaffCopilotController,type StaffCopilotPanelState} from '../app/(dashboard)/tickets/[id]/staff-copilot-controller';
import {StaffCopilotPanelView} from '../app/(dashboard)/tickets/[id]/staff-copilot-panel';

const ticketId='11111111-1111-4111-8111-111111111111';
const source={title:'คู่มือการใช้งาน',academicYear:2569,url:'https://example.ac.th/guide',location:'หน้า 4'};
const draft:StaffCopilotAdvice={ticketId,revision:7,status:'DRAFT',draftText:'ร่างคำตอบฉบับเต็ม',
 evidenceText:'หลักฐานที่ใช้ประกอบร่าง',sources:[source]};
const props={id:ticketId,revision:7,canReply:true,onDraft:vi.fn()};
const jsonResponse=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body}) as Response;

it('posts only the case revision with same-origin, uncached, abortable transport and accepts a bound draft',async()=>{
 const fetchImpl=vi.fn(async()=>jsonResponse(draft)),states:StaffCopilotPanelState[]=[];
 const controller=createStaffCopilotController({id:ticketId,revision:7,fetchImpl,onState:state=>states.push(state)});
 await controller.generate();
 expect(fetchImpl).toHaveBeenCalledTimes(1);
 expect(fetchImpl).toHaveBeenCalledWith(`/api/tickets/${ticketId}/copilot`,expect.objectContaining({
  method:'POST',credentials:'same-origin',cache:'no-store',body:JSON.stringify({revision:7}),signal:expect.any(AbortSignal),
 }));
 expect(states.at(-1)).toMatchObject({status:'result',advice:draft,draftText:draft.draftText});
 controller.dispose();
});

it('rejects a response bound to another case or revision',async()=>{
 const states:StaffCopilotPanelState[]=[];
 const controller=createStaffCopilotController({id:ticketId,revision:7,fetchImpl:async()=>jsonResponse({...draft,ticketId:'22222222-2222-4222-8222-222222222222'}),onState:state=>states.push(state)});
 await controller.generate();
 expect(states.at(-1)).toMatchObject({status:'error'});
 controller.dispose();
});

it('aborts on cancellation and ignores a late response',async()=>{
 let finish:(response:Response)=>void=()=>{};
 const fetchImpl=vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>(resolve=>{
  finish=resolve;init?.signal?.addEventListener('abort',()=>{}, {once:true});
 }));
 const states:StaffCopilotPanelState[]=[];
 const controller=createStaffCopilotController({id:ticketId,revision:7,fetchImpl,onState:state=>states.push(state)});
 const running=controller.generate();
 await Promise.resolve();
 const signal=fetchImpl.mock.calls[0]?.[1]?.signal;
 controller.cancel();
 expect(signal?.aborted).toBe(true);
 finish(jsonResponse(draft));
 await running;
 expect(states.at(-1)).toMatchObject({status:'cancelled'});
 expect(states.some(state=>state.status==='result')).toBe(false);
 controller.dispose();
});

it('does not retry a failed generation unless staff explicitly requests another attempt',async()=>{
 const fetchImpl=vi.fn().mockRejectedValue(new Error('offline'));
 const states:StaffCopilotPanelState[]=[];
 const controller=createStaffCopilotController({id:ticketId,revision:7,fetchImpl,onState:state=>states.push(state)});
 await controller.generate();
 expect(fetchImpl).toHaveBeenCalledTimes(1);
 expect(states.at(-1)).toMatchObject({status:'error'});
 await controller.generate();
 expect(fetchImpl).toHaveBeenCalledTimes(2);
 controller.dispose();
});

it('renders a full editable unreviewed draft and separate evidence/source links',()=>{
 const html=renderToStaticMarkup(<StaffCopilotPanelView {...props} state={{status:'result',advice:draft,draftText:draft.draftText}}
  onGenerate={()=>{}} onCancel={()=>{}} onDraftTextChange={()=>{}}/>);
 expect(html).toContain('ร่างนี้ยังไม่ได้ตรวจสอบ');
 expect(html).toContain('ร่างคำตอบฉบับเต็ม');
 expect(html).toContain('ข้อมูลที่ใช้ประกอบร่าง');
 expect(html).toContain('หลักฐานที่ใช้ประกอบร่าง');
 expect(html).toContain('https://example.ac.th/guide');
 expect(html).toContain('aria-label="แหล่งอ้างอิง"');
});

it('shows the complete over-limit draft and disables transfer without clipping',()=>{
 const longDraft='ก'.repeat(5_001),html=renderToStaticMarkup(<StaffCopilotPanelView {...props} state={{status:'result',
  advice:{...draft,draftText:longDraft},draftText:longDraft}} onGenerate={()=>{}} onCancel={()=>{}} onDraftTextChange={()=>{}}/>);
 expect(html).toContain(longDraft);
 expect(html).toContain('disabled=""');
 expect(html).toContain('เกิน 5,000 ตัวอักษร');
});

it('renders honest non-draft outcomes without an apply action',()=>{
 const notVerified:StaffCopilotAdvice={ticketId,revision:7,status:'NOT_VERIFIED',draftText:null,
  evidenceText:'ยังยืนยันคำแนะนำนี้ไม่ได้',sources:[]};
 const unavailable=renderToStaticMarkup(<StaffCopilotPanelView {...props} state={{status:'result',advice:notVerified,draftText:''}}
  onGenerate={()=>{}} onCancel={()=>{}} onDraftTextChange={()=>{}}/>);
 expect(unavailable).toContain('ยังยืนยันคำแนะนำไม่ได้');
 expect(unavailable).toContain('ยังยืนยันคำแนะนำนี้ไม่ได้');
 expect(unavailable).not.toContain('นำร่างไปแก้ไขในช่องตอบกลับ');
 const noQuestion:StaffCopilotAdvice={ticketId,revision:7,status:'NO_USER_QUESTION',draftText:null,evidenceText:null,sources:[]};
 const empty=renderToStaticMarkup(<StaffCopilotPanelView {...props} state={{status:'result',advice:noQuestion,draftText:''}}
  onGenerate={()=>{}} onCancel={()=>{}} onDraftTextChange={()=>{}}/>);
 expect(empty).toContain('ยังไม่มีข้อความคำถามจากผู้แจ้ง');
 expect(empty).not.toContain('นำร่างไปแก้ไขในช่องตอบกลับ');
});

it('exposes progress and cancel controls accessibly while generating',()=>{
 const html=renderToStaticMarkup(<StaffCopilotPanelView {...props} state={{status:'loading'}}
  onGenerate={()=>{}} onCancel={()=>{}} onDraftTextChange={()=>{}}/>);
 expect(html).toContain('aria-busy="true"');
 expect(html).toContain('กำลังสร้างร่าง');
 expect(html).toContain('ยกเลิกการสร้างร่าง');
});
