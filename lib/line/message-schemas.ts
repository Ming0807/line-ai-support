import {z} from 'zod';

const postback=z.strictObject({type:z.literal('postback'),label:z.string().min(1).max(20),
 data:z.string().min(1).max(300),displayText:z.string().max(300).optional()});
const dashboardUri=z.string().min(1).max(1000).refine(value=>{
 if(value.trim()!==value||/[\p{Cc}]/u.test(value))return false;
 try{const url=new URL(value);return !url.username&&!url.password&&(url.protocol==='https:'||
  url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname));}catch{return false;}
});
const uri=z.strictObject({type:z.literal('uri'),label:z.string().min(1).max(20),uri:dashboardUri});
export const lineQuickReplySchema=z.strictObject({items:z.array(z.strictObject({type:z.literal('action'),
 action:z.discriminatedUnion('type',[postback,uri])})).min(1).max(13)});
export const lineTextMessageSchema=z.strictObject({type:z.literal('text'),text:z.string().min(1).max(5000),
 quickReply:lineQuickReplySchema.optional()});
export const lineMessagesSchema=z.array(lineTextMessageSchema).min(1).max(5);
export type LineMessage=z.infer<typeof lineTextMessageSchema>;
