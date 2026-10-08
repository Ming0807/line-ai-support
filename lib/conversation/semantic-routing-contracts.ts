import {z} from 'zod';
import type {RouteCandidate} from './router';
const candidateCode=z.string().regex(/^C(?:[1-9]|1[0-2])$/u);
export const routingProposalSchema=z.strictObject({decision:z.enum(['NEW','CONTINUE','ASK']),candidateCode:candidateCode.nullable(),confidence:z.number().finite().min(0).max(1)})
 .refine(value=>value.decision==='CONTINUE'?value.candidateCode!==null:value.candidateCode===null);
export type RoutingProposal=z.infer<typeof routingProposalSchema>;
export interface SemanticCandidate extends RouteCandidate {topic:string|null;summary:string|null;history:{id:string;content:string;createdAt:string}[]}
const bounded=(text:string,max:number)=>text.slice(0,max).replace(/[\uD800-\uDBFF]$/u,'');
export function projectRoutingContext(candidates:SemanticCandidate[]){
 return candidates.slice(0,12).map((candidate,index)=>({code:`C${index+1}`,mode:candidate.mode,
  topic:candidate.topic===null?null:bounded(candidate.topic,200),summary:candidate.summary===null?null:bounded(candidate.summary,600),
  previousUserMessages:candidate.history.slice(-2).map(message=>bounded(message.content,300))}));
}
const context=z.strictObject({code:candidateCode,mode:z.enum(['AI','HUMAN']),topic:z.string().max(200).nullable(),summary:z.string().max(600).nullable(),previousUserMessages:z.array(z.string().max(300)).max(2)});
export const semanticPromptSchema=z.strictObject({question:z.string().trim().min(1).max(2000),contexts:z.array(context).max(12)})
 .refine(value=>new Set(value.contexts.map(c=>c.code)).size===value.contexts.length);
export type SemanticPrompt=z.infer<typeof semanticPromptSchema>;
export type SemanticClassifier=(input:SemanticPrompt,signal:AbortSignal)=>Promise<RoutingProposal|null>;
export function resolveRoutingProposal(input:unknown,candidates:SemanticCandidate[]):{newTopic:boolean;selectedConversationId?:string;confidence:number}|null{
 const parsed=routingProposalSchema.safeParse(input);
 if(!parsed.success||parsed.data.confidence<.8||parsed.data.decision==='ASK'||candidates.length>12)return null;
 const proposal=parsed.data;if(proposal.decision==='NEW')return {newTopic:true,confidence:proposal.confidence};
 const candidate=candidates[Number(proposal.candidateCode!.slice(1))-1];
 if(!candidate||(['RESOLVED','CLOSED','CANCELLED'].includes(candidate.ticketStatus??''))||
  (candidate.mode==='HUMAN'&&(!candidate.ticketId||candidate.ticketRevision===null||candidate.ticketStatus===null)))return null;
 return {selectedConversationId:candidate.conversationId,newTopic:false,confidence:proposal.confidence};
}
