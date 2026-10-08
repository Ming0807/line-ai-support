import {AIProviderError} from './types';
import {aiResultSchema,type AIResult} from './jobs';
import type {AIWorkerOptions} from './run-worker';
import {createSupportClassifier} from './support-classifier';
import {supportInputSchema,supportMetadataSchema,supportProposalSchema} from './support-contracts';
import {createKnowledgeProducer,type KnowledgeProducerOptions} from '../knowledge/answer-producer';
const unavailable='ตอนนี้ระบบยังวิเคราะห์บริบทเพื่อยืนยันคำตอบไม่ได้ครับ สามารถติดต่อเจ้าหน้าที่เพื่อให้ช่วยตรวจสอบได้';
/** Source metadata stays in the private job result. Provider input contains actual USER sources/public directory only. */
export function createSupportProducer(options:KnowledgeProducerOptions):AIWorkerOptions['produce']{
 const legacy=createKnowledgeProducer(options);
 return async(snapshot,signal)=>{
  if(!snapshot.support)return legacy(snapshot,signal);
  if(signal.aborted)throw new AIProviderError('CANCELLED');
  const s=snapshot.support,input=supportInputSchema.safeParse(s.input),c=s.context;
  if(!input.success||input.data.sources[0].text!==snapshot.question||c.sessionId!==snapshot.sessionId||c.conversationId!==snapshot.conversationId||
   c.messageId!==snapshot.messageId||c.revision!==snapshot.revision)return {kind:'CLARIFY',text:unavailable};
  let raw:unknown;
  const classify=createSupportClassifier(async call=>{const result=await options.generate({...call,conversationId:snapshot.conversationId});raw=result.output;return result;});
  const advice=await classify({question:input.data.sources[0].text,history:input.data.sources.slice(1).map(source=>({role:'user',content:source.text})),
   deliveredGuidance:input.data.deliveredGuidance},input.data.departments,signal,s.minimumSensitivity);
  if(signal.aborted)throw new AIProviderError('CANCELLED');
  const proposed=supportProposalSchema.safeParse(raw);
  if(!advice||!proposed.success)return {kind:'CLARIFY',text:unavailable};
  const metadata=supportMetadataSchema.safeParse({version:1,sourceDigest:s.sourceDigest,directoryDigest:s.directoryDigest,minimumSensitivity:s.minimumSensitivity,
   deliveredGuidance:input.data.deliveredGuidance,proposal:proposed.data});
  if(!metadata.success)return {kind:'CLARIFY',text:unavailable};
  let result:AIResult;
  if(advice.clarification)result={kind:'CLARIFY',text:advice.clarification};
  else if(advice.intent==='SOLVED')result={kind:'CLARIFY',text:advice.suggestSolved?'หากแก้ปัญหาได้แล้ว กรุณากดตัวเลือกแก้ได้แล้วเพื่อยืนยันครับ':'ยังไม่มีคำแนะนำที่ยืนยันการส่งสำเร็จสำหรับเรื่องนี้ครับ สามารถส่งรายละเอียดเพิ่มเติมหรือติดต่อเจ้าหน้าที่ได้'};
  else if(advice.intent==='ESCALATE')result={kind:'CLARIFY',text:'สามารถส่งรายละเอียดเรื่องนี้ให้เจ้าหน้าที่ตรวจสอบได้ครับ กรุณายืนยันหน่วยงานที่ต้องการส่งต่อ'};
  else if(advice.searchText){
   const problem=proposed.data.facts.find(fact=>fact.field==='PROBLEM'),original=problem?input.data.sources.find(source=>source.code===problem.source):undefined;
   // Never let a short problem quote erase explicit scope/year in the actual question or the selected original USER source.
   const question=advice.intent==='TROUBLESHOOT'&&original&&original.text!==snapshot.question?`${original.text}\n${snapshot.question}`:snapshot.question;
   result=await createKnowledgeProducer({...options,acceptedDepartmentCode:advice.departmentCode,
    retrievalQuery:advice.intent==='TROUBLESHOOT'?advice.searchText:snapshot.question})({...snapshot,question},signal);
  }
  else result={kind:'CLARIFY',text:'ช่วยอธิบายปัญหาหรือคำถามที่ต้องการให้ช่วยอีกนิดครับ'};
  const validated=aiResultSchema.safeParse({...result,support:metadata.data});
  return validated.success?validated.data:{kind:'CLARIFY',text:unavailable,support:metadata.data};
 };
}
