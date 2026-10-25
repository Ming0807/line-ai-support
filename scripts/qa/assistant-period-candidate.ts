import {z} from 'zod';
import {lookupPlanSchema} from '../../lib/knowledge/lookup-plan';

// QA candidate only. Literal provenance is not semantic intent or retrieval
// authority. No production caller uses this module; every result withholds it.
interface YearToken {text:string;year:number;start:number;end:number}
interface AdmittedQuestion {question:string;tokens:[YearToken,YearToken]}
const MAX_QUESTION_BYTES=6000;
const cohortYear=/(?:รุ่น(?:\s*ปี)?|ปีรุ่น|cohort(?:\s+(?:year|of))?)\s*(?:พ\.?ศ\.?\s*)?\d{4}/iu;
const codeYear=/(?:curriculum(?:[\s_-]*code)?|หลักสูตร(?:[\s_-]*code|[\s_-]*รหัส)?|program[\s_-]*code|programme[\s_-]*code|course[\s_-]*code|รหัส(?:หลักสูตร|สาขา|โปรแกรม))[\s_:#-]*(?:พ\.?ศ\.?\s*)?\d{4}/iu;
const encoder=new TextEncoder();

export function admitPeriodCandidateQuestion(question:unknown):AdmittedQuestion|null {
 if(typeof question!=='string'||!question.trim()||question.length>MAX_QUESTION_BYTES||encoder.encode(question).byteLength>MAX_QUESTION_BYTES)return null;
 if(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/u.test(question)||cohortYear.test(question)||codeYear.test(question)||/\d{5,}/u.test(question)
  ||/\b(?:date|dated)\b|\bas\s+of\b|วันที่/iu.test(question))return null;
 const digits=question.match(/\p{Decimal_Number}/gu)??[];
 if(digits.some(digit=>!/^[0-9]$/u.test(digit)))return null;
 const tokens:YearToken[]=[];
 for(const match of question.matchAll(/(?<!\d)\d{4}(?!\d)/gu)){
  const year=Number(match[0]);
  if(year<2400||year>3000||typeof match.index!=='number')return null;
  tokens.push({text:match[0],year,start:match.index,end:match.index+match[0].length});
 }
 if(tokens.length!==2||tokens[0].year===tokens[1].year)return null;
 // No extra numeric date/identifier components, even outside ISO spelling.
 const outsideTokens=question.slice(0,tokens[0].start)+question.slice(tokens[0].end,tokens[1].start)+question.slice(tokens[1].end);
 if(/\d/u.test(outsideTokens))return null;
 for(const token of tokens){
  if(!/(?:\byear|ปี(?:การศึกษา)?)[\s:=-]*(?:พ\.?ศ\.?\s*)?$/iu.test(question.slice(0,token.start))
   ||/^[A-Za-z0-9_]/u.test(question.slice(token.end)))return null;
 }
 return {question,tokens:[tokens[0],tokens[1]]};
}

const year=z.number().int().min(2400).max(3000),quote=z.string().min(1).max(1000);
export const periodCandidateResponseSchema=z.strictObject({resolution:z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('AMBIGUOUS')}),
 z.strictObject({kind:z.literal('EXCLUSIVE_REPLACEMENT'),discardedYear:year,requestedYear:year,
  discardedQuote:quote,requestedQuote:quote,plan:lookupPlanSchema}),
])});
type CandidateResolution=z.infer<typeof periodCandidateResponseSchema>['resolution'];
type ExclusiveResolution=Extract<CandidateResolution,{kind:'EXCLUSIVE_REPLACEMENT'}>;
type Inspection={kind:'INELIGIBLE'|'INVALID'|'AMBIGUOUS';executionAuthorized:false}
 | {kind:'EXCLUSIVE_PROPOSAL';executionAuthorized:false;discardedYear:number;requestedYear:number;
  plan:ExclusiveResolution['plan'];quoteWitnesses:{discarded:{start:number;end:number};requested:{start:number;end:number}}};

function quoteWitness(question:string,text:string,token:YearToken):{start:number;end:number}|null {
 const start=question.indexOf(text),end=start+text.length;
 if(start<0||start!==question.lastIndexOf(text)||start>token.start||end<token.end)return null;
 const years=[...text.matchAll(/(?<!\d)\d{4}(?!\d)/gu)].map(match=>Number(match[0]));
 return years.length===1&&years[0]===token.year?{start,end}:null;
}

export function inspectPeriodCandidate(question:unknown,output:unknown):Inspection {
 const admitted=admitPeriodCandidateQuestion(question);
 if(!admitted)return {kind:'INELIGIBLE',executionAuthorized:false};
 const parsed=periodCandidateResponseSchema.safeParse(output);
 if(!parsed.success)return {kind:'INVALID',executionAuthorized:false};
 const resolution=parsed.data.resolution;
 if(resolution.kind==='AMBIGUOUS')return {kind:'AMBIGUOUS',executionAuthorized:false};
 const discarded=admitted.tokens.find(token=>token.year===resolution.discardedYear);
 const requested=admitted.tokens.find(token=>token.year===resolution.requestedYear);
 if(!discarded||!requested||discarded===requested)return {kind:'INVALID',executionAuthorized:false};
 const discardedQuote=quoteWitness(admitted.question,resolution.discardedQuote,discarded);
 const requestedQuote=quoteWitness(admitted.question,resolution.requestedQuote,requested);
 if(!discardedQuote||!requestedQuote||discardedQuote.start<requestedQuote.end&&requestedQuote.start<discardedQuote.end)
  return {kind:'INVALID',executionAuthorized:false};
 const {scope,selection}=resolution.plan;
 const currentCues=[...admitted.question.matchAll(/\bcurrent\b|ปัจจุบัน/giu)];
 if(currentCues.some(match=>typeof match.index!=='number'||match.index<requestedQuote.start||match.index+match[0].length>requestedQuote.end))
  return {kind:'INVALID',executionAuthorized:false};
 const explicitCurrent=currentCues.length>0;
 if(scope.academicYear!==requested.year||scope.asOfDate!==null||scope.historical===explicitCurrent)return {kind:'INVALID',executionAuthorized:false};
 if(selection.method==='STRUCTURED'&&selection.query.filters.some(filter=>filter.field==='academic_year'&&filter.value!==requested.year))
  return {kind:'INVALID',executionAuthorized:false};
 // Other scope facts, selectors, clause meaning and model reliability remain
 // unverified. A future production design must run its existing validators.
 return {kind:'EXCLUSIVE_PROPOSAL',executionAuthorized:false,discardedYear:discarded.year,requestedYear:requested.year,
  plan:resolution.plan,quoteWitnesses:{discarded:discardedQuote,requested:requestedQuote}};
}
