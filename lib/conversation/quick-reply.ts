import {createHmac,randomBytes} from 'node:crypto';
import type {DbClient} from '../tickets/authorization';
import type {OutboundText} from '../queue/outbox';
import {routeConversation,type RouteCandidate} from './router';

export function hashOpaqueToken(token:string,key:string,purpose='route-choice'):string {
 return createHmac('sha256',Buffer.from(key,'base64')).update(`${purpose}:${token}`).digest('hex');
}
export interface CandidateSnapshot {id:string;revision:number;ticketId:string|null;ticketRevision:number|null}
type TypedRouteChoice={action:'NEW'}|{action:'CONTINUE';conversationId:string};
const canonicalSnapshot=(values:CandidateSnapshot[])=>JSON.stringify([...values].sort((a,b)=>a.id.localeCompare(b.id)));
const orderedSnapshot=(values:CandidateSnapshot[])=>JSON.stringify(values.map(value=>[value.id,value.revision,value.ticketId,value.ticketRevision]));
const numberedRouteCommand=/^ต่อ เรื่อง ([1-9]|1[0-2])$/u;

/** Display numbering is not routing authority; the offered opaque choice still binds its exact owned snapshot. */
export function contextChoiceOptions(candidates:RouteCandidate[]):{label:string;value:Record<string,string>}[]{
 return [{label:'เริ่มเรื่องใหม่',value:{action:'NEW'}},...candidates.slice(0,12).map((candidate,index)=>({
  label:`ต่อ เรื่อง ${index+1}`,value:{action:'CONTINUE',conversationId:candidate.conversationId},
 }))];
}
export function contextChoiceText(text:string,candidates:RouteCandidate[]):string{
 // This is a display preview only. Original USER/history and candidate authority stay complete.
 const subjects=candidates.slice(0,12).map((candidate,index)=>`${index+1}. ${Array.from((candidate.topicLabel??'เรื่องที่กำลังคุย').replace(/\s+/gu,' ').trim()).slice(0,120).join('')}`);
 return subjects.length?`${text}\n${subjects.join('\n')}`:text;
}

/** Reserve only standalone server navigation forms, including stale YRU references; mixed text remains semantic input. */
export function isTypedRouteNavigation(text:string,candidates:RouteCandidate[]):boolean {
 const command=text.trim();return command==='เริ่มเรื่องใหม่'||command==='ต่อ เรื่องที่กำลังคุย'||numberedRouteCommand.test(command)||/^ต่อ YRU-\d{1,20}$/u.test(command)
  ||candidates.some(candidate=>candidate.topicLabel!==null&&command===`ต่อ ${candidate.topicLabel}`);
}
export async function latestPendingRouteSource(client:DbClient,sessionId:string):Promise<{id:string;conversation_id:string}|null>{
 const source=(await client.query(`select m.id,m.conversation_id,m.metadata,m.ticket_id,c.conversation_type from public.messages m
  join public.conversations c on c.id=m.conversation_id join public.line_sessions s on s.id=c.line_session_id and s.active
  where c.line_session_id=$1 and m.sender_type='USER' and m.metadata->>'routing_status' is distinct from 'ROUTE_CONTROL'
  order by m.created_at desc,m.id desc limit 1`,[sessionId])).rows[0];
 return source?.metadata?.routing_status==='PENDING'&&source.ticket_id===null&&source.conversation_type==='SUPPORT'
  ?{id:source.id,conversation_id:source.conversation_id}:null;
}

/** Only exact labels of explicit navigation offered by this server, never general keyword routing. */
export function resolveTypedRouteChoice(text:string,candidates:RouteCandidate[]):TypedRouteChoice|null {
 if(!candidates.length||candidates.length>12)return null;
 const command=text.trim();if(command==='เริ่มเรื่องใหม่')return {action:'NEW'};
 const number=numberedRouteCommand.exec(command)?.[1];
 const matches=command==='ต่อ เรื่องที่กำลังคุย'?candidates.filter(candidate=>candidate.mode==='AI'):
  number===undefined?candidates.filter(candidate=>candidate.topicLabel!==null&&command===`ต่อ ${candidate.topicLabel}`):candidates.slice(Number(number)-1,Number(number));
 if(matches.length!==1)return null;
 const selected=matches[0],route=routeConversation({candidates,selectedConversationId:selected.conversationId});
 return ['AI_EXISTING','HUMAN_TICKET'].includes(route.route)?{action:'CONTINUE',conversationId:selected.conversationId}:null;
}

