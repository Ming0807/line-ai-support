import {it,expect,vi} from 'vitest';
import {PDFParse} from 'pdf-parse';
import {createPdfFixture} from './fixtures/import-pdf';
import {createImportSource} from '../lib/imports/source';
import {parsePdfSource} from '../lib/imports/pdf-parser';
import {applyExtractionEdit} from '../lib/imports/review-draft';
import {analyzeExtraction} from '../lib/imports/analyzer';
import {buildReviewWarnings} from '../lib/imports/review-warnings';
import {buildLocatedChunkPlan} from '../lib/knowledge/located-chunk-plan';
import {locatedPlanFixture} from './fixtures/located-plan';
import {unfinishedReviewDraft} from './fixtures/import-review';
import {reviewDraftSchema} from '../lib/imports/review-schema';
import {validatePublicationReview} from '../lib/imports/publication-contract';
import type {ImportPreview} from '../lib/imports/import-extraction';

async function fixture(){
 const f=await locatedPlanFixture();const source=createImportSource({bytes:createPdfFixture([{lines:[{text:'Over-credit request workflow',y:720},{text:'Complete the blank request form and submit to the faculty.',y:690},{text:'If the academic committee rejects, notify the applicant.',y:660}]}]),filename:'diagram.pdf',mimeType:'application/pdf',sourceUrl:f.source.sourceUrl,acquiredFrom:'UPLOAD',fetchedAt:null});
 const table=vi.spyOn(PDFParse.prototype,'getTable').mockResolvedValue({total:1,pages:[{num:1,tables:[[[],[''],['']]]}],mergedTables:[]});
 let original;try{original=await parsePdfSource(source);}finally{table.mockRestore();}
 const edit=applyExtractionEdit(source,original,{pages:[{index:0,text:original.pages[0].text+'\nSource-view review: the boxes are a workflow diagram, not a populated data table.'}],reason:'Read the actual synthetic page and retained every step and rejection branch.'});
 const preview:ImportPreview={job:{id:f.plan.binding.jobId,status:'READY',revision:3,filename:source.filename,format:'PDF',mimeType:'application/pdf',sourceUrl:source.sourceUrl,acquiredFrom:'UPLOAD',fetchedAt:null,acquisition:null,byteLength:source.bytes.length,createdAt:'2026-10-26T00:00:00.000Z',errorCode:null},extractionRevision:2,kind:'EDITED',extraction:edit.extraction,edit:edit.edit,analysis:analyzeExtraction(source,edit.extraction)};
 const warnings=buildReviewWarnings(preview),plan=await buildLocatedChunkPlan(source,preview.extraction,f.plan.binding,f.counter),base=unfinishedReviewDraft();
 const input={...base,schemaVersion:4,metadata:{...base.metadata,title:'Request form and workflow',familyCode:'FORM_WORKFLOW',newFamily:{name:'Request forms',category:'TEST'},departmentCode:'REGISTRAR',documentType:'FORM',versionName:'reviewed',versionStream:'ALL',scope:{...base.metadata.scope,audience:'ALL',studentType:'ALL'},authorityLevel:50,sourceUrl:source.sourceUrl,visibility:'PUBLIC',storageMode:'RAG'},action:'NEW_FAMILY',attestations:{sourceAuthorityReviewed:true,extractionReviewed:true,applicabilityReviewed:true,sensitivityReviewed:true,versionReviewed:true},chunkPlan:{digest:plan.digest,chunkerVersion:plan.chunkerVersion},structuredMapping:null,
  publicSourceReview:{temporalBasis:'CURRENT_REVIEWED',temporalReason:'Official current blank form with no effective date.',sensitivityAdjudications:[],extractionAdjudications:warnings.filter(w=>w.code==='UNSUPPORTED_TABLES').map(w=>({warningKey:w.key,basis:'REVIEWED_NON_TABULAR_DIAGRAM',reason:'Manually checked all source boxes/arrows; empty detector geometry only; no table data omitted.'}))},
  warningDispositions:warnings.map(w=>({warningKey:w.key,status:w.code==='UNSUPPORTED_TABLES'?'FALSE_POSITIVE':'CORRECTED',reason:'Full physical page reviewed with the original retained.'}))};
 const draft=reviewDraftSchema.parse(input);const review={jobId:preview.job.id,jobRevision:3,extractionRevision:2,reviewRevision:1,stale:false,warnings,saved:{reviewRevision:1,jobRevision:3,extractionRevision:2,actorId:'123e4567-e89b-42d3-a456-426614174001',createdAt:'2026-10-26T00:00:00.000Z',draft}};
 return {preview,input,review,validate:()=>validatePublicationReview(preview,review,plan,source.checksum)};
}
it('admits only explicitly reviewed non-tabular empty PDF geometry without removing warnings',async()=>{
 const f=await fixture();expect(f.validate().draft.schemaVersion).toBe(4);expect(f.preview.extraction.flags).toContain('UNSUPPORTED_TABLES');expect(f.preview.extraction.report.warnings.some(w=>w.code==='UNSUPPORTED_TABLES'&&w.severity==='BLOCKING')).toBe(true);
});
it('does not accept a generic warning dismissal, missing reason or an unrelated adjudication key',async()=>{
 const f=await fixture();
 for(const records of [[],f.input.publicSourceReview.extractionAdjudications.map(a=>({...a,reason:null})),f.input.publicSourceReview.extractionAdjudications.map(a=>({...a,warningKey:'a'.repeat(64)}))]){
  f.review.saved.draft=reviewDraftSchema.parse({...f.input,publicSourceReview:{...f.input.publicSourceReview,extractionAdjudications:records}});expect(f.validate).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');
 }
});
it('keeps nonempty cells, unedited pages, generic location and structured modes blocked',async()=>{
 const cells=await fixture();cells.preview.extraction.tables[0].rows[0][0]='Actual data';expect(cells.validate).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');
 const unedited=await fixture();unedited.preview.kind='PARSED';unedited.preview.edit=null;expect(unedited.validate).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');
 const global=await fixture();global.preview.extraction.report.warnings.find(w=>w.code==='UNSUPPORTED_TABLES')!.location=null;
 const currentWarnings=buildReviewWarnings(global.preview);
 global.review.saved.draft=reviewDraftSchema.parse({...global.input,publicSourceReview:{...global.input.publicSourceReview,extractionAdjudications:currentWarnings.filter(w=>w.code==='UNSUPPORTED_TABLES').map(w=>({...global.input.publicSourceReview.extractionAdjudications[0],warningKey:w.key}))},warningDispositions:currentWarnings.map(w=>({warningKey:w.key,status:w.code==='UNSUPPORTED_TABLES'?'FALSE_POSITIVE':'CORRECTED',reason:'Current global finding explicitly reviewed in the test, still not an admissible page.'}))});
 expect(global.validate).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');
 const mode=await fixture();mode.review.saved.draft=reviewDraftSchema.parse({...mode.input,metadata:{...mode.input.metadata,storageMode:'BOTH'}});expect(mode.validate).toThrow('PUBLICATION_REVIEW_INCOMPLETE');
});
it('requires false-positive disposition and actual manual edits on every affected page',async()=>{
 const status=await fixture();status.review.saved.draft=reviewDraftSchema.parse({...status.input,warningDispositions:status.input.warningDispositions.map(w=>({...w,status:'CORRECTED'}))});expect(status.validate).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');
 const pages=await fixture();pages.preview.edit!.changedPages=[];expect(pages.validate).toThrow('PUBLICATION_QUALITY_REANALYSIS_REQUIRED');
});
