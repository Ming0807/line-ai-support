/**
 * Scope grounding validators shared by the knowledge producer and CONV-V2 tool dispatch.
 * A model-proposed scope is accepted only when every field is literally supported by USER text.
 * Moved unchanged from answer-producer.ts (CONV-V2-01); behavior must not change here.
 */
import type {AISnapshot} from '../ai/run-worker';
import type {KnowledgeScope} from './types';
import type {StructuredQuery} from './structured-query';

export function structuredSelectorsGrounded(query:StructuredQuery,snapshot:AISnapshot,scope:KnowledgeScope):boolean {
 const text=scopeContext(snapshot),normalized=normalizedText(text);
 return Object.entries(query.filters).every(([field,value])=>{
  if(value===null)return /(?:ไม่ระบุสาขา|ไม่มีสาขา|no major|null)/iu.test(text);
  if(field==='academic_year')return scope.academicYear===value&&temporalParts(text).years.includes(Number(value));
  if(field==='semester')return explicitlyMentioned(String(value),text);
  if(typeof value==='number'||/^(?:fee_amount|source_credits|target_credits)/u.test(field)){
   const term=String(value).replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');return new RegExp(`(?<![\\d.])${term}(?![\\d.])`,'u').test(text);
  }
  if(value==='ALL')return /\ball\b|ทุก(?:ประเภท|กลุ่ม|หลักสูตร)/iu.test(text);
  if(typeof value!=='string')return false;
  if(query.dataset==='announcements'&&field==='title'&&snapshot.continuesOwnedConversation===true){
   // Backend-owned continuation admits a literal record name from the latest
   // USER turn. It does not admit quoted facts as evidence or fill applicability.
   const previousUser=snapshot.history.filter(turn=>turn.role==='user').at(-1)?.content;
   if(previousUser&&explicitlyMentioned(value,previousUser))return true;
  }
  if(field==='program_name'&&!explicitlyMentioned(value,snapshot.question)){
   const prior=snapshot.history.filter(turn=>turn.role==='user').at(-1)?.content;
   return snapshot.continuesOwnedConversation===true&&Boolean(prior&&explicitlyMentioned(value,prior))
    &&!/(?:หลักสูตร|สาขา|\bprogram(?:me)?\b|\bmajor\b)/iu.test(snapshot.question);
  }
  const term=normalizedText(value);return term.length>0&&(/^[a-z0-9 ]+$/iu.test(term)?(` ${normalized} `).includes(` ${term} `):normalized.includes(term));
 });
}

export interface QueryTime {
 years:number[];
 dates:string[];
 cohorts:number[];
 mentioned:boolean;
 ambiguousHistorical:boolean;
 current:boolean;
 /** A unique prior literal USER year, admitted only by backend-owned continuation. */
 ownedYear:number|null;
}

