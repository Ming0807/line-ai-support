import {z} from 'zod';
import {prioritySchema} from '../../types/tickets';
export const assistInputSchema=z.strictObject({revision:z.number().int().min(0).max(2147483647)});
const text=(max:number)=>z.string().trim().min(1).max(max);
export const assistOutputSchema=z.strictObject({ticketSummary:text(1500),conversationSummary:text(2000),replyDraft:text(3500),
 suggestedDepartmentCode:z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).nullable(),suggestedPriority:prioritySchema,
 reason:text(1000),uncertainties:z.array(text(500)).max(6)});
export type AssistOutput=z.infer<typeof assistOutputSchema>;
export const assistViewSchema=z.strictObject({revision:z.number().int().nonnegative(),advice:assistOutputSchema,historyTruncated:z.boolean(),knowledgeStatus:z.literal('NOT_SEARCHED')});
export type AssistView=z.infer<typeof assistViewSchema>;
interface Source {summary:string;category:string;priority:string;messages:{sender_type:string;content:string}[];departments:{code:string;name:string}[]}
export function projectAssistSource(source:Source){
 let truncated=source.messages.length>32||source.summary.length>2000,budget=10000;
 const messages:{sender:string;content:string}[]=[];
 for(const row of source.messages.slice(-32).reverse()){
  if(budget===0){truncated=true;break;}
  let content=row.content.slice(0,Math.min(1600,budget));
  if(/[\uD800-\uDBFF]$/.test(content))content=content.slice(0,-1);
  if(content.length<row.content.length)truncated=true;budget-=content.length;messages.unshift({sender:row.sender_type,content});
 }
 return {summary:source.summary.slice(0,2000),category:source.category,priority:source.priority,messages,
  departments:source.departments.map(d=>({code:d.code,name:d.name.slice(0,100)})),truncated};
}
export class AssistError extends Error {constructor(public code:'INVALID_REQUEST'|'NOT_FOUND'|'CONFLICT'|'UNAVAILABLE'){super(code);}}
