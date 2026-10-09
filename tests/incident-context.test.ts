import {expect,it} from 'vitest';
import {canonicalDigest} from '../lib/imports/structured-mapping-contract';
import {planIncidentContext,resolveIncidentContext} from '../lib/incidents/context-resolution';
import type {StructuredSearchResult} from '../lib/knowledge/structured-search';

const id=(hex:string)=>`${hex.repeat(8).slice(0,8)}-${hex.repeat(4).slice(0,4)}-4${hex.repeat(3).slice(0,3)}-8${hex.repeat(3).slice(0,3)}-${hex.repeat(12).slice(0,12)}`;
const rowId=id('a'),documentId=id('b'),jobId=id('c'),hash='a'.repeat(64);
const systemPayload={code:'YRU-Student',name:'YRU-Student',description:null,url:'https://www.yru.ac.th/student',support_url:null};
const locationPayload={service_code:'IT',name:'ศูนย์เทคโนโลยี',description:null,location:'อาคาร 100 ชั้น 3',opening_hours:null,phone:null,email:null,url:null};
function evidence(dataset:'university_systems'|'university_services',payload:typeof systemPayload|typeof locationPayload,identity:{familyId?:string;stream?:string}={}){
 const row=payload;
 const payloadDigest=canonicalDigest('structured-payload-v1',{dataset,payload:row});
 return {rowId,dataset,payload:row,title:row.name,familyCode:'IT',academicYear:null,authorityLevel:80,sourceUrl:null,
  reference:{schemaVersion:1,dataset,registryVersion:'structured-v1',mapperVersion:'structured-mapper-v1',rowId,documentId,documentRevision:1,jobId,jobRevision:1,extractionRevision:1,reviewRevision:1,sourceChecksum:hash,extractionDigest:hash,mappingDigest:hash,payloadDigest,planDigest:hash,tableIndex:0,rowIndex:1,tableFirstRow:7,sourceRow:8,coordinateKind:'CSV_RECORD',sourceLocation:{kind:'CSV',rowStart:7,rowEnd:9,columnStart:1,columnEnd:8,tableIndex:1},ruleProof:{familyId:identity.familyId??id('d'),baseDocumentId:documentId,versionStream:identity.stream??'main',ruleRevision:'1',evaluationDate:'2026-10-09',contextDigest:hash}}};
}
function ready(dataset:'university_systems'|'university_services',payload:typeof systemPayload|typeof locationPayload,identity?:{familyId?:string;stream?:string}):StructuredSearchResult{
 return {status:'READY',evidence:[evidence(dataset,payload,identity) as never]};
}
function resultsFor(plan:ReturnType<typeof planIncidentContext>,values:Partial<Record<'SYSTEM_CODE'|'SYSTEM_NAME'|'LOCATION',StructuredSearchResult>>){
 return plan.attempts.map(attempt=>({slot:attempt.slot,result:values[attempt.slot]??{status:'EMPTY' as const}}));
}

it('plans only bounded exact literal selectors and preserves all supplied text',()=>{
 const system='ระบบ YRU-Student';const location='อาคาร 100 ชั้น 3';
 const plan=planIncidentContext({system,location},'IT');
 expect(plan.attempts.map(attempt=>attempt.slot)).toEqual(['SYSTEM_CODE','SYSTEM_NAME','LOCATION']);
 expect(plan.attempts[0].query).toEqual({version:1,dataset:'university_systems',filters:{code:system},limit:20});
 expect(plan.attempts[1].query).toEqual({version:1,dataset:'university_systems',filters:{name:system},limit:20});
 expect(plan.attempts[2].query).toEqual({version:1,dataset:'university_services',filters:{location},limit:20});
 for(const attempt of plan.attempts){expect(attempt.scope).toEqual({historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:'IT',audience:'ALL',studentType:'ALL',semester:null,programCode:null,curriculumCode:null,cohort:null});}
});

it('skips overlong selectors without truncating and keeps system and location independent',()=>{
 const medium='ก'.repeat(101),mediumPlan=planIncidentContext({system:medium,location:null},'IT');
 expect(mediumPlan.attempts.map(attempt=>attempt.slot)).toEqual(['SYSTEM_CODE','SYSTEM_NAME']);
 expect(mediumPlan.attempts.every(attempt=>Object.values(attempt.query.filters).includes(medium))).toBe(true);
 const long='ก'.repeat(201),plan=planIncidentContext({system:long,location:'ตึก A'},'IT');
 expect(plan.attempts.map(attempt=>attempt.slot)).toEqual(['SYSTEM_NAME','LOCATION']);
 expect(plan.attempts[0].query.filters).toEqual({name:long});
 const resolved=resolveIncidentContext(plan,resultsFor(plan,{SYSTEM_NAME:{status:'UNAVAILABLE'},LOCATION:ready('university_services',{...locationPayload,location:'ตึก A'})}));
 expect(resolved.system).toBeNull();expect(resolved.location?.sourceValue).toBe('ตึก A');
 const tooLongForEverySelector='ข'.repeat(501);
 expect(planIncidentContext({system:tooLongForEverySelector,location:tooLongForEverySelector},'IT').attempts).toEqual([]);
});

