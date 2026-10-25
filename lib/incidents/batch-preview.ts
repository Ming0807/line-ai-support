import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '../database/pool';
import {loadActor,isSupervisor,lockConversation} from '../tickets/authorization';
import {staffChatAccessLock} from '../staff/line-case-context';
import {encryptValue,decryptValue} from '../security/identity';
import {hashOpaqueToken} from '../conversation/quick-reply';
import {IncidentError} from './contracts';
import {incidentVisibleSql} from './reads';
import {incidentCatalogLock} from './worker';
import {incidentReplySelectionSchema,incidentReplyOptionsSchema,incidentReplyPreviewSchema,
 type IncidentReplyOptions,type IncidentReplySelection,type IncidentReplyPreview} from './batch-reply-contracts';
import {prepareIncidentReplyPackets} from './batch-packets';

interface Options {pool?:Pool;key?:string}
interface Member {
 id:string;ticket_no:string;anonymous_code:string;line_session_id:string;conversation_id:string;department_id:string;
 assigned_staff_id:string|null;revision:number;staff_line_epoch:string;status:string;mode:string;sensitive_level:string;
 conversation_mode:string;conversation_status:string;conversation_revision:number;active_ticket_id:string|null;session_active:boolean;
 pending:number;source_digest:string;source_count:number;ordered_source_count:number;order_digest:string;read_through:string;membership_version:string;
}
interface Snapshot {view:IncidentReplyOptions;members:Member[];membershipDigest:string;now:Date;actorId:string}
const uuid=z.uuid().transform(value=>value.toLowerCase());
const receiptSchema=z.strictObject({purpose:z.literal('incident-reply-preview-v1'),actorId:uuid,incidentId:uuid,
 packetVersion:z.literal(1),selection:incidentReplySelectionSchema,snapshotDigest:z.string().regex(/^[a-f0-9]{64}$/),issuedAt:z.iso.datetime(),expiresAt:z.iso.datetime()});
