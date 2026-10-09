import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import {transaction} from '../database/pool';
import {decryptValue} from '../security/identity';
import {supportStateEnvelopeSchema,supportFactLabels} from '../ai/support-state';
import {supportFactSchema} from '../ai/support-contracts';
import {loadActor,authorizeScope,TicketError} from './authorization';
const copySchema=z.strictObject({version:z.literal(1),ticketId:z.uuid(),departmentId:z.uuid(),sensitiveLevel:z.enum(['GENERAL','SENSITIVE','RESTRICTED']),support:supportStateEnvelopeSchema});
export interface TicketSupportView {status:'READY'|'NONE'|'UNAVAILABLE';facts:{label:string;value:string}[]}
/** Only the freshly authorized Staff server read may decrypt immutable collected context. */
export async function getTicketSupportContext(staffId:string,ticketId:string,options:{pool?:Pool;key?:string}={}):Promise<TicketSupportView>{
 if(!z.uuid().safeParse(ticketId).success)throw new TicketError('NOT_FOUND');
 return transaction(async client=>{
  await client.query("set local statement_timeout='5000ms';set local lock_timeout='2000ms'");await loadActor(client,staffId);
  const ticket=(await client.query('select * from public.tickets where id=$1 for share',[ticketId])).rows[0];if(!ticket)throw new TicketError('NOT_FOUND');
  await authorizeScope(client,ticket.department_id,ticket.sensitive_level);
  const row=(await client.query('select * from private.ticket_support_contexts where ticket_id=$1',[ticketId])).rows[0];
  if(!row)return {status:'NONE',facts:[]};
  let copy:z.infer<typeof copySchema>;
  try{
   const key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new Error('CONTEXT_UNAVAILABLE');
   const raw=JSON.parse(decryptValue(row.context_encrypted,key));copy=copySchema.parse(raw);
   if(copy.ticketId!==ticketId||copy.departmentId!==ticket.department_id||row.conversation_id!==ticket.conversation_id||row.line_session_id!==ticket.line_session_id||
    copy.support.context.conversationId!==ticket.conversation_id||copy.support.context.sessionId!==ticket.line_session_id||copy.support.sourceDigest!==row.source_digest||
    createHash('sha256').update(JSON.stringify(raw.support)).digest('hex')!==row.state_digest||copy.sensitiveLevel!==copy.support.interpreted.sensitiveLevel)throw new Error('CONTEXT_UNAVAILABLE');
  }catch{return {status:'UNAVAILABLE',facts:[]};}
  await authorizeScope(client,copy.departmentId,copy.sensitiveLevel);
  const facts=supportFactSchema.array().max(8).safeParse(copy.support.interpreted.collectedContext);
  if(!facts.success)return {status:'UNAVAILABLE',facts:[]};
  return {status:'READY',facts:facts.data.map(fact=>({label:supportFactLabels[fact.field],value:fact.quote}))};
 },options.pool);
}
