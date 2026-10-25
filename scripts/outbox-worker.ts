import 'dotenv/config';
import {createDatabasePool} from '../lib/database/pool';
import {runOutboxCycle} from '../lib/queue/run-outbox';
import {createWorkerObserver} from '../lib/operations/worker-observations';
import {flushStaffAlerts} from '../lib/incidents/staff-alerts';

const connection=process.env.DIRECT_URL,key=process.env.ENCRYPTION_KEY;
if(!connection||!key)throw new Error('OUTBOX_WORKER_NOT_CONFIGURED');
const target=new URL(connection);
if(target.port==='6543'||target.searchParams.get('pgbouncer')==='true')throw new Error('SESSION_MODE_CONNECTION_REQUIRED');
const pool=createDatabasePool(connection,{max:2});
const observe=createWorkerObserver(pool,'OUTBOX');
let running=true;process.once('SIGINT',()=>{running=false;});process.once('SIGTERM',()=>{running=false;});
try{do{
 await observe();
 let alertFailed=false;
 try{await flushStaffAlerts(pool,key);}catch{alertFailed=true;console.error('STAFF_ALERT_FLUSH_FAILED');}
 const result=await runOutboxCycle(pool,key);
 if(process.argv.includes('--once')){if(result.failed||alertFailed)process.exitCode=1;break;}
 if(!result.claimed)await new Promise(resolve=>setTimeout(resolve,1000));
}while(running);}finally{await pool.end();}
