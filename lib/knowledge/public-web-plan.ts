import {z} from 'zod';
import {copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {knowledgeScopeSchema} from './retrieval';
import {assessStructuredQuery,validateStructuredQuery} from './structured-query';
import {buildPublicSearchQuery} from './public-search-query';

export const publicWebPlanSchema=z.object({version:z.literal(1),purpose:z.literal('YRU_INFORMATION'),
 topic:z.enum(['ACADEMIC_CALENDAR','CREDIT_TRANSFER','TUITION_FEES','REGISTRATION','WIFI_ACCESS','LIBRARY_SERVICES','STUDENT_ACTIVITIES','DORMITORY']),
 academicYear:z.number().int().min(2400).max(3000).nullable()}).strict();
export const publicWebPlanProposalSchema=publicWebPlanSchema.extend({quote:z.string().min(1).max(500)
 .refine(value=>value.trim().length>0&&!/[\p{Cc}\p{Cf}]/u.test(value))}).strict();
export type PublicWebPlan=z.infer<typeof publicWebPlanSchema>;
const contextSchema=z.object({userText:z.string().min(1).max(12000),scope:knowledgeScopeSchema,query:z.unknown()}).strict();
const registry={
 ACADEMIC_CALENDAR:{datasets:['academic_calendar_events'],anchor:/ปฏิทิน(?:\s*วิชาการ)?|academic\s+calendar/iu},
 CREDIT_TRANSFER:{datasets:['transfer_courses'],anchor:/เทียบโอน|credit\s+transfer/iu},
 TUITION_FEES:{datasets:['tuition_fees'],anchor:/ค่าธรรมเนียม|ค่าเทอม|ค่าเล่าเรียน|tuition|fees/iu},
 REGISTRATION:{datasets:['university_services','university_systems','announcements'],anchor:/ลงทะเบียน|registration/iu},
 WIFI_ACCESS:{datasets:['university_services','university_systems'],anchor:/wi[\s-]?fi|ไว[\s-]?ไฟ/iu},
 LIBRARY_SERVICES:{datasets:['university_services'],anchor:/ห้องสมุด|library/iu},
 STUDENT_ACTIVITIES:{datasets:['announcements','academic_calendar_events'],anchor:/กิจกรรมนักศึกษา|student\s+activit/iu},
 DORMITORY:{datasets:['university_services','service_forms','announcements'],anchor:/หอพัก|dormitor/iu},
} satisfies Record<PublicWebPlan['topic'],{datasets:readonly string[];anchor:RegExp}>;

/** Proposal validation only: no actor authority, arbitrary query, URL, history or identity is returned. */
export function validatePublicWebPlan(input:unknown,context:unknown):PublicWebPlan{
 try{
  const proposal=publicWebPlanProposalSchema.parse(copyStructuredJson(input,4096,64));
  const current=contextSchema.parse(copyStructuredJson(context,64*1024,2000)),query=validateStructuredQuery(current.query);
  const rule=registry[proposal.topic];
  if(assessStructuredQuery(query).status!=='READY'||!(rule.datasets as readonly string[]).includes(query.dataset)||
   !current.userText.includes(proposal.quote)||!rule.anchor.test(proposal.quote.normalize('NFKC'))||
   current.scope.asOfDate!==null||proposal.academicYear!==current.scope.academicYear)throw new Error();
  if(proposal.academicYear!==null&&!new RegExp(`(?<!\\d)${proposal.academicYear}(?!\\d)`,'u').test(current.userText))throw new Error();
  if('academic_year' in query.filters&&query.filters.academic_year!==current.scope.academicYear)throw new Error();
  const {version,purpose,topic,academicYear}=proposal,plan={version,purpose,topic,academicYear};
  buildPublicSearchQuery(plan);
  return freezeStructuredData(plan);
 }catch{throw new Error('PUBLIC_WEB_PLAN_INVALID');}
}
