import type {TicketDetail,TicketListResult} from './tickets';

export type ChatDeliveryStatus='PENDING'|'PROCESSING'|'SENT'|'RETRY'|'UNKNOWN'|'DEAD'|'SUPPRESSED';
export interface ChatAttachment {id:string;name:string;mimeType:string;size:number;status:'PENDING'|'READY'|'FAILED';downloadUrl:string|null}
/** CHAT-MEDIA-02H (DEC-205): Student-side state of a confirmed Staff file, derived on the server. */
export type StudentAttachmentAccess='WAITING_DELIVERY'|'AVAILABLE'|'EXPIRED'|'REVOKED'|'NOT_DELIVERED';
export interface OutboundAttachmentView {
 id:string;name:string;mimeType:'application/pdf'|'image/jpeg'|'image/png';size:number;studentAccess:StudentAttachmentAccess;canRevoke:boolean;
}
export interface ChatMessage {
 id:string;sequence:number;senderType:'USER'|'AI'|'STAFF'|'SYSTEM';staffName:string|null;
 content:string;createdAt:string;deliveryStatus:ChatDeliveryStatus|null;attachments:ChatAttachment[];
 /** Only on the STAFF message that confirmed an outbound file. */
 outboundAttachment?:OutboundAttachmentView|null;
}
export interface ChatNote {id:string;text:string;staffName:string;createdAt:string}
export interface InboxListResult extends TicketListResult {unreadCounts:Record<string,number>;categories:string[]}
export interface InboxThreadResult {
 detail:TicketDetail;messages:ChatMessage[];notes:ChatNote[];latestSequence:number;
 readThroughSequence:number;hasMore:boolean;nextBefore:number|null;
 outboundFiles?:{enabled:boolean};
}