/** Read-only preflight; final consumption repeats these checks inside the owned inbox transaction. */
export async function readTypedRouteChoice(client:DbClient,sessionId:string,text:string,candidates:RouteCandidate[]):Promise<{tokenHash:string;pendingMessageId:string;choice:TypedRouteChoice}|null> {
 const choice=resolveTypedRouteChoice(text,candidates);if(!choice)return null;
 const source=await latestPendingRouteSource(client,sessionId);if(!source)return null;
 const rows=(await client.query(`select token_hash,choice,candidate_snapshot from private.pending_route_choices
  where line_session_id=$1 and pending_message_id=$2 and consumed_at is null and expires_at>clock_timestamp()`,[sessionId,source.id])).rows;
 const snapshot=canonicalSnapshot(candidateSnapshotFor(candidates));
 const offeredOrder=numberedRouteCommand.test(text.trim())?orderedSnapshot(candidateSnapshotFor(candidates)):null;
 const matching=rows.filter(row=>row.choice?.action===choice.action&&Object.keys(row.choice).length===(choice.action==='NEW'?1:2)
  &&(choice.action==='NEW'||row.choice.conversationId===choice.conversationId)&&canonicalSnapshot(row.candidate_snapshot)===snapshot
  &&(offeredOrder===null||orderedSnapshot(row.candidate_snapshot)===offeredOrder));
 return matching.length===1?{tokenHash:matching[0].token_hash,pendingMessageId:source.id,choice}:null;
}
function candidateSnapshotFor(candidates:RouteCandidate[]):CandidateSnapshot[]{
 return candidates.map(c=>({id:c.conversationId,revision:c.conversationRevision,ticketId:c.ticketId,ticketRevision:c.ticketRevision}));
}
export async function consumeTypedRouteChoice(client:DbClient,sessionId:string,text:string,candidates:RouteCandidate[]):Promise<{choice:Record<string,string>;pendingMessageId:string}|null>{
 const offered=await readTypedRouteChoice(client,sessionId,text,candidates);if(!offered)return null;
 const consumed=await consumeChoiceHash(client,sessionId,offered.tokenHash,candidateSnapshotFor(candidates));
 return consumed?.pendingMessageId===offered.pendingMessageId?{choice:consumed.choice,pendingMessageId:offered.pendingMessageId}:null;
}
export async function createChoices(client:DbClient,input:{sessionId:string;snapshot:CandidateSnapshot[];pendingMessageId?:string;choices:{label:string;value:Record<string,string>}[]},key:string):Promise<NonNullable<OutboundText['quickReply']>> {
 const items:NonNullable<OutboundText['quickReply']>['items']=[];
 // A refreshed context menu supersedes its previous offer for this exact owned source.
 // Leave unrelated prompts and support-action confirmation offers untouched.
 if(input.pendingMessageId&&input.choices.length&&input.choices.every(choice=>['NEW','CONTINUE'].includes(choice.value.action))){
  await client.query(`update private.pending_route_choices set consumed_at=clock_timestamp()
   where line_session_id=$1 and pending_message_id=$2 and consumed_at is null and choice->>'action' in ('NEW','CONTINUE')`,[input.sessionId,input.pendingMessageId]);
 }
 for(const choice of input.choices.slice(0,13)){
  const token=randomBytes(32).toString('base64url');
  await client.query(`insert into private.pending_route_choices(token_hash,line_session_id,choice,candidate_snapshot,pending_message_id,expires_at)
   values($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes')`,[hashOpaqueToken(token,key),input.sessionId,choice.value,JSON.stringify(input.snapshot),input.pendingMessageId??null]);
  items.push({type:'action',action:{type:'postback',label:Array.from(choice.label).slice(0,20).join(''),data:`yru:choice:${token}`,displayText:choice.label}});
 }
 return {items};
}
export async function consumeChoice(client:DbClient,sessionId:string,data:string,snapshot:CandidateSnapshot[],key:string):Promise<{choice:Record<string,string>;pendingMessageId:string|null}|null> {
 const token=/^yru:choice:([A-Za-z0-9_-]{43})$/.exec(data)?.[1];if(!token)return null;
 return consumeChoiceHash(client,sessionId,hashOpaqueToken(token,key),snapshot);
}
export async function consumeChoiceHash(client:DbClient,sessionId:string,tokenHash:string,snapshot:CandidateSnapshot[]):Promise<{choice:Record<string,string>;pendingMessageId:string|null}|null>{
 const row=(await client.query('select * from private.pending_route_choices where token_hash=$1 and expires_at>clock_timestamp() for update',[tokenHash])).rows[0];
 if(!row||row.line_session_id!==sessionId||row.consumed_at)return null;
 // Compare exact server-loaded candidates/revisions in canonical order. No caller-selected IDs are trusted.
 if(canonicalSnapshot(row.candidate_snapshot)!==canonicalSnapshot(snapshot))return null;
 const updated=await client.query('update private.pending_route_choices set consumed_at=clock_timestamp() where token_hash=$1 and consumed_at is null and expires_at>clock_timestamp() returning token_hash',[row.token_hash]);
 if(updated.rowCount!==1)return null;
 // Alternatives for this prompt are invalidated together to prevent two choices applying the same pending message.
 if(row.pending_message_id)await client.query('update private.pending_route_choices set consumed_at=clock_timestamp() where pending_message_id=$1 and consumed_at is null',[row.pending_message_id]);
 return {choice:row.choice,pendingMessageId:row.pending_message_id};
}
