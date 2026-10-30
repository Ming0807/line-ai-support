import 'dotenv/config';
import {setTimeout as delay} from 'node:timers/promises';
import {getDatabasePool} from '../lib/database/pool';
import {createWorkerObserver} from '../lib/operations/worker-observations';
import {runChatMediaCycle} from '../lib/chat/media-worker';
import {flushInboxInvalidations} from '../lib/chat/realtime';

const key=process.env.ENCRYPTION_KEY;
if(!key||!process.env.DATABASE_URL)throw new Error('MEDIA_WORKER_NOT_CONFIGURED');
const pool=getDatabasePool(),observe=createWorkerObserver(pool,'MEDIA');let running=true;
process.once('SIGINT',()=>{running=false;});process.once('SIGTERM',()=>{running=false;});
try{do{
 await observe();
 const result=await runChatMediaCycle(pool,key);
 // Only an invalidation hint; Storage/Realtime failures cannot roll back a message.
 await flushInboxInvalidations(pool);
 if(process.argv.includes('--once')){if(result.failed)process.exitCode=1;break;}
 if(!result.claimed||result.failed)await delay(1000);
}while(running);}finally{await pool.end();}