const COHORT_YEAR_PATTERN=/(?:รุ่น(?:\s*ปี)?|ปีรุ่น|cohort(?:\s+(?:year|of))?)\s*(?:พ\.?ศ\.?\s*)?(24\d{2}|25\d{2}|26\d{2}|27\d{2}|28\d{2}|29\d{2}|3000)(?!\d)/gi;
const NON_TEMPORAL_CODE_YEAR_PATTERN=/(?:curriculum(?:[\s_-]*code)?|หลักสูตร(?:[\s_-]*code|[\s_-]*รหัส)?|program[\s_-]*code|programme[\s_-]*code|course[\s_-]*code|รหัส(?:หลักสูตร|สาขา|โปรแกรม))[\s_:#-]*(?:พ\.?ศ\.?\s*)?\d{4}/gi;
const HISTORICAL_CUE=/(?:ย้อนหลั|ในอดีต|ที่ผ่านมา|ปีที่แล้ว|ปีก่อน|เมื่อก่อน|สมัยก่อน|ประวัติ|ย้อนหลัง|histor(?:y|ical)|previous|past|last year|as of|that year|same year|that date|same date|ปีนั้น|ปีดังกล่าว|วันที่นั้น|วันที่ดังกล่าว)/i;
const DIRECT_TIME_REFERENCE=/\b(?:that year|same year|that date|same date)\b|(?:ปีนั้น|ปีดังกล่าว|วันที่นั้น|วันที่ดังกล่าว)/i;
const DIRECT_SCOPE_REFERENCE=/\b(?:(?:that|same|those|these)\s+(?:student|students|program|programs|curriculum|cohort|semester|student type|audience|department|rules|requirements|case|group)|for them|that group)\b|(?:ประเภทเดิม|หลักสูตรเดิม|รุ่นเดิม|ภาคเรียนเดิม|กลุ่มนักศึกษาเดิม|กรณี(?:เดิม|ดังกล่าว)|หลักสูตรดังกล่าว|รุ่นดังกล่าว|ประเภทดังกล่าว|ปีนั้น|วันที่ดังกล่าว|กลุ่มนี้|ตามกรณีเดิม)/i;

export function temporalParts(text:string):{years:number[];dates:string[];cohorts:number[];unsupportedYear:boolean} {
 const datePattern=/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g;
 const dates=[...text.matchAll(datePattern)].map(match=>match[0]);
 const withoutDates=text.replace(datePattern,' ');
 const cohorts=[...withoutDates.matchAll(COHORT_YEAR_PATTERN)].map(match=>Number(match[1]));
 const withoutCohorts=withoutDates.replace(COHORT_YEAR_PATTERN,' ');
 const withoutCodeYears=withoutCohorts.replace(NON_TEMPORAL_CODE_YEAR_PATTERN,' ');
 const years=[...withoutCodeYears.matchAll(/(?<!\d)(?:24\d{2}|25\d{2}|26\d{2}|27\d{2}|28\d{2}|29\d{2}|3000)(?!\d)/g)]
  .map(match=>Number(match[0]));
 const unsupportedYears=[...withoutCodeYears.matchAll(/(?<!\d)(?:18|19|20|21|22|23)\d{2}(?!\d)/g)];
 return {years:[...new Set(years)],dates:[...new Set(dates)],cohorts:[...new Set(cohorts)],unsupportedYear:unsupportedYears.length>0};
}

export function timeInQuestion(question:string,history:AISnapshot['history'],continuesOwnedConversation=false):QueryTime {
 const current=temporalParts(question);
 let years=current.years,dates=current.dates;
 let mentioned=years.length>0||dates.length>0||current.unsupportedYear;
 const directReference=DIRECT_TIME_REFERENCE.test(question);
 let ownedYear:number|null=null,unresolvedOwnedPeriod=false;
 const currentRequested=/\bcurrent\b|ปัจจุบัน/i.test(question);
 if(!mentioned&&directReference){
  const earlierUserTime=history.filter(item=>item.role==='user').map(item=>temporalParts(item.content));
  years=[...new Set(earlierUserTime.flatMap(item=>item.years))];
  dates=[...new Set(earlierUserTime.flatMap(item=>item.dates))];
  const unsupportedYear=earlierUserTime.some(item=>item.unsupportedYear);
  const historicalReferenceCount=years.length+dates.length;
  mentioned=!unsupportedYear&&historicalReferenceCount>0&&years.length<=1&&dates.length<=1;
  if(!mentioned){years=[];dates=[];}
 }
 if(!mentioned&&!directReference&&!currentRequested&&continuesOwnedConversation){
  const prior=history.filter(item=>item.role==='user').map(item=>temporalParts(item.content));
  const priorYears=[...new Set(prior.flatMap(item=>item.years))];
  // Do not choose by recency, or combine a year with a different dated period.
  // Multiple explicit years remain visible to the existing ambiguity preguard.
  if(priorYears.length>0&&!prior.some(item=>item.unsupportedYear||item.dates.length)){
   years=priorYears;mentioned=true;if(years.length===1)ownedYear=years[0];
  }else if(priorYears.length>0)unresolvedOwnedPeriod=true;
 }
 const ambiguousHistorical=unresolvedOwnedPeriod||HISTORICAL_CUE.test(question)&&!mentioned;
 return {years,dates,cohorts:current.cohorts,mentioned,ambiguousHistorical,current:currentRequested,ownedYear};
}

export function temporalScopeMatches(scope:KnowledgeScope,time:QueryTime):boolean {
 if(time.ambiguousHistorical)return false;
 if(!time.mentioned)return !scope.historical&&scope.academicYear===null&&scope.asOfDate===null;
 if(time.current&&time.years.length===1&&time.dates.length===0)return !scope.historical&&scope.academicYear===time.years[0]&&scope.asOfDate===null;
 if(!scope.historical||time.years.length>1||time.dates.length>1)return false;
 if(time.years.length===1&&scope.academicYear!==time.years[0])return false;
 if(time.dates.length===1&&scope.asOfDate!==time.dates[0])return false;
 if(time.years.length===0&&scope.academicYear!==null)return false;
 if(time.dates.length===0&&scope.asOfDate!==null)return false;
 return scope.academicYear!==null||scope.asOfDate!==null;
}

export function scopeContext(snapshot:AISnapshot):string {
 const text=[snapshot.question];
 if(DIRECT_SCOPE_REFERENCE.test(snapshot.question))
  text.push(...snapshot.history.filter(item=>item.role==='user').slice(-4).map(item=>item.content));
 return text.join(' ');
}

export function normalizedText(value:string):string {
 return value.normalize('NFKC').toLocaleLowerCase('en').replace(/[_-]+/g,' ')
  .replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/gu,' ').trim();
}

