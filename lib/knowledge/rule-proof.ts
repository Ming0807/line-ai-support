import {createHash} from 'node:crypto';
import {z} from 'zod';
import {isValidKnowledgeDate} from './metadata-filter';
import type {KnowledgeEvidence,KnowledgeRuleProof} from './types';

const MAX_POSTGRES_BIGINT=BigInt('9223372036854775807');
const uuid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const canonicalRuleRevision=/^(0|[1-9][0-9]*)$/;
const ruleRevision=z.string().max(19).regex(canonicalRuleRevision)
 .refine(value=>canonicalRuleRevision.test(value)&&BigInt(value)<=MAX_POSTGRES_BIGINT);
const versionStream=z.string().min(1).max(120);
const date=z.string().refine(isValidKnowledgeDate);

export const ruleProofSchema=z.object({
 familyId:uuid,
 baseDocumentId:uuid,
 versionStream,
 ruleRevision,
 evaluationDate:date,
 contextDigest:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const memberSchema=z.object({documentId:uuid,revision}).strict();
const effectSchema=z.object({sourceDocumentId:uuid,targetDocumentId:uuid,
 relationType:z.enum(['AMENDS','CANCELS']),revision}).strict();
const snapshotSchema=z.object({
 familyId:uuid,
 baseDocumentId:uuid,
 versionStream,
 ruleRevision,
 evaluationDate:date,
 members:z.array(memberSchema).min(1).max(200),
 effects:z.array(effectSchema).max(400),
}).strict();

type Snapshot=z.infer<typeof snapshotSchema>;
type Member=z.infer<typeof memberSchema>;
type Effect=z.infer<typeof effectSchema>;
type Proof=z.infer<typeof ruleProofSchema>;

function invalid():never {throw new Error('KNOWLEDGE_RULE_PROOF_INVALID');}
function compareText(left:string,right:string):number {return left<right?-1:left>right?1:0;}

function canonicalMembers(members:Member[]):Member[] {
 return members.map(member=>({documentId:member.documentId,revision:member.revision}))
  .sort((left,right)=>compareText(left.documentId,right.documentId));
}

function canonicalEffects(effects:Effect[]):Effect[] {
 return effects.map(effect=>({sourceDocumentId:effect.sourceDocumentId,targetDocumentId:effect.targetDocumentId,
  relationType:effect.relationType,revision:effect.revision}))
  .sort((left,right)=>compareText(left.sourceDocumentId,right.sourceDocumentId)||
   compareText(left.targetDocumentId,right.targetDocumentId)||compareText(left.relationType,right.relationType)||left.revision-right.revision);
}

function hasConsistentSnapshot(snapshot:Snapshot):boolean {
 const memberIds=new Set(snapshot.members.map(member=>member.documentId));
 if(memberIds.size!==snapshot.members.length||!memberIds.has(snapshot.baseDocumentId))return false;

 const effectKeys=new Set<string>(),effectPairs=new Map<string,string>();
 for(const effect of snapshot.effects){
  if(effect.sourceDocumentId===effect.targetDocumentId)return false;
  const pair=JSON.stringify([effect.sourceDocumentId,effect.targetDocumentId]);
  const priorType=effectPairs.get(pair);
  if(priorType!==undefined&&priorType!==effect.relationType)return false;
  effectPairs.set(pair,effect.relationType);

  // A returned base cannot simultaneously be a member and the target of an active cancellation.
  if(effect.relationType==='CANCELS'&&effect.targetDocumentId===snapshot.baseDocumentId)return false;

  const key=JSON.stringify([effect.sourceDocumentId,effect.targetDocumentId,effect.relationType]);
  if(effectKeys.has(key))return false;
  effectKeys.add(key);
 }
 return true;
}

function proofTuple(proof:Proof):string {
 return JSON.stringify([proof.familyId,proof.baseDocumentId,proof.versionStream,proof.ruleRevision,proof.evaluationDate,proof.contextDigest]);
}

export function buildRuleProof(input:unknown):KnowledgeRuleProof {
 try {
  const parsed=snapshotSchema.safeParse(input);
  if(!parsed.success||!hasConsistentSnapshot(parsed.data))return invalid();
  const value=parsed.data;
  const payload={
   familyId:value.familyId,
   baseDocumentId:value.baseDocumentId,
   versionStream:value.versionStream,
   ruleRevision:value.ruleRevision,
   evaluationDate:value.evaluationDate,
   members:canonicalMembers(value.members),
   effects:canonicalEffects(value.effects),
  };
  const result={
   familyId:value.familyId,
   baseDocumentId:value.baseDocumentId,
   versionStream:value.versionStream,
   ruleRevision:value.ruleRevision,
   evaluationDate:value.evaluationDate,
   contextDigest:createHash('sha256').update(JSON.stringify(payload),'utf8').digest('hex'),
  };
  const proof=ruleProofSchema.safeParse(result);
  if(!proof.success)return invalid();
  return {...proof.data};
 } catch {
  return invalid();
 }
}

export function ruleProofsEqual(left:unknown,right:unknown):boolean {
 try {
  const parsedLeft=ruleProofSchema.safeParse(left),parsedRight=ruleProofSchema.safeParse(right);
  return parsedLeft.success&&parsedRight.success&&proofTuple(parsedLeft.data)===proofTuple(parsedRight.data);
 } catch {
  return false;
 }
}

function contextProofs(rows:KnowledgeEvidence[]):Map<string,Proof>|null {
 const groups=new Map<string,Proof>();
 try {
  for(const row of rows){
   if(row===null||typeof row!=='object')return null;
   const parsed=ruleProofSchema.safeParse((row as KnowledgeEvidence).ruleProof);
   if(!parsed.success)return null;
   const proof=parsed.data,key=JSON.stringify([proof.familyId,proof.baseDocumentId,proof.versionStream]);
   const existing=groups.get(key);
   if(existing&&!ruleProofsEqual(existing,proof))return null;
   groups.set(key,proof);
  }
 } catch {
  return null;
 }
 return groups;
}

export function ruleContextsStillMatch(previous:KnowledgeEvidence[],current:KnowledgeEvidence[]):boolean {
 if(!Array.isArray(previous)||!Array.isArray(current))return false;
 const before=contextProofs(previous),after=contextProofs(current);
 if(before===null||after===null)return false;
 for(const [key,proof] of before){
  const fresh=after.get(key);
  if(!fresh||!ruleProofsEqual(proof,fresh))return false;
 }
 return true;
}
