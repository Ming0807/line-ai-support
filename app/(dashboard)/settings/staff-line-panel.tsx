'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {bindingStatusSchema,bindingChallengeSchema,type BindingStatus} from '@/lib/staff/line-binding-contracts';
import './staff-line.css';

export default function StaffLinePanel({initialStatus}:{initialStatus:BindingStatus|null}){
 const [status,setStatus]=useState(initialStatus),[command,setCommand]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(initialStatus?null:'ตรวจสอบการเชื่อมต่อไม่สำเร็จ'),[notice,setNotice]=useState<string|null>(null);
 const epoch=useRef(0),readController=useRef<AbortController|null>(null),writing=useRef(false),requestId=useRef<string|null>(null);
 const refresh=useCallback(async()=>{
  if(writing.current)return;
  readController.current?.abort();const controller=new AbortController();readController.current=controller;const serial=++epoch.current;
  try{
   const response=await fetch('/api/staff/line-binding',{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('UNAVAILABLE');
   const next=bindingStatusSchema.parse(await response.json());if(serial!==epoch.current)return;
   setStatus(next);setError(null);
   if(next.bound||!next.pending){setCommand(null);requestId.current=null;}
   if(next.bound)setNotice('เชื่อมต่อบัญชีเรียบร้อยแล้ว');
  }catch{if(serial===epoch.current&&!controller.signal.aborted)setError('ตรวจสอบการเชื่อมต่อไม่สำเร็จ กรุณาลองใหม่');}
 },[]);
 useEffect(()=>{
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);
  return ()=>{clearInterval(timer);readController.current?.abort();};
 },[refresh]);
 async function mutate(kind:'challenge'|'unlink'){
  if(writing.current)return;
  if(kind==='unlink'&&!window.confirm('ยกเลิกการเชื่อมต่อ LINE ของคุณ? ระบบจะหยุดส่งการแจ้งเตือนมายังบัญชีนี้'))return;
  readController.current?.abort();const serial=++epoch.current;writing.current=true;setBusy(true);setError(null);setNotice(null);
  if(kind==='challenge'){requestId.current??=crypto.randomUUID();setCommand(null);}
  try{
   const response=await fetch(kind==='challenge'?'/api/staff/line-binding/challenge':'/api/staff/line-binding',{
    method:kind==='challenge'?'POST':'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(kind==='challenge'?{requestId:requestId.current}:{}),cache:'no-store',signal:AbortSignal.timeout(15000),
   });
   if(!response.ok){
    if(response.status===409){requestId.current=null;throw Error('REFRESH');}
    throw Error('UNAVAILABLE');
   }
   const body:unknown=await response.json();if(serial!==epoch.current)return;
   if(kind==='challenge'){
    const next=bindingChallengeSchema.parse(body);setCommand(next.command);requestId.current=null;setStatus({bound:false,pending:true,expiresAt:next.expiresAt});setNotice('คัดลอกรหัสแล้วส่งเข้า LINE เจ้าหน้าที่ภายในเวลาที่กำหนด');
   }else{setStatus(bindingStatusSchema.parse(body));setCommand(null);requestId.current=null;setNotice('ยกเลิกการเชื่อมต่อแล้ว');}
  }catch(e){if(serial===epoch.current)setError(e instanceof Error&&e.message==='REFRESH'?'สถานะเปลี่ยนไปแล้ว กรุณาตรวจสอบสถานะและสร้างรหัสใหม่':'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง');}
  finally{writing.current=false;setBusy(false);}
 }
 async function copy(){
  if(!command)return;try{await navigator.clipboard.writeText(command);setNotice('คัดลอกรหัสแล้ว เปิด LINE เจ้าหน้าที่แล้ววางส่งได้เลย');}catch{setNotice('คัดลอกอัตโนมัติไม่สำเร็จ เลือกรหัสด้านล่างแล้วคัดลอกได้เลย');}
 }
 return <section className="operations-surface staff-line-panel" aria-labelledby="staff-line-title">
  <div className="staff-line-heading"><div><h2 id="staff-line-title">เชื่อมต่อ LINE เจ้าหน้าที่</h2><p className="operations-muted">รับแจ้งเตือนงานที่คุณมีสิทธิ์ดูผ่านบัญชี LINE ของคุณ</p></div><span className="operations-status">{status?.bound?'เชื่อมต่อแล้ว':status?.pending?'รอส่งรหัสเข้า LINE':status?'ยังไม่เชื่อมต่อ':'ยังไม่ทราบสถานะ'}</span></div>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status" aria-live="polite">{notice}</p>}
  {!status?.bound&&<p>สร้างรหัสชั่วคราว แล้วส่งรหัสทั้งบรรทัดเข้า Staff OA ระบบจะตรวจสอบและอัปเดตสถานะที่หน้านี้ให้</p>}
  {command&&status?.pending&&<div className="staff-line-command"><label htmlFor="staff-line-command">รหัสเชื่อมต่อชั่วคราว</label><textarea id="staff-line-command" value={command} readOnly rows={3} spellCheck={false} aria-describedby="staff-line-expiry"/><p id="staff-line-expiry" className="operations-muted">ใช้ได้ถึง {new Intl.DateTimeFormat('th-TH',{timeStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(status.expiresAt!))} · ใช้ครั้งเดียวสำหรับบัญชีของคุณ</p></div>}
  {status?.pending&&!command&&<p className="operations-muted">มีรหัสที่ยังใช้ได้ หากไม่ได้เก็บรหัสไว้ สามารถสร้างใหม่เพื่อยกเลิกรหัสเดิม</p>}
  <div className="staff-line-actions">
   {status?.bound?<button className="dashboard-pill-btn dashboard-pill-btn-outline" disabled={busy} onClick={()=>void mutate('unlink')}>ยกเลิกการเชื่อมต่อ</button>:
    <button className="dashboard-pill-btn dashboard-pill-btn-dark" disabled={busy||!status} onClick={()=>void mutate('challenge')}>{busy?'กำลังดำเนินการ…':command?'สร้างรหัสใหม่':'สร้างรหัสเชื่อมต่อ'}</button>}
   {command&&<button className="dashboard-pill-btn dashboard-pill-btn-dark" disabled={busy} onClick={()=>void copy()}>คัดลอกรหัส</button>}
   <button className="dashboard-pill-btn dashboard-pill-btn-outline" disabled={busy} onClick={()=>void refresh()}>ตรวจสอบสถานะ</button>
  </div>
 </section>;
}
