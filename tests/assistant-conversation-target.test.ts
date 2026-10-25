import {expect,it} from 'vitest';
import fixture from './fixtures/assistant-conversations.json';
import {validateOwnedConversationTarget,classifyOwnedEvaluationRecipient,matchesOwnedSentHistory} from '../lib/ai/conversation-eval-target';
it('admits the implemented no-source clarification boundary without admitting handoff or ownership cases',()=>{
 const target={database:'yru_structured_schema_0123456789ab',synthetic:true,caseIds:['B07']};
 expect(validateOwnedConversationTarget(target,fixture.scenarios)).toEqual([fixture.scenarios.find(s=>s.id==='B07')]);
 for(const caseIds of [['B05'],['B06'],['B08']])expect(()=>validateOwnedConversationTarget({...target,caseIds},fixture.scenarios)).toThrow();
 const original=fixture.scenarios.find(s=>s.id==='B07')!;
 for(const changed of [{...original,needsOfficialEvidence:true},{...original,evidenceState:'AVAILABLE'},{...original,conversationContext:{mode:'HUMAN'}}]){
  expect(()=>validateOwnedConversationTarget(target,[changed])).toThrow('OWNED_WORKFLOW_CONTEXT_REQUIRED');
 }
});
it('admits only implemented official contexts behind the explicit owned publication mode',()=>{
 const target={database:'yru_structured_schema_0123456789ab',synthetic:true,caseIds:['A10'],officialContext:true};
 expect(validateOwnedConversationTarget(target,fixture.scenarios).map(s=>s.id)).toEqual(['A10']);
 expect(validateOwnedConversationTarget({...target,caseIds:['A18']},fixture.scenarios).map(s=>s.id)).toEqual(['A18']);
 for(const caseIds of [['A14'],['A15'],['B02'],['A10','A01'],['A10','A11'],['A12','A13','A16','A18','B01']]){
  expect(()=>validateOwnedConversationTarget({...target,caseIds},fixture.scenarios)).toThrow();
 }
});

it('rejects a normal or malformed database before any case can be selected',()=>{
 for(const database of ['postgres','yru','yru_structured_schema_bad','yru_structured_schema_0123456789ab;drop database postgres']){
  expect(()=>validateOwnedConversationTarget({database,synthetic:true,caseIds:['A01']},fixture.scenarios)).toThrow('OWNED_EVALUATION_TARGET_REQUIRED');
 }
});
it('requires explicit synthetic bounded unique known cases',()=>{
 const database='yru_structured_schema_0123456789ab';
 expect(()=>validateOwnedConversationTarget({database,synthetic:false,caseIds:['A01']},fixture.scenarios)).toThrow();
 for(const caseIds of [[],['A01','A01'],['UNKNOWN'],Array.from({length:13},(_,i)=>`A${String(i+1).padStart(2,'0')}`)]){
  expect(()=>validateOwnedConversationTarget({database,synthetic:true,caseIds},fixture.scenarios)).toThrow();
 }
});
it('does not let a model-only pilot count official or routing-context cases as complete workflows',()=>{
 for(const caseId of ['A10','A11','A17','A18','B01','B04','B09','B10']){
  expect(()=>validateOwnedConversationTarget({database:'yru_structured_schema_0123456789ab',synthetic:true,caseIds:[caseId]},fixture.scenarios)).toThrow('OWNED_WORKFLOW_CONTEXT_REQUIRED');
 }
});

it('admits RAG_HTML cases only with the explicit reviewed source workflow context',()=>{
 const target={database:'yru_structured_schema_0123456789ab',synthetic:true,caseIds:['A14'],ragContext:true};
 expect(validateOwnedConversationTarget(target,fixture.scenarios).map(s=>s.id)).toEqual(['A14']);
 expect(validateOwnedConversationTarget({...target,caseIds:['A15']},fixture.scenarios).map(s=>s.id)).toEqual(['A15']);
 expect(()=>validateOwnedConversationTarget({...target,caseIds:['A14','A15']},fixture.scenarios)).toThrow('OWNED_SOURCE_CASE_ISOLATION_REQUIRED');
 expect(()=>validateOwnedConversationTarget({...target,ragContext:false},fixture.scenarios)).toThrow('OWNED_WORKFLOW_CONTEXT_REQUIRED');
});

