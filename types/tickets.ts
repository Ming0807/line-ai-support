import { z } from 'zod';

export const ticketStatusSchema=z.enum(['NEW','AI_HANDLING','WAITING_STAFF','STAFF_HANDLING','WAITING_USER','RESOLVED','CLOSED','CANCELLED']);
export const prioritySchema=z.enum(['LOW','MEDIUM','HIGH','CRITICAL']);
export const sensitivitySchema=z.enum(['GENERAL','SENSITIVE','RESTRICTED']);
const base={revision:z.number().int().nonnegative(),requestId:z.uuid()};
export const ticketActionSchemas={
 ACCEPT:z.object(base).strict(),
 STAFF_REPLY:z.object({...base,text:z.string().trim().min(1).max(5000)}).strict(),
 RESOLVE:z.object({...base,reason:z.string().trim().max(1000).optional()}).strict(),
 CLOSE:z.object(base).strict(),
 REASSIGN:z.object({...base,assigneeId:z.uuid()}).strict(),
 REOPEN:z.object({...base,reason:z.string().trim().min(1).max(1000)}).strict(),
} as const;
export type StaffTicketAction=keyof typeof ticketActionSchemas;
export type TicketActionInput={revision:number;requestId:string;text?:string;reason?:string;assigneeId?:string};
const pageNumber=(maximum:number)=>z.union([z.number(),z.string().regex(/^[1-9][0-9]*$/).transform(Number)]).pipe(z.number().int().min(1).max(maximum));
export const ticketFiltersSchema=z.object({
 department:z.uuid().optional(),status:ticketStatusSchema.optional(),priority:prioritySchema.optional(),
 assignee:z.uuid().optional(),from:z.iso.date().optional(),to:z.iso.date().optional(),sensitivity:sensitivitySchema.optional(),
 q:z.string().max(200).refine(value=>!/\p{Cc}/u.test(value)).transform(value=>value.trim()||undefined).optional(),
 page:pageNumber(10000).optional(),pageSize:pageNumber(100).optional(),
}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{message:'INVALID_DATE_RANGE'});
export type TicketFilters=z.infer<typeof ticketFiltersSchema>;
export function parseTicketQuery(params:URLSearchParams):TicketFilters{
 const entries=Object.fromEntries([...new Set(params.keys())].map(key=>{const values=params.getAll(key);return [key,values.length===1?values[0]:values];}));
 const parsed=ticketFiltersSchema.parse(entries);return {...parsed,page:parsed.page??1,pageSize:parsed.pageSize??100};
}
export interface TicketListItem {
 id:string;ticket_no:string;department_id:string;department_name:string;category:string;
 problem_summary:string;priority:z.infer<typeof prioritySchema>;status:z.infer<typeof ticketStatusSchema>;
 mode:'AI'|'HUMAN';sensitive_level:z.infer<typeof sensitivitySchema>;assigned_staff_id:string|null;
 assignee_name:string|null;revision:number;created_at:string;updated_at:string;anonymous_code:string;
}
export interface TicketDetail {
 ticket:TicketListItem;
 messages:{id:string;sender_type:'USER'|'AI'|'STAFF'|'SYSTEM';content:string;created_at:string;staff_name:string|null}[];
 history:{id:string;action:string;from_status:string|null;to_status:string|null;created_at:string;actor_name:string|null;reason?:string}[];
 assignees:{id:string;display_name:string}[];
 deliveries:{status:string;last_error_code:string|null;created_at:string}[];
 permissions:{accept:boolean;reply:boolean;resolve:boolean;close:boolean;reassign:boolean;reopen:boolean};
}
export interface TicketPagination {page:number;pageSize:number;total:number;totalPages:number;hasNext:boolean;hasPrevious:boolean}
export interface TicketListResult {tickets:TicketListItem[];departments:{id:string;code:string;name_th:string}[];assignees:{id:string;display_name:string}[];/** Absent only in legacy/failure UI values; successful backend reads always supply it. */pagination?:TicketPagination}
export interface TicketActionResult {id:string;status:z.infer<typeof ticketStatusSchema>;revision:number}
