import type {Pool} from 'pg';
import {transaction} from '../database/pool';
import {decryptValue,hashLineUserId} from '../security/identity';
import {enqueueOutbound} from '../queue/outbox';

let warned=false;
/** A degraded collection never gets an AI answer that silently ignores failed input. */
export async function flushDegradedInputNotices(pool:Pool,key:string):Promise<number>{
 let queued=0;
 try{
  const ready=(await pool.query("select to_regclass('private.student_input_windows') is not null ready")).rows?.[0]?.ready;
  if(!ready)return 0;
  await pool.query('select private.seal_student_input_windows()');
  const windows=(await pool.query(`select id,user_hash from private.student_input_windows where degraded
   and notice_state='PENDING' and notice_retry_at<=clock_timestamp() order by sealed_at,id limit 5`)).rows;
  for(const ref of windows){
   const sent=await transaction(async c=>{
    await c.query("set local statement_timeout='5s';set local lock_timeout='2s'");
    await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`processing:STUDENT:${ref.user_hash}`]);
    const row=(await c.query(`select id,user_hash from private.student_input_windows where id=$1 and degraded
     and notice_state='PENDING' and notice_retry_at<=clock_timestamp() for update`,[ref.id])).rows[0];
    if(!row)return false;
    const identity=(await c.query(`select i.line_session_id,i.user_id_encrypted,s.active from private.line_identities i
     join public.line_sessions s on s.id=i.line_session_id where i.user_hash=$1`,[row.user_hash])).rows[0];
    if(!identity||!identity.active){
     await c.query("update private.student_input_windows set notice_state='UNDELIVERABLE',notice_at=clock_timestamp() where id=$1",[row.id]);return false;
    }
    try{
     if(hashLineUserId(decryptValue(identity.user_id_encrypted,key),key)!==row.user_hash)throw new Error('IDENTITY_MISMATCH');
    }catch{
     await c.query("update private.student_input_windows set notice_retry_at=clock_timestamp()+interval '5 minutes' where id=$1",[row.id]);
     console.warn('INPUT_WINDOW_NOTICE_IDENTITY_UNAVAILABLE');return false;
    }
    const outbox=await enqueueOutbound(c,{idempotencyKey:`input-window:${row.id}:failure`,channel:'STUDENT',kind:'SYSTEM',
     lineSessionId:identity.line_session_id,messages:[{type:'text',text:'มีข้อความบางส่วนที่ประมวลผลไม่สำเร็จครับ ระบบเก็บข้อความไว้แล้ว กรุณาส่งรายละเอียดที่ต้องการให้ช่วยอีกครั้ง'}]},key);
    await c.query("update private.student_input_windows set notice_state='QUEUED',notice_outbox_id=$2,notice_at=clock_timestamp() where id=$1",[row.id,outbox]);
    return true;
   },pool);
   if(sent)queued++;
  }
  warned=false;return queued;
 }catch{if(!warned){warned=true;console.warn('INPUT_WINDOW_NOTICE_UNAVAILABLE');}return queued;}
}
