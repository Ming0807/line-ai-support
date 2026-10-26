import {z} from 'zod';
import {staffKnowledgeSourceSchema} from './knowledge-assistance-contracts';

const bound={ticketId:z.uuid(),revision:z.number().int().min(0).max(2147483647)};
const completeText=(max:number)=>z.string().min(1).max(max).refine(text=>text.trim().length>0&&text.isWellFormed()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text));
/** Browser-safe projection only: no process, actor, model, proof or LINE identity. */
export const staffCopilotAdviceSchema=z.discriminatedUnion('status',[
 z.strictObject({...bound,status:z.literal('DRAFT'),draftText:completeText(12000),evidenceText:completeText(3000),sources:z.array(staffKnowledgeSourceSchema).min(1).max(5)}),
 z.strictObject({...bound,status:z.literal('NOT_VERIFIED'),draftText:z.null(),evidenceText:completeText(2000),sources:z.array(staffKnowledgeSourceSchema).max(0)}),
 z.strictObject({...bound,status:z.literal('NO_USER_QUESTION'),draftText:z.null(),evidenceText:z.null(),sources:z.array(staffKnowledgeSourceSchema).max(0)}),
]);
export type StaffCopilotAdvice=z.infer<typeof staffCopilotAdviceSchema>;