export const incidentReplyReceiptSchema=receiptSchema;
export type IncidentReplyReceipt=z.infer<typeof receiptSchema>;
type Receipt=IncidentReplyReceipt;
function validateIds(actorId:string,incidentId:string){
 const actor=uuid.safeParse(actorId),incident=uuid.safeParse(incidentId);
 if(!actor.success||!incident.success)throw new IncidentError('INVALID_REQUEST');return {actorId:actor.data,incidentId:incident.data};
}
function encryptionKey(options:Options):string{
 const key=options.key??process.env.ENCRYPTION_KEY;
 if(!key)throw new IncidentError('UNAVAILABLE');return key;
}
function active(member:Member){return !['RESOLVED','CLOSED','CANCELLED'].includes(member.status);}
function eligibility(member:Member,actorId:string,supervisor:boolean):IncidentReplyOptions['items'][number]['eligibility']{
 if(!active(member)||!member.session_active||['CLOSED','RESOLVED'].includes(member.conversation_status))return 'INACTIVE_CASE';
 if(member.mode!=='HUMAN'||member.conversation_mode!=='HUMAN'||member.active_ticket_id!==member.id)return 'NOT_HUMAN';
 if(member.sensitive_level!=='GENERAL')return 'PRIVATE_CASE';
 if(!member.assigned_staff_id)return 'UNASSIGNED';
 if(!['STAFF_HANDLING','WAITING_USER'].includes(member.status))return 'INACTIVE_CASE';
 return member.assigned_staff_id===actorId?'OWN_CASE':supervisor?'INTERVENTION_REQUIRED':'OTHER_ASSIGNEE';
}
async function snapshot(c:PoolClient,actorId:string,incidentId:string,key:string,forUpdate=false):Promise<Snapshot>{
 await c.query("set local statement_timeout='8s'");await c.query("set local lock_timeout='2s'");
 await c.query('select pg_advisory_xact_lock_shared(hashtextextended($1,0))',[staffChatAccessLock]);
 await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[incidentCatalogLock]);
 const actor=await loadActor(c,actorId);
 const incident=(await c.query(`select i.id,i.revision,i.status from public.incidents i where i.id=$1 and ${incidentVisibleSql} for share`,[incidentId])).rows[0];
 if(!incident)throw new IncidentError('NOT_FOUND');
 const references=(await c.query(`select t.id,t.conversation_id from public.incident_tickets m join public.tickets t on t.id=m.ticket_id
  where m.incident_id=$1 order by t.id limit 501`,[incidentId])).rows;
 if(references.length>500)throw new IncidentError('UNAVAILABLE');
 // Match all supported writers: catalog -> sorted conversation -> sorted ticket.
 for(const conversation of [...new Set<string>(references.map(row=>row.conversation_id))].sort())await lockConversation(c,conversation);
 await c.query(`select id from public.tickets where id=any($1::uuid[]) order by id for ${forUpdate?'update':'share'}`,[references.map(row=>row.id)]);
 const rows=(await c.query(`select t.id,t.ticket_no,t.line_session_id,t.conversation_id,t.department_id,t.assigned_staff_id,
  t.revision,t.staff_line_epoch::text,t.status,t.mode,t.sensitive_level,l.anonymous_code,l.active session_active,
  v.mode conversation_mode,v.status conversation_status,v.revision conversation_revision,v.active_ticket_id,m.xmin::text membership_version,
  coalesce((select read_through_seq::text from private.staff_chat_read_cursors r where r.staff_id=$2 and r.ticket_id=t.id),'0') read_through,
  (select count(*)::int from private.staff_chat_message_order o join public.messages msg on msg.id=o.message_id and msg.ticket_id=o.ticket_id and msg.sender_type='USER'
   where o.ticket_id=t.id and o.message_seq>coalesce((select read_through_seq from private.staff_chat_read_cursors r where r.staff_id=$2 and r.ticket_id=t.id),0)) pending,
  (select count(*)::int from public.messages msg where msg.ticket_id=t.id and msg.sender_type='USER') source_count,
  (select count(*)::int from private.staff_chat_message_order o join public.messages msg on msg.id=o.message_id and msg.ticket_id=o.ticket_id and msg.conversation_id=t.conversation_id and msg.sender_type='USER'
   where o.ticket_id=t.id) ordered_source_count,
  encode(sha256(convert_to(coalesce((select string_agg(concat_ws(':',o.message_id::text,o.message_seq::text,o.xmin::text),',' order by o.message_seq)
   from private.staff_chat_message_order o join public.messages msg on msg.id=o.message_id and msg.ticket_id=o.ticket_id and msg.conversation_id=t.conversation_id and msg.sender_type='USER'
   where o.ticket_id=t.id),'[]'),'UTF8')),'hex') order_digest,
  encode(sha256(convert_to(coalesce((select jsonb_build_array(msg.id,msg.content,msg.metadata,msg.source_event_id,msg.created_at,msg.xmin::text)::text
   from public.messages msg where msg.ticket_id=t.id and msg.sender_type='USER' order by msg.created_at desc,msg.id desc limit 1),'[]'),'UTF8')),'hex') source_digest
  from public.incident_tickets m join public.tickets t on t.id=m.ticket_id join public.conversations v on v.id=t.conversation_id and v.line_session_id=t.line_session_id
  join public.line_sessions l on l.id=t.line_session_id where m.incident_id=$1 order by t.id`,[incidentId,actorId])).rows as Member[];
 const visible=(await c.query(`select i.id from public.incidents i where i.id=$1 and ${incidentVisibleSql}`,[incidentId])).rowCount;
 if(!visible)throw new IncidentError('NOT_FOUND');
 if(rows.length!==references.length||rows.some(row=>!references.some(ref=>ref.id===row.id&&ref.conversation_id===row.conversation_id)))throw new IncidentError('CONFLICT');
 // A partial ordered snapshot must never appear as a smaller unread workload.
 if(rows.some(row=>row.source_count!==row.ordered_source_count))throw new IncidentError('CONFLICT');
 const supervisor=isSupervisor(actor),live=rows.filter(active);
 const view=incidentReplyOptionsSchema.parse({incidentId,incidentRevision:incident.revision,incidentStatus:incident.status,canIntervene:supervisor,
  workload:{memberCases:rows.length,activeCases:live.length,anonymousSessions:new Set(rows.map(row=>row.line_session_id)).size,
   activeAnonymousSessions:new Set(live.map(row=>row.line_session_id)).size,unassignedCases:live.filter(row=>!row.assigned_staff_id).length,
   assignedStaff:new Set(live.map(row=>row.assigned_staff_id).filter(Boolean)).size,pendingUserMessages:live.reduce((sum,row)=>sum+row.pending,0)},
  items:rows.map(row=>({ticketId:row.id,ticketCode:row.ticket_no,reporterLabel:row.anonymous_code,status:row.status,
   eligibility:eligibility(row,actorId,supervisor),pendingUserMessages:row.pending}))});
 // xmin is private short-lived version evidence: revoke/restore must require review
 // even when the actor's role/grants end up with the same logical values again.
 const authority=(await c.query(`select s.xmin::text profile_version,coalesce((select jsonb_agg(jsonb_build_array(g.department_id,g.xmin::text) order by g.department_id)
  from public.staff_department_grants g where g.staff_id=s.id),'[]') grants from public.staff_profiles s where s.id=$1`,[actorId])).rows[0];
 const membershipDigest=hashOpaqueToken(JSON.stringify({incident,authority,members:rows}),key,'incident-reply-membership-v1');
 const now=(await c.query('select clock_timestamp() now')).rows[0].now as Date;
 return {view,members:rows,membershipDigest,now,actorId};
}
function selected(snapshot:Snapshot,input:IncidentReplySelection){
 if(['RESOLVED','CLOSED'].includes(snapshot.view.incidentStatus))throw new IncidentError('CONFLICT');
 if(input.intervention&&!snapshot.view.canIntervene)throw new IncidentError('FORBIDDEN');
 const ids=[...input.ticketIds].sort(),cases=ids.map(id=>snapshot.view.items.find(item=>item.ticketId===id));
 if(cases.some(item=>!item||!['OWN_CASE',...(input.intervention?['INTERVENTION_REQUIRED']:[])].includes(item.eligibility)))throw new IncidentError('CONFLICT');
 const members=ids.map(id=>snapshot.members.find(member=>member.id===id)!);
 return {cases:cases.map(item=>({ticketId:item!.ticketId,ticketCode:item!.ticketCode,reporterLabel:item!.reporterLabel})),members};
}
function replyPackets(members:Member[],text:string){
 return prepareIncidentReplyPackets(members.map(member=>({ticketId:member.id,ticketCode:member.ticket_no,reporterLabel:member.anonymous_code,sessionId:member.line_session_id})),text);
}
function preparationDigest(snapshot:Snapshot,input:IncidentReplySelection,key:string,deliveries=replyPackets(selected(snapshot,input).members,input.text)){
 return hashOpaqueToken(JSON.stringify({actor:snapshot.actorId,membership:snapshot.membershipDigest,selection:{...input,ticketIds:[...input.ticketIds].sort()},
  packetVersion:1,deliveries}),key,'incident-reply-preview-v1');
}
/** Read-only preparation. Neither a DTO nor an encrypted receipt grants send authority. */
export async function getIncidentReplyOptions(actorId:string,incidentId:string,options:Options={}):Promise<IncidentReplyOptions>{
 const ids=validateIds(actorId,incidentId),key=encryptionKey(options);
 return transaction(async c=>(await snapshot(c,ids.actorId,ids.incidentId,key)).view,options.pool);
}
export async function previewIncidentReply(actorId:string,incidentId:string,raw:unknown,options:Options={}):Promise<IncidentReplyPreview>{
 const ids=validateIds(actorId,incidentId),input=incidentReplySelectionSchema.parse(raw),key=encryptionKey(options);
 return transaction(async c=>{
  const state=await snapshot(c,ids.actorId,ids.incidentId,key),selection=selected(state,input);
  const deliveries=replyPackets(selection.members,input.text);
  const expiresAt=new Date(state.now.getTime()+10*60_000).toISOString();
  const receipt:Receipt={purpose:'incident-reply-preview-v1',packetVersion:1,...ids,selection:input,snapshotDigest:preparationDigest(state,input,key,deliveries),issuedAt:state.now.toISOString(),expiresAt};
  return incidentReplyPreviewSchema.parse({status:'REVIEW_ONLY',incidentId:ids.incidentId,requestId:input.requestId,cases:selection.cases,
   caseCount:selection.cases.length,recipientCount:deliveries.length,commonText:input.text,deliveries,
   intervention:input.intervention,expiresAt,previewReceipt:encryptValue(JSON.stringify(receipt),key)});
 },options.pool);
}
/** Future confirmation must perform this preparation inside its own immutable enqueue transaction.
 * This exported check deliberately performs no send, persistence, authorization handoff or AI call. */
