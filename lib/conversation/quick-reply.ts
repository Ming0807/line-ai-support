import {createHmac,randomBytes} from 'node:crypto';
import type {DbClient} from '../tickets/authorization';
import type {OutboundText} from '../queue/outbox';

export function hashOpaqueToken(token:string,key:string,purpose='route-choice'):string {
 return createHmac('sha256',Buffer.from(key,'base64')).update(`${purpose}:${token}`).digest('hex');
}
export interface CandidateSnapshot {id:string;revision:number;ticketId:string|null;ticketRevision:number|null}
export async function createChoices(client:DbClient,input:{sessionId:string;snapshot:CandidateSnapshot[];pendingMessageId?:string;choices:{label:string;value:Record<string,string>}[]},key:string):Promise<NonNullable<OutboundText['quickReply']>> {
 const items:NonNullable<OutboundText['quickReply']>['items']=[];
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
 const row=(await client.query('select * from private.pending_route_choices where token_hash=$1 and expires_at>clock_timestamp() for update',[hashOpaqueToken(token,key)])).rows[0];
 if(!row||row.line_session_id!==sessionId||row.consumed_at)return null;
 // Compare exact server-loaded candidates/revisions in canonical order. No caller-selected IDs are trusted.
 const canonical=(values:CandidateSnapshot[])=>JSON.stringify([...values].sort((a,b)=>a.id.localeCompare(b.id)));
 if(canonical(row.candidate_snapshot)!==canonical(snapshot))return null;
 const updated=await client.query('update private.pending_route_choices set consumed_at=clock_timestamp() where token_hash=$1 and consumed_at is null and expires_at>clock_timestamp() returning token_hash',[row.token_hash]);
 if(updated.rowCount!==1)return null;
 // Alternatives for this prompt are invalidated together to prevent two choices applying the same pending message.
 if(row.pending_message_id)await client.query('update private.pending_route_choices set consumed_at=clock_timestamp() where pending_message_id=$1 and consumed_at is null',[row.pending_message_id]);
 return {choice:row.choice,pendingMessageId:row.pending_message_id};
}
