import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { getDatabasePool } from '../lib/database/pool';
import { runInboxCycle } from '../lib/queue/run-inbox';
import {createSemanticRoutingClassifier} from '../lib/conversation/semantic-routing-provider';
import {generate} from '../lib/ai/gateway';
import {createAIStore} from '../lib/ai/store';
import {createProviderRegistry} from '../lib/ai/provider-registry';
import {createPriceReader} from '../lib/ai/pricing';

const key=process.env.ENCRYPTION_KEY;
if(!key || !process.env.DATABASE_URL) throw new Error('WORKER_NOT_CONFIGURED');
const pool=getDatabasePool();
const aiEnabled=process.env.YRU_AI_ENABLED==='true',store=createAIStore(pool),adapters=createProviderRegistry(),priceReader=createPriceReader();
const classify=aiEnabled?createSemanticRoutingClassifier(input=>generate(input,{store,key,adapters,priceReader})):undefined;
let stopped=false;
process.on('SIGINT',()=>{stopped=true;});
process.on('SIGTERM',()=>{stopped=true;});

try {
 while(!stopped) {
  const result=await runInboxCycle(pool,key,{aiEnabled,classify});
  if(process.argv.includes('--once')) {if(result.failed) process.exitCode=1;break;}
  if(!result.claimed || result.failed) await delay(1000);
 }
} finally {await pool.end();}