export async function revalidateIncidentReplyPreview(actorId:string,incidentId:string,encryptedReceipt:string,options:Options={}){
 const ids=validateIds(actorId,incidentId),key=encryptionKey(options);
 const receipt=decodeIncidentReplyReceipt(ids.actorId,ids.incidentId,encryptedReceipt,key);
 return transaction(async c=>{
  await verifyIncidentReplyPreview(c,receipt,key);
  return {status:'REVIEW_ONLY' as const,requestId:receipt.selection.requestId,caseCount:receipt.selection.ticketIds.length};
 },options.pool);
}
/** Parsing alone grants no authority. The caller must verify inside its write transaction. */
export function decodeIncidentReplyReceipt(actorId:string,incidentId:string,encryptedReceipt:string,key:string):Receipt{
 const ids=validateIds(actorId,incidentId);let receipt:Receipt;
 try{
  if(typeof encryptedReceipt!=='string'||encryptedReceipt.length>200000)throw new Error('INVALID_RECEIPT');
  receipt=receiptSchema.parse(JSON.parse(decryptValue(encryptedReceipt,key)));
 }catch{throw new IncidentError('CONFLICT');}
 if(receipt.actorId!==ids.actorId||receipt.incidentId!==ids.incidentId)throw new IncidentError('CONFLICT');
 return receipt;
}
/** Client-scoped final verification; confirmation keeps these locks through immutable enqueue. */
export async function verifyIncidentReplyPreview(c:PoolClient,receipt:Receipt,key:string,forUpdate=false){
 const state=await snapshot(c,receipt.actorId,receipt.incidentId,key,forUpdate),selection=selected(state,receipt.selection);
 const issued=Date.parse(receipt.issuedAt),expires=Date.parse(receipt.expiresAt);
 const deliveries=replyPackets(selection.members,receipt.selection.text);
 if(issued>state.now.getTime()||expires<=state.now.getTime()||expires-issued!==600000||preparationDigest(state,receipt.selection,key,deliveries)!==receipt.snapshotDigest)throw new IncidentError('CONFLICT');
 return {...selection,deliveries,selection:receipt.selection};
}

