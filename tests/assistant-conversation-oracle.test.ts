import {expect,it} from 'vitest';
import {matchesOwnedCurrentSourceAnswer,hasOwnedCaseWorkflowEvidence} from '../lib/ai/conversation-eval-oracle';
import {LOCAL_EMBEDDING_FINGERPRINT} from '../lib/knowledge/embedding-space';

const expectedDocumentIds=['owned-current-document'];
const sourceChecksum='a'.repeat(64),sourceUrl='https://fixture.yru.ac.th/synthetic/a14.html';
const sourceEvidence={caseId:'A14',sourceId:'a14-announcement',documentId:expectedDocumentIds[0],sourceChecksum,sourceUrl,
 review:{attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},warningCount:1,allWarningsResolved:true},
 document:{status:'ACTIVE',isCurrent:true,approvalStatus:'APPROVED',visibility:'PUBLIC',officialSource:true,effectiveToday:true,sourceUrl,checksum:sourceChecksum,authorityLevel:90},
 chunks:{count:1,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,dimension:384,normalized:true,reviewClear:true,allLocatedToSource:true,fixtureTextWitness:true}};
const valid={resultKind:'ANSWER',expectedCaseId:'A14',expectedSourceId:'a14-announcement',expectedDocumentIds,currentDocumentIds:expectedDocumentIds,sourceEvidence,
 evidenceDocumentIds:expectedDocumentIds,citationDocumentIds:expectedDocumentIds};
it('requires the declared B06 prior assistant step to have actually been delivered before frozen turns',()=>{
 const witness={kind:'OWNED_CONFIRMATION',finalUserConfirmationTurn:true,noTicketsBeforeFinalConfirmation:true,ticketCreatedOnlyAfterFinalTurn:true,
  priorProposalDeliveredBeforeFinal:true,ownedConfirmationObserved:true,ticketReceiptDelivered:true};
 expect(hasOwnedCaseWorkflowEvidence('B06',witness)).toBe(false);
 expect(hasOwnedCaseWorkflowEvidence('B06',{...witness,priorAssistantStepDeliveredBeforeFrozenSuite:true})).toBe(true);
});

it('accepts only evidence and citations from the exact currently eligible reviewed source set',()=>{
 expect(matchesOwnedCurrentSourceAnswer(valid)).toBe(true);
 expect(matchesOwnedCurrentSourceAnswer({...valid,currentDocumentIds:[]})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,currentDocumentIds:['stale-document']})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,sourceEvidence:{...sourceEvidence,review:{...sourceEvidence.review,allWarningsResolved:false}}})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,sourceEvidence:{...sourceEvidence,review:{...sourceEvidence.review,attestations:{...sourceEvidence.review.attestations,applicabilityReviewed:false}}}})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,sourceEvidence:{...sourceEvidence,document:{...sourceEvidence.document,isCurrent:false}}})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,sourceEvidence:{...sourceEvidence,chunks:{...sourceEvidence.chunks,reviewClear:false}}})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,evidenceDocumentIds:['unrelated-document']})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,citationDocumentIds:['unrelated-document']})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,citationDocumentIds:[]})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,resultKind:'CLARIFY'})).toBe(false);
});

it('rejects missing, duplicate, or malformed current-source ids',()=>{
 expect(matchesOwnedCurrentSourceAnswer({...valid,expectedDocumentIds:[]})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,expectedDocumentIds:['owned-current-document','owned-current-document']})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,currentDocumentIds:['owned-current-document','owned-current-document']})).toBe(false);
 expect(matchesOwnedCurrentSourceAnswer({...valid,evidenceDocumentIds:[]})).toBe(false);
});
