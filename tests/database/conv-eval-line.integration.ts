import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {transaction} from '../../lib/database/pool';
import {prepareAIJob} from '../../lib/ai/jobs';
import {runAICycle,type AISnapshot} from '../../lib/ai/run-worker';
import {encryptValue,decryptValue,hashLineUserId} from '../../lib/security/identity';
import {greetingReply,inputHoldForText} from '../../lib/conversation/input-hold';
import {LINE_EVAL_CASES,type LineEvalCase} from '../fixtures/conv-eval-line';

// CONV-EVAL-LINE-01 (DEC-206): the real window trigger, carry-over and worker with a fake model provider.
const database=process.env.YRU_OWNED_DATABASE;
assert.match(database??'',/^yru_owned_[a-f0-9]{12}$/u,'tests require the isolated owned database');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:4});
after(()=>pool.end());

interface CaseResult {calls:string[];fixed:('GREETING'|'THANKS')[]}
async function runCase(c:LineEvalCase,index:number):Promise<CaseResult>{
 const key=randomBytes(32).toString('base64'),lineUser='U'+randomUUID().replaceAll('-',''),userHash=hashLineUserId(lineUser,key);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`EVAL_${c.id}_${randomUUID()}`])).rows[0].id as string;
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,userHash,encryptValue(lineUser,key)]);
 const conversation=(await pool.query('insert into public.conversations(line_session_id) values($1) returning id',[session])).rows[0].id as string;
 // Every case lives in the past so each window is already due when the worker runs.
 const base=Date.now()-7_200_000+index*90_000;
 const calls:string[]=[];
 const produce=async(snapshot:AISnapshot)=>{calls.push(snapshot.question);return {kind:'CLARIFY' as const,text:`คำตอบทดสอบ ${calls.length}`};};
 async function drain(deliverAt:number){
  for(let guard=0;guard<10;guard++){
   const stats=await runAICycle(pool,key,{produce});
   assert.equal(stats.failed,0,`${c.id}: worker failure`);
   if(!stats.claimed)break;
  }
  // The reply reached LINE at this simulated time.
  await pool.query(`update private.message_outbox set status='SENT',completed_at=$2,lease_token=null,lease_until=null
   where conversation_id=$1 and status='PENDING'`,[conversation,new Date(base+deliverAt)]);
  await pool.query(`update public.messages set created_at=$2 where conversation_id=$1 and sender_type='AI' and created_at>$2`,[conversation,new Date(base+deliverAt)]);
 }
 let last=0;
 for(const step of c.steps){
  if('deliver' in step){await drain(step.deliver);last=step.deliver;continue;}
  const source=(await pool.query(`insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,status,received_at,completed_at,input_hold)
   values('STUDENT',$1,$2,$3,'MESSAGE','DONE',$4,clock_timestamp(),$5) returning id`,
   [randomUUID(),userHash,encryptValue('{}',key),new Date(base+step.at),inputHoldForText(step.text)])).rows[0].id as string;
  const message=(await pool.query(`insert into public.messages(conversation_id,sender_type,message_type,content,source_event_id,metadata,created_at)
   values($1,'USER','TEXT',$2,$3,$4,$5) returning id`,[conversation,step.text,source,{routing_status:'ROUTED',routing_route:'AI_EXISTING'},new Date(base+step.at)])).rows[0].id as string;
  await transaction(client=>prepareAIJob(client,{sessionId:session,conversationId:conversation,messageId:message,receivedAt:new Date()},key),pool);
  last=step.at;
 }
 await drain(last+60_000);
 const sent=(await pool.query(`select payload_encrypted from private.message_outbox where conversation_id=$1 and status='SENT' order by completed_at,created_at`,[conversation])).rows
  .map(row=>JSON.parse(decryptValue(row.payload_encrypted,key)).messages[0].text as string);
 const fixed=sent.flatMap(text=>text===greetingReply('GREETING').text?['GREETING' as const]:text===greetingReply('THANKS').text?['THANKS' as const]:[]);
 return {calls,fixed};
}

test('CONV-EVAL-LINE-01: LINE-realistic typing cases reach the model as the expected questions',async()=>{
 assert(LINE_EVAL_CASES.length>=40,'about forty cases');
 assert.equal(new Set(LINE_EVAL_CASES.map(c=>c.id)).size,LINE_EVAL_CASES.length);
 const failures:string[]=[],byCategory=new Map<string,{pass:number;total:number}>();
 let modelCalls=0,fixedReplies=0;
 for(const [index,c] of LINE_EVAL_CASES.entries()){
  const result=await runCase(c,index);
  modelCalls+=result.calls.length;fixedReplies+=result.fixed.length;
  const ok=JSON.stringify(result.calls)===JSON.stringify(c.calls)&&JSON.stringify(result.fixed)===JSON.stringify(c.fixed??[]);
  const bucket=byCategory.get(c.category)??{pass:0,total:0};bucket.total++;if(ok)bucket.pass++;byCategory.set(c.category,bucket);
  if(!ok)failures.push(`${c.id}: calls=${JSON.stringify(result.calls)} fixed=${JSON.stringify(result.fixed)}`);
 }
 console.log(JSON.stringify({stage:'conv_eval_line',cases:LINE_EVAL_CASES.length,modelCalls,fixedReplies,
  categories:Object.fromEntries(byCategory),failures:failures.length}));
 assert.deepEqual(failures,[]);
});
