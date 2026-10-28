import type {TicketDetail,TicketListResult} from './tickets';

export type ChatDeliveryStatus='PENDING'|'PROCESSING'|'SENT'|'RETRY'|'UNKNOWN'|'DEAD'|'SUPPRESSED';
export interface ChatAttachment {id:string;name:string;mimeType:string;size:number;status:'PENDING'|'READY'|'FAILED';downloadUrl:string|null}
export interface ChatMessage {
 id:string;sequence:number;senderType:'USER'|'AI'|'STAFF'|'SYSTEM';staffName:string|null;
 content:string;createdAt:string;deliveryStatus:ChatDeliveryStatus|null;attachments:ChatAttachment[];
}
export interface ChatNote {id:string;text:string;staffName:string;createdAt:string}
export interface InboxListResult extends TicketListResult {unreadCounts:Record<string,number>;categories:string[]}
export interface InboxThreadResult {
 detail:TicketDetail;messages:ChatMessage[];notes:ChatNote[];latestSequence:number;
 readThroughSequence:number;hasMore:boolean;nextBefore:number|null;
}
