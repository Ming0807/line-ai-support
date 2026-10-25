import {expect,it} from 'vitest';
import {canonicalDigest} from '../lib/imports/structured-mapping-contract';
import {validateStructuredEvidence,validateStructuredEvidenceList,buildStructuredAnswer,structuredEvidenceStillMatches} from '../lib/knowledge/structured-citations';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hash='a'.repeat(64);
const payload={service_code:'LIBRARY',name:'ห้องสมุด',description:null,location:null,opening_hours:null,phone:null,email:null,url:null};
function evidence(){return {rowId:id,dataset:'university_services',payload:{...payload},title:'บริการห้องสมุด',familyCode:'LIBRARY',academicYear:null,authorityLevel:80,sourceUrl:'https://www.yru.ac.th/library',reference:{schemaVersion:1,dataset:'university_services',registryVersion:'structured-v1',mapperVersion:'structured-mapper-v1',rowId:id,documentId:id,documentRevision:0,jobId:id,jobRevision:0,extractionRevision:1,reviewRevision:1,sourceChecksum:hash,extractionDigest:hash,mappingDigest:hash,payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'university_services',payload}),planDigest:hash,tableIndex:0,rowIndex:1,tableFirstRow:7,sourceRow:8,coordinateKind:'CSV_RECORD',sourceLocation:{kind:'CSV',rowStart:7,rowEnd:9,columnStart:1,columnEnd:8,tableIndex:1},ruleProof:{familyId:id,baseDocumentId:id,versionStream:'main',ruleRevision:'0',evaluationDate:'2026-10-08',contextDigest:hash}}};}
it('renders service destinations only from cited validated rows, separately from source references',()=>{
 const row=(rowId:string,url:string)=>{const base=evidence(),data={...payload,url};return validateStructuredEvidence({...base,rowId,payload:data,reference:{...base.reference,rowId,payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'university_services',payload:data})}});};
 const rows=[row(id,'https://www.yru.ac.th/service/library'),row('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','https://www.yru.ac.th/service/other')];
 const result=buildStructuredAnswer({answer:'ข้อมูลตามเอกสาร',citationRowIds:[id]},rows);
 const text=result.messages.map(m=>m.text).join('');
 expect(text).toContain('เว็บไซต์บริการตามเอกสาร:');expect(text).toContain('https://www.yru.ac.th/service/library');expect(text).not.toContain('https://www.yru.ac.th/service/other');
 expect(result.citations).toHaveLength(1);expect(result.citations[0].sourceUrl).toBe('https://www.yru.ac.th/library');
});
function calendar(rowId:string,title:string,start:string,end:string|null=null,description:string|null=null){
 const base=evidence(),data={academic_year:2569,semester:'ภาคเรียน1',student_type:'ภาคปกติ',event_type:title,title,start_date:start,end_date:end,description};
 return validateStructuredEvidence({...base,rowId,dataset:'academic_calendar_events',academicYear:2569,payload:data,
  reference:{...base.reference,rowId,dataset:'academic_calendar_events',payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'academic_calendar_events',payload:data})}});
}
it('renders dates only from the cited calendar payload even when model prose invents a Buddhist year',()=>{
 const opening=calendar(id,'วันเปิดภาคเรียน','2026-06-15');
 const registration=calendar('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','วันลงทะเบียน','2026-05-20','2026-05-30');
 const result=buildStructuredAnswer({answer:'วันเปิดภาคเรียนคือ15 มิถุนายน2566 (พ.ศ.2569)',citationRowIds:[id]},[opening,registration]);
 const text=result.messages.map(m=>m.text).join('');
 expect(text).toContain('2026-06-15');expect(text).toContain('2569');expect(text).toContain('ภาคปกติ');
 expect(text).not.toContain('2566');expect(text).not.toContain('2026-05-20');expect(text).not.toContain('วันลงทะเบียน');
 expect(result.citations.map(c=>c.rowId)).toEqual([id]);
});
it('preserves multiple cited calendar ranges and source qualifications without inventing a date from academic year',()=>{
 const second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const a=calendar(id,'ช่วงลงทะเบียน','2026-05-20','2026-05-30','เฉพาะภาคปกติ ไม่รวมวันหยุด');
 const b=calendar(second,'กิจกรรมภาคปลาย','2027-01-04');
 const text=buildStructuredAnswer({answer:'สรุปตามปฏิทินครับ',citationRowIds:[id,second]},[a,b]).messages.map(m=>m.text).join('');
 for(const value of ['ช่วงลงทะเบียน','2026-05-20','2026-05-30','เฉพาะภาคปกติ ไม่รวมวันหยุด','กิจกรรมภาคปลาย','2027-01-04'])expect(text).toContain(value);
 expect(text).not.toContain('2026-01-04');
});
it('rejects mixed calendar/noncalendar citations and unverified destinations in calendar free text',()=>{
 const a=calendar('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','วันเปิดภาคเรียน','2026-06-15');
 expect(()=>buildStructuredAnswer({answer:'คำตอบผสม',citationRowIds:[id,a.rowId]},[validateStructuredEvidence(evidence()),a])).toThrow('STRUCTURED_CITATION_INVALID');
 const link=calendar(id,'วันเปิดภาคเรียน','2026-06-15',null,'ไปที่ https://unverified.example');
 expect(()=>buildStructuredAnswer({answer:'ตามปฏิทิน',citationRowIds:[id]},[link])).toThrow('STRUCTURED_CITATION_INVALID');
});
it('renders the cited reviewed form destination separately from its source reference',()=>{
 const value=evidence(),form={name:'แบบคำร้อง',description:null,form_url:'https://www.yru.ac.th/forms/request.pdf',requirements:null};
 const row=validateStructuredEvidence({...value,dataset:'service_forms',payload:form,reference:{...value.reference,dataset:'service_forms',
  payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'service_forms',payload:form})}});
 const text=buildStructuredAnswer({answer:'พบแบบคำร้องครับ',citationRowIds:[id]},[row]).messages.map(message=>message.text).join('');
 expect(text).toContain('ลิงก์แบบฟอร์ม:');expect(text).toContain(form.form_url);
 expect(text).toContain(`แหล่งอ้างอิง:`);expect(text).toContain(value.sourceUrl);
});
it('does not render a destination from an uncited form row',()=>{
 const value=evidence(),formId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const form={name:'แบบคำร้องอื่น',description:null,form_url:'https://www.yru.ac.th/forms/other.pdf',requirements:null};
 const row=validateStructuredEvidence({...value,rowId:formId,dataset:'service_forms',payload:form,reference:{...value.reference,rowId:formId,dataset:'service_forms',
  payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'service_forms',payload:form})}});
 const text=buildStructuredAnswer({answer:'ข้อมูลห้องสมุดครับ',citationRowIds:[id]},[validateStructuredEvidence(value),row]).messages.map(message=>message.text).join('');
 expect(text).not.toContain(form.form_url);expect(text).not.toContain('ลิงก์แบบฟอร์ม:');
});
it('rejects a credential-bearing form destination even with a matching payload digest',()=>{
 const value=evidence(),form={name:'แบบคำร้อง',description:null,form_url:'https://www.yru.ac.th/forms/request?token=private-value',requirements:null};
 expect(()=>validateStructuredEvidence({...value,dataset:'service_forms',payload:form,reference:{...value.reference,dataset:'service_forms',
  payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'service_forms',payload:form})}})).toThrow('STRUCTURED_CITATION_INVALID');
});
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
it('rejects internal row identifiers in answer prose without silently removing text',()=>{
 expect(()=>buildStructuredAnswer({answer:`วันตามเอกสาร (rowId ${id})`,citationRowIds:[id]},[validateStructuredEvidence(evidence())])).toThrow('STRUCTURED_CITATION_INVALID');
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
it('reconstructs a full structured answer above 5000 characters with its complete reference and grapheme-safe packet bounds',()=>{
 const answerText='กำลังศึกษา👩‍👩‍👦 ค่าบริการ'.repeat(200),checked=validateStructuredEvidence(evidence());
 const expected=`${answerText}\n\nแหล่งอ้างอิง:\n1. ${checked.title} · CSV · แถว 7–9 · คอลัมน์ 1–8 · ตาราง 1 · แถว 8\n${checked.sourceUrl}`;
 const result=buildStructuredAnswer({answer:answerText,citationRowIds:[id]},[checked]);
 const parts=result.messages.map(message=>message.text),joined=parts.join('');
 expect(answerText.length).toBeGreaterThan(5000);
 expect(joined).toBe(expected);
 expect(parts.length).toBeLessThanOrEqual(5);
 expect(parts.every(part=>part.length<=5000)).toBe(true);
 const boundaries=new Set<number>([0]);let offset=0;
 for(const {segment} of new Intl.Segmenter('th',{granularity:'grapheme'}).segment(expected)){offset+=segment.length;boundaries.add(offset);}
 offset=0;
 for(const part of parts){offset+=part.length;expect(boundaries.has(offset)).toBe(true);}
});
it('preserves the distinct overflow error and returns no partial structured packet',()=>{
 const rows=Array.from({length:5},(_,index)=>{
  const rowId=`bbbbbbbb-bbbb-4bbb-8bbb-${String(index+1).padStart(12,'0')}`;
  const value=evidence();
  return validateStructuredEvidence({...value,rowId,title:'ก'.repeat(500),sourceUrl:'https://www.yru.ac.th/'+ 'a'.repeat(2023),
   reference:{...value.reference,rowId,coordinateKind:'EXTRACTED_LOGICAL',
    sourceLocation:{kind:'DOCX',blockStart:1,blockEnd:2,headingPath:Array.from({length:12},()=> 'ข'.repeat(200)),tableIndex:1}}});
 });
 expect(()=>buildStructuredAnswer({answer:'x'.repeat(11900),citationRowIds:rows.map(row=>row.rowId)},rows))
  .toThrow('LINE_TEXT_PACKET_TOO_LARGE');
});
it('preserves leading and trailing answer whitespace while rejecting whitespace-only answers',()=>{
 const checked=validateStructuredEvidence(evidence()),answerText=' \n  คำตอบที่ครบถ้วน\t \n';
 const expected=`${answerText}\n\nแหล่งอ้างอิง:\n1. ${checked.title} · CSV · แถว 7–9 · คอลัมน์ 1–8 · ตาราง 1 · แถว 8\n${checked.sourceUrl}`;
 const result=buildStructuredAnswer({answer:answerText,citationRowIds:[id]},[checked]);
 expect(result.messages.map(message=>message.text).join('')).toBe(expected);
 expect(()=>buildStructuredAnswer({answer:' \n\t ',citationRowIds:[id]},[checked]))
  .toThrow('STRUCTURED_CITATION_INVALID');
});
