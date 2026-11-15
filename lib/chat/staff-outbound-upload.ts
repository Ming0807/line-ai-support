import 'server-only';
import {ChatMediaError,inspectChatMedia} from './media-binary';
import type {StaffOutboundStorage} from './media-storage';
import {sealStaffOutbound} from './staff-outbound-binary';
import type {StaffOutboundDraftInput} from './staff-outbound-contracts';
import type {StaffOutboundReservation} from './staff-outbound-drafts';

/** Every effect is injected so ordering (verify → reserve → Storage outside SQL → finalize) is testable. */
export type StaffOutboundUploadDeps={
 key:string;
 begin(input:StaffOutboundDraftInput):Promise<StaffOutboundReservation>;
 finish(input:{staffId:string;ticketId:string;attachmentId:string;leaseToken:string}):Promise<boolean>;
 release(input:{attachmentId:string;leaseToken:string}):Promise<unknown>;
 storage:StaffOutboundStorage;
 verifyPdf(bytes:Uint8Array):Promise<void>;
 verifyImage(bytes:Uint8Array,mimeType:string):Promise<void>;
};
export type StaffOutboundUploadInput={staffId:string;ticketId:string;requestId:string;revision:number;name:string;
 contentType:string;declaredChecksum:string;bytes:Uint8Array};

/**
 * Creates a private READY draft. It never attaches the file to a message or contacts LINE; READY
 * only means the encrypted bytes are stored for this case, Staff member and recipient snapshot.
 */
export async function uploadStaffOutboundAttachment(deps:StaffOutboundUploadDeps,input:StaffOutboundUploadInput):Promise<{status:'READY'|'FAILED';attachmentId:string}>{
 const declared=input.contentType.split(';',1)[0].trim().toLowerCase();
 const kind=declared==='application/pdf'?'FILE':declared==='image/jpeg'||declared==='image/png'?'IMAGE':null;
 if(!kind)throw new ChatMediaError('UNSUPPORTED_TYPE');
 // The exact declared type is required here (no octet-stream fallback as for LINE downloads).
 const inspected=inspectChatMedia(input.bytes,declared,kind);
 if(inspected.mimeType!==declared)throw new ChatMediaError('UNSUPPORTED_TYPE');
 // A body cut short by the proxy buffer, or altered in transit, cannot match the browser's digest.
 if(inspected.checksum!==input.declaredChecksum)throw new ChatMediaError('INVALID_ATTACHMENT');
 if(inspected.mimeType==='application/pdf')await deps.verifyPdf(input.bytes);else await deps.verifyImage(input.bytes,inspected.mimeType);
 const reservation=await deps.begin({staffId:input.staffId,ticketId:input.ticketId,requestId:input.requestId,revision:input.revision,
  name:input.name,mimeType:inspected.mimeType,byteLength:inspected.byteLength,checksum:inspected.checksum});
 if(reservation.status!=='UPLOADING')return {status:reservation.status,attachmentId:reservation.attachmentId};
 const ref={attachmentId:reservation.attachmentId,objectId:reservation.objectId,ticketId:input.ticketId,
  mimeType:inspected.mimeType,byteLength:inspected.byteLength,checksum:inspected.checksum};
 try{await deps.storage.put(ref,sealStaffOutbound(input.bytes,ref,deps.key));}
 catch{
  await deps.release({attachmentId:reservation.attachmentId,leaseToken:reservation.leaseToken}).catch(()=>undefined);
  throw new ChatMediaError('UNAVAILABLE');
 }
 if(!await deps.finish({staffId:input.staffId,ticketId:input.ticketId,attachmentId:reservation.attachmentId,leaseToken:reservation.leaseToken}))
  throw new ChatMediaError('STALE_LEASE');
 return {status:'READY',attachmentId:reservation.attachmentId};
}
