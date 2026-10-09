import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {canonicalDigest,copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {supportFactSchema,supportProposalSchema} from '../ai/support-contracts';
import {supportStateEnvelopeSchema} from '../ai/support-state';
import {decryptValue} from '../security/identity';
import {incidentContextClaimsSchema} from './context-contracts';

const uuid=z.uuid().transform(value=>value.toLowerCase());
const digestSchema=z.string().regex(/^[a-f0-9]{64}$/u);
const ticketSchema=z.strictObject({id:uuid,conversationId:uuid,sessionId:uuid,departmentId:uuid});
const copySchema=z.strictObject({ticket_id:uuid,conversation_id:uuid,line_session_id:uuid,source_digest:digestSchema,state_digest:digestSchema,
 context_encrypted:z.string().min(1).max(100_000)});
const envelopeSchema=z.strictObject({version:z.literal(1),ticketId:uuid,departmentId:uuid,sensitiveLevel:z.enum(['GENERAL','SENSITIVE','RESTRICTED']),support:supportStateEnvelopeSchema});
const unavailable=()=>freezeStructuredData({status:'UNAVAILABLE' as const});
export type DecodedIncidentSupportSource=
 | {status:'NO_COPY';claims:{system:null;location:null};bindingDigest:null}
 | {status:'READY';claims:{system:string|null;location:string|null};sourceDigest:string;stateDigest:string;bindingDigest:string}
 | {status:'UNAVAILABLE'};

/** Decodes the immutable ticket copy without consulting current support state or AI history. */
export function decodeIncidentSupportSource(ticketInput:unknown,copyInput:unknown,key?:string):DecodedIncidentSupportSource{
 try{
  const ticket=ticketSchema.parse(copyStructuredJson(ticketInput,2048,16));
  if(copyInput===null)return freezeStructuredData({status:'NO_COPY',claims:{system:null,location:null},bindingDigest:null});
  const rawCopy=copyStructuredJson(copyInput,300*1024,32),copied=copySchema.parse(rawCopy);
  if(copied.ticket_id!==ticket.id||copied.conversation_id!==ticket.conversationId||copied.line_session_id!==ticket.sessionId||typeof key!=='string'||key.length===0)return unavailable();
  const plaintext=decryptValue(copied.context_encrypted,key);
  if(Buffer.byteLength(plaintext,'utf8')>256*1024)return unavailable();
  const raw:unknown=JSON.parse(plaintext);
  if(raw===null||typeof raw!=='object'||Array.isArray(raw))return unavailable();
  const rawRecord=raw as Record<string,unknown>;
  if(!Object.hasOwn(rawRecord,'support'))return unavailable();
  const rawSupport=rawRecord.support;
  if(createHash('sha256').update(JSON.stringify(rawSupport),'utf8').digest('hex')!==copied.state_digest)return unavailable();
  const envelope=envelopeSchema.parse(raw);
  if(envelope.ticketId!==ticket.id||envelope.departmentId!==ticket.departmentId||envelope.support.context.conversationId!==ticket.conversationId||
   envelope.support.context.sessionId!==ticket.sessionId||envelope.support.sourceDigest!==copied.source_digest||
   envelope.sensitiveLevel!==envelope.support.interpreted.sensitiveLevel)return unavailable();
  const proposal=supportProposalSchema.parse(envelope.support.proposal);
  const interpreted=envelope.support.interpreted;
  const collected=supportFactSchema.array().max(8).parse(interpreted.collectedContext);
  if(!isDeepStrictEqual(collected,proposal.facts)||new Set(collected.map(fact=>fact.field)).size!==collected.length)return unavailable();
  let system:string|null=null,location:string|null=null;
  for(const fact of collected){
   if(fact.field==='SYSTEM')system=fact.quote;
   if(fact.field==='LOCATION')location=fact.quote;
  }
  const claims=incidentContextClaimsSchema.parse({system,location});
  return freezeStructuredData({status:'READY',claims,sourceDigest:copied.source_digest,stateDigest:copied.state_digest,
   bindingDigest:canonicalDigest('incident-support-copy-v1',rawCopy)});
 }catch{return unavailable();}
}
