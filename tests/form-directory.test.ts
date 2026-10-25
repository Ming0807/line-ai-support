import {expect,it,vi} from 'vitest';
import {createKnowledgeProducer,type KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import {aiResultSchema,requiresStructuredCatalog} from '../lib/ai/jobs';
import {createAssistantOrchestrator} from '../lib/ai/assistant-orchestrator';
import type {AssistantDecision} from '../lib/ai/assistant-decision';
import {canonicalDigest} from '../lib/imports/structured-mapping-contract';
import {formDirectoryResultSchema,buildFormDirectory} from '../lib/knowledge/form-directory';

const hash='a'.repeat(64);
const scope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:'ALL',studentType:'ALL',semester:null,programCode:null,curriculumCode:null,cohort:null};
const uuid=(index:number)=>`bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12,'0')}`;

function formEvidence(index:number,options:{formUrl?:string;sourceUrl?:string;dataset?:'service_forms'|'university_services'}={}){
 const rowId=uuid(index),dataset=options.dataset??'service_forms';
 const payload=dataset==='service_forms'
  ?{name:`แบบคำร้อง ${index}`,description:`รายละเอียด ${index}`,form_url:options.formUrl??`https://www.yru.ac.th/forms/form-${index}.pdf`,requirements:null}
  :{service_code:`SERVICE_${index}`,name:`บริการ ${index}`,description:null,location:null,opening_hours:null,phone:null,email:null,url:null};
 return {rowId,dataset,payload,title:`เอกสาร ${index}`,familyCode:'SERVICE_FORMS',academicYear:null,authorityLevel:80,
  sourceUrl:options.sourceUrl??`https://records.yru.ac.th/source-${index}.html`,reference:{schemaVersion:1,dataset,registryVersion:'structured-v1',mapperVersion:'structured-mapper-v1',rowId,
   documentId:uuid(100+index),documentRevision:0,jobId:uuid(200+index),jobRevision:0,extractionRevision:1,reviewRevision:1,sourceChecksum:hash,extractionDigest:hash,mappingDigest:hash,
   payloadDigest:canonicalDigest('structured-payload-v1',{dataset,payload}),planDigest:hash,tableIndex:0,rowIndex:1,tableFirstRow:7,sourceRow:8,coordinateKind:'CSV_RECORD',
   sourceLocation:{kind:'CSV',rowStart:7,rowEnd:9,columnStart:1,columnEnd:5,tableIndex:1},
   ruleProof:{familyId:uuid(300+index),baseDocumentId:uuid(100+index),versionStream:'main',ruleRevision:'0',evaluationDate:'2026-10-13',contextDigest:hash}}};
}

