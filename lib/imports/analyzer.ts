import {z} from 'zod';
import {isOfficialYruUrl,verifyImportSource} from './source';
import {validateLocatedExtraction} from './extraction';
import {datasetTypes,extractionSchema,type DatasetType,type ImportAnalysis,type ImportSource,type SensitiveCategory} from './types';

const optionsSchema=z.object({installedDatasets:z.array(z.enum(datasetTypes)).max(7).refine(values=>new Set(values).size===values.length).default([])}).strict();
const invalid=():never=>{throw new Error('IMPORT_EXTRACTION_INVALID');};
const candidates:{pattern:RegExp;family:string;department:string;type:string;dataset:DatasetType|null}[]=[
 {pattern:/ปฏิทิน(?:วิชาการ|การศึกษา)|academic calendar/iu,family:'ACADEMIC_CALENDAR',department:'ACADEMIC_AFFAIRS',type:'CALENDAR',dataset:'academic_calendar_events'},
 {pattern:/ค่าธรรมเนียม|ค่าเล่าเรียน|tuition fee/iu,family:'TUITION_FEE',department:'FINANCE',type:'FEE',dataset:'tuition_fees'},
 {pattern:/ตาราง.*เทียบโอน|transfer course/iu,family:'TRANSFER_COURSE_TABLE',department:'ACADEMIC_AFFAIRS',type:'COURSE_TABLE',dataset:'transfer_courses'},
 {pattern:/ระเบียบ.*เทียบโอน/iu,family:'TRANSFER_REGULATION',department:'ACADEMIC_AFFAIRS',type:'REGULATION',dataset:null},
 {pattern:/wi-?fi|เครือข่ายไร้สาย/iu,family:'WIFI_GUIDE',department:'IT',type:'GUIDE',dataset:null},
 {pattern:/yru passport/iu,family:'YRU_PASSPORT_GUIDE',department:'IT',type:'GUIDE',dataset:'university_systems'},
 {pattern:/แบบฟอร์ม|คำร้อง|service form/iu,family:'SERVICE_FORM',department:'ACADEMIC_AFFAIRS',type:'FORM',dataset:'service_forms'},
 {pattern:/ประกาศ|announcement/iu,family:'ANNOUNCEMENT',department:'ADMIN',type:'ANNOUNCEMENT',dataset:'announcements'},
];
function sensitivity(text:string):SensitiveCategory[]{
 const categories:SensitiveCategory[]=[];
 if(/รายชื่อนักศึกษา|รหัสนักศึกษา|student\s*(?:id|list|record)/iu.test(text))categories.push('STUDENT_RECORDS');
 if(/(?:\+66|0)[-\s]?[689](?:[-\s]?\d){8}\b|(?:โทรศัพท์|phone)\s*:?\s*[0-9๐-๙-]{6,}/iu.test(text))categories.push('PHONE');
 for(const match of text.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/giu)){
  const domain=match[1].toLowerCase();if(domain!=='yru.ac.th'&&!domain.endsWith('.yru.ac.th')){categories.push('PERSONAL_EMAIL');break;}
 }
 if(/ผลการเรียน|เกรด|\bgpa\b|student grades/iu.test(text))categories.push('GRADES');
 if(/ประวัติการรักษา|ข้อมูลสุขภาพ|ประวัติผู้ป่วย|medical\s*(?:data|record|history)/iu.test(text))categories.push('MEDICAL');
 if(/เลขบัญชีธนาคาร|ข้อมูลการเงินส่วนบุคคล|personal\s*(?:finance|financial)|bank account/iu.test(text))categories.push('PERSONAL_FINANCE');
 return categories;
}
/** Proposals only: no publication, trusted dates/authority, dynamic SQL or model call. */
export function analyzeExtraction(source:ImportSource,input:unknown,options:unknown={}):ImportAnalysis{
 const verified=verifyImportSource(source);
 const candidateInput=input&&typeof input==='object'&&'locations' in input?validateLocatedExtraction(verified,input):input;
 const baseInput=candidateInput&&typeof candidateInput==='object'&&'locations' in candidateInput?{
  title:'title' in candidateInput?candidateInput.title:undefined,pages:'pages' in candidateInput?candidateInput.pages:undefined,
  tables:'tables' in candidateInput?candidateInput.tables:undefined,flags:'flags' in candidateInput?candidateInput.flags:undefined,
 }:candidateInput;
 const parsed=extractionSchema.safeParse(baseInput),configuration=optionsSchema.safeParse(options);
 if(!parsed.success||!configuration.success)return invalid();const value=parsed.data;
 const pageNumbers=new Set(value.pages.map(page=>page.pageNumber));
 if(value.pages.some(page=>verified.format==='PDF'?page.pageNumber===null:page.pageNumber!==null)||
  value.tables.some(table=>table.pageNumber!==null&&!pageNumbers.has(table.pageNumber)))return invalid();
 const text=[value.title??'',...value.pages.map(page=>page.text),...value.tables.flatMap(table=>table.rows.map(row=>row.join(' ')))].join('\n');
 const classifiedText=value.title??value.pages[0].text.slice(0,500);
 const specializedMatches=candidates.filter(candidate=>candidate.family!=='ANNOUNCEMENT'&&candidate.pattern.test(classifiedText));
 const announcementMatches=candidates.filter(candidate=>candidate.family==='ANNOUNCEMENT'&&candidate.pattern.test(classifiedText));
 const matches=specializedMatches.length>0?specializedMatches:announcementMatches;
 const candidate=matches.length===1?matches[0]:null;
 const ambiguousCategory=specializedMatches.length>1||specializedMatches.length===0&&announcementMatches.length>1;
 const years=new Set<number>();
 for(const match of text.matchAll(/(?:ปีการศึกษา|academic year)\s*[:：]?\s*([12][0-9]{3})/giu)){years.add(Number(match[1]));if(years.size>1)break;}
 const academicYear=years.size===1?[...years][0]:null;
 const flags=new Set<string>(value.flags);
 if(value.pages.some(page=>page.requiresReview))flags.add('PAGE_REVIEW_REQUIRED');
 if(value.tables.some(table=>table.rows.some(row=>row.length!==table.rows[0].length)))flags.add('TABLE_SHAPE_REVIEW');
 if(!verified.sourceUrl||!isOfficialYruUrl(verified.sourceUrl))flags.add('SOURCE_REVIEW_REQUIRED');
 if(years.size>1)flags.add('ACADEMIC_YEAR_AMBIGUOUS');if(ambiguousCategory)flags.add('FAMILY_AMBIGUOUS');
 const containsTables=value.tables.length>0,datasetCandidate=candidate?.dataset??null;
 const installed=datasetCandidate!==null&&configuration.data.installedDatasets.includes(datasetCandidate);
 if(containsTables&&!installed)flags.add('STRUCTURED_SCHEMA_UNAVAILABLE');
 const narrative=value.pages.some(page=>page.text.trim().length>0);
 const recommendedStorageMode=containsTables&&installed?(narrative?'BOTH':'STRUCTURED'):'RAG';
 const sensitiveCategories=sensitivity(text);if(sensitiveCategories.length)flags.add('SENSITIVE_DATA_REVIEW_REQUIRED');
 return {title:value.title,departmentCode:candidate?.department??null,documentType:candidate?.type??null,familyCode:candidate?.family??null,
  versionName:academicYear===null?null:`ปีการศึกษา ${academicYear}`,academicYear,publishedDate:null,effectiveFrom:null,effectiveTo:null,authorityLevel:null,
  containsTables,datasetCandidate,recommendedStorageMode,sensitiveRisk:sensitiveCategories.length>0,sensitiveCategories,
  amendmentCandidate:/แก้ไขเพิ่มเติม|\bamendment\b/iu.test(value.title??value.pages[0].text.slice(0,500)),flags:[...flags],reviewStatus:'PENDING_REVIEW',approved:false};
}
