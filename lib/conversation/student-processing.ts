import type {DbClient} from '../tickets/authorization';
import {lockConversation} from '../tickets/authorization';
import type {DirectUserEvent} from '../line/events';
import {enqueueOutbound,type OutboundText} from '../queue/outbox';
import {routeConversation} from './router';
import {loadCandidates,candidateSnapshot} from './context-resolver';
import {createChoices,consumeChoice,consumeTypedRouteChoice,isTypedRouteNavigation,latestPendingRouteSource,contextChoiceOptions,contextChoiceText} from './quick-reply';
import {createEscalation} from '../tickets/create-ticket';
import {applyUserReply} from '../tickets/human-takeover';
import {prepareAIJob} from '../ai/jobs';
import {createTicketToolRegistry} from '../ai/backend-tools';
import {validateRoutingAdvice,type SemanticRoutingAdvice} from './semantic-routing';
import type {RoutingDecisionObservation} from './routing-telemetry';
import {routingLatency} from './routing-telemetry';
import {loadSupportActionState} from '../ai/support-state';
import {confirmSupportSolved} from '../ai/support-actions';
import {consumeTypedSupportConfirmation,isTypedSupportConfirmation} from './support-confirmation';
import {readExplicitHumanFocus,rememberExplicitHumanFocus,clearExplicitHumanFocus,readExplicitNewTopic,rememberExplicitNewTopic} from './explicit-focus';
import {registerStudentChatAttachment} from '../chat/media-repository';

export interface StudentProcessingOptions {aiEnabled?:boolean;routingAdvice?:SemanticRoutingAdvice;routingUnavailable?:boolean;
 routingObservation?:(observation:RoutingDecisionObservation)=>void}

