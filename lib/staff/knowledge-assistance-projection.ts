import {aiResultSchema,type AIResult} from '../ai/jobs';
import {buildCitedAnswer,locationLabel} from '../knowledge/citations';
import {buildStructuredAnswer} from '../knowledge/structured-citations';
import {staffKnowledgeAdviceSchema,type StaffKnowledgeAdvice} from './knowledge-assistance-contracts';
import {buildWebLeadReply} from '../knowledge/web-leads';
/** Server-only: citation IDs/URLs are chosen by the existing canonical builders. */
export function projectStaffKnowledgeAdvice(input:AIResult,revision:number):StaffKnowledgeAdvice{
 const result=aiResultSchema.parse(input);
 if(result.kind==='CLARIFY')return staffKnowledgeAdviceSchema.parse({revision,status:'NOT_VERIFIED',answer:result.text,draftText:null,sources:[]});
 if(result.kind==='WEB_LEADS'){
  const reply=buildWebLeadReply(result),text=reply.messages.map(m=>m.text).join('\n');
  return staffKnowledgeAdviceSchema.parse({revision,status:'WEB_LEADS',answer:reply.messages[0].text,draftText:text.length<=5000?text:null,
   sources:reply.citations.map(c=>({title:c.title,academicYear:result.plan.academicYear,url:c.url,location:'ผลค้นเว็บ ยังไม่ได้ยืนยัน'}))});
 }
 const cited=result.kind==='ANSWER'?buildCitedAnswer(result.output,result.evidence):buildStructuredAnswer(result.output,result.evidence);
 const text=cited.messages.map(message=>message.text).join('');
 const sources=result.kind==='ANSWER'?buildCitedAnswer(result.output,result.evidence).citations.map(c=>({title:c.title,academicYear:c.academicYear,url:c.sourceUrl,
  location:c.sourceLocations?.length?c.sourceLocations.map(locationLabel).join(' · '):c.pageNumber===null?null:`หน้า ${c.pageNumber}`})):
  buildStructuredAnswer(result.output,result.evidence).citations.map(c=>({title:c.title,academicYear:c.academicYear,url:c.sourceUrl,location:`${locationLabel(c.sourceLocation)} · แถว ${c.sourceRow}`}));
 return staffKnowledgeAdviceSchema.parse({revision,status:'VERIFIED',answer:result.output.answer,draftText:text.length<=5000?text:null,sources});
}
