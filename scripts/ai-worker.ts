import 'dotenv/config';
import {setTimeout as delay} from 'node:timers/promises';
import {getDatabasePool} from '../lib/database/pool';
import {runAICycle} from '../lib/ai/run-worker';
import {createConfiguredKnowledgeProducer} from '../lib/knowledge/configured';
import {createWorkerObserver} from '../lib/operations/worker-observations';

if(process.env.YRU_AI_ENABLED==='true'){
 const key=process.env.ENCRYPTION_KEY;
 if(!key||!process.env.DATABASE_URL)throw new Error('AI_WORKER_NOT_CONFIGURED');
 const pool=getDatabasePool(),produce=createConfiguredKnowledgeProducer(pool,key),observe=createWorkerObserver(pool,'AI');
 let running=true;
 process.once('SIGINT',()=>{running=false;});process.once('SIGTERM',()=>{running=false;});
 try{do{
  await observe();
  const result=await runAICycle(pool,key,{produce,supportEnabled:true,loading:{accessToken:process.env.LINE_STUDENT_CHANNEL_ACCESS_TOKEN}});
  if(process.argv.includes('--once')){if(result.failed)process.exitCode=1;break;}
  if(!result.claimed||result.failed)await delay(1000);
 }while(running);}finally{await pool.end();}
}else console.info('AI_WORKER_DISABLED');