export async function processStudentContent(client:DbClient,input:{sessionId:string;eventId:string;receivedAt:Date;event:DirectUserEvent},key:string,options:StudentProcessingOptions={}):Promise<string|null> {
 const {sessionId,eventId,event,receivedAt}=input;
 if(event.type!=='message'&&event.type!=='postback')return 'UNSUPPORTED_EVENT';
 if(event.type==='message'&&(await client.query('select id from public.messages where line_message_id=$1',[event.message.id])).rowCount)return null;
 const initial=await loadCandidates(client,sessionId);
 for(const candidate of [...initial].sort((a,b)=>a.conversationId.localeCompare(b.conversationId)))await lockConversation(client,candidate.conversationId);
 const candidates=await loadCandidates(client,sessionId),snapshot=candidateSnapshot(candidates);
 const replyToken=event.replyToken;
 let selected:string|undefined,newTopic=false,choice:Record<string,string>|undefined,pendingMessageId:string|null=null;
 let typedChoice=false;
 if(event.type==='message'&&event.message.type==='text'){
  if(isTypedSupportConfirmation(event.message.text)){
   const confirmation=await consumeTypedSupportConfirmation(client,sessionId,event.message.text,candidates,key,receivedAt);
   if(!confirmation){await respond('ยังไม่มีข้อเสนอส่งต่อที่ยืนยันได้ครับ กรุณากดตัวเลือกจากข้อความล่าสุดหรือส่งรายละเอียดใหม่');return 'INVALID_CHOICE';}
   choice=confirmation.choice;selected=choice.conversationId;typedChoice=true;
   await client.query(`insert into public.messages(conversation_id,sender_type,message_type,content,line_message_id,source_event_id,metadata)
    values($1,'USER','TEXT',$2,$3,$4,$5)`,[selected,event.message.text,event.message.id,eventId,{routing_status:'ROUTE_CONTROL',support_choice_hash:confirmation.tokenHash}]);
  }
  if(!typedChoice){
  const consumed=await consumeTypedRouteChoice(client,sessionId,event.message.text,candidates);
  if(consumed){
   choice=consumed.choice;pendingMessageId=consumed.pendingMessageId;selected=choice.conversationId;newTopic=choice.action==='NEW';typedChoice=true;
   const control=await client.query(`insert into public.messages(conversation_id,sender_type,message_type,content,line_message_id,source_event_id,metadata)
    select m.conversation_id,'USER','TEXT',$2,$3,$4,'{"routing_status":"ROUTE_CONTROL"}'::jsonb from public.messages m
    join public.conversations c on c.id=m.conversation_id where m.id=$1 and c.line_session_id=$5 and m.metadata->>'routing_status'='PENDING'
    and m.ticket_id is null on conflict do nothing returning id`,[pendingMessageId,event.message.text,event.message.id,eventId,sessionId]);
   if(control.rowCount!==1)throw new Error('TYPED_ROUTE_SOURCE_CHANGED');
   if(newTopic)await clearExplicitHumanFocus(client,sessionId);
  }else if(isTypedRouteNavigation(event.message.text,candidates)){
   const source=await latestPendingRouteSource(client,sessionId);
   const controlConversation=source?.conversation_id??(await client.query("insert into public.conversations(line_session_id,conversation_type) values($1,'SUPPORT') returning id",[sessionId])).rows[0].id;
   await client.query(`insert into public.messages(conversation_id,sender_type,message_type,content,line_message_id,source_event_id,metadata)
    values($1,'USER','TEXT',$2,$3,$4,'{"routing_status":"ROUTE_CONTROL"}'::jsonb)`,[controlConversation,event.message.text,event.message.id,eventId]);
   const quickReply=await createChoices(client,{sessionId,snapshot,pendingMessageId:source?.id,choices:source?contextChoiceOptions(candidates):[{label:'เริ่มเรื่องใหม่',value:{action:'NEW'}}]},key);
   await respond(source?contextChoiceText('ตัวเลือกเดิมใช้ไม่ได้แล้วครับ กรุณากดเลือกด้านล่างเพื่อส่งคำถามเดิมเข้าหัวข้อที่ต้องการ',candidates):
    'ยังไม่มีคำถามที่รอเลือกเรื่องครับ ส่งคำถามมาได้เลย หรือกด “เริ่มเรื่องใหม่” ก่อนส่งคำถาม',quickReply);
   return 'INVALID_CHOICE';
  }
  }
 }
 if(event.type==='postback'){
  const consumed=await consumeChoice(client,sessionId,event.postback.data,snapshot,key);
  if(!consumed){await respond('ตัวเลือกนี้หมดอายุหรือถูกใช้แล้วครับ กรุณาส่งข้อความใหม่');return 'INVALID_CHOICE';}
  choice=consumed.choice;pendingMessageId=consumed.pendingMessageId;
  if(choice.action==='ROUTE_PAGE'){
   const page=typeof choice.page==='string'&&/^(0|[1-9]\d{0,3})$/u.test(choice.page)?Number(choice.page):-1;
   const source=await latestPendingRouteSource(client,sessionId);
   if(!source||source.id!==pendingMessageId||page<0||page>=(candidates.length<=12?1:Math.ceil(candidates.length/10))){
    await respond('รายการเรื่องเปลี่ยนแล้วครับ ส่งคำถามมาได้เลย');return 'INVALID_CHOICE';
   }
   const quickReply=await createChoices(client,{sessionId,snapshot,pendingMessageId:source.id,choices:contextChoiceOptions(candidates,page)},key);
   await respond(contextChoiceText('เลือกชื่อเรื่องที่ต้องการต่อครับ หรือพิมพ์คำถามเพิ่มเติมได้เลย',candidates,page),quickReply);return null;
  }
  selected=choice.conversationId;newTopic=choice.action==='NEW';
  if(newTopic)await clearExplicitHumanFocus(client,sessionId);
  if(newTopic&&!pendingMessageId){
   await rememberExplicitNewTopic(client,sessionId);
   await respond('ส่งคำถามเรื่องใหม่มาได้เลยครับ');return null;
  }
 }
 const requestedNew=event.type==='message'&&!typedChoice&&await readExplicitNewTopic(client,sessionId);
 if(requestedNew)await clearExplicitHumanFocus(client,sessionId);
 const semantic=event.type==='message'&&!typedChoice?await validateRoutingAdvice(client,input,options.routingAdvice,key):null;
 const focus=event.type==='message'?await readExplicitHumanFocus(client,sessionId,candidates):null;
 const decisionStart=Date.now();
 const decision=routeConversation({candidates,selectedConversationId:selected??semantic?.selectedConversationId??(!semantic?focus?.conversationId:undefined),newTopic:newTopic||requestedNew||semantic?.newTopic,confidence:semantic?.confidence});
 options.routingObservation?.({stage:'DECISION',status:decision.route==='ASK_CONTEXT'?'SKIPPED':'SUCCESS',reasonCode:decision.reason.toUpperCase(),
  candidates:candidates.length,latencyMs:routingLatency(decisionStart)});
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
  const last=(await client.query("select content from public.messages where conversation_id=$1 and sender_type='USER' and metadata->>'routing_status' is distinct from 'ROUTE_CONTROL' order by created_at desc,id desc limit 1",[conversationId])).rows[0];
  const summary=Array.from(last?.content??'ติดต่อเจ้าหน้าที่').slice(0,1000).join('');
  if(options.aiEnabled||choice.supportDigest){
   const selectedContext=candidates.find(c=>c.conversationId===conversationId)!;
   await createTicketToolRegistry(client,key,eventId).execute({name:'create_ticket',arguments:{departmentCode:choice.departmentCode,summary}},
    {lineSessionId:sessionId,conversationId,conversationRevision:selectedContext.conversationRevision},['create_ticket']);
  }else await createEscalation(client,{sessionId,conversationId,departmentCode:choice.departmentCode,summary},key);
  return null;
 }
 if(event.type==='message'&&!typedChoice){
  if(decision.route==='AI_NEW'||decision.route==='ASK_CONTEXT'){
   conversationId=(await client.query("insert into public.conversations(line_session_id,conversation_type) values($1,$2) returning id",[sessionId,decision.route==='ASK_CONTEXT'?'SUPPORT':'GENERAL'])).rows[0].id;
  }else conversationId=decision.conversationId;
  if(!conversationId)throw new Error('ROUTE_CONTEXT_MISSING');
  const mediaLabels={image:'[ไฟล์แนบ]',file:'[ไฟล์แนบ]',sticker:'[สติกเกอร์]',audio:'[ข้อความเสียง]',video:'[วิดีโอ]',location:'[ตำแหน่งที่ตั้ง]'};
  const content=event.message.type==='text'?event.message.text:mediaLabels[event.message.type];
  // A display representation of unsupported media is not a Student text question.
  // Keep the durable original event; no media understanding/download is claimed.
  const messageType=event.message.type==='text'?'TEXT':event.message.type==='image'?'IMAGE':event.message.type==='file'?'FILE':'SYSTEM';
  const stored=(await client.query("insert into public.messages(conversation_id,sender_type,message_type,content,line_message_id,source_event_id,metadata) values($1,'USER',$2,$3,$4,$5,$6) on conflict do nothing returning id",[conversationId,messageType,content,event.message.id,eventId,{routing_status:decision.route==='ASK_CONTEXT'?'PENDING':'ROUTED',routing_route:decision.route,
   ...(event.message.type==='text'?{}:{source_message_type:event.message.type})}])).rows[0];
  if(!stored)return null;pendingMessageId=stored.id;
  if(event.message.type==='image'||event.message.type==='file')await registerStudentChatAttachment(client,{messageId:stored.id,sourceEventId:eventId},key);
 }
 if(decision.route==='ASK_CONTEXT'){
  const quickReply=await createChoices(client,{sessionId,snapshot,pendingMessageId:pendingMessageId??undefined,choices:contextChoiceOptions(candidates)},key);
  const text=options.routingUnavailable
   ?'ระบบ AI ไม่พร้อมเชื่อมต่อเรื่องที่คุยชั่วคราวครับ ข้อความของคุณยังอยู่ เลือกเรื่องเดิมหรือเริ่มเรื่องใหม่จากปุ่มด้านล่างได้ โดยไม่ต้องพิมพ์ข้อความเดิมซ้ำ'
   :'ข้อความนี้เป็นเรื่องใดครับ เลือกเรื่องเดิมหรือเริ่มเรื่องใหม่';
  await respond(contextChoiceText(text,candidates),quickReply);return options.routingUnavailable?'ROUTING_UNAVAILABLE':null;
 }
 if(decision.route==='AI_NEW'&&(event.type==='postback'||typedChoice)){
  conversationId=(await client.query('insert into public.conversations(line_session_id) values($1) returning id',[sessionId])).rows[0].id;
 }
 if(!conversationId)conversationId=decision.conversationId;
 if(!conversationId)throw new Error('ROUTE_CONTEXT_MISSING');
 await lockConversation(client,conversationId);
 if(decision.route==='HUMAN_TICKET'&&decision.ticketId){
  if(pendingMessageId){
   await applyUserReply(client,sessionId,decision.ticketId,pendingMessageId,key);
   const explicit=choice?.action==='CONTINUE',inherited=focus?.conversationId===conversationId?focus:null;
   if(explicit||inherited){
    await rememberExplicitHumanFocus(client,sessionId,pendingMessageId,decision.ticketId,explicit?undefined:inherited??undefined);
    const current=await loadCandidates(client,sessionId),label=current.find(c=>c.ticketId===decision.ticketId)?.topicLabel??'ที่เลือก';
    const quickReply=await createChoices(client,{sessionId,snapshot:candidateSnapshot(current),choices:[{label:'เริ่มเรื่องใหม่',value:{action:'NEW'}}]},key);
    await respond(`ส่งข้อความเข้าเรื่อง ${label} แล้วครับ เจ้าหน้าที่จะเห็นข้อความในระบบ\nข้อความถัดไปจะต่อเรื่องนี้ชั่วคราว หากต้องการถามเรื่องอื่น กด “เริ่มเรื่องใหม่”`,quickReply);
   }else await respond('บันทึกข้อความเข้าเคสที่กำลังคุยกับเจ้าหน้าที่แล้วครับ เจ้าหน้าที่จะเห็นข้อความนี้ในระบบ');
  }
  // Fixed receipts and scoped Staff alerts are separate from forbidden AI answers in HUMAN.
  return null;
 }
 if(pendingMessageId&&(event.type==='postback'||typedChoice)){
  await client.query("update public.messages set conversation_id=$2,metadata=$4::jsonb where id=$1 and ticket_id is null and conversation_id in(select id from public.conversations where line_session_id=$3)",[pendingMessageId,conversationId,sessionId,{routing_status:'ROUTED',routing_route:decision.route,routing_input_event_id:eventId}]);
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
