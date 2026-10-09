import {decryptValue,encryptValue} from '../security/identity';
import {canonicalDigest,copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {isValidKnowledgeDate} from '../knowledge/metadata-filter';
import {matchesStructuredPayload,validateStructuredQuery} from '../knowledge/structured-query';
import {validateStructuredEvidenceList} from '../knowledge/structured-citations';
import type {StructuredSearchResult} from '../knowledge/structured-search';
import {incidentContextClaimsSchema,incidentContextDepartmentSchema,incidentContextPlanSchema,incidentContextSlotSchema,type IncidentContextPlan,type IncidentContextSlot,type ResolvedIncidentContext} from './context-contracts';
import {planIncidentContext,resolveIncidentContext} from './context-resolution';
import {z} from 'zod';

const PLAINTEXT_MAX=384*1024,CIPHERTEXT_MAX=524_288;
const uuid=z.uuid(),hex=z.string().regex(/^[a-f0-9]{64}$/u),sensitivity=z.enum(['GENERAL','SENSITIVE','RESTRICTED']);
const ticketSchema=z.strictObject({id:uuid,revision:z.number().int().min(0).max(999_999_999),conversationId:uuid,sessionId:uuid,departmentId:uuid,
 departmentCode:incidentContextDepartmentSchema,sensitiveLevel:sensitivity});
const sourceSchema=z.strictObject({status:z.literal('READY'),claims:incidentContextClaimsSchema,sourceDigest:hex,stateDigest:hex,bindingDigest:hex,retainedSensitivity:sensitivity});
const stampSchema=z.strictObject({epoch:z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/u).refine(value=>BigInt(value)<=BigInt('9223372036854775807')),
 evaluationDate:z.string().refine(isValidKnowledgeDate)});
const slotResultSchema=z.strictObject({slot:incidentContextSlotSchema,result:z.unknown()});
const inputSchema=z.strictObject({ticket:ticketSchema,source:sourceSchema,stamp:stampSchema.nullable(),results:z.array(slotResultSchema).max(3)});
const expectedSchema=z.strictObject({ticket:ticketSchema,source:sourceSchema,stamp:stampSchema.nullable()});
const proofSchema=z.strictObject({kind:z.literal('INCIDENT_CONTEXT'),schemaVersion:z.literal(1),ticket:ticketSchema,source:sourceSchema,plan:incidentContextPlanSchema,
 catalogStamp:stampSchema.nullable(),results:z.array(slotResultSchema).max(3)});
const ranks={GENERAL:0,SENSITIVE:1,RESTRICTED:2} as const;
const proofError=()=>new Error('INCIDENT_CONTEXT_PROOF_INVALID');
type Ticket=z.infer<typeof ticketSchema>;type Source=z.infer<typeof sourceSchema>;type Stamp=z.infer<typeof stampSchema>;
type ProofInput=z.infer<typeof inputSchema>;
type ContextKeys={systemKey:string|null;locationKey:string|null};
export interface SealIncidentContextProofInput {ticket:Ticket;source:Source;stamp:Stamp|null;results:{slot:IncidentContextSlot;result:StructuredSearchResult}[]}
export interface OpenIncidentContextProofExpected {ticket:Ticket;source:Source;stamp:Stamp|null}
export interface SealedIncidentContextProof extends ContextKeys {encrypted:string;requiresCatalog:boolean}

