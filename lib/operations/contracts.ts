import {z} from 'zod';

export class OperationsError extends Error {
 constructor(public readonly code:'INVALID_REQUEST'|'FORBIDDEN'|'NOT_FOUND'|'UNAVAILABLE'){super(code);}
}
export const activityGroups={
 TAKEOVER:['ACCEPTED'],REPLY:['STAFF_REPLIED'],REASSIGN:['REASSIGNED'],RESOLVE:['RESOLVED'],CLOSE:['CLOSED'],
 REOPEN:['REOPENED'],CREATE:['CREATED'],APPROVE_KNOWLEDGE:['KNOWLEDGE_IMPORT_PUBLISHED'],
 IMPORT:['KNOWLEDGE_IMPORT_STAGED','KNOWLEDGE_IMPORT_DUPLICATE','KNOWLEDGE_IMPORT_FAILED','KNOWLEDGE_IMPORT_ANALYZED','KNOWLEDGE_IMPORT_EDITED','KNOWLEDGE_IMPORT_REVIEW_SAVED'],
 PROVIDER:['AI_PROVIDER_CREATED','AI_PROVIDER_UPDATED','AI_MODEL_CREATED','AI_MODEL_UPDATED','AI_PROVIDERS_REORDERED','AI_MODELS_REORDERED','AI_PROVIDER_COST_MODE_CHANGED','AI_PROVIDER_HEALTH_CHECKED','AI_MODEL_PRICING_CHECKED','AI_MODEL_TESTED','AI_PROVIDER_QUOTA_CHECKED'],OTHER:[],
} as const;
export const activityActions=Object.keys(activityGroups) as (keyof typeof activityGroups)[];
export const activityLabels:Record<keyof typeof activityGroups,string>={TAKEOVER:'รับงาน',REPLY:'ตอบกลับ',REASSIGN:'มอบหมายงาน',RESOLVE:'แก้ไขสำเร็จ',CLOSE:'ปิดงาน',REOPEN:'เปิดงานอีกครั้ง',CREATE:'สร้างงาน',APPROVE_KNOWLEDGE:'เผยแพร่ความรู้',IMPORT:'นำเข้าความรู้',PROVIDER:'จัดการ AI',OTHER:'กิจกรรมอื่น'};
export const aiCodes=['TIMEOUT','CANCELLED','RATE_LIMITED','SERVER_ERROR','MODEL_UNAVAILABLE','AUTH_ERROR','INVALID_OUTPUT','INVALID_REQUEST','PROVIDER_UNAVAILABLE'] as const;
export const lineCodes=['LINE_DELIVERED','LINE_DELIVERY_FAILED','PUSH_RETRYABLE','PUSH_NETWORK_ERROR','PUSH_TIMEOUT','REPLY_ALREADY_ATTEMPTED','REPLY_OUTCOME_UNKNOWN','REPLY_RATE_LIMITED','LINE_REJECTED','UNEXPECTED_HTTP_STATUS'] as const;
export const logCodes=[...aiCodes,...lineCodes] as const;
const codeLabels:Record<typeof logCodes[number],string>={TIMEOUT:'AI ใช้เวลานานเกินกำหนด',CANCELLED:'ยกเลิกคำขอ AI',RATE_LIMITED:'AI จำกัดคำขอ',SERVER_ERROR:'ผู้ให้บริการ AI ขัดข้อง',MODEL_UNAVAILABLE:'โมเดลไม่พร้อม',AUTH_ERROR:'การยืนยันตัวตน AI ล้มเหลว',INVALID_OUTPUT:'ผลลัพธ์ AI ไม่ผ่านการตรวจสอบ',INVALID_REQUEST:'คำขอ AI ไม่ถูกต้อง',PROVIDER_UNAVAILABLE:'ผู้ให้บริการ AI ไม่พร้อม',LINE_DELIVERED:'LINE ยืนยันการส่ง',LINE_DELIVERY_FAILED:'ส่ง LINE ไม่สำเร็จ',PUSH_RETRYABLE:'รอลองส่ง LINE อีกครั้ง',PUSH_NETWORK_ERROR:'เชื่อมต่อ LINE ไม่สำเร็จ',PUSH_TIMEOUT:'LINE ใช้เวลานานเกินกำหนด',REPLY_ALREADY_ATTEMPTED:'เคยพยายามตอบ LINE แล้ว',REPLY_OUTCOME_UNKNOWN:'ยังยืนยันผลตอบ LINE ไม่ได้',REPLY_RATE_LIMITED:'LINE จำกัดคำขอ',LINE_REJECTED:'LINE ปฏิเสธคำขอ',UNEXPECTED_HTTP_STATUS:'LINE ส่งสถานะที่ไม่รองรับ'};
const boundedString=z.string().max(200).refine(value=>!/[\u0000-\u001f\u007f-\u009f]/u.test(value));
const civilDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value=>{const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;});
const integer=z.number().int().min(1);
const common={q:boundedString.optional(),from:civilDate,to:civilDate,page:integer.max(10000),pageSize:integer.max(100)};
const activityFilterSchema=z.strictObject({...common,action:z.enum(activityActions).optional()});
const logFilterSchema=z.strictObject({...common,severity:z.enum(['ERROR','WARN','INFO']).optional(),component:z.enum(['ai-gateway','line-delivery']).optional(),code:z.enum(logCodes).optional()});
export type ActivityFilters=z.infer<typeof activityFilterSchema>;
export type LogFilters=z.infer<typeof logFilterSchema>;
function shift(value:string,days:number){const date=new Date(value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);return civilDate.parse(date.toISOString().slice(0,10));}
function queryInput(params:URLSearchParams,keys:readonly string[],now:Date){
 const result:Record<string,unknown>={};
 for(const [key,value] of params){if(!keys.includes(key)||Object.hasOwn(result,key))throw new OperationsError('INVALID_REQUEST');result[key]=value;}
 for(const key of ['page','pageSize']){const value=result[key];if(value!==undefined&&(typeof value!=='string'||! /^[1-9]\d*$/u.test(value)))throw new OperationsError('INVALID_REQUEST');result[key]=value===undefined?(key==='page'?1:25):Number(value);}
 if(result.q!==undefined){if(typeof result.q!=='string')throw new OperationsError('INVALID_REQUEST');boundedString.parse(result.q);result.q=result.q.trim()||undefined;}
 if(result.from!==undefined)civilDate.parse(result.from);if(result.to!==undefined)civilDate.parse(result.to);
 if(result.from===undefined&&result.to===undefined){if(!Number.isFinite(now.getTime()))throw new OperationsError('INVALID_REQUEST');result.to=new Date(now.getTime()+7*3600000).toISOString().slice(0,10);result.from=shift(String(result.to),-6);}
 else if(result.from===undefined)result.from=shift(String(result.to),-6);
 else if(result.to===undefined)result.to=shift(String(result.from),6);
 const days=(Date.parse(String(result.to))-Date.parse(String(result.from)))/86400000+1;
 if(days<1||days>90)throw new OperationsError('INVALID_REQUEST');return result;
}
export function parseActivityQuery(params:URLSearchParams,now=new Date()):ActivityFilters{return activityFilterSchema.parse(queryInput(params,['q','from','to','page','pageSize','action'],now));}
export function parseLogQuery(params:URLSearchParams,now=new Date()):LogFilters{return logFilterSchema.parse(queryInput(params,['q','from','to','page','pageSize','severity','component','code'],now));}
export function validateActivityFilters(filters:ActivityFilters){const value=activityFilterSchema.parse(filters);validateWindow(value);return value;}
export function validateLogFilters(filters:LogFilters){const value=logFilterSchema.parse(filters);validateWindow(value);return value;}
function validateWindow(value:{from:string;to:string}){const days=(Date.parse(value.to)-Date.parse(value.from))/86400000+1;if(days<1||days>90)throw new OperationsError('INVALID_REQUEST');}
const timestamp=z.string().datetime();
export const activityItemSchema=z.strictObject({id:z.uuid(),occurredAt:timestamp,action:z.enum(activityActions),actionLabel:z.string().min(1).max(100),actorDisplayName:z.string().max(200).nullable(),ticketCode:z.string().max(100).nullable(),departmentLabel:z.string().max(200).nullable(),summary:z.string().min(1).max(300)});
export const logItemSchema=z.strictObject({id:z.string().regex(/^(?:ai:[0-9a-f-]{36}|line:[1-9]\d*)$/iu),loggedAt:timestamp,code:z.enum(logCodes),label:z.string().min(1).max(100),component:z.enum(['ai-gateway','line-delivery']),severity:z.enum(['ERROR','WARN','INFO']),httpStatus:z.number().int().min(100).max(599).nullable(),correlationId:z.null()});
export type ActivityItem=z.infer<typeof activityItemSchema>;export type LogItem=z.infer<typeof logItemSchema>;
export function activityAction(value:unknown):keyof typeof activityGroups {for(const [key,values] of Object.entries(activityGroups)){if((values as readonly unknown[]).includes(value))return key as keyof typeof activityGroups;}return 'OTHER';}
function iso(value:unknown){if(!(value instanceof Date)||!Number.isFinite(value.getTime()))throw new OperationsError('UNAVAILABLE');return value.toISOString();}
export function projectActivity(row:Record<string,unknown>):ActivityItem {
 const action=activityAction(row.action);return activityItemSchema.parse({id:row.id,occurredAt:iso(row.created_at),action,actionLabel:activityLabels[action],actorDisplayName:row.actor_name??null,ticketCode:row.ticket_code??null,departmentLabel:row.department_label??null,summary:activityLabels[action]});
}
export function projectLog(row:Record<string,unknown>):LogItem {
 const component=z.enum(['ai-gateway','line-delivery']).parse(row.component);
 const known=component==='ai-gateway'?aiCodes:lineCodes.filter(code=>code!=='LINE_DELIVERED');
 const code:typeof logCodes[number]=component==='line-delivery'&&row.accepted===true?'LINE_DELIVERED':(known as readonly unknown[]).includes(row.error_code)?row.error_code as typeof logCodes[number]:component==='line-delivery'?'LINE_DELIVERY_FAILED':'PROVIDER_UNAVAILABLE';
 const httpStatus=row.http_status??null;const severity=row.accepted===true&&component==='line-delivery'?'INFO':httpStatus===429||['CANCELLED','REPLY_OUTCOME_UNKNOWN','REPLY_ALREADY_ATTEMPTED'].includes(code)?'WARN':'ERROR';
 return logItemSchema.parse({id:row.id,loggedAt:iso(row.created_at),code,label:codeLabels[code],component,severity,httpStatus,correlationId:null});
}
export const paginationSchema=z.strictObject({page:integer.max(10000),pageSize:integer.max(100),total:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),totalPages:z.number().int().min(0),hasNext:z.boolean(),hasPrevious:z.boolean()}).refine(value=>value.totalPages===Math.ceil(value.total/value.pageSize)&&value.hasNext===(value.page*value.pageSize<value.total)&&value.hasPrevious===(value.page>1));
export function makePagination(page:number,pageSize:number,total:number){return paginationSchema.parse({page,pageSize,total,totalPages:Math.ceil(total/pageSize),hasNext:page*pageSize<total,hasPrevious:page>1});}
export const windowSchema=z.strictObject({from:civilDate,to:civilDate,timeZone:z.literal('Asia/Bangkok')}).refine(value=>{const days=(Date.parse(value.to)-Date.parse(value.from))/86400000+1;return days>=1&&days<=90;});
export function operationsEnvelopeSchema(kind:'activities'|'logs'){return z.strictObject({items:z.array(kind==='activities'?activityItemSchema:logItemSchema).max(100),pagination:paginationSchema,window:windowSchema});}
export type ReadEnvelope<T>={items:T[];pagination:z.infer<typeof paginationSchema>;window:z.infer<typeof windowSchema>};
