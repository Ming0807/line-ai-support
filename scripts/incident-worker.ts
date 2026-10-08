import 'dotenv/config';
import {setTimeout as delay} from 'node:timers/promises';
import {getDatabasePool} from '../lib/database/pool';
import {createLocalE5EmbeddingProvider} from '../lib/knowledge/embedding-client';
import {runIncidentCycle} from '../lib/incidents/worker';
const pool=getDatabasePool(),embedding=createLocalE5EmbeddingProvider();let running=true;
process.once('SIGINT',()=>{running=false;});process.once('SIGTERM',()=>{running=false;});
try{do{
 const result=await runIncidentCycle(pool,{embed:text=>embedding.embedPassages([text],{timeoutMs:15_000}).then(v=>v[0])});
 if(process.argv.includes('--once')){if(result.failed)process.exitCode=1;break;}
 if(!result.claimed||result.failed)await delay(1000);
}while(running);}finally{await pool.end();}
