interface Scenario {id:string;cohort:string;needsOfficialEvidence:boolean;evidenceState:string;conversationContext?:unknown}
export interface OwnedConversationHistoryTurn {role:'USER'|'AI';content:string}

function isOwnedConversationHistoryTurn(value:unknown):value is OwnedConversationHistoryTurn{
 if(typeof value!=='object'||value===null||Array.isArray(value))return false;
 const keys=Reflect.ownKeys(value);
 if(keys.length!==2||!keys.includes('role')||!keys.includes('content'))return false;
 const role=Object.getOwnPropertyDescriptor(value,'role');
 const content=Object.getOwnPropertyDescriptor(value,'content');
 if(!role||!('value' in role)||!content||!('value' in content))return false;
 return (role.value==='USER'||role.value==='AI')&&typeof content.value==='string'&&content.value.trim().length>0;
}

/** Exact ordered comparison for the USER turns and actually delivered AI turns expected in a follow-up. */
export function matchesOwnedSentHistory(observed:unknown,expected:readonly OwnedConversationHistoryTurn[]):boolean{
 if(!Array.isArray(observed)||observed.length!==expected.length)return false;
 return observed.every((turn,index)=>{
  const expectedTurn=expected[index];
  return isOwnedConversationHistoryTurn(turn)&&isOwnedConversationHistoryTurn(expectedTurn)
   &&turn.role===expectedTurn.role&&turn.content===expectedTurn.content;
 });
}

export function classifyOwnedEvaluationRecipient(body:{to?:unknown;replyToken?:unknown},target:{lineUser:string;replyToken:string;staffLineUser?:string}):'OWNED_PUSH'|'OWNED_REPLY'|'OWNED_STAFF_PUSH'|null{
 if(Object.hasOwn(body,'to')&&!Object.hasOwn(body,'replyToken')&&body.to===target.lineUser)return 'OWNED_PUSH';
 if(target.staffLineUser&&Object.hasOwn(body,'to')&&!Object.hasOwn(body,'replyToken')&&body.to===target.staffLineUser)return 'OWNED_STAFF_PUSH';
 if(!Object.hasOwn(body,'to')&&Object.hasOwn(body,'replyToken')&&body.replyToken===target.replyToken)return 'OWNED_REPLY';
 return null;
}
export function validateOwnedConversationTarget<T extends Scenario>(target:{database:string|undefined;synthetic:boolean;caseIds:string[];officialContext?:boolean;ragContext?:boolean;ownedWorkflowContext?:boolean},scenarios:readonly T[]):T[]{
 if(!target.synthetic||!target.database||!/^yru_structured_schema_[a-f0-9]{12}$/u.test(target.database))throw Error('OWNED_EVALUATION_TARGET_REQUIRED');
 if(!target.caseIds.length||target.caseIds.length>12||new Set(target.caseIds).size!==target.caseIds.length)throw Error('OWNED_EVALUATION_CASES_INVALID');
 if((target.officialContext===true||target.ragContext===true)&&target.caseIds.length!==1)throw Error('OWNED_SOURCE_CASE_ISOLATION_REQUIRED');
 return target.caseIds.map(id=>{
  const scenario=scenarios.find(s=>s.id===id);
  if(!scenario)throw Error('OWNED_EVALUATION_CASES_INVALID');
  if(target.officialContext===true){
   const expectedCohort=id==='B01'?'BOUNDARY_REQUIRED':'ANSWERABLE';
   if(!['A10','A11','A12','A13','A16','A18','B01'].includes(id)||scenario.cohort!==expectedCohort||!scenario.needsOfficialEvidence)throw Error('OWNED_WORKFLOW_CONTEXT_REQUIRED');
   return scenario;
  }
  if(target.ragContext===true){
   if(!['A14','A15'].includes(id)||scenario.cohort!=='ANSWERABLE'||!scenario.needsOfficialEvidence||scenario.evidenceState!=='AVAILABLE'
    )throw Error('OWNED_WORKFLOW_CONTEXT_REQUIRED');
   return scenario;
  }
  const contextualWorkflows=new Set(['A17','B02','B03','B04','B05','B06','B08','B09','B10']);
  if(target.ownedWorkflowContext===true){
   if(!contextualWorkflows.has(id))throw Error('OWNED_WORKFLOW_CONTEXT_REQUIRED');
   const valid=id==='A17'
    ?scenario.cohort==='ANSWERABLE'&&!scenario.needsOfficialEvidence&&scenario.evidenceState==='EMPTY'&&scenario.conversationContext!==undefined
    :id==='B02'||id==='B03'
     ?scenario.cohort==='BOUNDARY_REQUIRED'&&scenario.needsOfficialEvidence&&scenario.evidenceState==='EMPTY'
      &&(id!=='B02'||scenario.conversationContext!==undefined)
     :scenario.cohort==='BOUNDARY_REQUIRED'&&!scenario.needsOfficialEvidence
      &&(['B04','B05'].includes(id)||scenario.conversationContext!==undefined);
   if(!valid)throw Error('OWNED_WORKFLOW_CONTEXT_REQUIRED');
   return scenario;
  }
  const clarificationBoundary=id==='B07'&&scenario.cohort==='BOUNDARY_REQUIRED'&&scenario.evidenceState==='NOT_NEEDED';
  if((scenario.cohort!=='ANSWERABLE'&&!clarificationBoundary)||scenario.needsOfficialEvidence||!['NOT_NEEDED','EMPTY'].includes(scenario.evidenceState)||scenario.conversationContext!==undefined)
   throw Error('OWNED_WORKFLOW_CONTEXT_REQUIRED');
  return scenario;
 });
}
