import type {DbClient} from '../tickets/authorization';
import {lockConversation} from '../tickets/authorization';
import type {DirectUserEvent} from '../line/events';
import {enqueueOutbound,type OutboundText} from '../queue/outbox';
import {routeConversation} from './router';
import {loadCandidates,candidateSnapshot} from './context-resolver';
import {createChoices,consumeChoice} from './quick-reply';
import {createEscalation} from '../tickets/create-ticket';
import {applyUserReply} from '../tickets/human-takeover';
import {prepareAIJob} from '../ai/jobs';
import {createTicketToolRegistry} from '../ai/backend-tools';
import {validateRoutingAdvice,type SemanticRoutingAdvice} from './semantic-routing';
import {loadSupportActionState} from '../ai/support-state';
import {confirmSupportSolved} from '../ai/support-actions';

export interface StudentProcessingOptions {aiEnabled?:boolean;routingAdvice?:SemanticRoutingAdvice}

export async function processStudentContent(client:DbClient,input:{sessionId:string;eventId:string;receivedAt:Date;event:DirectUserEvent},key:string,options:StudentProcessingOptions={}):Promise<string|null> {
 const {sessionId,eventId,event,receivedAt}=input;
 if(event.type!=='message'&&event.type!=='postback')return 'UNSUPPORTED_EVENT';
 const initial=await loadCandidates(client,sessionId);
 for(const candidate of [...initial].sort((a,b)=>a.conversationId.localeCompare(b.conversationId)))await lockConversation(client,candidate.conversationId);
 const candidates=await loadCandidates(client,sessionId),snapshot=candidateSnapshot(candidates);
 const replyToken=event.replyToken;
 let selected:string|undefined,newTopic=false,choice:Record<string,string>|undefined,pendingMessageId:string|null=null;
 if(event.type==='postback'){
  const consumed=await consumeChoice(client,sessionId,event.postback.data,snapshot,key);
  if(!consumed){await respond('ตัวเลือกนี้หมดอายุหรือถูกใช้แล้วครับ กรุณาส่งข้อความใหม่');return 'INVALID_CHOICE';}
  choice=consumed.choice;pendingMessageId=consumed.pendingMessageId;
  selected=choice.conversationId;newTopic=choice.action==='NEW';
  if(options.aiEnabled&&newTopic&&!pendingMessageId){
   await respond('ส่งคำถามเรื่องใหม่มาได้เลยครับ แล้วเลือกเริ่มเรื่องใหม่เมื่อระบบถามบริบท');return null;
  }
 }
 const semantic=event.type==='message'?await validateRoutingAdvice(client,input,options.routingAdvice):null;
 const decision=routeConversation({candidates,selectedConversationId:selected??semantic?.selectedConversationId,newTopic:newTopic||semantic?.newTopic,confidence:semantic?.confidence});
 let conversationId=selected;
 if(choice?.supportDigest){
  const state=conversationId?await loadSupportActionState(client,sessionId,conversationId,key):null;
  if(!state||state.stateDigest!==choice.supportDigest){await respond('ข้อมูลเรื่องนี้เปลี่ยนแล้วครับ กรุณาส่งข้อความใหม่เพื่อยืนยันอีกครั้ง');return 'INVALID_CHOICE';}
 }
 if(choice?.action==='SOLVED'){
  if(!conversationId||!choice.supportDigest||!await confirmSupportSolved(client,{sessionId,conversationId,eventId,stateDigest:choice.supportDigest},key)){
   await respond('ยังยืนยันผลของเรื่องนี้ไม่ได้ครับ กรุณาส่งรายละเอียดเพิ่มเติม');return 'INVALID_CHOICE';
  }
  await respond('ยืนยันว่าแก้ปัญหาได้แล้วครับ หากมีเรื่องอื่น ส่งคำถามใหม่ได้เลย');return null;
 }
 if(choice?.action==='CONTACT'){
  conversationId=choice.conversationId;
  if(!conversationId||!candidates.some(c=>c.conversationId===conversationId&&c.mode==='AI')){await respond('กรุณาเลือกเรื่องใหม่ก่อนส่งต่อเจ้าหน้าที่');return 'INVALID_CHOICE';}
  const departments=(await client.query('select code,name_th from public.departments where active order by code')).rows;
  const quickReply=await createChoices(client,{sessionId,snapshot,pendingMessageId:pendingMessageId??undefined,choices:departments.map(d=>({label:d.name_th,value:{action:'ESCALATE',conversationId:conversationId!,departmentCode:d.code,...(choice.supportDigest?{supportDigest:choice.supportDigest}:{})}}))},key);
  await respond('เลือกหน่วยงานที่ต้องการติดต่อครับ',quickReply);return null;
 }
 if(choice?.action==='ESCALATE'){
  if(!conversationId||!candidates.some(c=>c.conversationId===conversationId&&c.mode==='AI')){await respond('กรุณาเลือกเรื่องใหม่ก่อนส่งต่อเจ้าหน้าที่');return 'INVALID_CHOICE';}
  if((await client.query('select id from public.departments where code=$1 and active for share',[choice.departmentCode])).rowCount!==1){
   await respond('หน่วยงานนี้ยังไม่พร้อมรับเรื่องครับ กรุณากดติดต่อเจ้าหน้าที่เพื่อเลือกใหม่');return 'INVALID_CHOICE';
  }
  const last=(await client.query("select content from public.messages where conversation_id=$1 and sender_type='USER' order by created_at desc,id desc limit 1",[conversationId])).rows[0];
  const summary=Array.from(last?.content??'ติดต่อเจ้าหน้าที่').slice(0,1000).join('');
  if(options.aiEnabled||choice.supportDigest){
   const selectedContext=candidates.find(c=>c.conversationId===conversationId)!;
   await createTicketToolRegistry(client,key,eventId).execute({name:'create_ticket',arguments:{departmentCode:choice.departmentCode,summary}},
    {lineSessionId:sessionId,conversationId,conversationRevision:selectedContext.conversationRevision},['create_ticket']);
  }else await createEscalation(client,{sessionId,conversationId,departmentCode:choice.departmentCode,summary},key);
  return null;
 }
 if(event.type==='message'){
  if(decision.route==='AI_NEW'||decision.route==='ASK_CONTEXT'){
   conversationId=(await client.query("insert into public.conversations(line_session_id,conversation_type) values($1,$2) returning id",[sessionId,decision.route==='ASK_CONTEXT'?'SUPPORT':'GENERAL'])).rows[0].id;
  }else conversationId=decision.conversationId;
  if(!conversationId)throw new Error('ROUTE_CONTEXT_MISSING');
  const content=event.message.type==='text'?event.message.text:'[ไฟล์แนบ]';
  const stored=(await client.query("insert into public.messages(conversation_id,sender_type,message_type,content,line_message_id,source_event_id,metadata) values($1,'USER',$2,$3,$4,$5,$6) on conflict do nothing returning id",[conversationId,event.message.type==='image'?'IMAGE':event.message.type==='file'?'FILE':'TEXT',content,event.message.id,eventId,{routing_status:decision.route==='ASK_CONTEXT'?'PENDING':'ROUTED'}])).rows[0];
  if(!stored)return null;pendingMessageId=stored.id;
 }
 if(decision.route==='ASK_CONTEXT'){
  const quickReply=await createChoices(client,{sessionId,snapshot,pendingMessageId:pendingMessageId??undefined,choices:[
   {label:'เริ่มเรื่องใหม่',value:{action:'NEW'}},...candidates.slice(0,12).map(c=>({label:`ต่อ ${c.topicLabel}`,value:{action:'CONTINUE',conversationId:c.conversationId}})),
  ]},key);
  await respond('ข้อความนี้เป็นเรื่องใดครับ เลือกเรื่องเดิมหรือเริ่มเรื่องใหม่',quickReply);return null;
 }
 if(decision.route==='AI_NEW'&&event.type==='postback'){
  conversationId=(await client.query('insert into public.conversations(line_session_id) values($1) returning id',[sessionId])).rows[0].id;
 }
 if(!conversationId)conversationId=decision.conversationId;
 if(!conversationId)throw new Error('ROUTE_CONTEXT_MISSING');
 await lockConversation(client,conversationId);
 if(decision.route==='HUMAN_TICKET'&&decision.ticketId){
  if(pendingMessageId)await applyUserReply(client,sessionId,decision.ticketId,pendingMessageId);
  // No automatic AI response in HUMAN. Staff sees the routed message in the dashboard.
  return null;
 }
 if(pendingMessageId&&event.type==='postback'){
  await client.query("update public.messages set conversation_id=$2,metadata='{\"routing_status\":\"ROUTED\"}' where id=$1 and ticket_id is null and conversation_id in(select id from public.conversations where line_session_id=$3)",[pendingMessageId,conversationId,sessionId]);
 }
 const current=await loadCandidates(client,sessionId);
 const quickReply=await createChoices(client,{sessionId,snapshot:candidateSnapshot(current),pendingMessageId:options.aiEnabled?undefined:pendingMessageId??undefined,choices:[{label:'ติดต่อเจ้าหน้าที่',value:{action:'CONTACT',conversationId}},{label:'เริ่มเรื่องใหม่',value:{action:'NEW'}}]},key);
 if(options.aiEnabled&&pendingMessageId){
  const text=(await client.query("select id from public.messages where id=$1 and conversation_id=$2 and sender_type='USER' and message_type='TEXT' and metadata->>'routing_status'='ROUTED'",[pendingMessageId,conversationId])).rows[0];
  if(text){
   await prepareAIJob(client,{sessionId,conversationId,messageId:pendingMessageId,receivedAt,replyToken,quickReply},key);return null;
  }
 }
 await respond('ได้รับข้อความแล้วครับ เลือกติดต่อเจ้าหน้าที่หรือเริ่มเรื่องใหม่ได้ด้านล่าง',quickReply);
 return null;

 async function respond(text:string,quickReply?:OutboundText['quickReply']) {
  await enqueueOutbound(client,{idempotencyKey:`student-response:${eventId}`,channel:'STUDENT',kind:'SYSTEM',lineSessionId:sessionId,replyToken,receivedAt,messages:[{type:'text',text,...(quickReply?{quickReply}:{})}]},key);
 }
}
