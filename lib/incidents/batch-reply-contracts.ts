import {z} from 'zod';
const uuid=z.uuid().transform(value=>value.toLowerCase());
export const incidentReplySelectionSchema=z.strictObject({requestId:uuid,
 ticketIds:z.array(uuid).min(1).max(100).refine(ids=>new Set(ids).size===ids.length),
 text:z.string().trim().min(1).max(4000).refine(value=>!/[\p{Cf}\p{Cs}]|[^\S\r\n\t ]/u.test(value)&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value)),
 intervention:z.boolean()});
export type IncidentReplySelection=z.infer<typeof incidentReplySelectionSchema>;
export const incidentReplyEligibilitySchema=z.enum(['OWN_CASE','INTERVENTION_REQUIRED','OTHER_ASSIGNEE','UNASSIGNED','PRIVATE_CASE','INACTIVE_CASE','NOT_HUMAN']);
export const incidentReplyOptionSchema=z.strictObject({ticketId:uuid,ticketCode:z.string().min(1).max(100),reporterLabel:z.string().min(1).max(200),
 status:z.string().max(30),eligibility:incidentReplyEligibilitySchema,pendingUserMessages:z.number().int().nonnegative()});
export type IncidentReplyOption=z.infer<typeof incidentReplyOptionSchema>;
export const incidentReplyOptionsSchema=z.strictObject({incidentId:uuid,incidentRevision:z.number().int().nonnegative(),
 incidentStatus:z.enum(['DETECTED','INVESTIGATING','MONITORING','RESOLVED','CLOSED']),canIntervene:z.boolean(),
 workload:z.strictObject({memberCases:z.number().int().nonnegative(),activeCases:z.number().int().nonnegative(),
  anonymousSessions:z.number().int().nonnegative(),activeAnonymousSessions:z.number().int().nonnegative(),unassignedCases:z.number().int().nonnegative(),
  assignedStaff:z.number().int().nonnegative(),pendingUserMessages:z.number().int().nonnegative()}),items:z.array(incidentReplyOptionSchema).max(500)});
export type IncidentReplyOptions=z.infer<typeof incidentReplyOptionsSchema>;
const replyCaseSchema=incidentReplyOptionSchema.pick({ticketId:true,ticketCode:true,reporterLabel:true});
export const incidentReplyPacketSchema=z.strictObject({recipientCode:z.string().regex(/^R(?:[1-9]|[1-9]\d|100)$/u),
 cases:z.array(replyCaseSchema).min(1).max(100),
 messages:z.array(z.strictObject({type:z.literal('text'),text:z.string().min(1).max(5000)})).min(1).max(5)});
export type IncidentReplyPacket=z.infer<typeof incidentReplyPacketSchema>;
export const incidentReplyPreviewSchema=z.strictObject({status:z.literal('REVIEW_ONLY'),incidentId:uuid,requestId:uuid,
 cases:z.array(replyCaseSchema).min(1).max(100),
 caseCount:z.number().int().min(1).max(100),recipientCount:z.number().int().min(1).max(100),commonText:incidentReplySelectionSchema.shape.text,
 deliveries:z.array(incidentReplyPacketSchema).min(1).max(100),
 intervention:z.boolean(),expiresAt:z.iso.datetime(),previewReceipt:z.string().min(1).max(200000)}).superRefine((value,context)=>{
 const selected=new Map(value.cases.map(item=>[item.ticketId,item]));
 const sent=value.deliveries.flatMap(packet=>packet.cases);
 const sameCase=(a:z.infer<typeof replyCaseSchema>,b:z.infer<typeof replyCaseSchema>)=>a.ticketId===b.ticketId&&a.ticketCode===b.ticketCode&&a.reporterLabel===b.reporterLabel;
 if(value.caseCount!==value.cases.length||selected.size!==value.caseCount||value.recipientCount!==value.deliveries.length||sent.length!==value.caseCount
  ||new Set(sent.map(item=>item.ticketId)).size!==value.caseCount||sent.some(item=>!selected.has(item.ticketId)||!sameCase(item,selected.get(item.ticketId)!))
  ||value.deliveries.some((packet,index)=>packet.recipientCode!==`R${index+1}`||packet.messages.map(message=>message.text).join('')!==
   `อัปเดตเคส: ${packet.cases.map(item=>item.ticketCode).join(', ')}\n\n${value.commonText}`))
  context.addIssue({code:'custom',message:'INCIDENT_REPLY_PACKET_INVALID'});
});
export type IncidentReplyPreview=z.infer<typeof incidentReplyPreviewSchema>;
