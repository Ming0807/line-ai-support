import { expect, it } from 'vitest';
import frozenFixture from './fixtures/assistant-conversations.json';
import {
  evaluateAssistantConversationCases,
  type AssistantConversationScenario,
} from '../lib/ai/conversation-eval';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../lib/knowledge/embedding-space';

const scenarios: AssistantConversationScenario[] = frozenFixture.scenarios.map(scenario => {
  if (typeof scenario.id !== 'string') throw new Error('Fixture scenario id must be a string');
  if (scenario.cohort !== 'ANSWERABLE' && scenario.cohort !== 'BOUNDARY_REQUIRED') {
    throw new Error(`Fixture scenario ${scenario.id} has an unknown cohort`);
  }
  if (scenario.needsOfficialEvidence !== undefined && typeof scenario.needsOfficialEvidence !== 'boolean') {
    throw new Error(`Fixture scenario ${scenario.id} has an invalid evidence requirement`);
  }
  return {
    id: scenario.id,
    cohort: scenario.cohort,
    ...(scenario.needsOfficialEvidence === undefined
      ? {}
      : { needsOfficialEvidence: scenario.needsOfficialEvidence }),
  };
});
function caseSpecificEvidence(caseId:string):unknown{
 if(caseId==='A14'||caseId==='A15'){
  const documentId=`doc-${caseId}`,sourceId=caseId==='A14'?'a14-announcement':'a15-system-guide';
  const sourceChecksum=caseId==='A14'?'a'.repeat(64):'b'.repeat(64),sourceUrl=`https://fixture.yru.ac.th/synthetic/${caseId.toLowerCase()}.html`;
  const source={caseId,sourceId,documentId,sourceChecksum,sourceUrl,
   review:{attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},warningCount:0,allWarningsResolved:true},
   document:{status:'ACTIVE',isCurrent:true,approvalStatus:'APPROVED',visibility:'PUBLIC',officialSource:true,effectiveToday:true,sourceUrl,checksum:sourceChecksum,authorityLevel:90},
   chunks:{count:1,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,dimension:384,normalized:true,reviewClear:true,allLocatedToSource:true,fixtureTextWitness:true}};
  return {kind:'RAG_CURRENT_SOURCE',reviewedCurrentRagSource:source,currentEligibleDocumentIds:[documentId],
   answerEvidence:{resultKind:'ANSWER',evidenceDocumentIds:[documentId],citationDocumentIds:[documentId]}};
 }
 if(caseId==='A17')return {kind:'SEPARATE_AI_CONVERSATION',newAIConversation:true,humanTicketUnchanged:true};
 if(caseId==='B02'||caseId==='B03')return {kind:'UNAVAILABLE_EVIDENCE',noOwnedPublication:true,eligiblePublicDocumentCount:0,resultKind:'CLARIFY',unavailableEvidenceObserved:true};
 if(caseId==='B04'||caseId==='B05')return {kind:'SUPPORT_PROPOSAL',proposalIntent:caseId==='B04'?'PERSONAL_CASE':'ESCALATE',supportProposalPrepared:true,editableProposalDelivered:true,noPrematureTicket:true};
 if(caseId==='B06')return {kind:'OWNED_CONFIRMATION',finalUserConfirmationTurn:true,noTicketsBeforeFinalConfirmation:true,ticketCreatedOnlyAfterFinalTurn:true,priorProposalDeliveredBeforeFinal:true,priorAssistantStepDeliveredBeforeFrozenSuite:true,ownedConfirmationObserved:true,ticketReceiptDelivered:true};
 if(caseId==='B08')return {kind:'AMBIGUOUS_CONTEXT',candidateContexts:2,ambiguousChoiceRequested:true,noAIJob:true,noTicketCreated:true};
 if(caseId==='B09')return {kind:'HUMAN_CONTINUATION',exactHumanTicketRoute:true,noAIJob:true,humanTicketUnchanged:true,noAIDelivery:true,noNewTicket:true,fixedReceiptObserved:true,staffNotificationObserved:true};
 if(caseId==='B10')return {kind:'INFERENCE_TAKEOVER',takeoverDuringInference:true,aiJobSuppressed:true,staleDispatchSuppressed:true,staleAIMessages:0,noAIDelivery:true,singleTakeoverTicket:true,takeoverTicketPreserved:true};
 return undefined;
}
const observations = scenarios.map((scenario, index) => ({
  caseId: scenario.id,
  usefulAnswer: scenario.cohort === 'ANSWERABLE',
  correctTrajectory: true,
  authoritySafe: true,
  ownershipSafe: true,
  status: 'PASS' as const,
  reviewer:'Synthetic evaluator',
  rationale:'Checked the stored case-specific workflow evidence against the frozen expected behavior.',
  reviewedAt:'2026-10-14T00:00:00.000Z',
  caseSpecificEvidence:caseSpecificEvidence(scenario.id),
  ...(index === -1 ? { rawText: 'must never escape' } : {}),
}));

it('keeps blocked provider failures in the frozen denominator and does not score them as passes', () => {
  const result = evaluateAssistantConversationCases(scenarios, observations.map(observation =>
    observation.caseId === 'A20'
      ? { ...observation, status: 'BLOCKED' as const, usefulAnswer: false, correctTrajectory: false }
      : observation,
  ));

  expect(result.frozen.total).toBe(30);
  expect(result.scored.correctTrajectory).toBe(29);
  expect(result.scored.trajectoryDenominator).toBe(30);
  expect(result.scored.usefulAnswers).toBe(19);
  expect(result.scored.usefulAnswerDenominator).toBe(20);
  expect(result.coverage.blockedCaseCount).toBe(1);
  expect(result.status).toBe('FAIL');
});