export function explicitlyMentioned(value:string|null,text:string):boolean {
 if(value===null)return true;
 const term=normalizedText(value);
 if(term==='all')return true;
 const normalized=normalizedText(text);
 if(/^\d+$/.test(term)){
  const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`(?:semester|term|ภาคเรียน|เทอม)\\s*(?:no\\.?\\s*|ที่\\s*)?${escaped}(?!\\d)`,'i').test(text);
 }
 if(/^[A-Z0-9]{1,2}$/.test(value)){
  const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(text);
 }
 if(!term)return false;
 if(/^[a-z0-9 ]+$/i.test(term))return (` ${normalized} `).includes(` ${term} `);
 return normalized.includes(term);
}

export function groundedLabel(field:'audience'|'studentType'|'departmentCode',value:string|null,text:string):boolean {
 if(explicitlyMentioned(value,text))return true;
 if(value===null)return true;
 const aliases:Record<string,string[]> = field==='departmentCode'?{
  IT:['ไอที','เทคโนโลยีสารสนเทศ'],LIBRARY:['ห้องสมุด'],REGISTRATION:['ทะเบียน','รับสมัคร'],REGISTRAR:['ทะเบียน','รับสมัคร'],
 }:{REGULAR:['ภาคปกติ'],WEEKEND:['ภาคพิเศษ','กศ.บป.','เสาร์อาทิตย์']};
 const normalized=normalizedText(text);
 return (aliases[value]??[]).some(alias=>normalized.includes(normalizedText(alias)));
}

export function scopeIsGrounded(scope:KnowledgeScope,snapshot:AISnapshot,time:QueryTime,acceptedDepartment?:string|null):boolean {
 const text=scopeContext(snapshot);
 const departmentMatches=scope.departmentCode===null||(acceptedDepartment?scope.departmentCode===acceptedDepartment:groundedLabel('departmentCode',scope.departmentCode,text));
 if(!departmentMatches||!groundedLabel('audience',scope.audience,text)||
  !groundedLabel('studentType',scope.studentType,text)||!explicitlyMentioned(scope.semester,text)||
  !explicitlyMentioned(scope.programCode,text)||!explicitlyMentioned(scope.curriculumCode,text))return false;
 const scopedCohorts=temporalParts(text).cohorts;
 if(scopedCohorts.length>1)return false;
 if(scopedCohorts.length===1&&scope.cohort!==scopedCohorts[0])return false;
 if(scope.cohort!==null&&scopedCohorts[0]!==scope.cohort)return false;
 if(time.cohorts.length>1)return false;
 return true;
}
