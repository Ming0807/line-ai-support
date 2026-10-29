import {randomBytes,createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '../database/pool';
import {lockConversation,type DbClient} from '../tickets/authorization';
import {staffChatAccessLock} from '../staff/line-case-context';
import {enqueueOutbound} from '../queue/outbox';
import type {LineMessage} from '../line/delivery';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {staffAlertCatalogLock,staffAlertScopeSql,staffAlertIncidentReadable,staffAlertProof,
 type StaffAlertCase,type StaffAlertSource,type StaffAlertDelivery} from './staff-alert-delivery';

export async function staffAlertsInstalled(c:DbClient){
 return (await c.query("select to_regclass('private.staff_alert_events') is not null ready")).rows[0]?.ready===true;
}
/** The caller already owns the source transaction; capture never acquires an incident catalog. */
export async function captureStaffAlert(c:DbClient,ticket:{id:string;revision:number}):Promise<boolean>{
 if(!await staffAlertsInstalled(c))return false;
 await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[staffChatAccessLock]);
 const reference=(await c.query('select conversation_id from public.tickets where id=$1',[ticket.id])).rows[0];
 if(!reference)return true;await lockConversation(c,reference.conversation_id);
 await c.query(`with stamp as materialized(select clock_timestamp() now)
  insert into private.staff_alert_events(source_kind,ticket_id,source_revision,assignment_epoch,staff_id,binding_hash,captured_at,due_at)
  select 'NEW_CASE',t.id,t.revision,t.staff_line_epoch,s.id,i.user_hash,stamp.now,
   stamp.now+make_interval(secs=>case when t.priority='CRITICAL' then 0 else r.alert_debounce_seconds end)
  from public.tickets t join public.conversations v on v.id=t.conversation_id
  cross join public.staff_profiles s join private.staff_line_identities i on i.staff_id=s.id and i.active
  cross join private.incident_rules r cross join stamp
  where r.id=1 and t.id=$1 and t.revision=$2 and t.mode='HUMAN' and t.status='WAITING_STAFF' and t.assigned_staff_id is null
   and v.mode='HUMAN' and v.active_ticket_id=t.id and v.status in('ACTIVE','WAITING')
   and ${staffAlertScopeSql('t.department_id','t.sensitive_level')}
  order by s.id on conflict do nothing`,[ticket.id,ticket.revision]);return true;
}
interface Event extends StaffAlertSource {staff_id:string;current_incident_id:string|null}
interface Ticket {
 id:string;conversation_id:string;ticket_no:string;revision:string;assignment_epoch:string;priority:string;sensitive_level:string;
 mode:string;status:string;assigned_staff_id:string|null;conversation_mode:string;conversation_status:string;active_ticket_id:string|null;allowed:boolean;incident_member:boolean;
}
function live(ticket:Ticket|undefined){return Boolean(ticket&&ticket.allowed&&ticket.mode==='HUMAN'&&ticket.conversation_mode==='HUMAN'
 &&ticket.active_ticket_id===ticket.id&&['ACTIVE','WAITING'].includes(ticket.conversation_status)
 &&['WAITING_STAFF','STAFF_HANDLING','WAITING_USER'].includes(ticket.status));}
function newCase(ticket:Ticket|undefined,event:Event){return Boolean(live(ticket)&&ticket!.status==='WAITING_STAFF'
 &&ticket!.assigned_staff_id===null&&ticket!.assignment_epoch===String(event.assignment_epoch));}
