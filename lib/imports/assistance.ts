import {z} from 'zod';
import {isOfficialYruUrl} from './source';
import {getImportPreview,type ImportPreview,type ImportExtractionOptions} from './import-extraction';
import {authorizeImportAdmin,withImportAdminTransaction,ImportStagingError} from './import-staging';
import {assistanceEnvelopeSchema,type ImportAssistance} from './assistance-contract';
import {isValidKnowledgeDate} from '../knowledge/metadata-filter';
type References=Pick<ImportAssistance,'families'|'departments'>;
export interface ImportAssistanceOptions extends ImportExtractionOptions {
 /** Controlled internal concurrency seam outside SQL; never request-configurable. */
 beforeRead?:()=>Promise<void>;
}
const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const digits=(value:string)=>value.replace(/[๐-๙]/g,v=>String('๐๑๒๓๔๕๖๗๘๙'.indexOf(v)));
function dateAtStart(value:string):string|null{
 const raw=digits(value).trim();const iso=raw.match(/^(\d{4}-\d{2}-\d{2})(?!\d)/);
 if(iso)return isValidKnowledgeDate(iso[1])?iso[1]:null;
 const thai=raw.match(/^(\d{1,2})\s+([ก-๙]+)\s+(?:(พ\.?\s*ศ\.?|ค\.?\s*ศ\.?)\s*)?(\d{4})(?!\d)/);
 if(!thai)return null;const month=months.indexOf(thai[2])+1;if(!month)return null;
 const supplied=Number(thai[4]),era=thai[3]?.replace(/[.\s]/g,'');
 const year=era==='พศ'?supplied-543:era==='คศ'?supplied:supplied>=2400?supplied-543:supplied;
 if(year<1800||year>2400)return null;
 const result=`${year}-${String(month).padStart(2,'0')}-${thai[1].padStart(2,'0')}`;
 return isValidKnowledgeDate(result)?result:null;
}
function labelledDate(text:string,pattern:RegExp):string|null{
 const values=new Set<string>();let invalid=false;
 for(const match of text.matchAll(pattern)){
  const parsed=dateAtStart(text.slice((match.index??0)+match[0].length,(match.index??0)+match[0].length+100));
  if(parsed===null)invalid=true;else values.add(parsed);
 }
 return !invalid&&values.size===1?[...values][0]:null;
}
/** Proposals only. Explicit source evidence and named defaults, never consent or publication. */
export function buildImportAssistance(preview:ImportPreview,references:References):ImportAssistance{
 const a=preview.analysis;
 const metadata:ImportAssistance['metadata']={title:null,familyCode:null,newFamily:null,departmentCode:null,documentType:null,versionName:null,versionStream:'main',academicYear:null,
  scope:{semester:null,audience:null,studentType:null,programCode:null,curriculumCode:null,cohort:null},publishedAt:null,effectiveFrom:null,effectiveTo:null,authorityLevel:null,
  sourceUrl:null,sourcePageUrl:null,visibility:'INTERNAL',storageMode:'RAG',datasetType:null};
 const origins:ImportAssistance['origins']={versionStream:{kind:'DEFAULT',label:'สายฉบับหลัก · เปลี่ยนได้'},visibility:{kind:'DEFAULT',label:'เริ่มเป็นข้อมูลภายใน · ยังไม่ใช้ตอบนักศึกษา'},storageMode:{kind:'DEFAULT',label:'ใช้ข้อความอ้างอิง · ชุดข้อมูลตารางรอตัวเชื่อม'}};
 const propose=<K extends keyof ImportAssistance['origins']>(field:K,value:ImportAssistance['metadata'][K],kind:'EXTRACTED'|'CLASSIFIED',label:string)=>{
  if(value!==null){Object.assign(metadata,{[field]:value});origins[field]={kind,label};}
 };
 const title=a.title?.trim();if(title)propose('title',title,'EXTRACTED','ชื่อเรื่องที่ตัวอ่านพบ');
 if(a.familyCode&&references.families.some(v=>v.code===a.familyCode))propose('familyCode',a.familyCode,'CLASSIFIED','เสนอจากประเภทเนื้อหา · ตรวจกลุ่มอีกครั้ง');
 if(a.departmentCode&&references.departments.some(v=>v.code===a.departmentCode))propose('departmentCode',a.departmentCode,'CLASSIFIED','เสนอจากประเภทเนื้อหา · ตรวจเจ้าของเอกสาร');
 if(a.documentType)propose('documentType',a.documentType,'CLASSIFIED','เสนอจากประเภทเนื้อหา');
 if(a.academicYear!==null&&a.academicYear>=2400&&a.academicYear<=3000){propose('academicYear',a.academicYear,'EXTRACTED','ปีการศึกษาที่ระบุชัดในข้อความ');if(a.versionName)propose('versionName',a.versionName,'CLASSIFIED','ชื่อฉบับจากปีการศึกษา');}
 if(preview.job.sourceUrl&&isOfficialYruUrl(preview.job.sourceUrl)&&preview.job.sourceUrl.length<=2000)propose('sourceUrl',preview.job.sourceUrl,'EXTRACTED','แหล่งที่มาที่เก็บพร้อมต้นฉบับ');
 const text=preview.extraction.pages.map(p=>p.text).join('\n');
 const published=labelledDate(text,/(?:ประกาศ(?:\s+ณ)?\s*(?:วันที่|วัน\s*ที่)|วันที่ประกาศ\s*[:：]?|published\s*(?:on|date)\s*[:：]?)/giu);
 const from=labelledDate(text,/(?:(?:มีผล(?:ใช้บังคับ)?|เริ่มมีผล|ให้ใช้บังคับ)\s*(?:ตั้งแต่)?\s*(?:วัน)?ที่|effective\s*(?:from|date)\s*[:：]?)/giu);
 const to=labelledDate(text,/(?:(?:สิ้นสุด(?:ลง)?|มีผลถึง)\s*(?:วัน)?ที่|effective\s*to\s*[:：]?)/giu);
 propose('publishedAt',published,'EXTRACTED','อ่านจากข้อความระบุวันประกาศ');propose('effectiveFrom',from,'EXTRACTED','อ่านจากข้อความระบุวันเริ่มใช้บังคับ');
 if(to!==null&&from!==null&&to>=from)propose('effectiveTo',to,'EXTRACTED','อ่านจากข้อความระบุวันสิ้นผล');
 return assistanceEnvelopeSchema.parse({assistance:{jobId:preview.job.id,jobRevision:preview.job.revision,extractionRevision:preview.extractionRevision,metadata,origins,...references}}).assistance;
}
export async function getImportAssistance(actor:string,id:string,options:ImportAssistanceOptions={}):Promise<ImportAssistance>{
 await authorizeImportAdmin(actor,options);if(!z.uuid().safeParse(id).success)throw new ImportStagingError('NOT_FOUND');
 if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');
 const preview=await getImportPreview(actor,id,options);
 await options.beforeRead?.();
 return withImportAdminTransaction(actor,options,async client=>{
  if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');
  const row=(await client.query('select revision from private.knowledge_import_jobs where id=$1 for share',[id])).rows[0];
  const latest=(await client.query('select max(revision)::int revision from private.knowledge_import_revisions where job_id=$1',[id])).rows[0];
  if(row?.revision!==preview.job.revision||latest?.revision!==preview.extractionRevision)throw new ImportStagingError('CONFLICT');
  const families=(await client.query('select code,name,category from public.document_families order by code,id limit 1001')).rows;
  const departments=(await client.query('select code,name_th name from public.departments order by code,id limit 1001')).rows;
  if(families.length>1000||departments.length>1000)throw new ImportStagingError('INTERNAL_ERROR');
  if(options.signal?.aborted)throw new ImportStagingError('CONFLICT');
  return buildImportAssistance(preview,{families,departments});
 });
}
