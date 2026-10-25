import {LOCAL_EMBEDDING_FINGERPRINT,LOCAL_EMBEDDING_DIMENSION} from '../knowledge/embedding-space';

interface OwnedCurrentSourceAnswerInput {
 resultKind:unknown;
 expectedCaseId:unknown;
 expectedSourceId:unknown;
 expectedDocumentIds:unknown;
 currentDocumentIds:unknown;
 sourceEvidence:unknown;
 evidenceDocumentIds:unknown;
 citationDocumentIds:unknown;
}

function stringIds(value:unknown):value is string[]{
 return Array.isArray(value)&&value.every(item=>typeof item==='string'&&item.length>0);
}

function isRecord(value:unknown):value is Record<string,unknown>{
 return typeof value==='object'&&value!==null&&!Array.isArray(value);
}

/** Prevents frozen workflow cases from being passed with only generic safety booleans. */
export function hasOwnedCaseWorkflowEvidence(caseId:string,value:unknown):boolean{
 if(!isRecord(value))return !['A14','A15','A17','B02','B03','B04','B05','B06','B08','B09','B10'].includes(caseId);
 const trueFields=(...fields:string[])=>fields.every(field=>value[field]===true);
 switch(caseId){
  case 'A14':case 'A15':{
   const sourceEvidence=value.reviewedCurrentRagSource,answer=value.answerEvidence;
   if(value.kind!=='RAG_CURRENT_SOURCE'||!isRecord(sourceEvidence)||!isRecord(answer))return false;
   return matchesOwnedCurrentSourceAnswer({resultKind:answer.resultKind,expectedCaseId:caseId,expectedSourceId:sourceEvidence.sourceId,
    expectedDocumentIds:[sourceEvidence.documentId],currentDocumentIds:value.currentEligibleDocumentIds,sourceEvidence,
    evidenceDocumentIds:answer.evidenceDocumentIds,citationDocumentIds:answer.citationDocumentIds});
  }
  case 'A17':return value.kind==='SEPARATE_AI_CONVERSATION'&&trueFields('newAIConversation','humanTicketUnchanged');
  case 'B02':case 'B03':return value.kind==='UNAVAILABLE_EVIDENCE'&&value.eligiblePublicDocumentCount===0&&value.resultKind==='CLARIFY'
    &&trueFields('noOwnedPublication','unavailableEvidenceObserved');
  case 'B04':return value.kind==='SUPPORT_PROPOSAL'&&value.proposalIntent==='PERSONAL_CASE'
    &&trueFields('supportProposalPrepared','editableProposalDelivered','noPrematureTicket');
  case 'B05':return value.kind==='SUPPORT_PROPOSAL'&&value.proposalIntent==='ESCALATE'
    &&trueFields('supportProposalPrepared','editableProposalDelivered','noPrematureTicket');
  case 'B06':return value.kind==='OWNED_CONFIRMATION'
    &&trueFields('finalUserConfirmationTurn','noTicketsBeforeFinalConfirmation','ticketCreatedOnlyAfterFinalTurn','priorProposalDeliveredBeforeFinal','priorAssistantStepDeliveredBeforeFrozenSuite',
      'ownedConfirmationObserved','ticketReceiptDelivered');
  case 'B08':return value.kind==='AMBIGUOUS_CONTEXT'&&value.candidateContexts===2
    &&trueFields('ambiguousChoiceRequested','noAIJob','noTicketCreated');
  case 'B09':return value.kind==='HUMAN_CONTINUATION'
    &&trueFields('exactHumanTicketRoute','noAIJob','humanTicketUnchanged','noAIDelivery','noNewTicket','fixedReceiptObserved','staffNotificationObserved');
  case 'B10':return value.kind==='INFERENCE_TAKEOVER'&&value.staleAIMessages===0
    &&trueFields('takeoverDuringInference','aiJobSuppressed','staleDispatchSuppressed','noAIDelivery','singleTakeoverTicket','takeoverTicketPreserved');
  default:return true;
 }
}

function hasReviewedCurrentSource(input:OwnedCurrentSourceAnswerInput,documentId:string):boolean{
 const evidence=input.sourceEvidence;
 if(!isRecord(evidence)||evidence.caseId!==input.expectedCaseId||evidence.sourceId!==input.expectedSourceId||evidence.documentId!==documentId
  ||typeof evidence.sourceChecksum!=='string'||!/^[a-f0-9]{64}$/u.test(evidence.sourceChecksum)||typeof evidence.sourceUrl!=='string')return false;
 const review=evidence.review,document=evidence.document,chunks=evidence.chunks;
 if(!isRecord(review)||review.allWarningsResolved!==true||!Number.isInteger(review.warningCount)||Number(review.warningCount)<0
  ||!isRecord(review.attestations))return false;
 const requiredAttestations=['sourceAuthorityReviewed','extractionReviewed','applicabilityReviewed','sensitivityReviewed','versionReviewed'];
 const attestations=review.attestations;
 if(requiredAttestations.some(key=>attestations[key]!==true))return false;
 if(!isRecord(document)||document.status!=='ACTIVE'||document.isCurrent!==true||document.approvalStatus!=='APPROVED'
  ||document.visibility!=='PUBLIC'||document.officialSource!==true||document.effectiveToday!==true
  ||typeof document.authorityLevel!=='number'||document.authorityLevel<=0
  ||document.sourceUrl!==evidence.sourceUrl||document.checksum!==evidence.sourceChecksum)return false;
 return isRecord(chunks)&&Number.isInteger(chunks.count)&&Number(chunks.count)>0
  &&chunks.fingerprint===LOCAL_EMBEDDING_FINGERPRINT&&chunks.dimension===LOCAL_EMBEDDING_DIMENSION
  &&chunks.normalized===true&&chunks.reviewClear===true&&chunks.allLocatedToSource===true&&chunks.fixtureTextWitness===true;
}

/** Requires the answer, evidence, citations, and current eligible documents to share one exact owned source set. */
export function matchesOwnedCurrentSourceAnswer(input:OwnedCurrentSourceAnswerInput):boolean{
 if(input.resultKind!=='ANSWER'||!stringIds(input.expectedDocumentIds)||!stringIds(input.currentDocumentIds)
  ||!stringIds(input.evidenceDocumentIds)||!stringIds(input.citationDocumentIds)||input.expectedDocumentIds.length!==1)return false;
 const expected=new Set(input.expectedDocumentIds);
 if(expected.size===0||expected.size!==input.expectedDocumentIds.length||input.currentDocumentIds.length!==expected.size
  ||new Set(input.currentDocumentIds).size!==input.currentDocumentIds.length
  ||input.currentDocumentIds.some(id=>!expected.has(id))
  ||input.evidenceDocumentIds.length===0||input.evidenceDocumentIds.some(id=>!expected.has(id))
  ||input.citationDocumentIds.length===0||input.citationDocumentIds.some(id=>!expected.has(id)))return false;
 return hasReviewedCurrentSource(input,input.expectedDocumentIds[0]!);
}
