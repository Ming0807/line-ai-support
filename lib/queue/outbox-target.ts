interface OutboxTarget {
 channel:string;kind:string;lineSessionId?:string|null;recipientStaffId?:string|null;
 conversationId?:string|null;ticketId?:string|null;deliveryMode?:string;
}

/** Check again at dispatch: persistence and callers are separate trust boundaries. */
export function validateOutboxTarget(input:OutboxTarget):void {
 const allowed=input.channel==='STUDENT'
  ? ['AI','STAFF','SYSTEM'].includes(input.kind)
  : input.channel==='STAFF'&&input.kind==='NOTIFICATION';
 if(!allowed)throw new Error('INVALID_OUTBOX_CHANNEL_KIND');
 if(input.channel==='STUDENT'){
  if(!input.lineSessionId||input.recipientStaffId)throw new Error('INVALID_OUTBOX_TARGET');
 }else if(!input.recipientStaffId||input.lineSessionId||input.conversationId||!input.ticketId||
  (input.deliveryMode!==undefined&&input.deliveryMode!=='PUSH'))throw new Error('INVALID_OUTBOX_TARGET');
}