it('does not let missing, duplicate, or unknown result rows pass evaluation', () => {
  const missing = evaluateAssistantConversationCases(scenarios, observations.slice(1));
  expect(missing.cases.find(row => row.caseId === 'A01')?.status).toBe('NOT_EVALUATED');
  expect(missing.scored.correctTrajectory).toBe(29);
  expect(missing.status).toBe('FAIL');

  const duplicate = evaluateAssistantConversationCases(scenarios, [...observations, observations[0]!]);
  expect(duplicate.cases.find(row => row.caseId === 'A01')?.status).toBe('NOT_EVALUATED');
  expect(duplicate.scored.correctTrajectory).toBe(29);
  expect(duplicate.coverage.duplicateCaseCount).toBe(1);
  expect(duplicate.status).toBe('FAIL');

  const unknown = evaluateAssistantConversationCases(scenarios, [...observations, {
    ...observations[0]!, caseId: 'NOT-A-FROZEN-CASE',
  }]);
  expect(unknown.scored.correctTrajectory).toBe(30);
  expect(unknown.coverage.unknownObservationCount).toBe(1);
  expect(unknown.status).toBe('FAIL');
});

it('does not treat a partially observed result as a pass', () => {
  const partial = evaluateAssistantConversationCases(scenarios, observations.map(observation =>
    observation.caseId === 'A01'
      ? { ...observation, correctTrajectory: null }
      : observation,
  ));

  expect(partial.cases.find(row => row.caseId === 'A01')?.status).toBe('NOT_EVALUATED');
  expect(partial.coverage.incompleteObservationCount).toBe(1);
  expect(partial.scored.correctTrajectory).toBe(29);
  expect(partial.status).toBe('FAIL');
});

it('does not score B04-B10 from generic ownership booleans without case-specific evidence',()=>{
 const genericOnly=observations.map(observation=>{
  if(observation.caseId!=='B09')return observation;
  const {caseSpecificEvidence:_caseSpecificEvidence,...withoutEvidence}=observation;
  void _caseSpecificEvidence;
  return withoutEvidence;
 });
 const result=evaluateAssistantConversationCases(scenarios,genericOnly);
 expect(result.cases.find(row=>row.caseId==='B09')?.status).toBe('NOT_EVALUATED');
 expect(result.cases.find(row=>row.caseId==='B09')?.ownershipSafe).toBeNull();
 expect(result.coverage.incompleteObservationCount).toBe(1);
 expect(result.status).toBe('FAIL');
});

it('requires an attributable reviewer, rationale, and review time before scoring',()=>{
 const unreviewed=observations.map(observation=>observation.caseId==='A01'?{...observation,reviewer:' ',rationale:null}:observation);
 const result=evaluateAssistantConversationCases(scenarios,unreviewed);
 expect(result.cases.find(row=>row.caseId==='A01')?.status).toBe('NOT_EVALUATED');
 expect(result.coverage.incompleteObservationCount).toBe(1);
 expect(result.status).toBe('FAIL');
});

it('passes at the trajectory and answer targets only when all boundary authority and ownership checks pass', () => {
  const targetObservations = observations.map((observation, index) => ({
    ...observation,
    usefulAnswer: observation.caseId.startsWith('A') && index < 18,
    correctTrajectory: index < 27,
    status: (index < 27 ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL',
  }));
  const result = evaluateAssistantConversationCases(scenarios, targetObservations);

  expect(result.scored.correctTrajectory).toBe(27);
  expect(result.scored.usefulAnswers).toBe(18);
  expect(result.safety.authoritySensitiveCases).toBe(10);
  expect(result.safety.authoritySafeCases).toBe(10);
  expect(result.safety.ownershipCases).toBe(30);
  expect(result.safety.ownershipSafeCases).toBe(30);
  expect(result.status).toBe('PASS');
});

it('fails if any authority-sensitive case has an authority violation', () => {
  const unsafe = observations.map(observation => observation.caseId === 'B04'
    ? { ...observation, authoritySafe: false, status: 'FAIL' as const }
    : observation,
  );
  const result = evaluateAssistantConversationCases(scenarios, unsafe);

  expect(result.safety.authoritySafeCases).toBe(9);
  expect(result.status).toBe('FAIL');
});

it('fails if an answerable official-answer case violates authority safety', () => {
  const unsafe = observations.map(observation => observation.caseId === 'A11'
    ? { ...observation, authoritySafe: false, status: 'FAIL' as const }
    : observation,
  );
  const result = evaluateAssistantConversationCases(scenarios, unsafe);

  expect(result.safety.allCasesAuthoritySafe).toBe(29);
  expect(result.safety.authoritySafeCases).toBe(10);
  expect(result.status).toBe('FAIL');
});

it('returns only sanitized aggregate fields and never includes raw text or token-like extras', () => {
  const result = evaluateAssistantConversationCases(scenarios, observations.map(observation => ({
    ...observation,
    rawText: 'secret reply text',
    token: 'sk-secret-token',
  })));
  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain('secret reply text');
  expect(serialized).not.toContain('sk-secret-token');
  expect(serialized).not.toContain('expectedBehavior');
  expect(result.cases).toHaveLength(30);
});
