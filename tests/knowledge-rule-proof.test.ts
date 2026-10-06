import {describe,expect,it} from 'vitest';
import {buildRuleProof,ruleContextsStillMatch,ruleProofSchema,ruleProofsEqual} from '../lib/knowledge/rule-proof';
import type {KnowledgeEvidence,KnowledgeRuleProof} from '../lib/knowledge/types';

const familyId='123e4567-e89b-42d3-a456-426614174000';
const baseDocumentId='123e4567-e89b-42d3-a456-426614174001';
const amendmentDocumentId='123e4567-e89b-42d3-a456-426614174002';
const cancellationDocumentId='123e4567-e89b-42d3-a456-426614174003';

function snapshot() {
 return {
  familyId,baseDocumentId,versionStream:'MAIN',ruleRevision:'17',evaluationDate:'2026-10-06',
  members:[{documentId:baseDocumentId,revision:4},{documentId:amendmentDocumentId,revision:2}],
  effects:[
   {sourceDocumentId:amendmentDocumentId,targetDocumentId:baseDocumentId,relationType:'AMENDS' as const,revision:2},
   {sourceDocumentId:cancellationDocumentId,targetDocumentId:amendmentDocumentId,relationType:'CANCELS' as const,revision:1},
  ],
 };
}

function evidence(chunkId:string,ruleProof:KnowledgeRuleProof|undefined):KnowledgeEvidence {
 return {chunkId,documentId:baseDocumentId,documentRevision:4,title:'Rule',familyCode:'RULES',academicYear:2569,authorityLevel:90,
  pageNumber:null,sectionTitle:null,content:'Rule text',sourceUrl:null,similarity:0.8,...(ruleProof?{ruleProof}:{})};
}