it('admits contextual and boundary workflows only behind their owned setup mode',()=>{
 const target={database:'yru_structured_schema_0123456789ab',synthetic:true,
  caseIds:['A17','B02','B03','B04','B05','B06','B08','B09','B10'],ownedWorkflowContext:true};
 expect(validateOwnedConversationTarget(target,fixture.scenarios).map(s=>s.id)).toEqual(target.caseIds);
 for(const caseId of target.caseIds){
  expect(()=>validateOwnedConversationTarget({...target,ownedWorkflowContext:false,caseIds:[caseId]},fixture.scenarios)).toThrow('OWNED_WORKFLOW_CONTEXT_REQUIRED');
 }
});
it('selects exact eligible frozen cases without changing prompts or their order',()=>{
 const selected=validateOwnedConversationTarget({database:'yru_structured_schema_0123456789ab',synthetic:true,caseIds:['A09','A01']},fixture.scenarios);
 expect(selected).toEqual([fixture.scenarios.find(s=>s.id==='A09'),fixture.scenarios.find(s=>s.id==='A01')]);
});

it('accepts only a single owned push or reply recipient shape',()=>{
 const target={lineUser:'controlled-user',replyToken:'controlled-reply'};
 expect(classifyOwnedEvaluationRecipient({to:target.lineUser},target)).toBe('OWNED_PUSH');
 expect(classifyOwnedEvaluationRecipient({replyToken:target.replyToken},target)).toBe('OWNED_REPLY');
 for(const body of [{to:'foreign-user',replyToken:target.replyToken},{to:target.lineUser,replyToken:'foreign-reply'},
  {to:target.lineUser,replyToken:target.replyToken},{to:undefined,replyToken:target.replyToken},{to:'foreign-user'},{}]){
  expect(classifyOwnedEvaluationRecipient(body,target)).toBeNull();
 }
});

it('admits only the explicitly seeded synthetic staff recipient for the HUMAN notification lane',()=>{
 const target={lineUser:'controlled-user',replyToken:'controlled-reply',staffLineUser:'controlled-staff'};
 expect(classifyOwnedEvaluationRecipient({to:target.staffLineUser},target)).toBe('OWNED_STAFF_PUSH');
 expect(classifyOwnedEvaluationRecipient({to:'foreign-staff'},target)).toBeNull();
 expect(classifyOwnedEvaluationRecipient({to:target.staffLineUser,replyToken:target.replyToken},target)).toBeNull();
});

it('requires complete ordered prior USER and delivered AI history on a follow-up turn',()=>{
 const expected=[
  {role:'USER',content:'มือถือ Android ต่อ Wi-Fi ไม่ได้'},
  {role:'AI',content:'ลองปิดเปิด Wi-Fi แล้วแจ้งผลอีกครั้ง'},
 ] as const;

 expect(matchesOwnedSentHistory([
  {role:'USER',content:'มือถือ Android ต่อ Wi-Fi ไม่ได้'},
  {role:'AI',content:'ลองปิดเปิด Wi-Fi แล้วแจ้งผลอีกครั้ง'},
 ],expected)).toBe(true);
 expect(matchesOwnedSentHistory([],expected)).toBe(false);
 expect(matchesOwnedSentHistory([{role:'USER',content:'มือถือ Android ต่อ Wi-Fi ไม่ได้'}],expected)).toBe(false);
 expect(matchesOwnedSentHistory([
  {role:'AI',content:'ลองปิดเปิด Wi-Fi แล้วแจ้งผลอีกครั้ง'},
  {role:'USER',content:'มือถือ Android ต่อ Wi-Fi ไม่ได้'},
 ],expected)).toBe(false);
 expect(matchesOwnedSentHistory([
  {role:'USER',content:'มือถือ Android ต่อ Wi-Fi ไม่ได้'},
  {role:'AI',content:'ลองปิดเปิด Wi-Fi แล้วแจ้งผลอีกครั้ง'},
  {role:'USER',content:'ลองแล้ว ยังเป็นเหมือนเดิม'},
 ],expected)).toBe(false);
 expect(matchesOwnedSentHistory([
  {role:'USER',content:'มือถือ Android ต่อ Wi-Fi ไม่ได้'},
  {role:'AI',content:'ลองปิดเปิด Wi-Fi'},
 ],expected)).toBe(false);
});

it('accepts empty observed history only when no prior turn is expected',()=>{
 expect(matchesOwnedSentHistory([],[])).toBe(true);
 expect(matchesOwnedSentHistory([{role:'USER',content:'มีประวัติ'}],[])).toBe(false);
});

it('rejects malformed or blank observed history entries',()=>{
 expect(matchesOwnedSentHistory(null,[{role:'USER',content:'ก่อนหน้า'}])).toBe(false);
 expect(matchesOwnedSentHistory([{role:'SYSTEM',content:'ไม่ได้ส่งให้ผู้ใช้'}],[{role:'USER',content:'ก่อนหน้า'}])).toBe(false);
 expect(matchesOwnedSentHistory([{role:'USER',content:'  '}],[{role:'USER',content:'  '}])).toBe(false);
});
