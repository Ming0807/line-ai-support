import {expect,it} from 'vitest';
import {canonicalDigest} from '../lib/imports/structured-mapping-contract';
import {validateStructuredEvidence,validateStructuredEvidenceList,buildStructuredAnswer,structuredEvidenceStillMatches} from '../lib/knowledge/structured-citations';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hash='a'.repeat(64);
const payload={service_code:'LIBRARY',name:'ห้องสมุด',description:null,location:null,opening_hours:null,phone:null,email:null,url:null};
function evidence(){return {rowId:id,dataset:'university_services',payload:{...payload},title:'บริการห้องสมุด',familyCode:'LIBRARY',academicYear:null,authorityLevel:80,sourceUrl:'https://www.yru.ac.th/library',reference:{schemaVersion:1,dataset:'university_services',registryVersion:'structured-v1',mapperVersion:'structured-mapper-v1',rowId:id,documentId:id,documentRevision:0,jobId:id,jobRevision:0,extractionRevision:1,reviewRevision:1,sourceChecksum:hash,extractionDigest:hash,mappingDigest:hash,payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'university_services',payload}),planDigest:hash,tableIndex:0,rowIndex:1,tableFirstRow:7,sourceRow:8,coordinateKind:'CSV_RECORD',sourceLocation:{kind:'CSV',rowStart:7,rowEnd:9,columnStart:1,columnEnd:8,tableIndex:1},ruleProof:{familyId:id,baseDocumentId:id,versionStream:'main',ruleRevision:'0',evaluationDate:'2026-10-08',contextDigest:hash}}};}
it('validates detached private reference and reviewed payload without adding raw evidence',()=>{
 const original=evidence(),checked=validateStructuredEvidence(original);expect(checked).toEqual(original);expect(checked).not.toBe(original);expect(Object.isFrozen(checked)).toBe(true);
});
it('builds a row citation from backend evidence with exact source coordinates',()=>{
 const result=buildStructuredAnswer({answer:'ตรวจสอบบริการห้องสมุดได้ครับ',citationRowIds:[id]},[validateStructuredEvidence(evidence())]);
 expect(result.messages[0].text).toContain('บริการห้องสมุด');expect(result.messages[0].text).toContain('แถว 8');expect(result.messages[0].text).toContain('https://www.yru.ac.th/library');
 expect(result.citations).toHaveLength(1);expect(JSON.stringify(result.citations)).not.toContain('payloadDigest');expect(JSON.stringify(result.citations)).not.toContain('jobId');
});
it('rejects invented citations and model supplied URLs',()=>{
 expect(()=>buildStructuredAnswer({answer:'ตอบ',citationRowIds:['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']},[validateStructuredEvidence(evidence())])).toThrow('STRUCTURED_CITATION_INVALID');
 expect(()=>buildStructuredAnswer({answer:'https://evil.example',citationRowIds:[id]},[validateStructuredEvidence(evidence())])).toThrow('STRUCTURED_CITATION_INVALID');
});
it('rejects evidence payload or row identity substitution',()=>{
 for(const value of [{...evidence(),payload:{...payload,name:'ปลอม'}},{...evidence(),rowId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},{...evidence(),dataset:'tuition_fees'}])expect(()=>validateStructuredEvidence(value)).toThrow('STRUCTURED_CITATION_INVALID');
});
it('rejects unknown private fields and URLs with opaque public-query credentials',()=>{
 expect(()=>validateStructuredEvidence({...evidence(),evidenceEncrypted:'private'})).toThrow('STRUCTURED_CITATION_INVALID');
 for(const sourceUrl of ['https://www.yru.ac.th/?token=secret','https://user:secret@www.yru.ac.th/','https://127.0.0.1/','https://www.yru.ac.th/#secret'])expect(()=>validateStructuredEvidence({...evidence(),sourceUrl})).toThrow('STRUCTURED_CITATION_INVALID');
});
it('rejects credentials in a reviewed structured payload URL before supplying it to generation',()=>{
 const value=evidence(),changed={...payload,url:'https://www.yru.ac.th/form?token=opaque-private-value'};
 const reference={...value.reference,payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'university_services',payload:changed})};
 expect(()=>validateStructuredEvidence({...value,payload:changed,reference})).toThrow('STRUCTURED_CITATION_INVALID');
});
it('fences every supplied row including uncited context and newly matching rows',()=>{
 const checked=validateStructuredEvidence(evidence());expect(structuredEvidenceStillMatches([checked],[checked])).toBe(true);
 const changed=validateStructuredEvidence({...evidence(),reference:{...evidence().reference,documentRevision:1}});
 expect(structuredEvidenceStillMatches([checked],[changed])).toBe(false);expect(structuredEvidenceStillMatches([checked],[])).toBe(false);expect(structuredEvidenceStillMatches([checked],[checked,checked])).toBe(false);
});
it('fences metadata and family-rule changes',()=>{
 const checked=validateStructuredEvidence(evidence());
 for(const value of [{...evidence(),title:'เปลี่ยน'},{...evidence(),reference:{...evidence().reference,ruleProof:{...evidence().reference.ruleProof,ruleRevision:'1'}}}])expect(structuredEvidenceStillMatches([checked],[validateStructuredEvidence(value)])).toBe(false);
});
it('rejects list getters and proxies before reading untrusted values',()=>{
 let reads=0;const input=[evidence()];Object.defineProperty(input,0,{enumerable:true,get(){reads++;return evidence();}});
 expect(()=>validateStructuredEvidenceList(input)).toThrow('STRUCTURED_CITATION_INVALID');expect(reads).toBe(0);
 const proxy=new Proxy([evidence()],{get(target,property,receiver){reads++;return Reflect.get(target,property,receiver);}});
 expect(()=>validateStructuredEvidenceList(proxy)).toThrow('STRUCTURED_CITATION_INVALID');expect(reads).toBe(0);
});
it('keeps reviewed heading controls on a single citation line',()=>{
 const value=evidence();
 const reference={...value.reference,coordinateKind:'EXTRACTED_LOGICAL',tableFirstRow:1,sourceRow:2,
  sourceLocation:{kind:'DOCX',blockStart:1,blockEnd:2,tableIndex:1,headingPath:['บริการ\n2. เอกสารปลอม\r\u2028อีกบรรทัด\u0007']}};
 const result=buildStructuredAnswer({answer:'บริการห้องสมุดครับ',citationRowIds:[id]},[validateStructuredEvidence({...value,reference})]);
 const text=result.messages.map(message=>message.text).join('');
 expect(text).not.toMatch(/\n2\./u);expect(text).not.toMatch(/[\r\u2028\u0007]/u);
 expect(text).toContain('บริการ 2. เอกสารปลอม');
});