describe('located rule proofs',()=>{
 it('hashes a strict canonical snapshot independent of row order without mutating it',()=>{
  const first=snapshot(),reordered=snapshot();
  reordered.members.reverse();reordered.effects.reverse();
  const firstBefore=structuredClone(first),reorderedBefore=structuredClone(reordered);
  const proof=buildRuleProof(first),same=buildRuleProof(reordered);

  expect(proof).toEqual(same);
  expect(proof).toMatchObject({familyId,baseDocumentId,versionStream:'MAIN',ruleRevision:'17',evaluationDate:'2026-10-06'});
  expect(proof.contextDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(first).toEqual(firstBefore);
  expect(reordered).toEqual(reorderedBefore);
  expect(ruleProofSchema.safeParse(proof).success).toBe(true);
 });

 it('changes the proof when epoch, date, membership, member revision, or effect changes',()=>{
  const original=buildRuleProof(snapshot());
  const changed=[
   {...snapshot(),ruleRevision:'18'},
   {...snapshot(),evaluationDate:'2026-10-07'},
   {...snapshot(),members:[...snapshot().members,{documentId:'123e4567-e89b-42d3-a456-426614174004',revision:0}]},
   {...snapshot(),members:[{...snapshot().members[0]!,revision:5},snapshot().members[1]!]},
   {...snapshot(),effects:[{...snapshot().effects[0]!,revision:3},snapshot().effects[1]!] },
  ];
  for(const value of changed)expect(ruleProofsEqual(original,buildRuleProof(value))).toBe(false);
 });

 it('accepts the maximum BIGINT epoch and rejects noncanonical or overflowing values',()=>{
  expect(buildRuleProof({...snapshot(),ruleRevision:'9223372036854775807'}).ruleRevision).toBe('9223372036854775807');
  for(const revision of ['-1','01','+1','1.0','9223372036854775808','']) {
   expect(()=>buildRuleProof({...snapshot(),ruleRevision:revision})).toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
  }
 });

 it('rejects malformed or extra proof fields and invalid calendar dates',()=>{
  const proof=buildRuleProof(snapshot());
  expect(ruleProofSchema.safeParse({...proof,unexpected:true}).success).toBe(false);
  expect(ruleProofSchema.safeParse({...proof,familyId:familyId.toUpperCase()}).success).toBe(false);
  expect(ruleProofSchema.safeParse({...proof,evaluationDate:'2026-02-30'}).success).toBe(false);
  expect(ruleProofSchema.safeParse({...proof,contextDigest:'A'.repeat(64)}).success).toBe(false);
  expect(ruleProofsEqual(proof,{...proof,unexpected:true})).toBe(false);
  expect(ruleProofsEqual(proof,null)).toBe(false);
 });

 it('rejects duplicate members, duplicate or contradictory effects, and a missing base member',()=>{
  const valid=snapshot();
  expect(()=>buildRuleProof({...valid,members:[...valid.members,valid.members[0]]})).toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
  expect(()=>buildRuleProof({...valid,effects:[...valid.effects,valid.effects[0]]})).toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
  expect(()=>buildRuleProof({...valid,effects:[...valid.effects,
   {sourceDocumentId:amendmentDocumentId,targetDocumentId:baseDocumentId,relationType:'CANCELS',revision:2}]}))
   .toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
  expect(()=>buildRuleProof({...valid,effects:[...valid.effects,
   {sourceDocumentId:cancellationDocumentId,targetDocumentId:baseDocumentId,relationType:'CANCELS',revision:1}]}))
   .toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
  expect(()=>buildRuleProof({...valid,effects:[...valid.effects,
   {sourceDocumentId:amendmentDocumentId,targetDocumentId:amendmentDocumentId,relationType:'AMENDS',revision:2}]}))
   .toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
  expect(()=>buildRuleProof({...valid,members:valid.members.filter(row=>row.documentId!==baseDocumentId)}))
   .toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
 });

 it('does not infer that effect endpoints must be returned members',()=>{
  const proof=buildRuleProof({...snapshot(),members:[{documentId:baseDocumentId,revision:4}],effects:[
   {sourceDocumentId:amendmentDocumentId,targetDocumentId:baseDocumentId,relationType:'AMENDS',revision:2},
   {sourceDocumentId:cancellationDocumentId,targetDocumentId:'123e4567-e89b-42d3-a456-426614174004',relationType:'CANCELS',revision:1},
  ]});
  expect(ruleProofSchema.safeParse(proof).success).toBe(true);
 });

 it('rejects non-strict snapshots, unsafe document revisions, and over-bound collections',()=>{
  const valid=snapshot();
  expect(()=>buildRuleProof({...valid,extra:'not in the snapshot contract'})).toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
  expect(()=>buildRuleProof({...valid,members:[{documentId:baseDocumentId,revision:-1}]})).toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
  expect(()=>buildRuleProof({...valid,members:[{documentId:baseDocumentId,revision:Number.MAX_SAFE_INTEGER+1}]}))
   .toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
  expect(()=>buildRuleProof({...valid,members:[{documentId:baseDocumentId,revision:4},...Array.from({length:200},(_,index)=>({
   documentId:`123e4567-e89b-42d3-a456-${(index+10).toString(16).padStart(12,'0')}`,revision:index,
  }))]})).toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
  expect(()=>buildRuleProof({...valid,effects:Array.from({length:401},(_,index)=>({
   sourceDocumentId:`123e4567-e89b-42d3-a456-${index.toString(16).padStart(12,'0')}`,
   targetDocumentId:baseDocumentId,relationType:'AMENDS',revision:index,
  }))})).toThrowError('KNOWLEDGE_RULE_PROOF_INVALID');
 });

 it('compares proofs by group and accepts fresh extra groups',()=>{
  const original=buildRuleProof(snapshot());
  const other=buildRuleProof({...snapshot(),baseDocumentId:amendmentDocumentId,
   members:[{documentId:amendmentDocumentId,revision:2}],effects:[]});
  const added=buildRuleProof({...snapshot(),baseDocumentId:cancellationDocumentId,
   members:[{documentId:cancellationDocumentId,revision:0}],effects:[]});
  expect(ruleContextsStillMatch([evidence('a',original),evidence('b',original),evidence('c',other)],
   [evidence('new-a',original),evidence('new-c',other),evidence('extra',added)])).toBe(true);
 });

 it('rejects a missing old group, legacy proofless rows, and conflicting proofs within one group',()=>{
  const original=buildRuleProof(snapshot());
  const changed=buildRuleProof({...snapshot(),ruleRevision:'18'});
  expect(ruleContextsStillMatch([evidence('old',original)],[evidence('fresh',changed)])).toBe(false);
  expect(ruleContextsStillMatch([evidence('legacy',undefined)],[evidence('fresh',original)])).toBe(false);
  expect(ruleContextsStillMatch([evidence('first',original),evidence('second',original)],
   [evidence('first',original),evidence('second',changed)])).toBe(false);
  expect(ruleContextsStillMatch([evidence('old',original)],[])).toBe(false);
 });
});