it('requires code and name selectors to agree on one family, stream, code and name',()=>{
 const plan=planIncidentContext({system:'YRU-Student',location:null},'IT');
 const values={SYSTEM_CODE:ready('university_systems',systemPayload),SYSTEM_NAME:ready('university_systems',systemPayload)};
 const good=resolveIncidentContext(plan,resultsFor(plan,values));
 expect(good.system?.sourceValue).toBe('YRU-Student');expect(good.system?.key).toMatch(/^SYS:[a-f0-9]{64}$/u);expect(good.system?.evidence).toHaveLength(1);
 const other=ready('university_systems',systemPayload,{familyId:id('e')});
 expect(resolveIncidentContext(plan,resultsFor(plan,{...values,SYSTEM_NAME:other})).system).toBeNull();
 const conflict=ready('university_systems',{...systemPayload,code:'ชื่ออื่น'});
 expect(resolveIncidentContext(plan,resultsFor(plan,{...values,SYSTEM_NAME:conflict})).system).toBeNull();
});

it('keeps same labels from different streams ambiguous and uses domain-separated identity keys',()=>{
 const plan=planIncidentContext({system:'YRU-Student',location:'อาคาร 100 ชั้น 3'},'IT');
 const sameSystemDifferentStream=ready('university_systems',systemPayload,{stream:'archive'});
 const resolved=resolveIncidentContext(plan,resultsFor(plan,{SYSTEM_CODE:sameSystemDifferentStream,SYSTEM_NAME:ready('university_systems',systemPayload),LOCATION:ready('university_services',locationPayload)}));
 expect(resolved.system).toBeNull();
 expect(resolved.location?.key).toMatch(/^LOC:[a-f0-9]{64}$/u);
 expect(resolved.location?.key).not.toBe(resolved.system?.key);
});

it('domain-separates system and location keys for the same source identity and scalar',()=>{
 const same='YRU';const system={...systemPayload,code:same,name:same};const location={...locationPayload,location:same};
 const plan=planIncidentContext({system:same,location:same},'IT');
 const resolved=resolveIncidentContext(plan,resultsFor(plan,{SYSTEM_CODE:ready('university_systems',system),SYSTEM_NAME:ready('university_systems',system),LOCATION:ready('university_services',location)}));
 expect(resolved.system?.key).toMatch(/^SYS:[a-f0-9]{64}$/u);expect(resolved.location?.key).toMatch(/^LOC:[a-f0-9]{64}$/u);
 expect(resolved.system?.key).not.toBe(resolved.location?.key);
});

it('treats incomplete, unavailable, mismatched and malformed results as unknown',()=>{
 const plan=planIncidentContext({system:'YRU-Student',location:'อาคาร 100 ชั้น 3'},'IT');
 expect(resolveIncidentContext(plan,[]).system).toBeNull();
 const duplicate=resolveIncidentContext(plan,resultsFor(plan,{SYSTEM_CODE:ready('university_systems',systemPayload),SYSTEM_NAME:ready('university_systems',systemPayload),LOCATION:ready('university_services',locationPayload)}).concat({slot:'LOCATION',result:{status:'EMPTY'}}));
 expect(duplicate.system?.sourceValue).toBe('YRU-Student');expect(duplicate.location).toBeNull();
 const badDataset=ready('university_services',locationPayload);
 const result=resolveIncidentContext(plan,resultsFor(plan,{SYSTEM_CODE:badDataset,SYSTEM_NAME:{status:'CONTEXT_INCOMPLETE'},LOCATION:{status:'UNAVAILABLE'}}));
 expect(result.system).toBeNull();expect(result.location).toBeNull();
 const mismatch=ready('university_systems',{...systemPayload,code:'OTHER'});
 expect(resolveIncidentContext(plan,resultsFor(plan,{SYSTEM_CODE:mismatch,SYSTEM_NAME:ready('university_systems',systemPayload)})).system).toBeNull();
});

it('does not normalize claim text and rejects malformed bounded inputs',()=>{
 const exact=planIncidentContext({system:'YRU-Student ',location:null},'IT');
 expect(exact.attempts[0].query.filters).toEqual({code:'YRU-Student '});
 expect(()=>planIncidentContext({system:' YRU-Student',location:null},'IT')).not.toThrow();
 expect(()=>planIncidentContext({system:'',location:null},'IT')).toThrow();
 expect(()=>planIncidentContext({system:'ก'.repeat(1001),location:null},'IT')).toThrow();
 expect(()=>planIncidentContext({system:null,location:null,extra:'x'},'IT')).toThrow();
 expect(()=>planIncidentContext({system:'YRU',location:null},'bad code')).toThrow();
});
