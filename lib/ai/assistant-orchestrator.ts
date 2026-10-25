import {AIProviderError} from './types';
import type {AIWorkerOptions} from './run-worker';
import type {createAssistantDecision,AssistantHandoffReason} from './assistant-decision';
import {createConversationReply,generalReplyNeedsEvidence,generalReplyEvidenceReason} from './conversation-reply';
interface Options {
 decide:ReturnType<typeof createAssistantDecision>;
 /** The configured production path may correct one schema-valid rejected prose proposal. */
 repairRejectedGeneral?:boolean;
 /** Candidate path: disregard UNSENT MIXED prose and compose once after official lookup. */
 composeMixed?:(snapshot:Parameters<AIWorkerOptions['produce']>[0],official:Awaited<ReturnType<AIWorkerOptions['produce']>>,signal:AbortSignal)=>Promise<string|null>;
 /** Optional model text affects retrieval ranking only; the snapshot retains all authority. */
 lookup(snapshot:Parameters<AIWorkerOptions['produce']>[0],signal:AbortSignal,retrievalHint?:string):ReturnType<AIWorkerOptions['produce']>;
 handoff(snapshot:Parameters<AIWorkerOptions['produce']>[0],signal:AbortSignal,reason:AssistantHandoffReason):ReturnType<AIWorkerOptions['produce']>;
}
const failedReply=()=>({kind:'CLARIFY' as const,text:'ตอนนี้บริการ AI ตอบคำถามนี้ไม่สำเร็จครับ ลองส่งอีกครั้งได้ โดยยังไม่มีการส่งเรื่องให้เจ้าหน้าที่'});
// Disclose partial delivery without passing rejected prose or inventing replacement advice.
const partialGeneralText='ผมยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบอย่างมั่นใจครับ จึงยังไม่ยืนยันส่วนนั้น ส่วนข้อมูลทางการมีผลการตรวจสอบดังนี้ครับ';
/** Decisions propose routes; existing backend producers retain evidence/action authority. */
export function createAssistantOrchestrator(options:Options):AIWorkerOptions['produce']{
 return async(snapshot,signal)=>{
  if(signal.aborted)throw new AIProviderError('CANCELLED');
  try{
   let {decision}=await options.decide({question:snapshot.question,history:snapshot.history},signal);
   if(signal.aborted)throw new AIProviderError('CANCELLED');
   if(decision.action==='MIXED_REPLY'&&options.composeMixed){
    const official=await options.lookup(snapshot,signal,decision.query);
    if(signal.aborted)throw new AIProviderError('CANCELLED');
    if(official.kind==='CONVERSATION'||official.kind==='MIXED'||official.support)return official;
    let text:string|null=null;
    try{text=await options.composeMixed(snapshot,official,signal);}
    catch{if(signal.aborted)throw new AIProviderError('CANCELLED');}
    if(signal.aborted)throw new AIProviderError('CANCELLED');
    const general=(text===null?null:createConversationReply(snapshot,text))??createConversationReply(snapshot,partialGeneralText);
    return general?{kind:'MIXED',general,official}:official;
   }
   let repaired=false;
   if(options.repairRejectedGeneral&&(decision.action==='GENERAL_REPLY'||decision.action==='CLARIFY'||decision.action==='MIXED_REPLY')){
    const reason=generalReplyEvidenceReason(decision.action==='MIXED_REPLY'?decision.generalText:decision.text,snapshot.question,snapshot.history);
    if(reason){
     const wasMixed=decision.action==='MIXED_REPLY';
     const corrected=await options.decide({question:snapshot.question,history:snapshot.history},signal,{reason,rejectedProposal:decision});
     if(signal.aborted)throw new AIProviderError('CANCELLED');
     if(wasMixed&&corrected.decision.action!=='MIXED_REPLY')return failedReply();
     decision=corrected.decision;repaired=true;
    }
   }
   if(decision.action==='MIXED_REPLY'){
    const general=createConversationReply(snapshot,decision.generalText)??createConversationReply(snapshot,partialGeneralText);
    let official:Awaited<ReturnType<AIWorkerOptions['produce']>>;
    try{official=await options.lookup(snapshot,signal,decision.query);}
    catch(error){
     if(signal.aborted||error instanceof AIProviderError&&error.code==='CANCELLED')throw new AIProviderError('CANCELLED');
     official={kind:'CLARIFY',text:'ส่วนข้อมูลของมหาวิทยาลัยยังตรวจสอบไม่สำเร็จครับ กรุณาลองถามส่วนนี้อีกครั้ง ผมยังยืนยันข้อมูลทางการไม่ได้'};
    }
    if(signal.aborted)throw new AIProviderError('CANCELLED');
    if(!general||official.kind==='CONVERSATION'||official.kind==='MIXED'||official.support)return official;
    return {kind:'MIXED',general,official};
   }
   if(decision.action==='GENERAL_REPLY'){
    const reply=createConversationReply(snapshot,decision.text);
    if(reply)return reply;
    if(repaired)return failedReply();
    if(generalReplyNeedsEvidence(decision.text,snapshot.question,snapshot.history))return await options.lookup(snapshot,signal);
    return {kind:'CLARIFY',text:'คำตอบยาวเกินขนาดที่ส่งครบในครั้งเดียวครับ กรุณาแยกคำถามเป็นประเด็น ผมจะช่วยตอบทีละส่วน'};
   }
   if(decision.action==='LOOKUP')return await options.lookup(snapshot,signal,decision.query);
   if(decision.action==='HANDOFF')return await options.handoff(snapshot,signal,decision.reason);
   // Polite information requests need not contain interrogatives or punctuation.
   // This recognizes reply grammar only; the shared evidence screen still owns claims.
   // Typed intent needs no second language classifier. Schema, source binding and
   // the same official-claim/action screen still authorize every delivered reply.
   const clarification=createConversationReply(snapshot,decision.text);
   if(!clarification&&repaired)return failedReply();
   if(!clarification)return await options.lookup(snapshot,signal);
   return clarification;
  }catch(error){
   if(signal.aborted||error instanceof AIProviderError&&error.code==='CANCELLED')throw new AIProviderError('CANCELLED');
   return failedReply();
  }
 };
}
