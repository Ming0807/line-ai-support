import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readdirSync,readFileSync} from 'node:fs';
import {relative,resolve} from 'node:path';

/** Deterministic flags only enqueue human review; they never score or accept a run. */
export type Severity='REVIEW'|'INFO';
export interface TurnInput{
 question:string;text:string|null;resultKind:string|null;elapsedMs:number;
 attempts?:{status:string;error_code:string|null}[];
 observations?:{action?:string;result?:string;error_code?:string|null}[];
}
export interface Flag{code:string;severity:Severity;detail:string}
export interface TurnFlag{reportPath:string;reportSha256:string;caseId:string;turnIndex:number;flags:Flag[]}

const MAX_FILES=500,MAX_REVIEW_RECORDS=10_000,MAX_FILE_BYTES=5*1024*1024,MAX_RECORDS=2_000,MAX_TURNS_PER_RECORD=100;
const MAX_TURNS_PER_REPORT=20_000,MAX_TOTAL_TURNS=100_000,MAX_DIAGNOSTICS=2_000;
const MAX_QUESTION_CHARS=20_000,MAX_ANSWER_CHARS=12_000,MAX_OBSERVATIONS=200;
const AVAILABILITY_FALLBACK='ตอบคำถามนี้ไม่สำเร็จ';
const NO_DOCUMENT='ยังไม่พบเอกสารทางการ';
const EXPLICIT_YEAR=/(?:ปีการศึกษา\s*)?(?:2[5-7]\d{2}|๒๕[๖-๙]\d{2})/u;
const OFFICIAL_CLAIM=/(?:\d{1,3}(?:,\d{3})+(?:\.\d{2})?\s*บาท)|(?:เวลาทำการ)|(?:วันที่เริ่ม)|(?:วันที่สิ้นสุด)|(?:\d{4}-\d{2}-\d{2})/u;
const CALCULATION_INTENT=/(?:คูณ|หาร|ร้อยละ|เปอร์เซ็นต์|percent|%)/iu;
const MIXED_PARTIAL_PREFIX='ผมยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบอย่างมั่นใจครับ จึงยังไม่ยืนยันส่วนนั้น ส่วนข้อมูลทางการมีผลการตรวจสอบดังนี้ครับ';
const DETAILS={
 PROVIDER_FAILURE:'a model/runtime attempt failed; check availability and fallback behaviour',
 AVAILABILITY_FALLBACK_TEXT:'availability fallback was delivered; confirm retry guidance and that nothing was invented',
 CLARIFY_WITH_EXPLICIT_YEAR:'clarification requested although the question states an explicit year; review the discovery path',
 OFFICIAL_CLAIM_NO_CITATION:'official-looking fee/time/date claim has no visible citation or link',
 MIXED_PARTIAL_ANSWER:'backend disclosed that the independent general portion was incomplete; review completeness alongside the official answer',
 NO_DOCUMENT_ANSWER:'no-official-document answer; informational candidate for corpus review',
 SLOW_TURN:'turn took at least 20 seconds; review provider latency',
} as const;

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const safeId=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/u.test(value)?value:'INVALID_CASE_ID';
const safeName=(value:string)=>value.replace(/[^A-Za-z0-9._-]/gu,'_').slice(0,120)||'UNKNOWN_ARTIFACT';

function failedObservation(turn:TurnInput):boolean{
 return (turn.attempts??[]).some(attempt=>attempt.status==='FAILED')||
  (turn.observations??[]).some(observation=>observation.result==='ERROR'||observation.result==='FAILURE'||
   observation.error_code!==null&&observation.error_code!==undefined&&observation.error_code!=='');
}

