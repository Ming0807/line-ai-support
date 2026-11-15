import 'server-only';
import {z} from 'zod';
import {CHAT_MEDIA_MAX_BYTES,normalizeChatMediaName} from './media-binary';

/** Only server-resolved Staff identity is accepted; recipient/storage references are never client input. */
export const staffOutboundDraftInputSchema=z.strictObject({
 staffId:z.uuid(),ticketId:z.uuid(),requestId:z.uuid(),revision:z.number().int().safe().nonnegative(),
 name:z.string().min(1).max(360),mimeType:z.enum(['image/jpeg','image/png','application/pdf']),
 byteLength:z.number().int().safe().min(1).max(CHAT_MEDIA_MAX_BYTES),checksum:z.string().regex(/^[a-f0-9]{64}$/u),
}).transform(value=>({...value,name:normalizeChatMediaName(value.name,value.mimeType==='application/pdf'?'FILE':'IMAGE')}));
export type StaffOutboundDraftInput=z.input<typeof staffOutboundDraftInputSchema>;