const result=(evidence:unknown[])=>({kind:'FORM_DIRECTORY',scope,evidence});
it.each([
 ['เขียนจุดประสงค์ให้ชัดเจน รวบรวมข้อมูลที่มี และตรวจคำแนะนำของแบบฟอร์มก่อนยื่นครับ',true],
 ['ต้องแนบสำเนาบัตรประชาชนและใบแสดงผลการศึกษา',false],
] as const)('retains reviewed form links while screening the independent general segment',async(generalText,accepted)=>{
 const official=formDirectoryResultSchema.parse(result([formEvidence(1)]));
 const decision:AssistantDecision={action:'MIXED_REPLY',generalText,query:'แบบฟอร์มอยู่ที่ไหน'};
 const lookup=vi.fn(async()=>official),handoff=vi.fn();
 const produce=createAssistantOrchestrator({decide:async()=>({decision,provenance:'MODEL_PROPOSAL_UNVERIFIED',historyOmittedCount:0}),lookup,handoff});
 const snapshot={jobId:uuid(1),sessionId:uuid(2),conversationId:uuid(3),messageId:uuid(4),revision:0,question:'ช่วยเตรียมตัวและหาแบบฟอร์ม',history:[]};
 const actual=await produce(snapshot,new AbortController().signal);
 expect(actual.kind).toBe('MIXED');expect(aiResultSchema.safeParse(actual).success).toBe(true);
 expect(lookup).toHaveBeenCalledWith(snapshot,expect.any(AbortSignal),decision.query);expect(handoff).not.toHaveBeenCalled();
 if(actual.kind==='MIXED'){
  expect(actual.official).toBe(official);
  if(accepted)expect(actual.general.text).toBe(generalText);
  else {expect(actual.general.text).toContain('ยังตอบส่วนคำแนะนำทั่วไปได้ไม่ครบ');expect(JSON.stringify(actual)).not.toContain(generalText);}
 }
});
it('uses model-proposed discovery without exact-selector guessing or another generation call',async()=>{
 const groundedScope={...scope,audience:null,studentType:null};
 const directory=formDirectoryResultSchema.parse({...result([formEvidence(1)]),scope:groundedScope});
 const generate=vi.fn(async()=>({output:{scope:groundedScope,selection:{method:'DISCOVER_FORMS',query:null,notApplicable:null}},toolCalls:[],providerId:'fixture',modelId:'fixture',fallbackUsed:false}));
 const discoverForms=vi.fn(async()=>({status:'READY' as const,evidence:directory.evidence}));
 const embed=vi.fn(),search=vi.fn(),structuredSearch=vi.fn();
 const produce=createKnowledgeProducer({generate:generate as KnowledgeProducerOptions['generate'],discoverForms,embed,search,structuredSearch,compactPlanning:true});
 const actual=await produce({jobId:uuid(1),sessionId:uuid(2),conversationId:uuid(3),messageId:uuid(4),revision:0,question:'แบบฟอร์มคำร้องของมหาวิทยาลัยอยู่ที่ไหน',history:[]},new AbortController().signal);
 expect(actual).toEqual(directory);expect(aiResultSchema.safeParse(actual).success).toBe(true);expect(requiresStructuredCatalog(actual)).toBe(true);
 expect(discoverForms).toHaveBeenCalledWith({scope:groundedScope});expect(generate).toHaveBeenCalledTimes(1);
 expect(embed).not.toHaveBeenCalled();expect(search).not.toHaveBeenCalled();expect(structuredSearch).not.toHaveBeenCalled();
});

it('accepts a strict directory result with six validated service form rows',()=>{
 const parsed=formDirectoryResultSchema.parse(result(Array.from({length:6},(_,index)=>formEvidence(index+1))));
 expect(parsed.kind).toBe('FORM_DIRECTORY');expect(parsed.evidence).toHaveLength(6);
 expect(formDirectoryResultSchema.safeParse({...result([formEvidence(1)]),query:'invented'}).success).toBe(false);
 expect(formDirectoryResultSchema.safeParse({...result([formEvidence(1)]),support:{troubleshoot:true}}).success).toBe(false);
});

it('renders every reviewed form destination and its distinct source reference without model prose',()=>{
 const rows=Array.from({length:6},(_,index)=>formEvidence(index+1));
 const rendered=buildFormDirectory(result(rows)),text=rendered.messages.map(message=>message.text).join('');
 expect(rendered.citations).toHaveLength(6);
 for(let index=1;index<=6;index++){
  expect(text).toContain(`https://www.yru.ac.th/forms/form-${index}.pdf`);
  expect(text).toContain(`https://records.yru.ac.th/source-${index}.html`);
 }
 expect(text).toContain('ลิงก์แบบฟอร์ม:');
 expect(text).toContain('กรุณาเลือกแบบฟอร์มที่ตรงกับเรื่องของคุณ');
 expect(text).toContain('ไม่ได้ยืนยันว่าคุณมีสิทธิ์หรือเข้าเกณฑ์');
 expect(text).not.toContain('model');
});

