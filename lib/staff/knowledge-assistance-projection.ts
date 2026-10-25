import {aiResultSchema,type AIResult} from '../ai/jobs';
import {buildCitedAnswer,locationLabel} from '../knowledge/citations';
import {buildStructuredAnswer} from '../knowledge/structured-citations';
import {staffKnowledgeAdviceSchema,type StaffKnowledgeAdvice} from './knowledge-assistance-contracts';
import {buildWebLeadReply} from '../knowledge/web-leads';
import {buildFormDirectory} from '../knowledge/form-directory';
/** Server-only: citation IDs/URLs are chosen by the existing canonical builders. */
export function projectStaffKnowledgeAdvice(input:AIResult,revision:number):StaffKnowledgeAdvice{
 const result=aiResultSchema.parse(input);
 if(result.kind==='CONVERSATION'||result.kind==='MIXED')throw new Error('GENERAL_REPLY_NOT_KNOWLEDGE_ADVICE');
 if(result.kind==='CLARIFY')return staffKnowledgeAdviceSchema.parse({revision,status:'NOT_VERIFIED',answer:result.text,draftText:null,sources:[]});
 if(result.kind==='FORM_DIRECTORY'){
  const reply=buildFormDirectory(result),text=reply.messages.map(message=>message.text).join('');
  if(text.length>3000||reply.citations.length>5)return staffKnowledgeAdviceSchema.parse({revision,status:'NOT_VERIFIED',answer:'รายการแบบฟอร์มยาวเกินขนาดคำแนะนำในหน้านี้ครับ กรุณาระบุชื่อแบบฟอร์มหรือหน่วยงานให้แคบลง',draftText:null,sources:[]});
  return staffKnowledgeAdviceSchema.parse({revision,status:'VERIFIED',answer:text,draftText:text.length<=5000?text:null,
   sources:reply.citations.map(c=>({title:c.title,academicYear:c.academicYear,url:c.sourceUrl,location:`${locationLabel(c.sourceLocation)} · แถว ${c.sourceRow}`}))});
 }
 if(result.kind==='WEB_LEADS'){
  const reply=buildWebLeadReply(result),text=reply.messages.map(m=>m.text).join('\n');
  return staffKnowledgeAdviceSchema.parse({revision,status:'WEB_LEADS',sourceKind:result.plan.purpose==='GENERAL_PUBLIC'?'GENERAL_PUBLIC':'YRU_WEBSITE',answer:reply.messages[0].text,draftText:text.length<=5000?text:null,
   sources:reply.citations.map(c=>({title:c.title,academicYear:result.plan.academicYear,url:c.url,location:'ผลค้นเว็บ ยังไม่ได้ยืนยัน'}))});
 }
 const cited=result.kind==='ANSWER'?buildCitedAnswer(result.output,result.evidence):buildStructuredAnswer(result.output,result.evidence);
 const text=cited.messages.map(message=>message.text).join('');
 const sources=result.kind==='ANSWER'?buildCitedAnswer(result.output,result.evidence).citations.map(c=>({title:c.title,academicYear:c.academicYear,url:c.sourceUrl,
  location:c.sourceLocations?.length?c.sourceLocations.map(locationLabel).join(' · '):c.pageNumber===null?null:`หน้า ${c.pageNumber}`})):
  buildStructuredAnswer(result.output,result.evidence).citations.map(c=>({title:c.title,academicYear:c.academicYear,url:c.sourceUrl,location:`${locationLabel(c.sourceLocation)} · แถว ${c.sourceRow}`}));
 return staffKnowledgeAdviceSchema.parse({revision,status:'VERIFIED',answer:result.output.answer,draftText:text.length<=5000?text:null,sources});
}
