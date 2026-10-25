import {z} from 'zod';
import {lookupPlanSchema} from './lookup-plan';

// These checks establish literal provenance only. The existing planner must
// interpret exclusivity; source eligibility and ordinary scope checks still run.
interface YearToken {year:number;start:number;end:number}
export interface PeriodPlanInput {question:string;tokens:[YearToken,YearToken]}
export function periodPlanInput(question:string):PeriodPlanInput|null {
 if(/\b(?:date|dated|month|today|currently|now)\b|\b(?:as\s+of|this\s+year)\b|วันที่|เดือน|วันนี้|ปีนี้|ขณะนี้|ตอนนี้/iu.test(question))return null;
 const tokens:YearToken[]=[];
 for(const match of question.matchAll(/(?<!\d)\d{4}(?!\d)/gu)){
  const year=Number(match[0]);
  if(year<2400||year>3000||typeof match.index!=='number')return null;
  const before=question.slice(0,match.index),after=question.slice(match.index+4);
  if(!/(?:\byear|ปี(?:การศึกษา)?)[\s:=-]*(?:พ\.?ศ\.?\s*)?$/iu.test(before)||/^[A-Za-z0-9_]/u.test(after))return null;
  tokens.push({year,start:match.index,end:match.index+4});
 }
 if(tokens.length!==2||tokens[0].year===tokens[1].year)return null;
 const outside=question.slice(0,tokens[0].start)+question.slice(tokens[0].end,tokens[1].start)+question.slice(tokens[1].end);
 if(/\p{Decimal_Number}/u.test(outside))return null;
 return {question,tokens:[tokens[0],tokens[1]]};
}
const year=z.number().int().min(2400).max(3000),quote=z.string().min(1).max(1000);
export const periodPlanSchema=z.strictObject({resolution:z.discriminatedUnion('kind',[
 z.strictObject({kind:z.enum(['AMBIGUOUS'])}),
 z.strictObject({kind:z.enum(['EXCLUSIVE_REPLACEMENT']),discardedYear:year,requestedYear:year,discardedQuote:quote,requestedQuote:quote,plan:lookupPlanSchema}),
])});
function witness(input:PeriodPlanInput,text:string,year:number):{start:number;end:number}|null {
 const token=input.tokens.find(item=>item.year===year),start=input.question.indexOf(text),end=start+text.length;
 if(!token||start<0||start!==input.question.lastIndexOf(text)||start>token.start||end<token.end)return null;
 const years=[...text.matchAll(/(?<!\d)\d{4}(?!\d)/gu)].map(item=>Number(item[0]));
 return years.length===1&&years[0]===year?{start,end}:null;
}
export function resolvePeriodPlan(input:PeriodPlanInput,output:unknown):
 |{kind:'INVALID'|'AMBIGUOUS'}|{kind:'RESOLVED';requestedYear:number;plan:z.infer<typeof lookupPlanSchema>} {
 const parsed=periodPlanSchema.safeParse(output);if(!parsed.success)return {kind:'INVALID'};
 const resolution=parsed.data.resolution;if(resolution.kind==='AMBIGUOUS')return {kind:'AMBIGUOUS'};
 if(resolution.discardedYear===resolution.requestedYear)return {kind:'INVALID'};
 const discarded=witness(input,resolution.discardedQuote,resolution.discardedYear),requested=witness(input,resolution.requestedQuote,resolution.requestedYear);
 if(!discarded||!requested||discarded.start<requested.end&&requested.start<discarded.end)return {kind:'INVALID'};
 const {scope,selection}=resolution.plan;
 const currentCues=[...input.question.matchAll(/\bcurrent\b|ปัจจุบัน/giu)];
 if(currentCues.some(item=>typeof item.index!=='number'||item.index<requested.start||item.index+item[0].length>requested.end))return {kind:'INVALID'};
 // A matched named year with no current cue passes to the producer's existing
 // sole-USER-year canonicalizer. Never rewrite the proposal here or normalize a
 // mismatched/missing year, a date, or an explicitly current historical plan.
 if(scope.academicYear!==resolution.requestedYear||scope.asOfDate!==null||currentCues.length>0&&scope.historical)return {kind:'INVALID'};
 if(selection.method==='STRUCTURED'&&selection.query.filters.some(filter=>filter.field==='academic_year'&&filter.value!==resolution.requestedYear))return {kind:'INVALID'};
 return {kind:'RESOLVED',requestedYear:resolution.requestedYear,plan:resolution.plan};
}
export const PERIOD_PLAN_GUIDANCE=`The current USER question contains two literal years. Interpret the complete question, including conditions and quoted source text, before choosing a period. Return resolution AMBIGUOUS with no plan if the user compares years, offers alternatives, quotes another source's instruction, states a conditional or unresolved change, or does not exclusively discard one year and request the other now. Only for an unambiguous current USER replacement return EXCLUSIVE_REPLACEMENT, the discardedYear and requestedYear, exact unique disjoint verbatim discardedQuote and requestedQuote from that question, and a complete plan under plan. Each quote must include its own year and the words expressing rejection or exclusive request; the requestedQuote must include any current-information cue. Never select the larger/latest year by default or borrow years from assistant/history. A named year is historical=true unless the requested USER clause explicitly asks for current information. The nested plan obeys every ordinary scope and source instruction. These are proposals, not permission to bypass backend validation.`;
