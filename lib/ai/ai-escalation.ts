import type {PoolClient} from 'pg';
import {createEscalation} from '../tickets/create-ticket';
import {TicketError} from '../tickets/authorization';
import {routedInputEventSql} from './input-watermark';
import type {SupportActionState} from './support-state';

/**
 * NATURAL-ESCALATE-01 (DEC-209). When the AI cannot help (the Student asks for a person, troubleshooting failed, or a
 * personal record is needed), the backend opens the staff case itself instead of offering confirmation buttons.
 * The trigger is the Student's own LINE message for this turn, verified as a STUDENT event of the same identity;
 * the case goes through the existing createEscalation (department, sensitivity, single open case, HUMAN takeover,
 * Student notice and scoped Staff alert). The model never supplies the ticket, recipient or confirmation.
 */
const departmentAliases:Record<string,string[]>={IT:['ไอที','it','คอม','อินเทอร์เน็ต','wifi','ไวไฟ'],REGISTRAR:['ทะเบียน'],FINANCE:['การเงิน'],
 STUDENT_AFFAIRS:['กิจการนักศึกษา','กิจการ'],LIBRARY:['ห้องสมุด'],DORMITORY:['หอพัก','หอ'],ACADEMIC_AFFAIRS:['วิชาการ'],FACILITY:['อาคาร','สถานที่']};

type Department={code:string;name_th:string};
async function activeDepartments(client:PoolClient):Promise<Department[]>{
 return (await client.query("select code,name_th from public.departments where active and code<>'ADMIN' order by code")).rows;
}

/** A department the Student typed by name, only when exactly one matches. Never a topic router. */
export function typedDepartment(text:string,departments:Department[]):string|null{
 const value=text.normalize('NFKC').toLowerCase().replace(/\s+/gu,'');
 const hits=departments.filter(d=>[d.name_th,d.code,...(departmentAliases[d.code]??[])].some(name=>{
  const n=name.normalize('NFKC').toLowerCase().replace(/\s+/gu,'');return n.length>=2&&value.includes(n);}));
 return hits.length===1?hits[0].code:null;
}

export function departmentQuestion(departments:Department[]):string{
 return `เรื่องนี้ต้องให้เจ้าหน้าที่ช่วยต่อครับ ช่วยพิมพ์บอกหน่อยว่าเกี่ยวกับงานไหน เช่น ${departments.map(d=>d.name_th).join(' / ')}`;
}

export type AIEscalationResult={status:'ESCALATED';ticketId:string;ticketNo:string}|{status:'ASK_DEPARTMENT';text:string}|{status:'NOT_ALLOWED'};

export async function escalateFromAI(client:PoolClient,input:{sessionId:string;conversationId:string;messageId:string;question:string;state:SupportActionState},key:string):Promise<AIEscalationResult>{
 const advice=input.state.interpreted;
 if(!advice.needsTicket)return {status:'NOT_ALLOWED'};
 const trigger=(await client.query(`select e.id from public.messages m join private.webhook_inbox e on e.id=${routedInputEventSql('m')}
  join private.line_identities i on i.line_session_id=$2 and i.user_hash=e.user_hash
  where m.id=$1 and m.conversation_id=$3 and m.sender_type='USER' and e.channel='STUDENT' and e.event_kind='MESSAGE'`,
  [input.messageId,input.sessionId,input.conversationId])).rows[0];
 if(!trigger)return {status:'NOT_ALLOWED'};
 const departments=await activeDepartments(client);
 const departmentCode=advice.departmentCode??typedDepartment(input.question,departments);
 if(!departmentCode||!departments.some(d=>d.code===departmentCode))return {status:'ASK_DEPARTMENT',text:departmentQuestion(departments)};
 const lead=advice.intent==='PERSONAL_CASE'?'เรื่องนี้ต้องให้เจ้าหน้าที่ตรวจข้อมูลของคุณครับ':undefined;
 const summary=Array.from((advice.problemText??input.question).trim()||'ติดต่อเจ้าหน้าที่').slice(0,1000).join('');
 let ticket:{id:string;ticket_no:string};
 // A business refusal (an open case already exists, inactive department) leaves the normal reply in place.
 try{ticket=await createEscalation(client,{sessionId:input.sessionId,conversationId:input.conversationId,departmentCode,summary},key,lead?{lead}:{});}
 catch(error){if(error instanceof TicketError)return {status:'NOT_ALLOWED'};throw error;}
 const row=(await client.query('select department_id,sensitive_level from public.tickets where id=$1',[ticket.id])).rows[0];
 await client.query(`insert into private.ai_support_outcomes(conversation_id,line_session_id,last_message_id,confirmation_event_id,state_digest,kind,department_id,sensitive_level,ticket_id)
  values($1,$2,$3,$4,$5,'AI_ESCALATED',$6,$7,$8)`,[input.conversationId,input.sessionId,input.messageId,trigger.id,input.state.stateDigest,row.department_id,row.sensitive_level,ticket.id]);
 return {status:'ESCALATED',ticketId:ticket.id,ticketNo:ticket.ticket_no};
}
