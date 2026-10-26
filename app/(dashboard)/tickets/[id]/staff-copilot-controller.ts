import {staffCopilotAdviceSchema,type StaffCopilotAdvice} from '../../../../lib/staff/staff-copilot-contracts';

export type StaffCopilotPanelState=
 | {status:'idle'|'loading'|'cancelled'}
 | {status:'error';message:string}
 | {status:'result';advice:StaffCopilotAdvice;draftText:string};

type ControllerOptions={
 id:string;
 revision:number;
 onState:(state:StaffCopilotPanelState)=>void;
 fetchImpl?:typeof fetch;
};

const IDLE:StaffCopilotPanelState={status:'idle'};
function responseError(status:number):string{
 if(status===401)return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
 if(status===403)return 'คุณไม่มีสิทธิ์สร้างร่างสำหรับเคสนี้';
 if(status===404)return 'ไม่พบเคสนี้ หรือสิทธิ์ในการเข้าถึงเปลี่ยนไป';
 if(status===409)return 'เคสหรือข้อมูลอ้างอิงเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง';
 if(status===429)return 'ขณะนี้มีงานร่างคำตอบครบจำนวนที่รองรับ กรุณารอสักครู่แล้วลองใหม่';
 if(status===503)return 'Hermes ยังไม่พร้อมใช้งานในเครื่องนี้';
 return 'ยังสร้างร่างไม่ได้ กรุณาลองอีกครั้ง';
}

/** One explicit request at a time; the caller owns component lifetime and case binding. */
export function createStaffCopilotController(options:ControllerOptions){
 const fetchImpl=options.fetchImpl??globalThis.fetch;
 let active:AbortController|undefined,serial=0;
 const publish=options.onState;
 const current=(controller:AbortController,epoch:number)=>active===controller&&serial===epoch&&!controller.signal.aborted;

 async function generate():Promise<void>{
  if(active)return;
  const controller=new AbortController(),epoch=++serial;active=controller;
  publish({status:'loading'});
  try{
   const response=await fetchImpl(`/api/tickets/${encodeURIComponent(options.id)}/copilot`,{
    method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
    body:JSON.stringify({revision:options.revision}),cache:'no-store',signal:controller.signal,
   });
   if(!current(controller,epoch))return;
   if(!response.ok){publish({status:'error',message:responseError(response.status)});return;}
   let payload:unknown;
   try{payload=await response.json();}
   catch{if(current(controller,epoch))publish({status:'error',message:'Hermes ส่งข้อมูลกลับมาไม่ครบ กรุณาลองใหม่'});return;}
   if(!current(controller,epoch))return;
   const parsed=staffCopilotAdviceSchema.safeParse(payload);
   if(!parsed.success){publish({status:'error',message:'Hermes ส่งข้อมูลที่อ่านไม่ได้ กรุณาลองใหม่'});return;}
   if(parsed.data.ticketId!==options.id||parsed.data.revision!==options.revision){
    publish({status:'error',message:'ผลร่างไม่ตรงกับเคสหรือรุ่นข้อมูลที่เปิดอยู่ กรุณาโหลดข้อมูลล่าสุด'});return;
   }
   publish({status:'result',advice:parsed.data,draftText:parsed.data.status==='DRAFT'?parsed.data.draftText:''});
  }catch{
   if(current(controller,epoch))publish({status:'error',message:'การเชื่อมต่อขาดหาย ร่างยังไม่พร้อม กรุณาลองใหม่'});
  }finally{
   if(active===controller)active=undefined;
  }
 }

 function cancel():void{
  const controller=active;if(!controller)return;
  active=undefined;serial++;controller.abort();publish({status:'cancelled'});
 }

 /** Cleanup is silent so unmount/case switch never paints an obsolete state. */
 function dispose():void{
  const controller=active;if(!controller)return;
  active=undefined;serial++;controller.abort();
 }

 return {generate,cancel,dispose,reset:()=>publish(IDLE)};
}
