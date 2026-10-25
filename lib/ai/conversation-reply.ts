import {createHash} from 'node:crypto';
import {z} from 'zod';
import {lineMessages} from '../knowledge/citations';

const contextSchema=z.object({sessionId:z.uuid(),conversationId:z.uuid(),messageId:z.uuid(),revision:z.number().int().nonnegative(),
 question:z.string().min(1).max(20000),history:z.array(z.strictObject({role:z.enum(['user','assistant']),content:z.string().min(1)})).max(1000)});
type Context=z.infer<typeof contextSchema>;
export const conversationReplySchema=z.strictObject({kind:z.literal('CONVERSATION'),basis:z.literal('GENERAL_MODEL'),
 text:z.string().min(1).max(20000).refine(s=>s.trim().length>0),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/u),support:z.never().optional()});
export type ConversationReply=z.infer<typeof conversationReplySchema>;
const digest=(context:Context)=>createHash('sha256').update(JSON.stringify(contextSchema.parse(context))).digest('hex');
/** Supplementary conservative output screening, not a semantic truth proof or conversation router. */
export type GeneralEvidenceReason='URL'|'INSTITUTIONAL_TOPIC'|'INSTITUTIONAL_NUMBER'|'INSTITUTIONAL_REQUIREMENT'|'PERSONAL_RECORD_CLAIM'|'ACTION_COMPLETION';
export function generalReplyEvidenceReason(text:string,question?:string,history:Readonly<Context['history']>=[]):GeneralEvidenceReason|null{
 const normalized=text.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,'');
 // Numbered instructions are separate statements, even when the model uses one line.
 // Only the screening copy changes; the complete delivered answer stays untouched.
 const actionStatements=normalized.replace(/(?:^|\s)[0-9๐-๙]+[.)]\s+/gu,'\n');
 if(/https?:\/\/|www\.|\b[a-z0-9-]+\.(?:ac\.th|go\.th|com|org|net)\b/iu.test(normalized))return 'URL';
 // Concrete campus identifiers cannot be invented even as illustrative examples.
 // Asking for the actual name or giving generic device examples makes no such claim.
 if(/(?:เครือข่าย|Wi[\s-]?Fi|SSID|ระบบ)[^\n.!?]{0,80}(?:มหาวิทยาลัย|\bYRU\b)[^\n.!?]{0,40}(?:เช่น|ได้แก่|ชื่อ)\s*["'“‘]?[a-z][a-z0-9_-]{2,}|\b(?:university|campus)\s+(?:Wi-Fi|wireless|network|system)[^\n.!?]{0,50}(?:for example|e\.g\.|named|called)\s+["'“‘]?[a-z][a-z0-9_-]{2,}/iu.test(actionStatements))return 'INSTITUTIONAL_TOPIC';
 // An attributed official attachment list still needs reviewed authority when its nouns are unfamiliar.
 if(/(?:ประกาศ|ระเบียบ|นโยบาย|มหาวิทยาลัย)[^\n.!?]{0,300}(?:เอกสาร|หลักฐาน)[^\n.!?]{0,60}(?:ต้องเตรียม|ต้องใช้|ต้องแนบ|ได้แก่|คือ)/u.test(actionStatements))return 'INSTITUTIONAL_REQUIREMENT';
 // The decision model has not searched the corpus and cannot establish document availability.
 if(/(?:ผม|ฉัน|I)[^\n.!?]{0,40}(?:มองไม่เห็น|ไม่เห็น|ไม่ได้รับ|ไม่สามารถเข้าถึง|cannot (?:see|access))[^\n.!?]{0,40}(?:คู่มือ|ประกาศ|แบบฟอร์ม|official (?:guide|notice|form))/iu.test(actionStatements))return 'INSTITUTIONAL_TOPIC';
 // A specific attachment checklist is an official requirement, even with "for example".
 // Advice to check the applicable instructions without listing attachments remains general.
 // Optional-sounding preparation lists can also invent the applicable paperwork.
 // Match an instruction plus a concrete attachment within one list item, not a document noun alone.
 if(new RegExp(/(?:รวบรวม|เตรียม)(?:ข้อมูล(?:ส่วนตัว)?(?:และ|หรือ))?เอกสาร[^\n.!?]{0,100}(?:สำเนาบัตร|บัตรประชาชน|บัตร(?:ประจำตัว)?นักศึกษา|ผลการเรียน|ใบแสดงผล|ใบรายงานผล|จดหมายแนะนำ|หลักฐานการชำระเงิน|หนังสืออนุมัติ)|\b(?:gather|prepare|collect)\s+(?:supporting\s+)?documents?[^\n.!?]{0,100}(?:transcripts?|ID\b|identity card|recommendation letters?|proof of payment)/iu.source.normalize('NFKC'),'iu').test(actionStatements))return 'INSTITUTIONAL_REQUIREMENT';
 if(new RegExp(/(?:ต้อง(?:แนบ|ใช้|เตรียม)|เอกสาร(?:หลักฐาน)?ที่(?:จำเป็น|ต้องใช้|ต้องเตรียม)).{0,100}(?:สำเนาบัตร|บัตรประชาชน|บัตรนักศึกษา|ใบแสดงผล|ใบรายงานผล|จดหมายแนะนำ|transcript)|(?:must|need to|required to)\s+(?:attach|submit|provide|include).{0,100}(?:transcript|ID\b|identity card|recommendation letter)|required\s+(?:documents|attachments)\s*:.{0,100}(?:transcript|ID\b|identity card|recommendation letter)/iu.source.normalize('NFKC'),'iu').test(actionStatements))return 'INSTITUTIONAL_REQUIREMENT';
 // Mandatory personal fields are source-dependent requirements too. General
 // advice to check the applicable instructions does not assert a field list.
 // Join explicit list continuations for screening only. Keep ordinary paragraph
 // boundaries, and never alter the text delivered to LINE.
 const fieldStatements=normalized.replace(/\r?\n[ \t]*(?:[-*•]|[0-9๐-๙]+[.)])[ \t]+/gu,' ');
 // "program" and "phone" can instead describe software/device diagnostics.
 // Use the unchanged owned question and prior USER context to disambiguate these nouns;
 // it supplies no official facts, retrieval scope, routing or action authority.
 const requestContext=[question??'',...history.filter(turn=>turn.role==='user').map(turn=>turn.content)].join('\n');
 const formContext=question===undefined||/คำร้อง|ใบสมัคร|สมัครเรียน|(?:แบบฟอร์ม|ฟอร์ม)[^\n.!?]{0,80}(?:มหาวิทยาลัย|นักศึกษา|งานทะเบียน)|(?:มหาวิทยาลัย|นักศึกษา|งานทะเบียน)[^\n.!?]{0,80}(?:แบบฟอร์ม|ฟอร์ม)|\b(?:university|student|college|campus|YRU)\b[^\n.!?]{0,80}\b(?:form|request|application|appeal)\b|\b(?:form|request|application|appeal)\b[^\n.!?]{0,80}\b(?:university|student|college|campus|YRU)\b/iu.test(requestContext);
 const institutionalFields=/(?:รหัสนักศึกษา|คณะ|สาขา|หลักสูตร|student\s+(?:ID|number)|faculty|curriculum\b)/iu.source;
 const personalFields=`(?:${institutionalFields}|${/(?:ชื่อ[\s-]*นามสกุล|ชื่อ\s+นามสกุล|ข้อมูล(?:การ)?ติดต่อ|เบอร์ติดต่อ|เบอร์โทร|หมายเลขโทรศัพท์|full\s+name|contact\s+(?:information|details)|(?:phone|telephone|contact)\s+number)/iu.source})`;
 const fields=`(?:${personalFields}${formContext?'|\\bprogram(?:me)?\\b|\\bmajor\\b|\\bphone\\b':''})`;
 // A direct field-entry imperative is still a prescription without a modal.
 // Form context and concrete field nouns keep topic/file names and resume advice separate.
 if(formContext&&new RegExp(`(?:ระบุ|กรอก)[^\\n.!?]{0,80}${fields}|\\b(?:provide|enter|include|fill in)\\b[^\\n.!?]{0,100}${fields}`,'iu').test(fieldStatements))return 'INSTITUTIONAL_REQUIREMENT';
 // A separate gather-information instruction can introduce a concrete form
 // checklist without repeating the earlier modal verb. As with attachment
 // checklists, source authority is still required; resume advice is not a form.
 if(formContext&&new RegExp(`(?:รวบรวม|เตรียม)(?:ข้อมูล|รายละเอียด)[^\\n.!?]{0,100}${fields}|\\b(?:gather|prepare|collect)\\s+(?:(?:your|personal|contact)\\s+)*(?:information|details|fields)\\b[^\\n.!?]{0,100}${fields}`,'iu').test(fieldStatements))return 'INSTITUTIONAL_REQUIREMENT';
 // Advisory wording needs form context; ordinary resume/contact advice remains general.
 const necessity=/(?:ข้อมูล(?:และข้อเท็จจริง)?|รายละเอียด(?:ส่วนตัว)?)(?:ที่)?(?:จำเป็น|ต้อง(?:กรอก|ใช้|เตรียม|ระบุ))[^\n.!?]{0,100}(?:เช่น|ได้แก่|คือ|:)[^\n.!?]{0,100}PERSONAL_FIELD|THAI_OBLIGATION(?:ระบุ|กรอก|เตรียม|ให้)[^\n.!?]{0,80}PERSONAL_FIELD|\b(?:required|mandatory|necessary)\s+(?:(?:personal|contact)\s+)?(?:information|details|fields|facts)\b[^\n.!?]{0,100}PERSONAL_FIELD|\bENGLISH_OBLIGATION\s+(?:provide|enter|include|fill in)\b[^\n.!?]{0,100}PERSONAL_FIELD/iu;
 const requiresFields=(advisory:boolean,fieldPattern:string)=>new RegExp(necessity.source
  .replace('THAI_OBLIGATION',advisory?'(?:จำเป็นต้อง|ต้อง|ควร)':'(?:จำเป็นต้อง|ต้อง)')
  .replace('ENGLISH_OBLIGATION',advisory?'(?:must|need to|required to|should)':'(?:must|need to|required to)')
  .replaceAll('PERSONAL_FIELD',fieldPattern).normalize('NFKC'),'iu').test(fieldStatements);
 if(requiresFields(false,fields)||requiresFields(true,formContext?fields:institutionalFields))return 'INSTITUTIONAL_REQUIREMENT';
 if(/(?:ค่าเทอม|ค่าธรรมเนียม|ค่าปรับ|ทุนการศึกษา|ลงทะเบียน|ระเบียบมหาวิทยาลัย|นโยบายมหาวิทยาลัย|tuition|university policy|registration deadline)/iu.test(normalized))return 'INSTITUTIONAL_TOPIC';
 // A relative deadline is still a concrete institutional claim without any digits.
 // Merely asking which university network was used today does not assert such a fact.
 if(/(?:รับสมัคร|เปิดภาคเรียน|ปิดภาคเรียน|(?:ห้องสมุด|หอพัก|มหาวิทยาลัย|\bYRU\b|university|library)[^\n.!?]{0,60}(?:เปิด|ปิด|deadline|closes?|opens?))[^\n.!?]{0,60}(?:วันนี้|พรุ่งนี้|มะรืน|เมื่อวาน|today|tomorrow|yesterday)/iu.test(actionStatements))return 'INSTITUTIONAL_NUMBER';
 if(/(?:รับสมัคร|เปิดภาคเรียน|ปิดภาคเรียน|ห้องสมุด|หอพัก|มหาวิทยาลัย|\bYRU\b|admissions?|academic calendar|university|library).{0,100}(?:[0-9๐-๙]|deadline|closes?\s+(?:at|on)|open\s+(?:at|on))/iu.test(actionStatements))return 'INSTITUTIONAL_NUMBER';
 if(/(?:บัญชี|สถานะ|ผลการเรียน|เกรด|ยอดเงิน)(?:ของคุณ|คุณ).{0,45}(?:ถูก|เป็น|ได้|แล้ว|ค้าง)|your\s+(?:account|grade|balance|enrollment)\s+(?:is|has|was)/iu.test(normalized))return 'PERSONAL_RECORD_CLAIM';
 if(/(?:เปิดเคส|สร้างเคส|สร้างตั๋ว|ส่งต่อเจ้าหน้าที่|รีเซ็ต|เปลี่ยนรหัสผ่าน|แก้ปัญหา).{0,40}(?:เรียบร้อย|แล้ว|สำเร็จ)|(?:I|we)\s+(?:have\s+)?(?:reset|created|submitted|sent|fixed|resolved|updated)\b/iu.test(actionStatements))return 'ACTION_COMPLETION';
 return null;
}
export function generalReplyNeedsEvidence(text:string,question?:string,history:Readonly<Context['history']>=[]):boolean{return generalReplyEvidenceReason(text,question,history)!==null;}
export function createConversationReply(context:Context,text:string):ConversationReply|null{
 if(!contextSchema.safeParse(context).success||generalReplyNeedsEvidence(text,context.question,context.history))return null;
 const parsed=conversationReplySchema.safeParse({kind:'CONVERSATION',basis:'GENERAL_MODEL',text,sourceDigest:digest(context)});
 if(!parsed.success)return null;
 try{lineMessages(parsed.data.text);return parsed.data;}catch{return null;}
}
export function verifyConversationReply(reply:ConversationReply,context:Context):boolean{
 try{return conversationReplySchema.safeParse(reply).success&&!generalReplyNeedsEvidence(reply.text,context.question,context.history)&&reply.sourceDigest===digest(context);}catch{return false;}
}
export function conversationReplyMessages(reply:ConversationReply){return lineMessages(conversationReplySchema.parse(reply).text);}
