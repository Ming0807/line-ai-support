import {z} from 'zod';
import {generalReplyEvidenceReason,type GeneralEvidenceReason} from './conversation-reply';

const part=z.string().min(1).max(12000).refine(text=>text.trim().length>0);
/** Repair wire format only. The normal decision/public result remains unchanged. */
export const mixedRepairResponseSchema=z.strictObject({decision:z.strictObject({action:z.enum(['MIXED_REPLY']),
 generalText:z.array(part).min(1).max(6).refine(parts=>parts.join(' ').length<=12000),
 query:z.string().min(1).max(4000).refine(text=>text.trim().length>0),
})});
interface Context {question:string;history:readonly {role:'user'|'assistant';content:string}[]}
interface Screened {
 decision:{action:'MIXED_REPLY';generalText:string;query:string}|null;
 acceptedParts:number;rejectedParts:number;reason:GeneralEvidenceReason|null;
}
/** Proposals stay unverified. Caller still binds and validates the complete reply. */
export function screenMixedRepair(output:unknown,context:Context):Screened|null{
 const parsed=mixedRepairResponseSchema.safeParse(output);if(!parsed.success)return null;
 const screen=(text:string)=>generalReplyEvidenceReason(text.replace(/\s+/gu,' '),context.question,context.history);
 const kept:string[]=[],reasons:GeneralEvidenceReason[]=[];
 for(const text of parsed.data.decision.generalText){
  const reason=screen(text);
  if(reason)reasons.push(reason);else kept.push(text);
 }
 // Space-joining and rescreening also rejects instructions distributed across
 // seemingly harmless fragments. No prefix clipping, rephrasing or canned fill.
 const text=kept.join(' '),joinedReason=screen(text);
 return {decision:text.trim()&&!joinedReason?{action:'MIXED_REPLY',generalText:text,query:parsed.data.decision.query}:null,
  acceptedParts:kept.length,rejectedParts:reasons.length,reason:joinedReason??(kept.length?null:reasons[0]??null)};
}
