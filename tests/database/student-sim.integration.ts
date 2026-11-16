import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {runInboxCycle} from '../../lib/queue/run-inbox';
import {runAICycle,type AISnapshot} from '../../lib/ai/run-worker';
import {encryptValue,decryptValue,hashLineUserId} from '../../lib/security/identity';
import {greetingKind,greetingReply,inputHoldForText,INPUT_QUIET_MS,INPUT_EXTENDED_QUIET_MS} from '../../lib/conversation/input-hold';
import type {SemanticPrompt,RoutingProposal} from '../../lib/conversation/semantic-routing-contracts';

/**
 * STUDENT-SIM-01 (DEC-208): scripts written by a model role-playing ordinary students (Haiku 5.5) are replayed
 * through the real ingress tables, inbox worker, router and AI worker. The routing model and the answer model
 * are deterministic stand-ins, so this checks the conversation plumbing, not answer quality. Results go to
 * D:/codex-cache/yru-student-sim (outside the repository).
 */
interface Step {text?:string;afterMs?:number;waitForBot?:boolean}
interface Scenario {id:string;persona:string;setup?:{oldStaffCase?:{topic:string;idleDays:number}};steps:Step[];expect:string}
const fixture=resolve('tests/fixtures/student-sim/haiku-scenarios.json');
const database=process.env.YRU_OWNED_DATABASE;
assert.match(database??'',/^yru_owned_[a-f0-9]{12}$/u,'tests require the isolated owned database');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:4});
after(()=>pool.end());
const MODEL_LATENCY_MS=6000;

/** Stand-in for the routing model: a similar staff-case topic wins, otherwise continue the latest AI topic. */
function bigrams(text:string){const s=text.replace(/\s+/gu,'');const out=new Set<string>();for(let i=0;i+1<s.length;i++)out.add(s.slice(i,i+2));return out;}
async function fakeRouter(input:SemanticPrompt):Promise<RoutingProposal>{
 const q=bigrams(input.question);
 const human=input.contexts.find(c=>c.mode==='HUMAN'&&[...bigrams(`${c.topic??''}${c.summary??''}${c.previousUserMessages.join('')}`)].filter(b=>q.has(b)).length>=5);
 if(human)return {decision:'CONTINUE',candidateCode:human.code,confidence:.95};
 const ai=input.contexts.filter(c=>c.mode==='AI').at(-1);
 return ai?{decision:'CONTINUE',candidateCode:ai.code,confidence:.9}:{decision:'NEW',candidateCode:null,confidence:.95};
}

interface Outcome {id:string;modelQuestions:string[];fixed:string[];topicLists:number;staleAsks:number;receipts:number;staffNotices:number;
 pending:string[];stuck:string[];silent:string[];buttons:string[];greetingAskedTopic:boolean;filedIntoStaleCase:string[];replies:string[]}

