import {expect,it} from 'vitest';
import {admitPeriodCandidateQuestion,inspectPeriodCandidate,periodCandidateResponseSchema} from '../scripts/qa/assistant-period-candidate';

const question='ไม่ใช้ปี2568แล้ว ขอหลักเกณฑ์การเทียบโอนเฉพาะปี2569 ต้องเตรียมอะไรบ้าง';
const scope=()=>({historical:true,academicYear:2569,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,
 studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null});
const plan=()=>({scope:scope(),selection:{method:'RAG',query:null,notApplicable:null}});
const proposal=()=>({resolution:{kind:'EXCLUSIVE_REPLACEMENT',discardedYear:2568,requestedYear:2569,
 discardedQuote:'ไม่ใช้ปี2568แล้ว',requestedQuote:'เฉพาะปี2569',plan:plan()}});

it('retains exact token text and positions without rewriting the current question',()=>{
 const input='😀 '+question,admitted=admitPeriodCandidateQuestion(input);
 expect(admitted).not.toBeNull();expect(admitted?.question).toBe(input);
 expect(admitted?.tokens.map(token=>({text:token.text,year:token.year,start:token.start,end:token.end}))).toEqual([
  {text:'2568',year:2568,start:input.indexOf('2568'),end:input.indexOf('2568')+4},
  {text:'2569',year:2569,start:input.indexOf('2569'),end:input.indexOf('2569')+4},
 ]);
 for(const token of admitted!.tokens)expect(input.slice(token.start,token.end)).toBe(token.text);
});
it.each(['year 2569 then year 2568','ปี2400 และปี3000','ปี 2568 กับปี 2569'])('admits only two lossless supported period tokens: %s',input=>{
 expect(admitPeriodCandidateQuestion(input)?.tokens).toHaveLength(2);
});
it.each([
 ['no period','ขอเกณฑ์ปัจจุบัน'],['one period','ขอเกณฑ์ปี2569'],['same period repeated','ปี2569 ไม่ใช่ปี2569'],
 ['third period','ปี2568 ไม่ใช่ปี2569 และปี2570'],['duplicate hidden by set','ปี2568 ปี2569 ปี2568'],
 ['unsupported year','ปี2025 และปี2569'],['out of supported scope','ปี3001 และปี2569'],
 ['ISO date','ปี2568 เปลี่ยนเป็นปี2569 ณ2026-10-19'],['cohort','รุ่นปี2568 ขอปี2569'],
 ['English cohort','cohort of 2568 year 2569'],['Thai code','หลักสูตร2568 ปี2569'],
 ['English code','curriculum code 2568 year 2569'],['third code','ปี2568 ปี2569 course code 2025'],
 ['Thai digits','ปี๒๕๖๘ ปี2569'],['hidden Thai period','ปี2568 ปี2569 ปี๒๕๗๐'],
 ['long digit run','ปี2568 ปี2569 รหัส12345678'],['UTF8 bound','ก'.repeat(2000)+'ปี2568 ปี2569'],
 ['empty',''],['non text',null],
 ['slash date','10/05/2568 หรือปี2569'],['dotted date','10.05.2568 กับปี2569'],
 ['dash date','31-12-2568 กับปี2569'],['marked day and month','วันที่10 เดือน5 ปี2568 กับปี2569'],
 ['date with words','วันที่สิบพฤษภาคมปี2568 เทียบกับปี2569'],
 ['bare identifier','CS2568 กับปี2569'],['identifier suffix','ปี2568A กับปี2569'],
 ['bare numeric labels','รหัส2568 เทียบกับ2569'],['unmarked first year','2568 แล้วขอปี2569'],
 ['extra numeric detail','ไม่ใช้ปี2568แล้ว ขอเฉพาะปี2569 ข้อ2'],
])('keeps unsupported or non-temporal admission closed: %s',(_name,input)=>{
 expect(admitPeriodCandidateQuestion(input)).toBeNull();
 expect(inspectPeriodCandidate(input,proposal())).toEqual({kind:'INELIGIBLE',executionAuthorized:false});
});
it('accepts a strict non-executable ambiguous response with no plan',()=>{
 const output={resolution:{kind:'AMBIGUOUS'}};
 expect(periodCandidateResponseSchema.safeParse(output).success).toBe(true);
 expect(inspectPeriodCandidate(question,output)).toEqual({kind:'AMBIGUOUS',executionAuthorized:false});
});
it.each([
 {resolution:{kind:'AMBIGUOUS',plan:plan()}},
 {resolution:{kind:'AMBIGUOUS',requestedYear:2569}},
 {resolution:{kind:'AMBIGUOUS'},plan:plan()},
 {resolution:{kind:'UNKNOWN'}},
 {resolution:{...proposal().resolution,requestedQuote:null}},
 {resolution:{...proposal().resolution,plan:{...plan(),scope:{...scope(),academicYear:null}}}},
 {resolution:{...proposal().resolution,plan:{...plan(),scope:{...scope(),madeUpField:true}}}},
])('rejects malformed or executable ambiguity and preserves the original plan scope refinement',output=>{
 expect(periodCandidateResponseSchema.safeParse(output).success).toBe(false);
 expect(inspectPeriodCandidate(question,output)).toEqual({kind:'INVALID',executionAuthorized:false});
});
it('retains a fully valid proposal while explicitly withholding execution authority',()=>{
 const input=proposal(),original=JSON.stringify(input),result=inspectPeriodCandidate(question,input);
 expect(result).toMatchObject({kind:'EXCLUSIVE_PROPOSAL',executionAuthorized:false,discardedYear:2568,requestedYear:2569,plan:plan()});
 expect(JSON.stringify(input)).toBe(original);
});
it.each([
 {requestedYear:2570}, {discardedYear:2569}, {discardedQuote:'ปี2567'}, {requestedQuote:'เฉพาะปี2567'},
 {requestedQuote:'เฉพาะปี'}, {discardedQuote:question}, {requestedQuote:'เฉพาะปี2569X'},
 {plan:{...plan(),scope:{...scope(),academicYear:2568}}},
 {plan:{...plan(),scope:{...scope(),academicYear:null}}},
 {plan:{...plan(),scope:{...scope(),asOfDate:'2026-10-19'}}},
 {plan:{...plan(),scope:{...scope(),historical:false}}},
])('rejects wrong/missing periods and unsupported quote or scope repairs',patch=>{
 expect(inspectPeriodCandidate(question,{resolution:{...proposal().resolution,...patch}})).toEqual({kind:'INVALID',executionAuthorized:false});
});
it('requires two disjoint quote spans, rather than overlapping text fragments',()=>{
 const text='Discard year 2568; I want only academic year 2569.';
 const input={resolution:{...proposal().resolution,discardedQuote:'year 2568; I want',requestedQuote:'want only academic year 2569'}};
 expect(inspectPeriodCandidate(text,input)).toEqual({kind:'INVALID',executionAuthorized:false});
});
it('retains the explicit current-year semantics without mutating a historical scope',()=>{
 const text='ไม่ใช้ปี2568แล้ว ขอหลักเกณฑ์ปัจจุบันเฉพาะปี2569';
 expect(inspectPeriodCandidate(text,proposal())).toEqual({kind:'INVALID',executionAuthorized:false});
 const input={resolution:{...proposal().resolution,requestedQuote:'ขอหลักเกณฑ์ปัจจุบันเฉพาะปี2569',plan:{...plan(),scope:{...scope(),historical:false}}}};
 expect(inspectPeriodCandidate(text,input)).toMatchObject({kind:'EXCLUSIVE_PROPOSAL',executionAuthorized:false,plan:{scope:{historical:false,academicYear:2569}}});
});
it('does not borrow an unquoted current cue for a requested year',()=>{
 const text='ไม่ใช้ปี2568แล้ว ขอหลักเกณฑ์ปัจจุบันเฉพาะปี2569';
 const input={resolution:{...proposal().resolution,plan:{...plan(),scope:{...scope(),historical:false}}}};
 expect(inspectPeriodCandidate(text,input)).toEqual({kind:'INVALID',executionAuthorized:false});
});
it.each([true,false])('keeps a current cue about the discarded/source year from deciding target scope: %s',historical=>{
 const text='the notice calls year2568 current; I need only historical year2569';
 const input={resolution:{...proposal().resolution,discardedQuote:'the notice calls year2568 current',requestedQuote:'I need only historical year2569',plan:{...plan(),scope:{...scope(),historical}}}};
 expect(inspectPeriodCandidate(text,input)).toEqual({kind:'INVALID',executionAuthorized:false});
});
it.each([2568,2569])('checks a present structured academic_year against the requested period: %s',year=>{
 const input={resolution:{...proposal().resolution,plan:{scope:scope(),selection:{method:'STRUCTURED',notApplicable:null,query:{version:1,dataset:'academic_calendar_events',filters:[{field:'academic_year',value:year}],limit:20}}}}};
 expect(inspectPeriodCandidate(question,input).kind).toBe(year===2569?'EXCLUSIVE_PROPOSAL':'INVALID');
});
it('does not invent a missing structured row selector',()=>{
 const input={resolution:{...proposal().resolution,plan:{scope:scope(),selection:{method:'STRUCTURED',notApplicable:null,query:{version:1,dataset:'academic_calendar_events',filters:[],limit:20}}}}};
 expect(inspectPeriodCandidate(question,input)).toMatchObject({kind:'EXCLUSIVE_PROPOSAL',executionAuthorized:false,plan:{selection:{query:{filters:[]}}}});
});
it('does not mistake literal provenance for semantic permission on a conditional source excerpt',()=>{
 const text='เอกสารระบุว่า ไม่ใช้ปี2568แล้ว ขอหลักเกณฑ์เฉพาะปี2569 หากปีนั้นใช้ได้';
 const result=inspectPeriodCandidate(text,proposal());
 expect(result).toMatchObject({kind:'EXCLUSIVE_PROPOSAL',executionAuthorized:false});
 expect(result).not.toHaveProperty('execute');
});
