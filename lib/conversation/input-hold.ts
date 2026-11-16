/**
 * CONV-BURST-01 / CONV-GREET-01 (DEC-206). Deterministic text rules for real LINE typing.
 * The hold only changes how long the collection window waits for more fragments; it never decides
 * meaning, routing, retrieval or authority. Greeting detection only replaces a model call for a turn
 * that carries nothing but a greeting or thanks; any other content goes through the normal flow.
 * No 'server-only': the webhook ingress and the AI worker both use it.
 */
export const INPUT_QUIET_MS=2500;
export const INPUT_EXTENDED_QUIET_MS=8000;
export const INPUT_WINDOW_CAP_MS=15000;
export type InputHold='NORMAL'|'EXTENDED';
export type GreetingKind='GREETING'|'THANKS';

const PARTICLE='(?:ครับผม|ครับ|คับ|ค่ะ|คะ|ค่า|คร่า|จ้า|จ้ะ|จ๊ะ|นะ|ฮะ|ฮับ|เด้อ|ค้าบ|งับ)';
const ADDRESSEE='(?:แอดมิน|admin|พี่ๆ|พี่|น้อง|บอท|bot|ทุกคน|everyone|there)';
const GREET=`(?:สวัสดี|หวัดดี|ดี(?=${PARTICLE})|hello|helo|hi|hey|goodmorning|goodafternoon|goodevening)`;
const THANK='(?:ขอบคุณ|ขอบใจ|thankyou|thanks|thank|thx|ty)';
const FILLER=`(?:${PARTICLE}|${ADDRESSEE}|มากๆ|มาก|ๆ|so much|somuch|verymuch|alot)`;
const greetingTurn=new RegExp(`^(?:(?:${GREET}|${THANK})${FILLER}*)+$`,'u');
const hasGreet=new RegExp(GREET,'u');
const particlesOnly=new RegExp(`^${PARTICLE}+$`,'u');
const opener=new RegExp(`^(?:(?:ขอ|รบกวน)?(?:สอบถาม|ถาม)(?:หน่อย|นิดนึง|นิดหน่อย|ค่ะ|ครับ)?|อยาก(?:สอบ)?ถาม(?:ว่า)?|มีเรื่อง(?:จะ)?(?:ถาม|ปรึกษา|สอบถาม)|คือ(?:ว่า)?|แล้วก็|แล้ว|เอ่อ|อ่า|อืม|อ่ะ|แบบ(?:ว่า)?|question)${PARTICLE}*$`,'u');
const danglingEnd=/(?:\.\.\.|…|,|ว่า|เรื่อง|เกี่ยวกับ|แล้วก็|และ|คือ)$/u;

/** NFKC, lower case, no invisible marks, no punctuation/emoji, repeated Thai letters collapsed, no spaces. */
function compact(text:string):string{
 return text.normalize('NFKC').toLowerCase().replace(/[​-‏‪-‮⁠-⁯﻿]/gu,'')
  .replace(/[\p{P}\p{S}\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}]/gu,' ')
  .replace(/([ก-ฮะ-ูเ-ๅ])\1{2,}/gu,'$1').replace(/\s+/gu,'');
}
function graphemes(text:string):number{
 let count=0;for(const piece of new Intl.Segmenter('th',{granularity:'grapheme'}).segment(text)){void piece;count++;}return count;
}

/** The whole turn (all fragments joined) is only a greeting or thanks. */
export function greetingKind(text:string):GreetingKind|null{
 if(typeof text!=='string'||text.length>500)return null;
 const value=compact(text);
 if(!value||!greetingTurn.test(value))return null;
 return hasGreet.test(value)?'GREETING':'THANKS';
}

/** Longer wait when the latest fragment looks unfinished; it never changes the answer itself. */
export function inputHoldForText(text:string):InputHold{
 if(typeof text!=='string'||text.length>500)return 'NORMAL';
 const trimmed=text.normalize('NFKC').trim();
 if(danglingEnd.test(trimmed))return 'EXTENDED';
 const value=compact(trimmed);
 if(!value)return 'NORMAL';
 if(greetingKind(trimmed)==='GREETING'||particlesOnly.test(value)||opener.test(value)||graphemes(value)<=2)return 'EXTENDED';
 return 'NORMAL';
}

/** Reads only a LINE text message event; every other event keeps the normal gap. */
export function inputHoldForEvent(event:unknown):InputHold{
 if(!event||typeof event!=='object')return 'NORMAL';
 const data=event as {type?:unknown;message?:{type?:unknown;text?:unknown}|null};
 if(data.type!=='message'||!data.message||typeof data.message!=='object'||data.message.type!=='text'||typeof data.message.text!=='string')return 'NORMAL';
 return inputHoldForText(data.message.text);
}

const GREETING_TEXT='สวัสดีครับ ผู้ช่วย YRU พร้อมตอบคำถามเรื่องการเรียนและบริการของมหาวิทยาลัยครับ พิมพ์คำถามมาได้เลย หรือเลือกหัวข้อด้านล่างครับ';
const THANKS_TEXT='ยินดีครับ ถ้ามีคำถามเพิ่มเติมพิมพ์มาได้เลยนะครับ';
/** Popular starting topics. Each button sends its label as an ordinary Student message (no new authority). */
export const GREETING_TOPICS=['ลงทะเบียนเรียน','ค่าเทอม','ติดต่อเจ้าหน้าที่'] as const;
export function greetingReply(kind:GreetingKind):{text:string;topics:string[]}{
 return kind==='GREETING'?{text:GREETING_TEXT,topics:[...GREETING_TOPICS]}:{text:THANKS_TEXT,topics:[]};
}
export function isGreetingReplyText(text:string):boolean{return text===GREETING_TEXT||text===THANKS_TEXT;}