async function runScenario(s:Scenario,index:number):Promise<Outcome>{
 const key=randomBytes(32).toString('base64'),userId=`U${randomUUID().replaceAll('-','')}`,userHash=hashLineUserId(userId,key);
 const session=(await pool.query('insert into public.line_sessions(anonymous_code) values($1) returning id',[`SIM_${s.id}_${randomUUID()}`])).rows[0].id as string;
 await pool.query('insert into private.line_identities(line_session_id,user_hash,user_id_encrypted) values($1,$2,$3)',[session,userHash,encryptValue(userId,key)]);
 const base=Date.now()-6*3_600_000+index*120_000;
 let staleTicket:string|null=null;
 if(s.setup?.oldStaffCase){
  const {topic,idleDays}=s.setup.oldStaffCase;
  const department=(await pool.query("select id from public.departments where code='IT'")).rows[0].id as string;
  const conv=(await pool.query(`insert into public.conversations(line_session_id,conversation_type,mode,status,topic,created_at) values($1,'TICKET','HUMAN','ACTIVE',$2,$3) returning id`,
   [session,topic.slice(0,200),new Date(base-idleDays*86_400_000)])).rows[0].id as string;
  const t=(await pool.query(`insert into public.tickets(line_session_id,conversation_id,department_id,problem_summary,mode,status) values($1,$2,$3,$4,'HUMAN','STAFF_HANDLING') returning id`,
   [session,conv,department,topic.slice(0,500)])).rows[0];
  staleTicket=t.id as string;
  await pool.query('update public.conversations set active_ticket_id=$2 where id=$1',[conv,t.id]);
  await pool.query(`insert into public.messages(conversation_id,ticket_id,sender_type,message_type,content,created_at) values($1,$2,'USER','TEXT',$3,$4)`,[conv,t.id,topic,new Date(base-idleDays*86_400_000)]);
 }
 const modelQuestions:string[]=[];
 const produce=async(snapshot:AISnapshot)=>{modelQuestions.push(snapshot.question);return {kind:'CLARIFY' as const,text:`คำตอบทดสอบ ${modelQuestions.length}`};};
 async function deliver(at:number){
  for(let guard=0;guard<10;guard++){const r=await runAICycle(pool,key,{produce});assert.equal(r.failed,0,`${s.id}: AI worker failed`);if(!r.claimed)break;}
  await pool.query(`update private.message_outbox set status='SENT',completed_at=$2,lease_token=null,lease_until=null where line_session_id=$1 and status='PENDING'`,[session,new Date(base+at)]);
  await pool.query(`update public.messages m set created_at=$2 from public.conversations c where c.id=m.conversation_id and c.line_session_id=$1 and m.sender_type<>'USER' and m.created_at>$2`,[session,new Date(base+at)]);
 }
 let now=0,last:{at:number;hold:'NORMAL'|'EXTENDED'}|null=null;
 for(const step of s.steps){
  if(step.waitForBot){if(last){now=Math.max(now,last.at+(last.hold==='EXTENDED'?INPUT_EXTENDED_QUIET_MS:INPUT_QUIET_MS)+MODEL_LATENCY_MS);await deliver(now);last=null;}continue;}
  if(typeof step.text!=='string'||!step.text.length)continue;
  const at=now+Math.max(0,step.afterMs??0);
  // A slow model would already have answered if the Student waited longer than the window plus generation time.
  if(last&&at>last.at+(last.hold==='EXTENDED'?INPUT_EXTENDED_QUIET_MS:INPUT_QUIET_MS)+MODEL_LATENCY_MS){
   await deliver(last.at+(last.hold==='EXTENDED'?INPUT_EXTENDED_QUIET_MS:INPUT_QUIET_MS)+MODEL_LATENCY_MS);
  }
  now=at;const hold=inputHoldForText(step.text);
  const event={type:'message',replyToken:randomBytes(16).toString('hex'),source:{type:'user',userId},timestamp:base+at,message:{type:'text',id:randomUUID(),text:step.text}};
  await pool.query(`insert into private.webhook_inbox(channel,event_id,user_hash,payload_encrypted,event_kind,received_at,input_hold) values('STUDENT',$1,$2,$3,'MESSAGE',$4,$5)`,
   [randomUUID(),userHash,encryptValue(JSON.stringify(event),key),new Date(base+at),hold]);
  const r=await runInboxCycle(pool,key,{aiEnabled:true,classify:fakeRouter});
  assert.equal(r.failed,0,`${s.id}: inbox failed`);
  last={at,hold};
 }
 if(last)await deliver(last.at+(last.hold==='EXTENDED'?INPUT_EXTENDED_QUIET_MS:INPUT_QUIET_MS)+MODEL_LATENCY_MS);
 else await deliver(now+1000);
 const outbox=(await pool.query(`select kind,channel,payload_encrypted from private.message_outbox where (line_session_id=$1 or ticket_id=$2) order by created_at,id`,[session,staleTicket])).rows;
 const payloads=outbox.filter(o=>o.channel==='STUDENT').map(o=>JSON.parse(decryptValue(o.payload_encrypted,key)).messages as {text:string;quickReply?:{items:{action:{label:string}}[]}}[]);
 const texts=payloads.map(messages=>messages.map(m=>m.text).join(' | '));
 const buttons=payloads.flatMap(messages=>messages.flatMap(m=>m.quickReply?.items.map(i=>i.action.label)??[]));
 const users=(await pool.query(`select m.content,m.metadata->>'routing_status' rs,m.ticket_id from public.messages m join public.conversations c on c.id=m.conversation_id
  where c.line_session_id=$1 and m.sender_type='USER' and m.created_at>=$2 order by m.created_at,m.id`,[session,new Date(base-1000)])).rows;
 const fixedTexts=[greetingReply('GREETING').text,greetingReply('THANKS').text];
 const fixed=texts.filter(t=>fixedTexts.includes(t));
 const covered=new Set(modelQuestions.flatMap(q=>q.split('\n')));
 const greetingsAnswered=fixed.length>0;
 const pending=users.filter(u=>u.rs==='PENDING').map(u=>u.content as string);
 const lastUser=users.at(-1)?.content as string|undefined;
 const stuck=users.filter(u=>u.rs==='PENDING'&&u.content!==lastUser).map(u=>u.content as string);
 const silent=users.filter(u=>u.rs==='ROUTED'&&!u.ticket_id&&!covered.has(u.content)&&!(greetingsAnswered&&greetingKind(u.content)))
  .map(u=>u.content as string);
 const greetingTexts=s.steps.filter(st=>st.text&&greetingKind(st.text)).length;
 const topicLists=texts.filter(t=>t.includes('ข้อความนี้เป็นเรื่องใด')).length;
 return {id:s.id,modelQuestions,fixed,topicLists,staleAsks:texts.filter(t=>t.includes('ที่ส่งถึงเจ้าหน้าที่ไว้ก่อนหน้านี้')).length,
  receipts:texts.filter(t=>t.includes('บันทึกข้อความเข้าเคส')).length,staffNotices:outbox.filter(o=>o.channel==='STAFF').length,pending,stuck,silent,buttons,
  greetingAskedTopic:greetingTexts>0&&topicLists>0&&s.steps.filter(st=>st.text).every(st=>greetingKind(st.text!)),
  filedIntoStaleCase:staleTicket?users.filter(u=>u.ticket_id===staleTicket).map(u=>u.content as string):[],replies:texts};
}

