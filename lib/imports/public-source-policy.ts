import type {ImportReviewDraft} from './review-schema';
import type {ImportPreview} from './import-extraction';
import type {ReviewWarning} from './review-warnings';

/** Final publication policy, not analysis or an automatic claim that content is nonpersonal. */
export function hasValidPublicTemporalReview(draft:Extract<ImportReviewDraft,{schemaVersion:4}>):boolean{
 const m=draft.metadata,r=draft.publicSourceReview;
 if(m.visibility!=='PUBLIC'||m.storageMode!=='RAG'||draft.structuredMapping!==null)return false;
 if(r.temporalBasis==='DATED')return m.effectiveFrom!==null;
 const scopedNotice=m.documentType==='ANNOUNCEMENT'&&m.publishedAt!==null&&m.scope.cohort!==null&&m.scope.audience!==null&&m.scope.audience!=='ALL'&&m.scope.studentType!==null&&m.scope.studentType!=='ALL';
 return (['FORM','GUIDE','CALENDAR'].includes(m.documentType??'')||scopedNotice)&&(m.documentType!=='CALENDAR'||m.academicYear!==null)&&m.effectiveFrom===null&&m.effectiveTo===null&&
  Boolean(r.temporalReason?.trim())&&draft.relationship===null&&draft.target===null&&
  (draft.action==='NEW_FAMILY'||draft.action==='ADD_ADDITIONAL');
}

export function reviewedPublicContent(preview:ImportPreview,draft:ImportReviewDraft,warnings:ReviewWarning[]):boolean{
 if(draft.schemaVersion!==4||draft.metadata.visibility!=='PUBLIC'||draft.metadata.storageMode!=='RAG'||draft.structuredMapping!==null)return false;
 const categories=preview.analysis.sensitiveCategories,adjudications=draft.publicSourceReview.sensitivityAdjudications;
 if(categories.length===0||adjudications.length!==categories.length||new Set(categories).size!==categories.length)return false;
 if(!categories.every(category=>adjudications.some(a=>a.category===category&&Boolean(a.reason?.trim()))))return false;
 const findings=warnings.filter(w=>w.code==='SENSITIVE_DATA_REVIEW_REQUIRED');
 if(findings.length===0||!findings.every(w=>draft.warningDispositions.some(d=>d.warningKey===w.key&&d.status==='FALSE_POSITIVE'&&Boolean(d.reason?.trim()))))return false;
 const text=[preview.extraction.title??'',...preview.extraction.pages.map(p=>p.text),...preview.extraction.tables.flatMap(t=>t.rows.map(r=>r.join(' ')))].join('\n')
  .replace(/[๐-๙]/gu,c=>String(c.charCodeAt(0)-0x0e50));
 // A review choice cannot relabel obvious populated identifiers or a filled grade form.
 if(/(?:รหัส(?:ประจำตัว)?นักศึกษา|student\s*id)\s*[:：#]?\s*\d{6,}/iu.test(text)||/\b\d{10,13}\b/u.test(text))return false;
 const blank=/^[\s._\-–—/\\()[\]□☐…]*$/u;
 const sensitiveHeader=/รหัส(?:ประจำตัว)?นักศึกษา|student\s*id|ผลการเรียน|เกรด|\bgpa\b|\bgrade\b|ชื่อ\s*[-–]?\s*(?:นามสกุล|สกุล)|\b(?:full\s*name|name)\b/iu;
 const filledSensitiveColumn=preview.extraction.tables.some(table=>table.rows.some((row,index)=>row.some((cell,column)=>
  sensitiveHeader.test(cell)&&table.rows.slice(index+1).some(next=>column<next.length&&!blank.test(next[column])&&!sensitiveHeader.test(next[column])))));
 return adjudications.every(a=>{
  if(a.basis==='GENERAL_POLICY_WORDING')return a.category==='GRADES'&&['REGULATION','GUIDE','CALENDAR','ANNOUNCEMENT'].includes(draft.metadata.documentType??'');
  if(a.basis==='PUBLIC_BLANK_TEMPLATE')return draft.metadata.documentType==='FORM'&&['STUDENT_RECORDS','GRADES'].includes(a.category)&&
   !filledSensitiveColumn&&!/\b\d{6,13}\b/u.test(text)&&
   !/(?:เกรด|ผลการเรียน|\bgpa\b|\bgrade\b)\s*[:：=]?\s*(?:[0-4](?:[.,]\d+)?|[A-F][+-]?)(?:\b|\s|$)/iu.test(text)&&
   !/(?:นาย|นางสาว|นาง|Mr\.?|Mrs\.?|Ms\.?)\s*[\p{L}]{2,}\s+[\p{L}]{2,}/iu.test(text);
  if(a.basis==='INSTITUTIONAL_CONTACT')return a.category==='PHONE'&&draft.metadata.documentType==='GUIDE'&&
   !/(?:\+66|0)[-\s]?[689](?:[-\s]?\d){8}\b/u.test(text)&&
   /(?:โทรศัพท์|phone)\s*:?[\s]*(?:0[2-57](?:[-\s]?\d){7}|\+66[2-57](?:[-\s]?\d){7})\b/iu.test(text);
  return false;
 });
}

/** No generic quality override: only manually corrected diagram pages whose detected cells are all empty. */
export function reviewedNonTabularDiagram(preview:ImportPreview,draft:ImportReviewDraft,finding:ReviewWarning):boolean{
 if(draft.schemaVersion!==4||draft.metadata.visibility!=='PUBLIC'||draft.metadata.storageMode!=='RAG'||!['FORM','GUIDE'].includes(draft.metadata.documentType??'')||
  preview.job.format!=='PDF'||preview.kind!=='EDITED'||!preview.edit||finding.code!=='UNSUPPORTED_TABLES'||finding.location?.kind!=='PDF')return false;
 const adjudication=draft.publicSourceReview.extractionAdjudications?.find(a=>a.warningKey===finding.key);
 if(!adjudication?.reason?.trim()||adjudication.basis!=='REVIEWED_NON_TABULAR_DIAGRAM')return false;
 const disposition=draft.warningDispositions.find(w=>w.warningKey===finding.key);
 if(disposition?.status!=='FALSE_POSITIVE'||!disposition.reason?.trim())return false;
 const pageNumber=finding.location.pageNumber,pageIndex=preview.extraction.pages.findIndex(p=>p.pageNumber===pageNumber);
 if(pageIndex<0||!preview.edit.changedPages.includes(pageIndex)||preview.extraction.pages[pageIndex].text.trim().length<40)return false;
 const tables=preview.extraction.tables.filter(t=>t.pageNumber===pageNumber);
 return tables.every(t=>t.rows.length>0&&t.rows.every(row=>row.length>0&&row.every(cell=>cell.trim()==='')));
}
