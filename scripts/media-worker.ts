import 'dotenv/config';
import {setTimeout as delay} from 'node:timers/promises';
import {getDatabasePool} from '../lib/database/pool';
import {createWorkerObserver} from '../lib/operations/worker-observations';
import {runChatMediaCycle} from '../lib/chat/media-worker';
import {flushInboxInvalidations} from '../lib/chat/realtime';
import {reconcileStaffOutboundUploads} from '../lib/chat/staff-outbound-recovery';

const key=process.env.ENCRYPTION_KEY;
if(!key||!process.env.DATABASE_URL)throw new Error('MEDIA_WORKER_NOT_CONFIGURED');
const pool=getDatabasePool(),observe=createWorkerObserver(pool,'MEDIA');let running=true,nextReconcile=0;
process.once('SIGINT',()=>{running=false;});process.once('SIGTERM',()=>{running=false;});
try{do{
 await observe();
 // CHAT-MEDIA-02D: retire crashed Staff uploads once a minute; status only, objects stay private.
 if(Date.now()>=nextReconcile){
  nextReconcile=Date.now()+60_000;
  // A recovery failure (e.g. migration 54 not yet applied) must not stop inbound media processing.
  try{
   const recovered=await reconcileStaffOutboundUploads(pool);
   if(recovered.interrupted.length||recovered.attemptLimit.length)
    console.log(JSON.stringify({event:'staff_outbound_reconciled',interrupted:recovered.interrupted.length,attemptLimit:recovered.attemptLimit.length}));
  }catch{console.error(JSON.stringify({event:'staff_outbound_reconcile_failed'}));}
 }
 const result=await runChatMediaCycle(pool,key);
 // Only an invalidation hint; Storage/Realtime failures cannot roll back a message.
 await flushInboxInvalidations(pool);
 if(process.argv.includes('--once')){if(result.failed)process.exitCode=1;break;}
 if(!result.claimed||result.failed)await delay(1000);
}while(running);}finally{await pool.end();}
