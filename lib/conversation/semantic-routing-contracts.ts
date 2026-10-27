import {z} from 'zod';
import type {RouteCandidate} from './router';
import type {AIErrorCode} from '../ai/types';
/** Sanitized infrastructure outcome; never a semantic proposal or routing authority. */
export class SemanticRoutingUnavailableError extends Error {
 constructor(readonly reason:AIErrorCode|'CONTEXT_LIMIT'|'PROMPT_LIMIT'){super('ROUTING_UNAVAILABLE');this.name='SemanticRoutingUnavailableError';}
}
export const SEMANTIC_CANDIDATE_LIMIT=64;
export const SEMANTIC_PROMPT_LIMIT=19000;
const candidateCode=z.string().regex(/^C(?:[1-9]|[1-5][0-9]|6[0-4])$/u);
export const routingProposalSchema=z.strictObject({decision:z.enum(['NEW','CONTINUE','ASK']),candidateCode:candidateCode.nullable(),confidence:z.number().finite().min(0).max(1)})
 .refine(value=>value.decision==='CONTINUE'?value.candidateCode!==null:value.candidateCode===null);
export type RoutingProposal=z.infer<typeof routingProposalSchema>;
export const SEMANTIC_ROUTE_TIMEOUT_MS=25000;
export function routingInferenceBudgetMs(remainingMs:unknown):number|null{
 const remaining=Number(remainingMs);if(!Number.isFinite(remaining))return null;
 const duration=Math.min(SEMANTIC_ROUTE_TIMEOUT_MS,remaining-7000);return duration>=1?duration:null;
}
export interface SemanticCandidate extends RouteCandidate {topic:string|null;summary:string|null;history:{id:string;content:string;createdAt:string;senderType?:'USER'|'AI'}[]}
export function projectRoutingContext(candidates:SemanticCandidate[]){
 return candidates.map((candidate,index)=>({code:`C${index+1}`,mode:candidate.mode,
  topic:candidate.topic,summary:candidate.summary,
  previousUserMessages:candidate.history.filter(message=>message.senderType!=='AI').slice(-2).map(message=>message.content),
  recentMessages:candidate.history.slice(-8).map(message=>({role:message.senderType==='AI'?'assistant' as const:'user' as const,content:message.content}))}));
}
const context=z.strictObject({code:candidateCode,mode:z.enum(['AI','HUMAN']),topic:z.string().max(20000).nullable(),summary:z.string().max(20000).nullable(),previousUserMessages:z.array(z.string().max(20000)).max(2),recentMessages:z.array(z.strictObject({role:z.enum(['user','assistant']),content:z.string().max(20000)})).max(8).optional()});
export const semanticPromptSchema=z.strictObject({question:z.string().min(1).max(20000).refine(value=>value.trim().length>0&&new TextEncoder().encode(value).byteLength<=60000),contexts:z.array(context).max(SEMANTIC_CANDIDATE_LIMIT)})
 .refine(value=>new Set(value.contexts.map(c=>c.code)).size===value.contexts.length);
export type SemanticPrompt=z.infer<typeof semanticPromptSchema>;
export type SemanticClassifier=(input:SemanticPrompt,signal:AbortSignal)=>Promise<RoutingProposal|null>;
export function resolveRoutingProposal(input:unknown,candidates:SemanticCandidate[]):{newTopic:boolean;selectedConversationId?:string;confidence:number}|null{
 const parsed=routingProposalSchema.safeParse(input);
 if(!parsed.success||parsed.data.confidence<.8||parsed.data.decision==='ASK'||candidates.length>SEMANTIC_CANDIDATE_LIMIT||
  new Set(candidates.map(c=>c.conversationId)).size!==candidates.length)return null;
 const proposal=parsed.data;if(proposal.decision==='NEW')return {newTopic:true,confidence:proposal.confidence};
 const candidate=candidates[Number(proposal.candidateCode!.slice(1))-1];
 if(!candidate||(['RESOLVED','CLOSED','CANCELLED'].includes(candidate.ticketStatus??''))||
  (candidate.mode==='HUMAN'&&(!candidate.ticketId||candidate.ticketRevision===null||candidate.ticketStatus===null)))return null;
 return {selectedConversationId:candidate.conversationId,newTopic:false,confidence:proposal.confidence};
}
