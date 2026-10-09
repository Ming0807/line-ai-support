import {canonicalDigest,copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {knowledgeScopeSchema} from '../knowledge/retrieval';
import {matchesStructuredPayload,validateStructuredQuery} from '../knowledge/structured-query';
import {validateStructuredEvidenceList} from '../knowledge/structured-citations';
import type {StructuredEvidence} from '../knowledge/structured-citations';
import {incidentContextClaimsSchema,incidentContextDepartmentSchema,incidentContextPlanSchema,incidentContextSlotSchema,
 type IncidentContextPlan,type IncidentContextSlot,type ResolvedIncidentContext,type ResolvedIncidentContextValue} from './context-contracts';

const exactCodeLimit=200,exactNameLimit=500,exactLocationLimit=500;
const invalid=()=>new Error('INCIDENT_CONTEXT_INVALID');
function attempt(slot:IncidentContextSlot,dataset:'university_systems'|'university_services',field:string,value:string,departmentCode:string){
 const query=validateStructuredQuery({version:1,dataset,filters:{[field]:value},limit:20});
 const scope=knowledgeScopeSchema.parse({historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode,audience:'ALL',studentType:'ALL',semester:null,programCode:null,curriculumCode:null,cohort:null});
 return {slot,query,scope};
}
/** Pure exact-match planning. It creates bounded structured searches but performs none. */
export function planIncidentContext(claimsInput:unknown,departmentInput:unknown):IncidentContextPlan{
 let claims:ReturnType<typeof incidentContextClaimsSchema.parse>,departmentCode:string;
 try{
  claims=incidentContextClaimsSchema.parse(copyStructuredJson(claimsInput,24*1024,32));
  departmentCode=incidentContextDepartmentSchema.parse(copyStructuredJson(departmentInput,256,4));
 }catch{throw invalid();}
 const attempts=[];
 if(claims.system!==null){
  if(claims.system.length<=exactCodeLimit)attempts.push(attempt('SYSTEM_CODE','university_systems','code',claims.system,departmentCode));
  if(claims.system.length<=exactNameLimit)attempts.push(attempt('SYSTEM_NAME','university_systems','name',claims.system,departmentCode));
 }
 if(claims.location!==null&&claims.location.length<=exactLocationLimit)attempts.push(attempt('LOCATION','university_services','location',claims.location,departmentCode));
 try{return freezeStructuredData(incidentContextPlanSchema.parse({claims,departmentCode,attempts}));}catch{throw invalid();}
}

interface ValidAttemptResult {status:'EMPTY'|'READY';evidence:StructuredEvidence[]}
function parsePlan(input:unknown):IncidentContextPlan{
 try{
  const plan=incidentContextPlanSchema.parse(copyStructuredJson(input,32*1024,512));
  const canonical=planIncidentContext(plan.claims,plan.departmentCode);
  if(canonicalDigest('incident-context-plan-v1',plan)!==canonicalDigest('incident-context-plan-v1',canonical))throw invalid();
  return plan;
 }catch{throw invalid();}
}
function resultFor(plan:IncidentContextPlan,slot:IncidentContextSlot,input:unknown):ValidAttemptResult|null{
 const attempt=plan.attempts.find(item=>item.slot===slot);
 if(!attempt||input===undefined)return null;
 try{
  const snapshot=copyStructuredJson(input,256*1024,10_000);
  if(snapshot===null||typeof snapshot!=='object'||Array.isArray(snapshot)||!Object.hasOwn(snapshot,'status'))return null;
  const status=(snapshot as {status?:unknown}).status;
  if(status==='EMPTY')return Object.keys(snapshot).length===1?{status:'EMPTY',evidence:[]}:null;
  if(status!=='READY'||Object.keys(snapshot).length!==2||!Object.hasOwn(snapshot,'evidence'))return null;
  const evidence=validateStructuredEvidenceList((snapshot as {evidence:unknown}).evidence);
  const query=validateStructuredQuery(attempt.query);
  for(const row of evidence){
   if(row.dataset!==query.dataset||!matchesStructuredPayload(query,row.payload))return null;
  }
  return {status:'READY',evidence};
 }catch{return null;}
}
function selectedResults(plan:IncidentContextPlan,resultsInput:unknown):Map<IncidentContextSlot,ValidAttemptResult|null>{
 const outputs=new Map<IncidentContextSlot,ValidAttemptResult|null>();
 for(const attempt of plan.attempts)outputs.set(attempt.slot,null);
 try{
  const results=copyStructuredJson(resultsInput,512*1024,20_000);
  if(!Array.isArray(results))return outputs;
  const parsed=results.map(value=>{
   if(value===null||typeof value!=='object'||Array.isArray(value))throw invalid();
   const entry=value as Record<string,unknown>;
   if(Object.keys(entry).length!==2||!Object.hasOwn(entry,'slot')||!Object.hasOwn(entry,'result'))throw invalid();
   return {slot:incidentContextSlotSchema.parse(entry.slot),result:entry.result};
  });
  if(parsed.some(item=>!plan.attempts.some(attempt=>attempt.slot===item.slot)))return outputs;
  for(const attempt of plan.attempts){
   const matches=parsed.filter(item=>item.slot===attempt.slot);
   if(matches.length===1)outputs.set(attempt.slot,resultFor(plan,attempt.slot,matches[0].result));
  }
 }catch{/* A malformed result envelope contributes no known source context. */}
 return outputs;
}
function resolveSystem(plan:IncidentContextPlan,outputs:Map<IncidentContextSlot,ValidAttemptResult|null>):ResolvedIncidentContextValue|null{
 const attempts=plan.attempts.filter(item=>item.slot==='SYSTEM_CODE'||item.slot==='SYSTEM_NAME');
 if(!attempts.length)return null;
 const candidates:{familyId:string;versionStream:string;code:string;name:string;evidence:StructuredEvidence}[]=[];
 const evidenceByRowId=new Map<string,{digest:string;evidence:StructuredEvidence}>();
 for(const item of attempts){
  const outcome=outputs.get(item.slot);if(!outcome)return null;
  if(outcome.status==='EMPTY')continue;
  for(const evidence of outcome.evidence){
   if(evidence.dataset!=='university_systems')return null;
   const evidenceDigest=canonicalDigest('incident-context-evidence-v1',evidence),seen=evidenceByRowId.get(evidence.rowId);
   if(seen&&seen.digest!==evidenceDigest)return null;
   if(seen)continue;
   evidenceByRowId.set(evidence.rowId,{digest:evidenceDigest,evidence});
   const payload=evidence.payload as {code:string;name:string};
   if(item.slot==='SYSTEM_CODE'&&payload.code!==plan.claims.system||item.slot==='SYSTEM_NAME'&&payload.name!==plan.claims.system)return null;
   candidates.push({familyId:evidence.reference.ruleProof.familyId,versionStream:evidence.reference.ruleProof.versionStream,code:payload.code,name:payload.name,evidence});
  }
 }
 if(!candidates.length)return null;
 const identities=new Set(candidates.map(row=>JSON.stringify([row.familyId,row.versionStream,row.code,row.name])));
 if(identities.size!==1)return null;
 const first=candidates[0]!;
 const digest=canonicalDigest('incident-system-context-v1',{familyId:first.familyId,versionStream:first.versionStream,code:first.code});
 return {key:`SYS:${digest}`,sourceValue:first.code,familyId:first.familyId,versionStream:first.versionStream,evidence:candidates.map(row=>row.evidence)};
}
function resolveLocation(plan:IncidentContextPlan,outputs:Map<IncidentContextSlot,ValidAttemptResult|null>):ResolvedIncidentContextValue|null{
 if(!plan.attempts.some(item=>item.slot==='LOCATION'))return null;
 const outcome=outputs.get('LOCATION');if(!outcome)return null;if(outcome.status==='EMPTY')return null;
 const candidates:{familyId:string;versionStream:string;location:string;evidence:StructuredEvidence}[]=[];
 for(const evidence of outcome.evidence){
  if(evidence.dataset!=='university_services')return null;
  const location=(evidence.payload as {location:string|null}).location;
  if(location===null||location!==plan.claims.location)return null;
  candidates.push({familyId:evidence.reference.ruleProof.familyId,versionStream:evidence.reference.ruleProof.versionStream,location,evidence});
 }
 const identities=new Set(candidates.map(row=>JSON.stringify([row.familyId,row.versionStream,row.location])));
 if(!candidates.length||identities.size!==1)return null;
 const first=candidates[0]!;
 const digest=canonicalDigest('incident-location-context-v1',{familyId:first.familyId,versionStream:first.versionStream,location:first.location});
 return {key:`LOC:${digest}`,sourceValue:first.location,familyId:first.familyId,versionStream:first.versionStream,evidence:candidates.map(row=>row.evidence)};
}
/** Resolves private, source-backed context values. Invalid/missing result slots fail closed to null. */
export function resolveIncidentContext(planInput:unknown,resultsInput:unknown):ResolvedIncidentContext{
 const plan=parsePlan(planInput),outputs=selectedResults(plan,resultsInput);
 return freezeStructuredData({system:resolveSystem(plan,outputs),location:resolveLocation(plan,outputs)});
}
