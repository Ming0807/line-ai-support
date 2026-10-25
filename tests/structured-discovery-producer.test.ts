import {expect,it,vi} from 'vitest';
import {createKnowledgeProducer,type KnowledgeProducerOptions} from '../lib/knowledge/answer-producer';
import {canonicalDigest} from '../lib/imports/structured-mapping-contract';
import {buildStructuredAnswer} from '../lib/knowledge/structured-citations';
import {buildServiceDiscoveryOutput} from '../lib/knowledge/service-discovery';
const uuid=(n:number)=>`bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12,'0')}`,hash='a'.repeat(64);
const scope={historical:false,academicYear:null,asOfDate:null,familyCodes:[],departmentCode:null,audience:null,studentType:null,semester:null,programCode:null,curriculumCode:null,cohort:null};
const payload={academic_year:2569,semester:'ภาคเรียนตัวอย่าง',student_type:'ทุกกลุ่มทดสอบ',event_type:'TERM_OPEN',title:'เปิดภาคเรียน',start_date:'2026-06-15',end_date:null,description:'ข้อมูลทดสอบ'};
const evidence={rowId:uuid(1),dataset:'academic_calendar_events',payload,title:'ปฏิทินทดสอบ',familyCode:'ACADEMIC_CALENDAR',academicYear:2569,authorityLevel:80,sourceUrl:'https://fixture.yru.ac.th/calendar',reference:{schemaVersion:1,dataset:'academic_calendar_events',registryVersion:'structured-v1',mapperVersion:'structured-mapper-v1',rowId:uuid(1),documentId:uuid(2),documentRevision:0,jobId:uuid(3),jobRevision:0,extractionRevision:1,reviewRevision:1,sourceChecksum:hash,extractionDigest:hash,mappingDigest:hash,payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'academic_calendar_events',payload}),planDigest:hash,tableIndex:0,rowIndex:0,tableFirstRow:1,sourceRow:1,coordinateKind:'CSV_RECORD',sourceLocation:{kind:'CSV',rowStart:1,rowEnd:1,columnStart:1,columnEnd:8,tableIndex:1},ruleProof:{familyId:uuid(4),baseDocumentId:uuid(2),versionStream:'main',ruleRevision:'0',evaluationDate:'2026-10-14',contextDigest:hash}}};
const servicePayload={service_code:'LIBRARY',name:'ห้องสมุด',description:'หยุดวันนักขัตฤกษ์',location:'อาคารทดสอบ',opening_hours:'เสาร์ 09:00–15:30',phone:null as string|null,email:null as string|null,url:'https://fixture.yru.ac.th/library' as string|null};
function serviceRow(n=1,changes:Partial<{[K in keyof typeof servicePayload]:typeof servicePayload[K]|null}>={}){
 const payload={...servicePayload,...changes},rowId=uuid(n);
 return {...evidence,rowId,dataset:'university_services',academicYear:null,payload,reference:{...evidence.reference,rowId,dataset:'university_services',payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'university_services',payload})}};
}
it('preserves all differing service records and qualifications rather than choosing a schedule',()=>{
 const rows=[serviceRow(),serviceRow(2,{opening_hours:'เสาร์ 10:00–12:00',description:'เฉพาะช่วงปิดภาคเรียน',phone:'000-000-0000',email:'fixture@yru.ac.th'})];
 const result=buildServiceDiscoveryOutput(rows);
 expect(result.citationRowIds).toEqual(rows.map(r=>r.rowId));
 expect(result.answer).toContain('ยังไม่เลือก');
 for(const row of rows){expect(result.answer).toContain(row.payload.opening_hours);expect(result.answer).toContain(row.payload.description);}
 expect(result.answer).toContain('000-000-0000');expect(result.answer).toContain('fixture@yru.ac.th');
 expect(result.answer).not.toContain('LIBRARY');expect(result.answer).not.toContain('http');
});
it('labels missing hours and location as unknown without treating a null as closure',()=>{
 const result=buildServiceDiscoveryOutput([serviceRow(1,{opening_hours:null,location:null,description:null,url:null})]);
 expect(result.answer).toContain('เวลาทำการ: เอกสารไม่ระบุ');expect(result.answer).toContain('สถานที่: เอกสารไม่ระบุ');expect(result.answer).not.toContain('ปิด');
});
it('rejects different service identities, wrong datasets and more rows than can be cited',()=>{
 expect(()=>buildServiceDiscoveryOutput([serviceRow(),serviceRow(2,{name:'อีกบริการ'})])).toThrow();
 expect(()=>buildServiceDiscoveryOutput([evidence])).toThrow();
 expect(()=>buildServiceDiscoveryOutput(Array.from({length:6},(_,i)=>serviceRow(i+1)))).toThrow();
});
it('rejects a changed payload digest, credential URL and full-answer overflow without clipping',()=>{
 const row=serviceRow();expect(()=>buildServiceDiscoveryOutput([{...row,payload:{...row.payload,opening_hours:'ปลอม'}}])).toThrow();
 expect(()=>buildServiceDiscoveryOutput([serviceRow(1,{url:'https://fixture.yru.ac.th/?token=secret'})])).toThrow();
 expect(()=>buildServiceDiscoveryOutput(Array.from({length:3},(_,i)=>serviceRow(i+1,{description:'ก'.repeat(5000)})))).toThrow();
});
it('answers a bounded calendar discovery while retaining exact reviewed date and full context for revalidation',async()=>{
 const discoverStructured=vi.fn(async()=>({status:'READY' as const,evidence:[evidence]})),structuredSearch=vi.fn(),embed=vi.fn(),search=vi.fn();
 const generate=vi.fn(async(input:{taskType:string})=>({output:input.taskType==='KNOWLEDGE_PLAN'?{scope,selection:{method:'DISCOVER_CALENDAR',query:null,notApplicable:null}}:{answer:'เปิดภาคเรียนวันที่ 2026-06-15 ตามปฏิทินทดสอบ',citationRowIds:[uuid(1)]},toolCalls:[]}));
 const options={compactPlanning:true,generate,structuredSearch,discoverStructured,embed,search};
 const produce=createKnowledgeProducer(options as unknown as KnowledgeProducerOptions);
 const result=await produce({jobId:uuid(10),sessionId:uuid(11),conversationId:uuid(12),messageId:uuid(13),revision:0,question:'ปฏิทินมหาวิทยาลัยระบุวันเปิดภาคเรียนเมื่อไร',history:[]},new AbortController().signal);
 expect(result.kind).toBe('STRUCTURED_DISCOVERY');
 expect(discoverStructured).toHaveBeenCalledWith({dataset:'academic_calendar_events',scope});
 expect(structuredSearch).not.toHaveBeenCalled();expect(embed).not.toHaveBeenCalled();
 expect(result).toMatchObject({evidence:[evidence],output:{citationRowIds:[uuid(1)]}});
});
it('delivers a named service and its holiday qualification without waiting for another model completion',async()=>{
 const payload={service_code:'LIBRARY',name:'ห้องสมุด',description:'วันหยุดนักขัตฤกษ์ให้ตรวจประกาศก่อนเดินทาง',location:'อาคารทดสอบ',opening_hours:'เสาร์ 09:00–15:30',phone:null,email:null,url:'https://fixture.yru.ac.th/library'};
 const row={...evidence,dataset:'university_services',academicYear:null,payload,reference:{...evidence.reference,dataset:'university_services',payloadDigest:canonicalDigest('structured-payload-v1',{dataset:'university_services',payload})}};
 const discoverStructured=vi.fn(async()=>({status:'READY' as const,evidence:[row]}));
 const generate=vi.fn(async(input:{taskType:string})=>{
  if(input.taskType!=='KNOWLEDGE_PLAN')throw new Error('MODEL_COMPLETION_UNAVAILABLE');
  return {output:{scope,selection:{method:'DISCOVER_SERVICES',query:null,notApplicable:null}},toolCalls:[]};
 });
 const result=await createKnowledgeProducer({compactPlanning:true,generate,discoverStructured,structuredSearch:vi.fn(),embed:vi.fn(),search:vi.fn()} as unknown as KnowledgeProducerOptions)(
  {jobId:uuid(10),sessionId:uuid(11),conversationId:uuid(12),messageId:uuid(13),revision:0,question:'ห้องสมุดเปิดวันเสาร์ถึงกี่โมง',history:[]},new AbortController().signal);
 expect(result.kind).toBe('STRUCTURED_DISCOVERY');
 if(result.kind!=='STRUCTURED_DISCOVERY')throw Error('EXPECTED_DISCOVERY');
 const text=buildStructuredAnswer(result.output,result.evidence).messages.map(m=>m.text).join('');
 expect(text).toContain(payload.opening_hours);expect(text).toContain(payload.description);expect(text).toContain(payload.location);expect(text).toContain(payload.url);
 expect(result.evidence).toEqual([row]);expect(generate).toHaveBeenCalledTimes(1);
});
it.each(['ambiguous','too-many','cancelled'] as const)('does not bypass %s discovery guards or call completion',async mode=>{
 const controller=new AbortController();
 const rows=mode==='too-many'?Array.from({length:6},(_,i)=>serviceRow(i+1)):[serviceRow(),serviceRow(2,{name:'บริการอื่น'})];
 const discoverStructured=vi.fn(async()=>{if(mode==='cancelled')controller.abort();return {status:'READY' as const,evidence:rows};});
 const generate=vi.fn(async()=>({output:{scope,selection:{method:'DISCOVER_SERVICES',query:null,notApplicable:null}},toolCalls:[]}));
 const promise=createKnowledgeProducer({compactPlanning:true,generate,discoverStructured,structuredSearch:vi.fn(),embed:vi.fn(),search:vi.fn()} as unknown as KnowledgeProducerOptions)(
  {jobId:uuid(10),sessionId:uuid(11),conversationId:uuid(12),messageId:uuid(13),revision:0,question:mode==='ambiguous'?'ห้องสมุดกับบริการอื่นเปิดเมื่อไร':'ห้องสมุดเปิดเมื่อไร',history:[]},controller.signal);
 if(mode==='cancelled')await expect(promise).rejects.toMatchObject({code:'CANCELLED'});else expect((await promise).kind).toBe('CLARIFY');
 expect(generate).toHaveBeenCalledTimes(1);
});
