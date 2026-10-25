interface OutboxTarget {
 channel:string;kind:string;lineSessionId?:string|null;recipientStaffId?:string|null;
 conversationId?:string|null;ticketId?:string|null;deliveryMode?:string;
}

/** Check again at dispatch: persistence and callers are separate trust boundaries. */
export function validateOutboxTarget(input:OutboxTarget):void {
 const allowed=input.channel==='STUDENT'
  ? ['AI','STAFF','SYSTEM','BATCH'].includes(input.kind)
  : input.channel==='STAFF'&&['NOTIFICATION','CONTROL','CHAT','ALERT','DIGEST'].includes(input.kind);
 if(!allowed)throw new Error('INVALID_OUTBOX_CHANNEL_KIND');
 if(input.channel==='STUDENT'){
  if(!input.lineSessionId||input.recipientStaffId)throw new Error('INVALID_OUTBOX_TARGET');
 }else if(!input.recipientStaffId||input.lineSessionId||input.conversationId||(input.kind==='CONTROL'?!!input.ticketId:!input.ticketId)||
  (input.deliveryMode!==undefined&&input.deliveryMode!=='PUSH'))throw new Error('INVALID_OUTBOX_TARGET');
}
