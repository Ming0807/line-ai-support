import 'dotenv/config';
import {setTimeout as delay} from 'node:timers/promises';
import {getDatabasePool} from '../lib/database/pool';
import {createLocalE5EmbeddingProvider} from '../lib/knowledge/embedding-client';
import {runIncidentCycle} from '../lib/incidents/worker';
import {createWorkerObserver} from '../lib/operations/worker-observations';
const pool=getDatabasePool(),embedding=createLocalE5EmbeddingProvider();let running=true;
const observe=createWorkerObserver(pool,'INCIDENT');
process.once('SIGINT',()=>{running=false;});process.once('SIGTERM',()=>{running=false;});
try{do{
 await observe();
 const result=await runIncidentCycle(pool,{embed:text=>embedding.embedPassages([text],{timeoutMs:15_000}).then(v=>v[0])});
 if(process.argv.includes('--once')){if(result.failed)process.exitCode=1;break;}
 if(!result.claimed||result.failed)await delay(1000);
}while(running);}finally{await pool.end();}
