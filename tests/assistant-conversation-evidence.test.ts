import {expect,it} from 'vitest';
import {collectOwnedConversationReviews,conversationRecordDigest,REQUIRED_CONVERSATION_PROOF_PATHS} from '../lib/ai/conversation-eval-evidence';
const hashes=Object.fromEntries(REQUIRED_CONVERSATION_PROOF_PATHS.map(path=>[path,'a'.repeat(64)]));
const fixture=[{id:'A01',cohort:'ANSWERABLE' as const,turns:['สวัสดี']}];
const record={caseId:'A01',cohort:'ANSWERABLE',componentStatus:'WORKFLOW_OBSERVED',turns:[{question:'สวัสดี',text:'สวัสดีครับ',completed:true,ownershipSafe:true,caseSpecificWitness:{},sentDeliveries:[{recipient:'OWNED_REPLY'}]}]};
const run={schemaVersion:1,scope:'DISPOSABLE_MODEL_WORKFLOW_PILOT',syntheticOnly:true,runId:'run-1',productionActivated:false,sourceUnchanged:true,
 sourceHashes:hashes,finalSourceHashes:hashes,caseIds:['A01'],records:[record],models:[{sourceModelId:'model-1',sourceProviderId:'provider-1',modelName:'fixture',sourceAdapter:'COMPATIBLE',sourceBaseUrl:'https://fixture.invalid/v1',sourceNetworkRevision:1,sourceProviderRevision:1,sourceModelRevision:2,sourceProviderPriority:0,sourcePriority:0,sourceCostMode:'FREE_ONLY',sourceApiFormat:null,sourceGrantExpiresAt:'2026-10-20T00:00:00Z',sourceTimeoutMs:15000,targetTimeoutMs:15000}]};
const review={caseId:'A01',runId:'run-1',recordDigest:conversationRecordDigest(record),status:'PASS',usefulAnswer:true,correctTrajectory:true,
 authoritySafe:true,ownershipSafe:true,reviewer:'root actual output review',rationale:'Exact greeting observed; no facts or effects.',reviewedAt:'2026-10-14T16:00:00Z'};
it('connects an explicit review to its exact owned transcript and current source; missing frozen cases cannot pass',()=>{
 const result=collectOwnedConversationReviews(fixture,[run],[review],hashes);
 expect(result.observations).toHaveLength(1);expect(result.observations[0]).toMatchObject({caseId:'A01',status:'PASS'});
 expect(result.report.status).toBe('FAIL');
});
it.each(['source','finalSource','transcript','runId','question','recipient','duplicate'] as const)('rejects substituted %s evidence',kind=>{
 const r=structuredClone(run),v=structuredClone(review),current={...hashes};
 if(kind==='source')current[REQUIRED_CONVERSATION_PROOF_PATHS[0]]='b'.repeat(64);
 if(kind==='finalSource')r.finalSourceHashes={...hashes,[REQUIRED_CONVERSATION_PROOF_PATHS[0]]:'b'.repeat(64)};
 if(kind==='transcript')v.recordDigest='b'.repeat(64);
 if(kind==='runId')v.runId='foreign-run';
 if(kind==='question')r.records[0].turns[0].question='replacement';
 if(kind==='recipient')r.records[0].turns[0].sentDeliveries[0].recipient='FOREIGN';
 expect(()=>collectOwnedConversationReviews(fixture,[r],kind==='duplicate'?[v,v]:[v],current)).toThrow();
});
it('cannot turn a generic completed HUMAN case into owned safety evidence',()=>{
 const f=[{id:'B09',cohort:'BOUNDARY_REQUIRED' as const,turns:['สวัสดี']}],r=structuredClone(run);
 r.caseIds=['B09'];r.records[0].caseId='B09';r.records[0].cohort='BOUNDARY_REQUIRED';
 const v={...review,caseId:'B09',recordDigest:conversationRecordDigest(r.records[0])};
 expect(()=>collectOwnedConversationReviews(f,[r],[v],hashes)).toThrow();
});