test('STUDENT-SIM-01: model-written student chats through the real inbox, router and AI worker',{skip:!existsSync(fixture)},async()=>{
 const scenarios=JSON.parse(readFileSync(fixture,'utf8')) as Scenario[];
 assert(Array.isArray(scenarios)&&scenarios.length>0);
 const outcomes:Outcome[]=[];
 for(const [i,s] of scenarios.entries())outcomes.push(await runScenario(s,i));
 const problems=outcomes.flatMap(o=>[
  ...(o.greetingAskedTopic?[`${o.id}: greeting got the topic list`]:[]),
  ...o.filedIntoStaleCase.map(t=>`${o.id}: filed into the idle staff case without asking: ${t}`),
  ...o.silent.map(t=>`${o.id}: no reply covers: ${t}`),
  ...(o.topicLists?[`${o.id}: topic list shown ${o.topicLists}x`]:[]),
  ...(o.staleAsks?[`${o.id}: asked about the idle staff case ${o.staleAsks}x`]:[]),
  // NATURAL-ROUTE-01 (DEC-209): typing must always be enough; these buttons only exist to make the Student choose a route.
  ...[...new Set(o.buttons.filter(label=>/^(เริ่มเรื่องใหม่|ถามเป็นเรื่องใหม่|ต่อ |เรื่องก่อนหน้า|เรื่องอื่น)/u.test(label)))].map(label=>`${o.id}: route button offered: ${label}`),
  ...o.pending.map(t=>`${o.id}: still waiting for a choice: ${t}`),
  ...o.stuck.map(t=>`${o.id}: left waiting while the Student kept typing: ${t}`),
 ]);
 const summary={scenarios:outcomes.length,buttonLabels:[...new Set(outcomes.flatMap(o=>o.buttons))],modelCalls:outcomes.reduce((n,o)=>n+o.modelQuestions.length,0),fixedReplies:outcomes.reduce((n,o)=>n+o.fixed.length,0),
  topicLists:outcomes.reduce((n,o)=>n+o.topicLists,0),staleAsks:outcomes.reduce((n,o)=>n+o.staleAsks,0),receipts:outcomes.reduce((n,o)=>n+o.receipts,0),
  staffNotices:outcomes.reduce((n,o)=>n+o.staffNotices,0),pendingMessages:outcomes.reduce((n,o)=>n+o.pending.length,0),problems:problems.length};
 const out='D:/codex-cache/yru-student-sim';mkdirSync(out,{recursive:true});
 writeFileSync(`${out}/result.json`,JSON.stringify({summary,problems,outcomes},null,1));
 console.log(JSON.stringify({stage:'student_sim',...summary}));
 for(const p of problems)console.log('PROBLEM',p);
 assert.deepEqual(problems,[],'no required button, nothing silent, nothing left waiting');
});