function canonicalBase(value:string|undefined){
 try{if(!value||value.length>1000)throw Error();const u=new URL(value);
  if(!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error();return u.origin;
 }catch{throw new Error('STAFF_ALERT_BASE_REQUIRED');}
}
async function captureCriticalIncidents(c:PoolClient){
 const hiddenScope=staffAlertScopeSql('t.department_id','t.sensitive_level').replaceAll('s.','hs.');
 await c.query(`with stamp as materialized(select clock_timestamp() now),candidates as materialized(
  select i.id incident_id,i.critical_alert_epoch,anchor.id ticket_id,anchor.staff_line_epoch,s.id staff_id,b.user_hash
  from public.incidents i cross join public.staff_profiles s join private.staff_line_identities b on b.staff_id=s.id and b.active
  cross join lateral(select t.id,t.staff_line_epoch from public.incident_tickets m join public.tickets t on t.id=m.ticket_id
   join public.conversations v on v.id=t.conversation_id where m.incident_id=i.id and t.mode='HUMAN' and v.mode='HUMAN'
   and t.status in('WAITING_STAFF','STAFF_HANDLING','WAITING_USER') and v.status in('ACTIVE','WAITING') and v.active_ticket_id=t.id
   order by t.id limit 1) anchor
  where i.severity='CRITICAL' and i.status in('DETECTED','INVESTIGATING','MONITORING')
   and ${staffAlertScopeSql('i.department_id','i.sensitive_level')}
   and not exists(select 1 from public.incident_tickets m join public.tickets t on t.id=m.ticket_id where m.incident_id=i.id
    and not exists(select 1 from public.staff_profiles hs where hs.id=s.id and ${hiddenScope}))
   and not exists(select 1 from private.staff_alert_events e where e.source_kind='CRITICAL_INCIDENT' and e.incident_id=i.id and e.staff_id=s.id and e.source_revision=i.critical_alert_epoch)
  order by i.id,s.id limit 100)
  insert into private.staff_alert_events(source_kind,ticket_id,incident_id,source_revision,assignment_epoch,staff_id,binding_hash,captured_at,due_at)
  select 'CRITICAL_INCIDENT',ticket_id,incident_id,critical_alert_epoch,staff_line_epoch,staff_id,user_hash,stamp.now,stamp.now from candidates cross join stamp
  on conflict do nothing`);
}
/** Atomic bounded scheduler. A source deadline never creates a delayed FIFO outbox. No external I/O. */
export async function flushStaffAlerts(pool:Pool,key:string,options:{appBaseUrl?:string}={}):Promise<{released:number;suppressed:number}>{
 const result={released:0,suppressed:0};if(!await staffAlertsInstalled(pool))return result;
 return transaction(async c=>{
  await c.query("set local statement_timeout='8s';set local lock_timeout='2s'");
  if(!(await c.query("select pg_try_advisory_xact_lock(hashtextextended('staff-alert-scheduler:v1',0)) acquired")).rows[0].acquired)return result;
  await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[staffChatAccessLock]);
  await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[staffAlertCatalogLock]);
  await captureCriticalIncidents(c);
  const first=(await c.query(`select e.*,coalesce(e.incident_id,m.incident_id) current_incident_id from private.staff_alert_events e
   join public.tickets t on t.id=e.ticket_id left join public.incident_tickets m on m.ticket_id=t.id
   left join public.incidents i on i.id=coalesce(e.incident_id,m.incident_id)
   where e.status='PENDING' and (e.due_at<=clock_timestamp() or t.priority='CRITICAL' or i.severity='CRITICAL')
   order by case when e.source_kind='CRITICAL_INCIDENT' or t.priority='CRITICAL' or i.severity='CRITICAL' then 1 else 0 end desc,e.due_at,e.id limit 1`)).rows[0] as Event|undefined;
  if(!first)return result;
  const incident=first.current_incident_id?await staffAlertIncidentReadable(c,first.staff_id,first.current_incident_id):null;
  const group=incident&&(incident.sensitive_level==='GENERAL'||first.source_kind==='CRITICAL_INCIDENT');
  const events=(await c.query(`select e.*,coalesce(e.incident_id,m.incident_id) current_incident_id from private.staff_alert_events e
   left join public.incident_tickets m on m.ticket_id=e.ticket_id
   where e.status='PENDING' and e.staff_id=$1 and e.binding_hash=$2
    and (e.id=$3 or ($4::boolean and coalesce(e.incident_id,m.incident_id)=$5)) order by e.id limit 501`,
  [first.staff_id,first.binding_hash,first.id,Boolean(group),first.current_incident_id])).rows as Event[];
  const refs=(await c.query(`select id,conversation_id from public.tickets t where id=any($1::uuid[]) or exists(
   select 1 from public.incident_tickets m where m.incident_id=$2 and m.ticket_id=t.id) order by id limit 1001`,
  [events.map(v=>v.ticket_id),group?first.current_incident_id:null])).rows;
  if(refs.length>1000)throw new Error('STAFF_ALERT_REFERENCE_BOUND');
  await c.query(`with ordered as materialized(select distinct unnest($1::uuid[]) id order by id)
   select pg_advisory_xact_lock(hashtextextended('conversation:'||id::text,0)) from ordered`,[refs.map(v=>v.conversation_id)]);
  const tickets=(await c.query(`select t.id,t.conversation_id,t.ticket_no,t.revision::text,t.staff_line_epoch::text assignment_epoch,t.priority,t.sensitive_level,
   t.mode,t.status,t.assigned_staff_id,v.mode conversation_mode,v.status conversation_status,v.active_ticket_id,
   exists(select 1 from public.staff_profiles s where s.id=$2 and ${staffAlertScopeSql('t.department_id','t.sensitive_level')}) allowed,
   exists(select 1 from public.incident_tickets m where m.incident_id=$3 and m.ticket_id=t.id) incident_member
   from public.tickets t join public.conversations v on v.id=t.conversation_id where t.id=any($1::uuid[]) order by t.id for share of t`,[refs.map(v=>v.id),first.staff_id,first.current_incident_id])).rows as Ticket[];
  const currentIncident=first.current_incident_id?await staffAlertIncidentReadable(c,first.staff_id,first.current_incident_id):null;
  const identity=(await c.query('select staff_id from private.staff_line_identities where staff_id=$1 and active and user_hash=$2',[first.staff_id,first.binding_hash])).rowCount===1;
  // Lane precedes source/outbox row locks, matching the sender and binding operations.
  await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`delivery:STAFF:${first.staff_id}`]);
  const locked=new Set((await c.query("select id from private.staff_alert_events where id=any($1::uuid[]) and status='PENDING' order by id for update",[events.map(v=>v.id)])).rows.map(v=>v.id));
  const eligible:Event[]=[],denied:string[]=[];
  for(const event of events){if(!locked.has(event.id))continue;
   const allowed=identity&&(event.source_kind==='CRITICAL_INCIDENT'?currentIncident?.severity==='CRITICAL'
    &&currentIncident.critical_alert_epoch===String(event.source_revision)&&tickets.some(t=>t.incident_member&&live(t)):newCase(tickets.find(t=>t.id===event.ticket_id),event));
   if(allowed)eligible.push(event);else denied.push(event.id);
  }
  if(denied.length){await c.query("update private.staff_alert_events set status='SUPPRESSED',suppression_code='ALERT_CONTEXT_CHANGED',completed_at=clock_timestamp() where id=any($1::uuid[]) and status='PENDING'",[denied]);result.suppressed=denied.length;}
  if(!eligible.length)return result;
  const critical=eligible.some(e=>e.source_kind==='CRITICAL_INCIDENT');
  let selected=[...new Set(eligible.filter(e=>e.source_kind==='NEW_CASE').map(e=>e.ticket_id))].map(id=>tickets.find(t=>t.id===id)!);
  if(!selected.length&&critical){const anchor=tickets.find(t=>t.incident_member&&live(t));if(!anchor)throw new Error('STAFF_ALERT_ANCHOR_REQUIRED');selected=[anchor];}
  if(selected.length>500)throw new Error('STAFF_ALERT_CASE_BOUND');
  const grouped=Boolean(currentIncident&&(critical||selected.length>=2));
  const kind=grouped?'DIGEST':'ALERT',newCount=new Set(eligible.filter(e=>e.source_kind==='NEW_CASE').map(e=>e.ticket_id)).size;
  const base=canonicalBase(options.appBaseUrl??process.env.APP_BASE_URL);
  // Individual alerts can retain a private current incident for urgency proof; their text has no incident link.
  const purpose=critical?'CRITICAL_INCIDENT':'NEW_CASES',incidentId=grouped||currentIncident?.severity==='CRITICAL'?first.current_incident_id:null;
  const urgent=critical||currentIncident?.severity==='CRITICAL'||selected.some(t=>t.priority==='CRITICAL');
  let messages:LineMessage[];
  if(grouped){messages=[{type:'text',text:(critical?'มีเหตุการณ์เร่งด่วนที่ต้องตรวจสอบ':'มีเคสใหม่ที่เกี่ยวข้องกับปัญหาเดียวกัน')
   +(newCount?`\n${newCount} เคสใหม่รอเจ้าหน้าที่ตรวจสอบ`:'')+`\nเปิดเหตุการณ์และเลือกเคสใน Dashboard: ${base}/incidents/${incidentId}\nการแจ้งเตือนนี้ยังไม่ถือว่ารับเคส กรุณาเลือกเคสและสนทนาใน Dashboard`,
   quickReply:{items:[{type:'action',action:{type:'uri',label:'เปิดเหตุการณ์',uri:`${base}/incidents/${incidentId}`}}]}}];
  }else{
   const t=selected[0],token=randomBytes(32).toString('base64url');
   await c.query("insert into private.staff_action_tokens(token_hash,staff_id,ticket_id,action,expected_revision,expires_at) values($1,$2,$3,'ACCEPT',$4,clock_timestamp()+interval '30 minutes')",[hashOpaqueToken(token,key,'staff-command'),first.staff_id,t.id,Number(t.revision)]);
   messages=[{type:'text',text:t.sensitive_level==='GENERAL'?`มีงานใหม่ ${t.ticket_no} · ความสำคัญ ${t.priority}\nเปิดห้องแชตใน Dashboard เพื่อดูรายละเอียด`:'มีงานที่ต้องตรวจสอบ กรุณาเข้าสู่แดชบอร์ดตามสิทธิ์ของคุณ',
    quickReply:{items:[{type:'action',action:{type:'postback',label:'รับงาน',data:`yru:staff:accept:${token}`}},
     {type:'action',action:{type:'uri',label:'เปิดห้องแชต',uri:`${base}/inbox?ticket=${t.id}`}}]}}];
  }
  const sourceIds=eligible.map(e=>e.id).sort(),idempotencyKey='staff-alert:'+createHash('sha256').update(JSON.stringify(sourceIds)).digest('hex');
  const outboxId=await enqueueOutbound(c,{idempotencyKey,channel:'STAFF',kind,recipientStaffId:first.staff_id,ticketId:selected[0].id,messages,alertPriority:urgent?1:0},key);
  if(!outboxId)throw new Error('STAFF_ALERT_ENQUEUE_REQUIRED');
  const cases:StaffAlertCase[]=selected.map(t=>({ticket_id:t.id,conversation_id:t.conversation_id,ticket_revision:String(t.revision),assignment_epoch:String(t.assignment_epoch)}));
  const sources:StaffAlertSource[]=eligible.map(e=>({id:e.id,source_kind:e.source_kind,ticket_id:e.ticket_id,incident_id:e.incident_id,
   source_revision:String(e.source_revision),assignment_epoch:String(e.assignment_epoch),binding_hash:e.binding_hash}));
  const proof:Omit<StaffAlertDelivery,'proof_digest'>={outbox_id:outboxId,staff_id:first.staff_id,binding_hash:first.binding_hash,incident_id:incidentId,kind,purpose,
   case_count:cases.length,new_case_count:newCount,alert_priority:urgent?1:0,cases,sources};
  await c.query(`insert into private.staff_alert_deliveries(outbox_id,staff_id,binding_hash,incident_id,kind,purpose,case_count,new_case_count,alert_priority,proof_digest)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[outboxId,first.staff_id,first.binding_hash,incidentId,kind,purpose,cases.length,newCount,proof.alert_priority,staffAlertProof(proof,messages,key)]);
  await c.query(`insert into private.staff_alert_delivery_cases(outbox_id,ticket_id,conversation_id,ticket_revision,assignment_epoch)
   select $1,ticket_id,conversation_id,ticket_revision,assignment_epoch from jsonb_to_recordset($2::jsonb)
    as v(ticket_id uuid,conversation_id uuid,ticket_revision bigint,assignment_epoch bigint)`,[outboxId,JSON.stringify(cases)]);
  await c.query("update private.staff_alert_events set status='QUEUED',outbox_id=$2,completed_at=clock_timestamp() where id=any($1::uuid[]) and status='PENDING'",[sourceIds,outboxId]);
  result.released=1;return result;
 },pool);
}
