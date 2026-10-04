import { z } from 'zod';

const source=z.object({type:z.literal('user'),userId:z.string().regex(/^U[A-Za-z0-9]+$/).max(128)});
const messageId=z.string().min(1).max(256);
const message=z.discriminatedUnion('type',[
 z.object({type:z.literal('text'),id:messageId,text:z.string().min(1).max(20_000)}),
 z.object({type:z.enum(['image','file','video','audio','location','sticker']),id:messageId}),
]);

export const userEventSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('message'),source,message,replyToken:z.string().min(1).max(512).optional(),timestamp:z.number().int().nonnegative().optional()}),
 z.object({type:z.literal('follow'),source,replyToken:z.string().min(1).max(512).optional(),timestamp:z.number().int().nonnegative().optional()}),
 z.object({type:z.literal('unfollow'),source}),
 z.object({type:z.literal('postback'),source,postback:z.object({data:z.string().min(1).max(1024)}),replyToken:z.string().min(1).max(512).optional(),timestamp:z.number().int().nonnegative().optional()}),
]);
export type DirectUserEvent=z.infer<typeof userEventSchema>;
export type EventKind='MESSAGE'|'FOLLOW'|'UNFOLLOW'|'OTHER'|'UNKNOWN';

/** Only non-sensitive event classification leaves the encrypted payload. */
export function classifyEventKind(value:unknown):EventKind {
 const parsed=userEventSchema.safeParse(value);
 if(!parsed.success) return 'OTHER';
 return parsed.data.type==='message'?'MESSAGE':parsed.data.type==='follow'?'FOLLOW':parsed.data.type==='unfollow'?'UNFOLLOW':'OTHER';
}