export function screenTurn(caseId:string,turnIndex:number,turn:TurnInput,identity={reportPath:'',reportSha256:''}):TurnFlag{
 const flags:Flag[]=[],text=turn.text??'';
 const add=(code:keyof typeof DETAILS,severity:Severity)=>flags.push({code,severity,detail:DETAILS[code]});
 if(failedObservation(turn))add('PROVIDER_FAILURE','REVIEW');
 if(text.includes(AVAILABILITY_FALLBACK))add('AVAILABILITY_FALLBACK_TEXT','REVIEW');
 if(turn.resultKind==='CLARIFY'&&EXPLICIT_YEAR.test(turn.question))add('CLARIFY_WITH_EXPLICIT_YEAR','REVIEW');
 if(OFFICIAL_CLAIM.test(text)&&!text.includes('แหล่งอ้างอิง')&&!/https?:\/\//u.test(text)&&!CALCULATION_INTENT.test(turn.question))
  add('OFFICIAL_CLAIM_NO_CITATION','REVIEW');
 if(text.startsWith(MIXED_PARTIAL_PREFIX))add('MIXED_PARTIAL_ANSWER','REVIEW');
 if(text.includes(NO_DOCUMENT))add('NO_DOCUMENT_ANSWER','INFO');
 if(turn.elapsedMs>=20_000)add('SLOW_TURN','INFO');
 return {reportPath:safeName(identity.reportPath),reportSha256:identity.reportSha256,caseId:safeId(caseId),turnIndex,flags};
}

export interface RecordInput{caseId:string;turns:TurnInput[]}
export function screenRecord(record:RecordInput,identity={reportPath:'',reportSha256:''}):TurnFlag[]{
 return record.turns.map((turn,index)=>screenTurn(record.caseId,index,turn,{...identity,reportPath:identity.reportPath||'DIRECT_INPUT'}));
}

export function summarize(rows:TurnFlag[]){
 const counts:Record<string,number>={};
 for(const row of rows)for(const flag of row.flags)counts[flag.code]=(counts[flag.code]??0)+1;
 return {flaggedTurns:rows.filter(row=>row.flags.length>0).length,totalTurns:rows.length,counts};
}

interface ReviewRecord{caseId:string;status:string;useful?:boolean;report?:string;sha256?:string}
interface Diagnostic{artifact:string;code:string}
interface ReviewBinding{caseId:string;binding:'BOUND'|'UNBOUND';status:string;outcome:'PASS'|'NON_PASS'|'UNBOUND'}
interface Profile{reportPath:string;reportSha256:string;summary:ReturnType<typeof summarize>;turns:TurnFlag[];reviewBindings:ReviewBinding[];missedKnownMisses:{caseId:string;status:string}[];diagnostics:Diagnostic[]}

function diagnostic(artifact:string,code:string):Diagnostic{return {artifact:safeName(artifact),code};}
function pushDiagnostic(target:Diagnostic[],value:Diagnostic):void{if(target.length<MAX_DIAGNOSTICS)target.push(value);}
function allowedStatus(value:unknown):string{
 if(typeof value!=='string'||value.length>100||!/^[A-Z][A-Z0-9_]*$/u.test(value))return 'UNKNOWN';
 return value;
}
function reviewOutcome(status:string,useful?:boolean):'PASS'|'NON_PASS'{
 // Deliberately exact: PASS_SAFE_MISS_NOT_USEFUL and unknown PASS_* variants are not passes.
 return useful!==false&&(status==='PASS'||status==='PASS_TRAJECTORY_SAFE_MISS_USEFUL')?'PASS':'NON_PASS';
}
function normalizedPath(value:string):string{return value.replace(/\\/gu,'/').replace(/^\.\//u,'').replace(/\/{2,}/gu,'/');}
function pathMatches(reference:string,reportPath:string,stagingDir:string):boolean{
 const ref=normalizedPath(reference),name=normalizedPath(reportPath);
 if(ref===name)return true;
 const absolute=normalizedPath(resolve(process.cwd(),reference));
 const actual=normalizedPath(resolve(stagingDir,reportPath));
 if(absolute===actual)return true;
 const workspaceRelative=normalizedPath(relative(process.cwd(),actual));
 return ref===workspaceRelative;
}
function readReviewRecords(stagingDir:string,names:string[],diagnostics:Diagnostic[]):ReviewRecord[]{
 const records:ReviewRecord[]=[];
 for(const name of names){
  const fullPath=resolve(stagingDir,name);
  try{
   const stat=lstatSync(fullPath);if(!stat.isFile()){pushDiagnostic(diagnostics,diagnostic(name,'REVIEW_NOT_REGULAR_FILE'));continue;}
   if(stat.size>MAX_FILE_BYTES){pushDiagnostic(diagnostics,diagnostic(name,'REVIEW_FILE_TOO_LARGE'));continue;}
   const value=JSON.parse(readFileSync(fullPath,'utf8')) as unknown;
   if(!isObject(value)){pushDiagnostic(diagnostics,diagnostic(name,'INVALID_REVIEW_SHAPE'));continue;}
   const sharedReport=typeof value.report==='string'?value.report:undefined;
   const sharedSha=typeof value.sha256==='string'?value.sha256:undefined;
   const rawRecords=Array.isArray(value.records)?value.records:
    typeof value.caseId==='string'?[value]:null;
   if(!rawRecords){pushDiagnostic(diagnostics,diagnostic(name,'INVALID_REVIEW_SHAPE'));continue;}
   if(rawRecords.length>MAX_RECORDS){pushDiagnostic(diagnostics,diagnostic(name,'REVIEW_RECORD_LIMIT_EXCEEDED'));continue;}
   if(records.length+rawRecords.length>MAX_REVIEW_RECORDS){pushDiagnostic(diagnostics,diagnostic(name,'REVIEW_TOTAL_RECORD_LIMIT_EXCEEDED'));break;}
   for(const raw of rawRecords){
    if(!isObject(raw)||typeof raw.caseId!=='string') {pushDiagnostic(diagnostics,diagnostic(name,'INVALID_REVIEW_RECORD'));continue;}
    records.push({caseId:safeId(raw.caseId),status:allowedStatus(raw.status),
     ...(typeof raw.useful==='boolean'?{useful:raw.useful}:{}),
     ...(typeof raw.report==='string'?{report:raw.report}:sharedReport?{report:sharedReport}:{}),
     ...(typeof raw.sha256==='string'?{sha256:raw.sha256}:sharedSha?{sha256:sharedSha}:{})});
   }
  }catch{pushDiagnostic(diagnostics,diagnostic(name,'MALFORMED_REVIEW'));}
 }
 return records;
}

function parseTurn(value:unknown):{turn?:TurnInput;error?:string}{
 if(!isObject(value)||typeof value.question!=='string'||value.question.length>MAX_QUESTION_CHARS||
  !(typeof value.text==='string'&&value.text.length<=MAX_ANSWER_CHARS||value.text===null)||
  !(typeof value.resultKind==='string'&&value.resultKind.length<=100||value.resultKind===null)||
  typeof value.elapsedMs!=='number'||!Number.isFinite(value.elapsedMs)||value.elapsedMs<0||value.elapsedMs>86_400_000)
  return {error:'INVALID_TURN_SHAPE'};
 const attempts:TurnInput['attempts']=[];
 if(value.attempts!==undefined){
  if(!Array.isArray(value.attempts)||value.attempts.length>MAX_OBSERVATIONS)return {error:'INVALID_TURN_OBSERVATIONS'};
  for(const attempt of value.attempts){
   if(!isObject(attempt)||typeof attempt.status!=='string'||attempt.status.length>80||
    !(typeof attempt.error_code==='string'&&attempt.error_code.length<=100||attempt.error_code===null))return {error:'INVALID_TURN_OBSERVATIONS'};
   attempts.push({status:attempt.status,error_code:attempt.error_code as string|null});
  }
 }
 const observations:NonNullable<TurnInput['observations']>=[];
 if(value.observations!==undefined){
  if(!Array.isArray(value.observations)||value.observations.length>MAX_OBSERVATIONS)return {error:'INVALID_TURN_OBSERVATIONS'};
  for(const observation of value.observations){
   if(!isObject(observation)||!(observation.action===undefined||typeof observation.action==='string'&&observation.action.length<=80)||
    !(observation.result===undefined||typeof observation.result==='string'&&observation.result.length<=80)||
    !(observation.error_code===undefined||observation.error_code===null||typeof observation.error_code==='string'&&observation.error_code.length<=100))
    return {error:'INVALID_TURN_OBSERVATIONS'};
   observations.push({action:observation.action as string|undefined,result:observation.result as string|undefined,
    error_code:observation.error_code as string|null|undefined});
  }
 }
 return {turn:{question:value.question,text:value.text as string|null,resultKind:value.resultKind as string|null,elapsedMs:value.elapsedMs,
  ...(attempts.length?{attempts}:{}),...(observations.length?{observations}:{})}};
}

function reviewForProfile(records:ReviewRecord[],profile:{reportPath:string;reportSha256:string},profiles:{reportPath:string;reportSha256:string}[],stagingDir:string):ReviewBinding[]{
 return records.filter(record=>record.caseId).flatMap(record=>{
  const target=typeof record.report==='string'?profiles.find(candidate=>pathMatches(record.report!,candidate.reportPath,stagingDir)):undefined;
  // A correctly path-bound review for a sibling report belongs only to that report.
  // If its hash is wrong or absent, the target profile will retain it as UNBOUND.
  if(target&&target.reportPath!==profile.reportPath)return [];
  const pathKnown=typeof record.report==='string',hashKnown=typeof record.sha256==='string'&&/^[a-f0-9]{64}$/iu.test(record.sha256);
  const bound=pathKnown&&hashKnown&&pathMatches(record.report!,profile.reportPath,stagingDir)&&record.sha256!.toLowerCase()===profile.reportSha256;
  const status=record.status;
  return [{caseId:record.caseId,binding:bound?'BOUND':'UNBOUND',status,
   outcome:bound?reviewOutcome(status,record.useful):'UNBOUND'}];
 });
}

/** Reads bounded artifacts and emits an identity-preserving human-review queue. */
export function scanStaging(stagingDir:string){
 const diagnostics:Diagnostic[]=[],profiles:Profile[]=[];
 let names:string[],allReviewNames:string[];
 try{
  names=readdirSync(stagingDir).filter(name=>name.startsWith('assistant-owned-eval-sol-')&&name.endsWith('.json')).sort();
  allReviewNames=readdirSync(stagingDir).filter(name=>name.startsWith('root-announcement-')&&name.includes('review')&&name.endsWith('.json')).sort();
 }
 catch{return {profiles,diagnostics:[diagnostic('STAGING','STAGING_DIRECTORY_UNREADABLE')],reviewFlagged:[],missedKnownMisses:[]};}
 if(names.length>MAX_FILES){pushDiagnostic(diagnostics,diagnostic('STAGING','FILE_COUNT_LIMIT_EXCEEDED'));names=names.slice(0,MAX_FILES);}
 const reviewNames=allReviewNames.slice(0,MAX_FILES);
 if(allReviewNames.length>MAX_FILES)pushDiagnostic(diagnostics,diagnostic('STAGING','REVIEW_FILE_COUNT_LIMIT_EXCEEDED'));
 const reviews=readReviewRecords(stagingDir,reviewNames,diagnostics);
 let totalTurns=0;
 for(const name of names){
  const perReportDiagnostics:Diagnostic[]=[],fullPath=resolve(stagingDir,name);
  let bytes:Buffer;
  try{const stat=lstatSync(fullPath);if(!stat.isFile()){pushDiagnostic(diagnostics,diagnostic(name,'REPORT_NOT_REGULAR_FILE'));continue;}
   if(stat.size>MAX_FILE_BYTES){pushDiagnostic(diagnostics,diagnostic(name,'REPORT_FILE_TOO_LARGE'));continue;}bytes=readFileSync(fullPath);}
  catch{pushDiagnostic(diagnostics,diagnostic(name,'REPORT_UNREADABLE'));continue;}
  const digest=createHash('sha256').update(bytes).digest('hex');
  let raw:unknown;
  try{raw=JSON.parse(bytes.toString('utf8'));}catch{pushDiagnostic(diagnostics,diagnostic(name,'MALFORMED_JSON'));continue;}
  if(!isObject(raw)||!Array.isArray(raw.records)){pushDiagnostic(diagnostics,diagnostic(name,'INVALID_REPORT_SHAPE'));continue;}
  if(raw.records.length>MAX_RECORDS){pushDiagnostic(diagnostics,diagnostic(name,'RECORD_LIMIT_EXCEEDED'));continue;}
  const turns:TurnFlag[]=[];
  let reportTurnCount=0;
  for(const record of raw.records){
   if(totalTurns>=MAX_TOTAL_TURNS){pushDiagnostic(perReportDiagnostics,diagnostic(name,'TOTAL_TURN_LIMIT_EXCEEDED'));break;}
   if(!isObject(record)||typeof record.caseId!=='string'||!Array.isArray(record.turns)||record.turns.length>MAX_TURNS_PER_RECORD){
    pushDiagnostic(perReportDiagnostics,diagnostic(name,'INVALID_RECORD_SHAPE'));continue;
   }
   const caseId=safeId(record.caseId);
   if(caseId==='INVALID_CASE_ID')pushDiagnostic(perReportDiagnostics,diagnostic(name,'INVALID_CASE_ID'));
   for(let index=0;index<record.turns.length;index++){
    if(reportTurnCount>=MAX_TURNS_PER_REPORT){pushDiagnostic(perReportDiagnostics,diagnostic(name,'TURN_LIMIT_EXCEEDED'));break;}
    if(totalTurns>=MAX_TOTAL_TURNS){pushDiagnostic(perReportDiagnostics,diagnostic(name,'TOTAL_TURN_LIMIT_EXCEEDED'));break;}
    reportTurnCount++;
    totalTurns++;
    const parsed=parseTurn(record.turns[index]);
    if(!parsed.turn){pushDiagnostic(perReportDiagnostics,diagnostic(name,parsed.error??'INVALID_TURN_SHAPE'));continue;}
    turns.push(screenTurn(caseId,index,parsed.turn,{reportPath:name,reportSha256:digest}));
   }
   if(reportTurnCount>=MAX_TURNS_PER_REPORT)break;
   if(totalTurns>=MAX_TOTAL_TURNS){pushDiagnostic(perReportDiagnostics,diagnostic(name,'TOTAL_TURN_LIMIT_EXCEEDED'));break;}
  }
  const reportIdentity={reportPath:name,reportSha256:digest};
  for(const item of perReportDiagnostics)pushDiagnostic(diagnostics,item);
  profiles.push({...reportIdentity,summary:summarize(turns),turns,reviewBindings:[],missedKnownMisses:[],diagnostics:perReportDiagnostics});
 }
 const identities=profiles.map(({reportPath,reportSha256})=>({reportPath,reportSha256}));
 for(const profile of profiles){
  profile.reviewBindings=reviewForProfile(reviews,profile,identities,stagingDir).filter(binding=>profile.turns.some(turn=>turn.caseId===binding.caseId));
  if(profile.reviewBindings.some(binding=>binding.binding==='UNBOUND')){
   const item=diagnostic(profile.reportPath,'REVIEW_UNBOUND');pushDiagnostic(profile.diagnostics,item);pushDiagnostic(diagnostics,item);
  }
  const reviewFlagged=profile.turns.filter(turn=>turn.flags.some(flag=>flag.severity==='REVIEW'));
  profile.missedKnownMisses=profile.reviewBindings.filter(binding=>binding.outcome==='NON_PASS'&&
   !reviewFlagged.some(row=>row.caseId===binding.caseId)).map(binding=>({caseId:binding.caseId,status:binding.status}));
 }
 const reviewFlagged=profiles.flatMap(profile=>profile.turns.filter(row=>row.flags.some(flag=>flag.severity==='REVIEW')));
 const missedKnownMisses=profiles.flatMap(profile=>profile.missedKnownMisses.map(row=>({...row,reportPath:profile.reportPath,reportSha256:profile.reportSha256})));
 return {profiles,diagnostics,reviewFlagged,missedKnownMisses};
}

if(process.argv[1]&&resolve(process.argv[1]).endsWith('qa-pre-screener.ts')){
 const staging=process.argv[2]??'.superpowers/staging';
 if(!existsSync(staging)){console.error('STAGING_DIR_MISSING');process.exit(1);}
 const result=scanStaging(staging);
 console.log(JSON.stringify({profiles:result.profiles.map(profile=>({reportPath:profile.reportPath,reportSha256:profile.reportSha256,
  summary:profile.summary,reviewFlaggedTurns:profile.turns.filter(row=>row.flags.some(flag=>flag.severity==='REVIEW')).length,
  reviewBindings:profile.reviewBindings,missedKnownMisses:profile.missedKnownMisses,diagnostics:profile.diagnostics})),diagnostics:result.diagnostics},null,1));
}
