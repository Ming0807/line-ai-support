import type {Pool} from 'pg';
import {z} from 'zod';

/** Fixed vocabulary of routing observations shared with the operator logs contract. */
export const routingReasons={
 PAYLOAD_UNPARSEABLE:{severity:'INFO',label:'ข้อความถอดรหัสเฉพาะไม่ได้'},
 PAYLOAD_SCHEMA:{severity:'INFO',label:'โครงข้อความไม่ผ่านจุดตรวจ'},
 NON_TEXT_EVENT:{severity:'INFO',label:'กิจกรรมไม่ใช่ข้อความตัวอักษร'},
 QUESTION_SIZE:{severity:'INFO',label:'ขนาดข้อความอยู่นอกขอบเขต'},
 IDENTITY_MISMATCH:{severity:'WARN',label:'ยืนยันตัวตนผู้ส่งไม่ตรง'},
 SUPPORT_CONFIRMATION:{severity:'INFO',label:'ข้อความยืนยันการสนับสนุน'},
 SESSION_MISSING:{severity:'WARN',label:'ไม่พบเซสชันผู้ใช้ที่ใช้งานอยู่'},
 EXPLICIT_NEW_TOPIC:{severity:'INFO',label:'ผู้เรียนขอเริ่มเรื่องใหม่ชัดเจน'},
 INBOX_RATE_LIMIT:{severity:'WARN',label:'ผู้เรียนส่งถี่เกินขนาดรับได้'},
 DUPLICATE_MESSAGE:{severity:'INFO',label:'ข้อความซ้ำของกิจกรรมเดิม'},
 CANDIDATES_EMPTY:{severity:'INFO',label:'ไม่มีบริบทเรื่องที่คุยอยู่'},
 CANDIDATES_OVERFLOW:{severity:'WARN',label:'หัวข้อที่ยังเปิดเกินขีดจำนวนรองรับ'},
 CONTEXT_LIMIT:{severity:'WARN',label:'จำนวนบริบทเกินงบวิเคราะห์ในรอบนี้'},
 PROMPT_LIMIT:{severity:'WARN',label:'บริบทข้อความยาวเกินงบวิเคราะห์ในรอบนี้'},
 ROUTE_NAVIGATION:{severity:'INFO',label:'ข้อความเป็นคำสั่งเลือกเรื่อง'},
 CONTEXT_MISMATCH:{severity:'WARN',label:'โหลดบริบทหัวข้อไม่ครบ'},
 LEASE_STALE:{severity:'INFO',label:'งานถูกเคลมทับระหว่างเตรียม'},
 LEASE_BUDGET_EXHAUSTED:{severity:'WARN',label:'งบเวลาเช่าหมดก่อนเรียกโมเดล'},
 INTERNAL_ERROR:{severity:'ERROR',label:'ข้อผิดพลาดภายในของเส้นการนำทาง'},
 NO_VALID_PROPOSAL:{severity:'INFO',label:'โมเดลเสนอผลไม่ผ่านเกณฑ์นำทาง'},
 NO_EXISTING_CONTEXT:{severity:'INFO',label:'ไม่มีบริบทเดิม สร้างเรื่องใหม่'},
 SELECTION_NOT_IN_CURRENT_CONTEXT:{severity:'INFO',label:'เลือกบริบทต่างจากที่ถูกเสนอ'},
 TERMINAL_CONTEXT_REQUIRES_EXPLICIT_NEW_TOPIC:{severity:'INFO',label:'บริบทสิ้นสุดแล้ว ต้องขอเรื่องใหม่'},
 SELECTED_AI_CONVERSATION:{severity:'INFO',label:'ส่งต่อในเรื่องที่คุยกับ AI เดิม'},
 SELECTED_ACTIVE_HUMAN_TICKET:{severity:'INFO',label:'ส่งเข้าเคสที่คุยกับเจ้าหน้าที่เดิม'},
 INCONSISTENT_HUMAN_CONTEXT:{severity:'WARN',label:'สถานะเคสเจ้าหน้าที่ไม่ครบต้องเลือกใหม่'},
 SERVER_SPAM_DECISION:{severity:'WARN',label:'ระบบจัดเป็นข้อความไม่กระตือรือร้น'},
 LOW_CONFIDENCE:{severity:'WARN',label:'โมเดลไม่แน่ใจบริบท จึงขอให้เลือกเรื่อง'},
 MULTIPLE_CONTEXTS_REQUIRE_SELECTION:{severity:'WARN',label:'มีหลายเรื่องพิจารณา ต้องเลือกเอง'},
} as const satisfies Record<string,{severity:'ERROR'|'WARN'|'INFO';label:string}>;
export type RoutingReason=Exclude<keyof typeof routingReasons,number>;
export type RoutingSeverity=(typeof routingReasons)[RoutingReason]['severity'];

const routingObservationSchema=z.strictObject({
 inboxEventId:z.uuid().optional(),lineSessionId:z.uuid().optional(),
 stage:z.enum(['PREFLIGHT','CLASSIFY','DECISION']),status:z.enum(['SUCCESS','SKIPPED','TIMEOUT','ERROR']),
 reasonCode:z.string().regex(/^[A-Z0-9_]{1,48}$/u).optional(),
 candidates:z.number().int().min(0).max(10_000).optional(),
 latencyMs:z.number().int().min(0).max(3_600_000),
});
export type RoutingObservationInput=z.infer<typeof routingObservationSchema>;
/** What a caller inside routing code provides; storage columns are bound at the worker boundary. */
export type RoutingDecisionObservation=Omit<RoutingObservationInput,'inboxEventId'|'lineSessionId'>;

/** Best effort: caller never awaits storage; at most one pending submission per pool.
 * The independent query can use DB capacity, but cannot build an unbounded queue.
 * A caller mistake (unknown/range-violating field) downgrades to one warn with the row dropped;
 * it must never abort the caller's transaction the way a synchronous throw once did. */
const pendingPools=new WeakSet<Pool>();
export function recordRoutingObservation(pool:Pool,input:RoutingObservationInput):void {
 try{
 const parsed=routingObservationSchema.safeParse(input);
 if(!parsed.success){console.warn('ROUTING_TELEMETRY_UNAVAILABLE');return;}
 const {inboxEventId,lineSessionId,stage,status,reasonCode,candidates,latencyMs}=parsed.data;
 const query={text:`insert into private.inbox_routing_observations(inbox_event_id,line_session_id,stage,status,reason_code,candidates,latency_ms)
  values($1,$2,$3,$4,$5,$6,$7)`,values:[inboxEventId??null,lineSessionId??null,stage,status,reasonCode??null,candidates??null,latencyMs],query_timeout:2000};
 if(pendingPools.has(pool))return;
 pendingPools.add(pool);
 try{void pool.query(query).catch(()=>{console.warn('ROUTING_TELEMETRY_UNAVAILABLE');}).finally(()=>pendingPools.delete(pool));}
 catch{pendingPools.delete(pool);console.warn('ROUTING_TELEMETRY_UNAVAILABLE');}
 }catch{console.warn('ROUTING_TELEMETRY_UNAVAILABLE');}
}

/** Bounded cap helper so long turns cannot exceed the observation latency envelope. */
export function routingLatency(sinceMs:number):number {return Math.min(3_600_000,Math.max(0,Math.round(Date.now()-sinceMs)));}
