import 'dotenv/config';
import {createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {z} from 'zod';
import {databaseConnection} from '../../lib/database/connection';

/** Candidate counts only: this does not establish that a source is absent. */
export interface GapRow{conversationId:string;answeredAt:string;question:string|null}
export interface GapReportItem{topicId:string;categoryHint:'NETWORK'|'REGISTRATION'|'TUITION'|'LIBRARY'|'SCHOLARSHIP'|'FORM'|'OTHER'|'MULTIPLE';count:number;lastSeen:string}
interface GapClient{query(text:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]} >;release():void}
interface GapPool{connect():Promise<GapClient>}
const NO_DOCUMENT_PREFIX='ยังไม่พบเอกสารทางการ';
// Private analytics hints only, never conversation routing or source authority.
function categoryHint(question:string):GapReportItem['categoryHint']{
 const rules:[GapReportItem['categoryHint'],RegExp][]=[['NETWORK',/wi[ -]?fi|เครือข่าย|อินเทอร์เน็ต/iu],['REGISTRATION',/ลงทะเบียน|สมัครเรียน/u],
  ['TUITION',/ค่าเทอม|ค่าเล่าเรียน|ค่าธรรมเนียม/u],['LIBRARY',/ห้องสมุด|ยืมหนังสือ/u],['SCHOLARSHIP',/ทุนการศึกษา|ขอทุน/u],['FORM',/แบบฟอร์ม|ยื่นคำร้อง/u]];
 const matched=rules.filter(([,rule])=>rule.test(question));
 return matched.length===1?matched[0][0]:matched.length>1?'MULTIPLE':'OTHER';
}
const optionsSchema=z.strictObject({actorId:z.uuid(),hashKey:z.string().min(32).max(4096),
 from:z.date().optional(),to:z.date().optional(),limit:z.number().int().min(1).max(5000).default(1000)});
export type GapOptions=z.input<typeof optionsSchema>;
export function normalizeQuestion(question:string):string{
 if(question.length>20000)throw new Error('GAP_INPUT_TOO_LARGE');
 return question.normalize('NFKC').replace(/\s+/gu,' ').trim();
}
export function aggregateGaps(rows:GapRow[],hashKey:string):GapReportItem[]{
 if(hashKey.length<32||hashKey.length>4096||rows.length>5001)throw new Error('GAP_INPUT_INVALID');
 const buckets=new Map<string,GapReportItem>();
 for(const row of rows){
  if(!row.question)continue;
  const question=normalizeQuestion(row.question);if(!question)continue;
  // Keyed and domain-separated: raw text, identities and dictionary-attackable
  // plain hashes never leave this private aggregation boundary.
  const topicId=createHmac('sha256',hashKey).update('yru-knowledge-gap-v1\0').update(question).digest('hex');
  const existing=buckets.get(topicId);
  if(existing){existing.count++;if(row.answeredAt>existing.lastSeen)existing.lastSeen=row.answeredAt;}
  else buckets.set(topicId,{topicId,categoryHint:categoryHint(question),count:1,lastSeen:row.answeredAt});
 }
 return [...buckets.values()].sort((a,b)=>b.count-a.count||a.topicId.localeCompare(b.topicId));
}
/** SUPER_ADMIN-only global maintenance report. No raw questions are returned. */
export async function mineKnowledgeGaps(pool:GapPool,input:GapOptions){
 const parsed=optionsSchema.safeParse(input);if(!parsed.success)throw new Error('GAP_INPUT_INVALID');
 const to=parsed.data.to??new Date(),from=parsed.data.from??new Date(to.getTime()-30*86400000);
 if(!Number.isFinite(to.getTime())||!Number.isFinite(from.getTime())||to<=from||to.getTime()-from.getTime()>31*86400000)throw new Error('GAP_INPUT_INVALID');
 const {actorId,hashKey,limit}=parsed.data,client=await pool.connect();
 try{
  await client.query('begin read only');
  await client.query("set local statement_timeout='5s'");
  const actor=await client.query("select id from public.staff_profiles where id=$1 and active and role='SUPER_ADMIN'",[actorId]);
  if(actor.rows.length!==1)throw new Error('GAP_REPORT_FORBIDDEN');
  const result=await client.query(`select m.created_at as answered_at,u.content as question
   from public.messages m
   join private.ai_jobs j on j.id=case when m.metadata->>'ai_job_id' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
    then (m.metadata->>'ai_job_id')::uuid else null end and j.conversation_id=m.conversation_id
   join public.messages u on u.id=j.message_id and u.conversation_id=j.conversation_id and u.sender_type='USER' and u.message_type='TEXT'
   where m.sender_type='AI' and m.message_type='TEXT' and m.created_at >= $2 and m.created_at < $3 and m.content like $4
    and exists(select 1 from public.staff_profiles s where s.id=$1 and s.active and s.role='SUPER_ADMIN')
    and exists(select 1 from private.message_outbox o where o.conversation_id=m.conversation_id
     and o.idempotency_key='ai-job:'||j.id::text and o.kind='AI' and o.status='SENT' and o.completed_at is not null)
   order by m.created_at desc,m.id desc limit $5`,[actorId,from,to,`%${NO_DOCUMENT_PREFIX}%`,limit+1]);
  const rows=result.rows.slice(0,limit).map(row=>({conversationId:'',question:z.string().nullable().parse(row.question),
   answeredAt:z.coerce.date().parse(row.answered_at).toISOString()}));
  const report={scope:'SUPER_ADMIN_AGGREGATE_ONLY' as const,basis:'DELIVERED_NO_DOCUMENT_TEXT_CANDIDATES' as const,
   from:from.toISOString(),to:to.toISOString(),sampledAnswers:rows.length,truncated:result.rows.length>limit,
   items:aggregateGaps(rows,hashKey)};
  await client.query('rollback');return report;
 }catch(error){try{await client.query('rollback');}catch{/* Connection owner releases below. */}throw error;}
 finally{client.release();}
}
async function main(){
 const match=process.argv.slice(2);const actorArg=match.find(arg=>arg.startsWith('--staff-id='));
 if(match.length!==1||!actorArg||!z.uuid().safeParse(actorArg.slice(11)).success){console.error('GAP_REPORT_STAFF_ID_REQUIRED');process.exitCode=1;return;}
 const connection=process.env.DIRECT_URL??process.env.DATABASE_URL,hashKey=process.env.ENCRYPTION_KEY;
 if(!connection||!hashKey){console.error('GAP_REPORT_CONFIGURATION_REQUIRED');process.exitCode=1;return;}
 const pool=new Pool({...databaseConnection(connection),max:1,connectionTimeoutMillis:10000});
 try{console.log(JSON.stringify({generatedAt:new Date().toISOString(),...await mineKnowledgeGaps(pool,{actorId:actorArg.slice(11),hashKey})},null,1));}
 catch(error){console.error(error instanceof Error&&error.message==='GAP_REPORT_FORBIDDEN'?'GAP_REPORT_FORBIDDEN':'GAP_REPORT_FAILED');process.exitCode=1;}
 finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