it('rejects other datasets, more than twenty rows, and changed payloads or digests',()=>{
 expect(formDirectoryResultSchema.safeParse(result([formEvidence(1,{dataset:'university_services'})])).success).toBe(false);
 expect(formDirectoryResultSchema.safeParse(result(Array.from({length:21},(_,index)=>formEvidence(index+1)))).success).toBe(false);
 const changed=formEvidence(1) as ReturnType<typeof formEvidence> & {payload:{name:string}};
 changed.payload.name='แก้ไขหลังตรวจทาน';
 expect(formDirectoryResultSchema.safeParse(result([changed])).success).toBe(false);
 const wrongDigest=formEvidence(1);wrongDigest.reference.payloadDigest='b'.repeat(64);
 expect(formDirectoryResultSchema.safeParse(result([wrongDigest])).success).toBe(false);
});

it('preserves the reviewed purpose and its qualifications verbatim for each form',()=>{
 const row=formEvidence(1);
 row.payload.description='ใช้แจ้งแก้ไขข้อมูลติดต่อเท่านั้น ไม่ได้ยืนยันการอนุมัติคำร้อง';
 row.reference.payloadDigest=canonicalDigest('structured-payload-v1',{dataset:row.dataset,payload:row.payload});
 const text=buildFormDirectory(result([row])).messages.map(message=>message.text).join('');
 expect(text).toContain(row.payload.description);
 expect(text).toContain('คำอธิบายจากเอกสาร:');
});

it('does not invent a description when the reviewed field is absent',()=>{
 const row=formEvidence(1);row.payload.description=null;
 row.reference.payloadDigest=canonicalDigest('structured-payload-v1',{dataset:row.dataset,payload:row.payload});
 const text=buildFormDirectory(result([row])).messages.map(message=>message.text).join('');
 expect(text).not.toContain('คำอธิบายจากเอกสาร:');
 expect(text).not.toContain('null');
});

it('preserves long Thai descriptions across packets and rejects a directory that cannot fit in full',()=>{
 const rows=Array.from({length:10},(_,i)=>{
  const row=formEvidence(i+1);row.payload.description='ใช้สำหรับข้อมูลทดสอบเท่านั้น '.repeat(100);
  row.reference.payloadDigest=canonicalDigest('structured-payload-v1',{dataset:row.dataset,payload:row.payload});return row;
 });
 const rendered=buildFormDirectory(result(rows.slice(0,3)));
 expect(rendered.messages.length).toBeGreaterThan(1);
 const text=rendered.messages.map(message=>message.text).join('');
 expect(text.split(rows[0].payload.description!).length-1).toBe(3);
 for(const row of rows){row.payload.description='Reviewed form purpose only. '.repeat(100);
  row.reference.payloadDigest=canonicalDigest('structured-payload-v1',{dataset:row.dataset,payload:row.payload});}
 expect(formDirectoryResultSchema.safeParse(result(rows)).success).toBe(true);
 expect(()=>buildFormDirectory(result(rows))).toThrow('LINE_TEXT_PACKET_TOO_LARGE');
});

it('rejects a complete result larger than 128 KiB',()=>{
 const oversized={...result([formEvidence(1)]),unexpected:'x'.repeat(129*1024)};
 expect(formDirectoryResultSchema.safeParse(oversized).success).toBe(false);
});

it('returns no partial packet when all directory rows cannot fit in LINE bounds',()=>{
 const rows=Array.from({length:16},(_,index)=>{
  const suffix=String(index+1).padStart(2,'0');
  return formEvidence(index+1,{formUrl:`https://www.yru.ac.th/forms/${suffix}-${'f'.repeat(900)}.pdf`,sourceUrl:`https://records.yru.ac.th/${suffix}-${'s'.repeat(900)}.html`});
 });
 expect(formDirectoryResultSchema.safeParse(result(rows)).success).toBe(true);
 expect(()=>buildFormDirectory(result(rows))).toThrow('LINE_TEXT_PACKET_TOO_LARGE');
});
