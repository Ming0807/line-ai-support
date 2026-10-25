import type {DbClient} from '../tickets/authorization';
import {eligibleScopeSql} from '../tickets/authorization';
import {hashOpaqueToken} from '../conversation/quick-reply';

export const staffAlertCatalogLock='incident-catalog:v1';
export function staffAlertScopeSql(department:string,sensitivity:string){
 return eligibleScopeSql.replaceAll('$1',department).replaceAll('$2',sensitivity);
}
export interface StaffAlertCase {ticket_id:string;conversation_id:string;ticket_revision:string;assignment_epoch:string}
export interface StaffAlertSource {id:string;source_kind:string;ticket_id:string;incident_id:string|null;source_revision:string;assignment_epoch:string;binding_hash:string}
export interface StaffAlertDelivery {
 outbox_id:string;staff_id:string;binding_hash:string;incident_id:string|null;kind:'ALERT'|'DIGEST';purpose:'NEW_CASES'|'CRITICAL_INCIDENT';
 case_count:number;new_case_count:number;alert_priority:0|1;proof_digest:string;cases:StaffAlertCase[];sources:StaffAlertSource[];
}
export function staffAlertProof(header:Omit<StaffAlertDelivery,'proof_digest'>,messages:unknown,key:string){
 return hashOpaqueToken(JSON.stringify({...header,cases:[...header.cases].sort((a,b)=>a.ticket_id.localeCompare(b.ticket_id)),
  sources:[...header.sources].sort((a,b)=>a.id.localeCompare(b.id)),messages}),key,'staff-alert-delivery-v1');
}
export async function loadStaffAlertDelivery(c:DbClient,outboxId:string):Promise<StaffAlertDelivery|null>{
 const h=(await c.query('select outbox_id,staff_id,binding_hash,incident_id,kind,purpose,case_count,new_case_count,alert_priority,proof_digest from private.staff_alert_deliveries where outbox_id=$1',[outboxId])).rows[0];
 if(!h)return null;
 const cases=(await c.query('select ticket_id,conversation_id,ticket_revision::text,assignment_epoch::text from private.staff_alert_delivery_cases where outbox_id=$1 order by ticket_id limit 501',[outboxId])).rows;
 const sources=(await c.query("select id,source_kind,ticket_id,incident_id,source_revision::text,assignment_epoch::text,binding_hash from private.staff_alert_events where outbox_id=$1 and status='QUEUED' order by id limit 1001",[outboxId])).rows;
 return {...h,cases,sources};
}
/** Catalog must already be locked before reading mutable incident membership. */
export async function staffAlertReferences(c:DbClient,h:StaffAlertDelivery){
 const rows=(await c.query(`select id,conversation_id from public.tickets t where id=any($1::uuid[]) or exists(
  select 1 from public.incident_tickets m where m.incident_id=$2 and m.ticket_id=t.id) order by id limit 1001`,[h.cases.map(v=>v.ticket_id),h.incident_id])).rows;
 if(rows.length>1000)throw new Error('STAFF_ALERT_REFERENCE_BOUND');return rows;
}
export async function staffAlertIncidentReadable(c:DbClient,staffId:string,incidentId:string){
 return (await c.query(`select i.id,i.status,i.severity,i.sensitive_level,i.critical_alert_epoch::text from public.incidents i where i.id=$2
  and i.status in('DETECTED','INVESTIGATING','MONITORING')
  and exists(select 1 from public.staff_profiles s where s.id=$1 and ${staffAlertScopeSql('i.department_id','i.sensitive_level')})
  and not exists(select 1 from public.incident_tickets m join public.tickets t on t.id=m.ticket_id where m.incident_id=i.id
   and not exists(select 1 from public.staff_profiles s where s.id=$1 and ${staffAlertScopeSql('t.department_id','t.sensitive_level')}))`,[staffId,incidentId])).rows[0]??null;
}
/** Required for both new kinds, under shared access/catalog + every conversation/delivery session lock. */
export async function verifyStaffAlertDelivery(c:DbClient,h:StaffAlertDelivery|null,
 job:{id:string;channel:string;kind:string;recipient_staff_id:string|null;ticket_id:string|null;delivery_mode:string;alert_priority?:number},payload:{messages:unknown;replyToken?:string},key:string){
 if(!h||job.id!==h.outbox_id||job.channel!=='STAFF'||job.kind!==h.kind||job.recipient_staff_id!==h.staff_id||job.delivery_mode!=='PUSH'
  ||payload.replyToken!==undefined||job.alert_priority!==h.alert_priority||h.cases.length!==h.case_count||h.cases.length<1||h.cases.length>500
  ||!h.sources.length||h.sources.length>1000||!h.cases.some(v=>v.ticket_id===job.ticket_id))return false;
 const {proof_digest,...proof}=h;
 if(staffAlertProof(proof,payload.messages,key)!==proof_digest)return false;
 if(!(await c.query(`select i.staff_id from private.staff_line_identities i join public.staff_profiles s on s.id=i.staff_id
  where i.staff_id=$1 and i.active and s.active and i.user_hash=$2`,[h.staff_id,h.binding_hash])).rowCount)return false;
 const newCases=new Set(h.sources.filter(s=>s.source_kind==='NEW_CASE').map(s=>s.ticket_id));
 if((h.purpose==='CRITICAL_INCIDENT'&&!h.sources.some(s=>s.source_kind==='CRITICAL_INCIDENT'&&s.incident_id===h.incident_id))
  ||newCases.size!==h.new_case_count||h.sources.some(s=>s.binding_hash!==h.binding_hash
  ||(s.source_kind==='NEW_CASE'&&!h.cases.some(v=>v.ticket_id===s.ticket_id))
  ||(s.source_kind==='CRITICAL_INCIDENT'&&(h.purpose!=='CRITICAL_INCIDENT'||s.incident_id!==h.incident_id))))return false;
 if(h.incident_id){
  const incident=await staffAlertIncidentReadable(c,h.staff_id,h.incident_id);
  if(!incident||(h.purpose==='CRITICAL_INCIDENT'&&(incident.severity!=='CRITICAL'
   ||h.sources.some(s=>s.source_kind==='CRITICAL_INCIDENT'&&s.source_revision!==incident.critical_alert_epoch)))
   ||(h.kind==='DIGEST'&&h.purpose==='NEW_CASES'&&incident.sensitive_level!=='GENERAL'))return false;
  const ids=(await c.query('select ticket_id from public.incident_tickets where incident_id=$1 and ticket_id=any($2::uuid[])',[h.incident_id,h.cases.map(v=>v.ticket_id)])).rows;
  if(ids.length!==h.case_count)return false;
 }else if(h.kind==='DIGEST'||h.purpose==='CRITICAL_INCIDENT')return false;
 // Keyed priority proves the locked enqueue-time urgency. Claim permits bypass only while urgency is current.
 // A severity-only downgrade does not invalidate ordinary NEW_CASES copy; all case/scope guards still apply.
 const count=(await c.query(`select count(*)::int n from jsonb_to_recordset($1::jsonb)
   as f(ticket_id uuid,conversation_id uuid,ticket_revision bigint,assignment_epoch bigint,is_new boolean)
   join public.tickets t on t.id=f.ticket_id join public.conversations v on v.id=t.conversation_id
   where t.conversation_id=f.conversation_id and t.revision=f.ticket_revision and t.staff_line_epoch=f.assignment_epoch
   and t.mode='HUMAN' and v.mode='HUMAN' and v.active_ticket_id=t.id and v.status in('ACTIVE','WAITING')
   and t.status in('WAITING_STAFF','STAFF_HANDLING','WAITING_USER')
   and (not f.is_new or (t.status='WAITING_STAFF' and t.assigned_staff_id is null))
   and exists(select 1 from public.staff_profiles s where s.id=$2 and ${staffAlertScopeSql('t.department_id','t.sensitive_level')})`,
 [JSON.stringify(h.cases.map(v=>({...v,is_new:newCases.has(v.ticket_id)}))),h.staff_id])).rows[0].n;
 return count===h.case_count;
}
