'use client';
import Script from 'next/script';
import {useCallback,useRef,useState} from 'react';
import {readAttachmentParam,viewerMessageFor} from './viewer-state';

type Liff={init(config:{liffId:string}):Promise<void>;isLoggedIn():boolean;login(config?:{redirectUri?:string}):void;getIDToken():string|null};
type State={phase:'loading'}|{phase:'error';message:string}|{phase:'ready';url:string;kind:'PDF'|'IMAGE'};
const LIFF_SDK='https://static.line-scdn.net/liff/edge/2/sdk.js';

/** The raw ID token goes only to our same-origin session endpoint; it is never stored, shown or logged. */
export function StudentMediaViewer({liffId}:{liffId:string}){
 const [state,setState]=useState<State>({phase:'loading'});
 const started=useRef(false);
 const start=useCallback(async()=>{
  if(started.current)return;started.current=true;
  const liff=(window as unknown as {liff?:Liff}).liff;
  if(!liff){setState({phase:'error',message:viewerMessageFor(503)});return;}
  try{
   await liff.init({liffId});
   if(!liff.isLoggedIn()){liff.login({redirectUri:window.location.href});return;}
   const attachmentId=readAttachmentParam(window.location.search);
   if(!attachmentId){setState({phase:'error',message:viewerMessageFor(404)});return;}
   const idToken=liff.getIDToken();
   if(!idToken){setState({phase:'error',message:viewerMessageFor(401)});return;}
   const response=await fetch('/api/student/media/session',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({attachmentId,idToken}),credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer'});
   if(!response.ok){setState({phase:'error',message:viewerMessageFor(response.status)});return;}
   const body=await response.json() as {kind?:unknown};
   setState({phase:'ready',url:`/api/student/media/${attachmentId}`,kind:body.kind==='IMAGE'?'IMAGE':'PDF'});
  }catch{setState({phase:'error',message:viewerMessageFor(503)});}
 },[liffId]);
 return (
  <main style={{maxWidth:480,margin:'0 auto',padding:'24px 16px',fontFamily:'inherit',lineHeight:1.6}}>
   <Script src={LIFF_SDK} strategy="afterInteractive" onLoad={()=>{void start();}} onError={()=>setState({phase:'error',message:viewerMessageFor(503)})}/>
   <h1 style={{fontSize:20,margin:'0 0 12px'}}>ไฟล์จากเจ้าหน้าที่ มรภ.ยะลา</h1>
   {state.phase==='loading'&&<p role="status">กำลังยืนยันบัญชี LINE ของคุณ…</p>}
   {state.phase==='error'&&<p role="alert">{state.message}</p>}
   {state.phase==='ready'&&(
    <section>
     {state.kind==='IMAGE'&&(
      // Private no-store bytes must not pass through the next/image optimizer cache.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={state.url} alt="รูปภาพจากเจ้าหน้าที่" referrerPolicy="no-referrer" style={{maxWidth:'100%',height:'auto',display:'block',marginBottom:12}}/>
     )}
     <a href={state.url} rel="noreferrer" download style={{display:'inline-block',padding:'10px 16px',borderRadius:8,background:'#06c755',color:'#fff',textDecoration:'none'}}>
      {state.kind==='PDF'?'ดาวน์โหลดไฟล์ PDF':'ดาวน์โหลดรูปภาพ'}
     </a>
     <p style={{fontSize:14,color:'#555'}}>ลิงก์ดาวน์โหลดนี้ใช้ได้ประมาณ 5 นาที ถ้าหมดเวลา ให้แตะลิงก์ในแชต LINE อีกครั้ง</p>
    </section>
   )}
  </main>
 );
}