function exactDigest(left:unknown,right:unknown,domain:string):boolean{return canonicalDigest(domain,left)===canonicalDigest(domain,right);}
function validStampFor(plan:IncidentContextPlan,stamp:Stamp|null):boolean{return plan.attempts.length===0?stamp===null:stamp!==null;}
function normalizeResults(plan:IncidentContextPlan,input:unknown,stamp:Stamp|null){
 const copied=copyStructuredJson(input,PLAINTEXT_MAX,20_000),items=slotResultSchema.array().max(3).parse(copied);
 if(items.length!==plan.attempts.length||new Set(items.map(item=>item.slot)).size!==items.length||items.some(item=>!plan.attempts.some(attempt=>attempt.slot===item.slot)))throw proofError();
 const normalized:{slot:IncidentContextSlot;result:StructuredSearchResult}[]=[];
 for(const attempt of plan.attempts){
  const match=items.find(item=>item.slot===attempt.slot);if(!match)throw proofError();
  const value=copyStructuredJson(match.result,PLAINTEXT_MAX,20_000);
  if(value===null||typeof value!=='object'||Array.isArray(value))throw proofError();
  const result=value as Record<string,unknown>;let accepted:StructuredSearchResult;
  if(result.status==='EMPTY'&&Object.keys(result).length===1)accepted={status:'EMPTY'};
  else if(result.status==='CLARIFICATION_REQUIRED'&&Object.keys(result).length===2&&Array.isArray(result.missing)&&result.missing.length<=8&&
   result.missing.every(item=>typeof item==='string'&&item.length>0&&item.length<=200)&&new Set(result.missing).size===result.missing.length){
   accepted={status:'CLARIFICATION_REQUIRED',missing:[...result.missing] as string[]};
  }else if(result.status==='READY'&&Object.keys(result).length===2&&Object.hasOwn(result,'evidence')){
   const evidence=validateStructuredEvidenceList(result.evidence);
   const query=validateStructuredQuery(attempt.query);
   for(const row of evidence){
    if(row.dataset!==query.dataset||!matchesStructuredPayload(query,row.payload)||stamp===null||row.reference.ruleProof.evaluationDate!==stamp.evaluationDate)throw proofError();
   }
   accepted={status:'READY',evidence};
  }else throw proofError();
  normalized.push({slot:attempt.slot,result:accepted});
 }
 return normalized;
}
function currentKeys(plan:IncidentContextPlan,results:{slot:IncidentContextSlot;result:StructuredSearchResult}[]):ContextKeys{
 if(plan.attempts.length===0)return {systemKey:null,locationKey:null};
 const resolved:ResolvedIncidentContext=resolveIncidentContext(plan,results);
 return {systemKey:resolved.system?.key??null,locationKey:resolved.location?.key??null};
}
function checkFloor(ticket:Ticket,source:Source){if(ranks[ticket.sensitiveLevel]<ranks[source.retainedSensitivity])throw proofError();}
function validateSourcePlan(ticket:Ticket,source:Source):IncidentContextPlan{
 checkFloor(ticket,source);
 const plan=planIncidentContext(source.claims,ticket.departmentCode);
 try{incidentContextPlanSchema.parse(plan);}catch{throw proofError();}
 return plan;
}

/** Authenticate and seal one bounded, source-bound incident-context proof. */
export function sealIncidentContextProof(inputInput:unknown,key:string):SealedIncidentContextProof{
 try{
  if(typeof key!=='string'||key.length===0)throw proofError();
  const copied=copyStructuredJson(inputInput,PLAINTEXT_MAX,20_000),input:ProofInput=inputSchema.parse(copied);
  const plan=validateSourcePlan(input.ticket,input.source);
  if(!validStampFor(plan,input.stamp))throw proofError();
  const results=normalizeResults(plan,input.results,input.stamp),keys=currentKeys(plan,results);
  const envelope={kind:'INCIDENT_CONTEXT' as const,schemaVersion:1 as const,ticket:input.ticket,source:input.source,plan,catalogStamp:input.stamp,results};
  const plaintext=JSON.stringify(envelope);if(Buffer.byteLength(plaintext,'utf8')>PLAINTEXT_MAX)throw proofError();
  const encrypted=encryptValue(plaintext,key);if(encrypted.length>CIPHERTEXT_MAX)throw proofError();
  return freezeStructuredData({encrypted,requiresCatalog:plan.attempts.length>0,...keys});
 }catch{throw proofError();}
}

/** Reopen only when the authenticated private proof still binds the exact current source, ticket and catalog stamp. */
export function openIncidentContextProof(encryptedInput:unknown,expectedInput:unknown,key:string):ContextKeys|null{
 try{
  if(typeof encryptedInput!=='string'||encryptedInput.length===0||encryptedInput.length>CIPHERTEXT_MAX||typeof key!=='string'||key.length===0)return null;
  const expected=expectedSchema.parse(copyStructuredJson(expectedInput,16*1024,256));
  const plaintext=decryptValue(encryptedInput,key);if(Buffer.byteLength(plaintext,'utf8')>PLAINTEXT_MAX)return null;
  const raw=JSON.parse(plaintext),proof=proofSchema.parse(copyStructuredJson(raw,PLAINTEXT_MAX,20_000));
  if(!exactDigest(proof.ticket,expected.ticket,'incident-context-proof-ticket-v1')||!exactDigest(proof.source,expected.source,'incident-context-proof-source-v1')||
   !exactDigest(proof.catalogStamp,expected.stamp,'incident-context-proof-stamp-v1'))return null;
  const plan=validateSourcePlan(expected.ticket,expected.source);
  if(!exactDigest(proof.plan,plan,'incident-context-proof-plan-v1')||!validStampFor(plan,expected.stamp))return null;
  const results=normalizeResults(plan,proof.results,expected.stamp);
  return freezeStructuredData(currentKeys(plan,results));
 }catch{return null;}
}
