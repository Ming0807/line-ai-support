import {expect,it} from 'vitest';
import {canonicalDigest} from '../lib/imports/structured-mapping-contract';
import {encryptValue} from '../lib/security/identity';
import type {StructuredSearchResult} from '../lib/knowledge/structured-search';
import {openIncidentContextProof,sealIncidentContextProof} from '../lib/incidents/context-proof';

const key=Buffer.alloc(32,4).toString('base64'),hash='a'.repeat(64);
const ids={ticket:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',conversation:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',session:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',department:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',row:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',job:'ffffffff-ffff-4fff-8fff-ffffffffffff'};
const ticket={id:ids.ticket,revision:3,conversationId:ids.conversation,sessionId:ids.session,departmentId:ids.department,departmentCode:'IT',sensitiveLevel:'GENERAL'} as const;
const source={status:'READY',claims:{system:'YRU-Student',location:'อาคาร 2'},sourceDigest:'a'.repeat(64),stateDigest:'b'.repeat(64),bindingDigest:'c'.repeat(64),retainedSensitivity:'GENERAL'} as const;
const stamp={epoch:'0',evaluationDate:'2026-10-09'};
const systemPayload={code:'YRU-Student',name:'YRU-Student',description:null,url:'https://www.yru.ac.th/student',support_url:null};
const locationPayload={service_code:'IT',name:'ศูนย์เทคโนโลยี',description:null,location:'อาคาร 2',opening_hours:null,phone:null,email:null,url:null};
function evidence(dataset:'university_systems'|'university_services',payload:typeof systemPayload|typeof locationPayload){
 const payloadDigest=canonicalDigest('structured-payload-v1',{dataset,payload});
 return {rowId:ids.row,dataset,payload,title:payload.name,familyCode:'IT',academicYear:null,authorityLevel:80,sourceUrl:null,
  reference:{schemaVersion:1,dataset,registryVersion:'structured-v1',mapperVersion:'structured-mapper-v1',rowId:ids.row,documentId:ids.row,documentRevision:1,jobId:ids.job,jobRevision:1,extractionRevision:1,reviewRevision:1,sourceChecksum:hash,extractionDigest:hash,mappingDigest:hash,payloadDigest,planDigest:hash,tableIndex:0,rowIndex:1,tableFirstRow:7,sourceRow:8,coordinateKind:'CSV_RECORD',sourceLocation:{kind:'CSV',rowStart:7,rowEnd:9,columnStart:1,columnEnd:8,tableIndex:1},ruleProof:{familyId:ids.job,baseDocumentId:ids.row,versionStream:'main',ruleRevision:'1',evaluationDate:'2026-10-09',contextDigest:hash}}};
}
function ready(dataset:'university_systems'|'university_services',payload:typeof systemPayload|typeof locationPayload):StructuredSearchResult{return {status:'READY',evidence:[evidence(dataset,payload) as never]};}
function input(overrides:Record<string,unknown>={}){
 const results=[{slot:'SYSTEM_CODE',result:ready('university_systems',systemPayload)},{slot:'SYSTEM_NAME',result:ready('university_systems',systemPayload)},{slot:'LOCATION',result:ready('university_services',locationPayload)}];
 return {ticket,source,stamp,results,...overrides};
}
function sealed(inputValue=input()) {return sealIncidentContextProof(inputValue,key);}

it('seals a complete proof and opens only keys for the exact ticket/source/catalog stamp',()=>{
 const sealedProof=sealed();expect(sealedProof).toMatchObject({requiresCatalog:true,systemKey:/^SYS:[a-f0-9]{64}$/u,locationKey:/^LOC:[a-f0-9]{64}$/u});
 expect(sealedProof.encrypted).not.toContain('YRU-Student');expect(sealedProof.encrypted.length).toBeLessThanOrEqual(524_288);
 expect(openIncidentContextProof(sealedProof.encrypted,{ticket,source,stamp},key)).toEqual({systemKey:sealedProof.systemKey,locationKey:sealedProof.locationKey});
 expect(openIncidentContextProof(sealedProof.encrypted,{ticket:{...ticket,revision:4},source,stamp},key)).toBeNull();
 expect(openIncidentContextProof(sealedProof.encrypted,{ticket,source:{...source,sourceDigest:'d'.repeat(64)},stamp},key)).toBeNull();
 expect(openIncidentContextProof(sealedProof.encrypted,{ticket,source,stamp:{...stamp,epoch:'1'}},key)).toBeNull();
});
it('authenticates no-attempt proofs with a null catalog stamp and returns unknown keys',()=>{
 const noClaims={...source,claims:{system:null,location:null}},proof=sealed(input({source:noClaims,stamp:null,results:[]}));
 expect(proof).toEqual({encrypted:expect.any(String),requiresCatalog:false,systemKey:null,locationKey:null});
 expect(openIncidentContextProof(proof.encrypted,{ticket,source:noClaims,stamp:null},key)).toEqual({systemKey:null,locationKey:null});
 expect(openIncidentContextProof(proof.encrypted,{ticket,source:noClaims,stamp},key)).toBeNull();
});
it('rejects missing, duplicate, extra, unavailable and incomplete slot results',()=>{
 const results=input().results;
 for(const value of [results.slice(0,2),[...results,results[2]],results.map((row,index)=>index===0?{...row,slot:'LOCATION'}:row),results.map((row,index)=>index===0?{...row,result:{status:'UNAVAILABLE'}}:row),results.map((row,index)=>index===0?{...row,result:{status:'CONTEXT_INCOMPLETE'}}:row)]){
  expect(()=>sealed(input({results:value}))).toThrow('INCIDENT_CONTEXT_PROOF_INVALID');
 }
});
it('accepts only exact EMPTY and bounded clarification status envelopes',()=>{
 const results=input().results.map((row,index)=>index===0?{slot:row.slot,result:{status:'EMPTY'}}:index===1?{slot:row.slot,result:{status:'CLARIFICATION_REQUIRED',missing:['code_or_name']}}:row);
 expect(sealed(input({results})).systemKey).toBeNull();
 for(const bad of [{status:'EMPTY',extra:true},{status:'CLARIFICATION_REQUIRED',missing:Array(9).fill('field')},{status:'CLARIFICATION_REQUIRED',missing:['x'.repeat(201)]}]){
  expect(()=>sealed(input({results:results.map((row,index)=>index===0?{slot:row.slot,result:bad}:row)}))).toThrow('INCIDENT_CONTEXT_PROOF_INVALID');
 }
});
it('rejects mismatched evidence, weak sensitivity, and invalid catalog stamps',()=>{
 const wrong=ready('university_systems',{...systemPayload,code:'OTHER'});
 expect(()=>sealed(input({results:input().results.map((row,index)=>index===0?{slot:row.slot,result:wrong}:row)}))).toThrow('INCIDENT_CONTEXT_PROOF_INVALID');
 expect(()=>sealed(input({ticket:{...ticket,sensitiveLevel:'GENERAL'},source:{...source,retainedSensitivity:'RESTRICTED'}}))).toThrow('INCIDENT_CONTEXT_PROOF_INVALID');
 for(const invalidStamp of [{epoch:'00',evaluationDate:'2026-10-09'},{epoch:'9223372036854775808',evaluationDate:'2026-10-09'},{epoch:'1',evaluationDate:'2026-02-30'}])expect(()=>sealed(input({stamp:invalidStamp}))).toThrow('INCIDENT_CONTEXT_PROOF_INVALID');
 const wrongDay=ready('university_systems',systemPayload),withWrongDay={...wrongDay,evidence:wrongDay.status==='READY'?wrongDay.evidence.map(item=>({...item,reference:{...item.reference,ruleProof:{...item.reference.ruleProof,evaluationDate:'2026-10-08'}}})):[]};
 expect(()=>sealed(input({results:input().results.map((row,index)=>index===0?{slot:row.slot,result:withWrongDay}:row)}))).toThrow('INCIDENT_CONTEXT_PROOF_INVALID');
 expect(sealed(input({stamp:{epoch:'9223372036854775807',evaluationDate:'2026-10-09'}})).requiresCatalog).toBe(true);
});
it('returns null for tampering, malformed encrypted data and wrong key',()=>{
 const proof=sealed();
 const pieces=proof.encrypted.split('.');pieces[3]=`${pieces[3]![0]==='A'?'B':'A'}${pieces[3]!.slice(1)}`;
 expect(openIncidentContextProof(pieces.join('.'),{ticket,source,stamp},key)).toBeNull();
 expect(openIncidentContextProof('x'.repeat(524_289),{ticket,source,stamp},key)).toBeNull();
 expect(openIncidentContextProof(encryptValue('x'.repeat(384*1024+1),key),{ticket,source,stamp},key)).toBeNull();
 expect(openIncidentContextProof(proof.encrypted,{ticket,source,stamp},Buffer.alloc(32,5).toString('base64'))).toBeNull();
});
