import {z} from 'zod';
import {getDatabasePool} from '../database/pool';
import {generate} from '../ai/gateway';
import {createAIStore} from '../ai/store';
import {createProviderRegistry} from '../ai/provider-registry';
import {AIProviderError} from '../ai/types';
import {getImportPreview,type ImportExtractionOptions} from './import-extraction';
import {getImportAssistance} from './assistance';
import {authorizeImportAdmin,ImportStagingError} from './import-staging';
import {modelAssistanceRequestSchema,modelAssistanceResultSchema} from './model-assistance-contract';
import {createImportModelProposal,freeImportStore} from './model-assistance-proposal';

export class ImportModelAssistanceError extends Error {
 constructor(readonly code:'IMPORT_AI_SOURCE_REVIEW_REQUIRED'|'AI_UNAVAILABLE'){super(code);}
}
interface Options extends ImportExtractionOptions {generate?:Parameters<typeof createImportModelProposal>[0]}
/** Explicit, private read-only proposal. All source/SQL reads finish before external inference. */
export async function getImportModelAssistance(actor:string,id:string,input:unknown,options:Options={}){
 await authorizeImportAdmin(actor,options);
 const request=modelAssistanceRequestSchema.safeParse(input);
 if(!request.success||!z.uuid().safeParse(id).success)throw new ImportStagingError('INVALID_REQUEST');
 const signal=options.signal??new AbortController().signal;
 const current=(value:{jobRevision:number;extractionRevision:number})=>{
  if(signal.aborted||value.jobRevision!==request.data.expectedJobRevision||value.extractionRevision!==request.data.expectedExtractionRevision)throw new ImportStagingError('CONFLICT');
 };
 if(signal.aborted)throw new ImportStagingError('CONFLICT');
 const preview=await getImportPreview(actor,id,options);
 current({jobRevision:preview.job.revision,extractionRevision:preview.extractionRevision});
 const safeFlags=new Set(['SOURCE_REVIEW_REQUIRED','ACADEMIC_YEAR_AMBIGUOUS','FAMILY_AMBIGUOUS','STRUCTURED_SCHEMA_UNAVAILABLE']);
 if(preview.analysis.sensitiveRisk||preview.analysis.flags.some(flag=>!safeFlags.has(flag))||preview.extraction.pages.some(page=>page.requiresReview))throw new ImportModelAssistanceError('IMPORT_AI_SOURCE_REVIEW_REQUIRED');
 const nonempty=preview.extraction.pages.map((page,index)=>({id:`p${index+1}`,text:page.text.trimStart()})).filter(page=>page.text.length>0);
 const segments=nonempty.slice(0,4).map(page=>({...page,text:page.text.slice(0,3000)}));
 // This supplements explicit human permission, not a privacy-clearance classifier.
 if(!segments.length||segments.some(segment=>/(?:sk-[a-z0-9_-]{12,}|sb_secret_|Bearer\s+\S+|BEGIN.*PRIVATE KEY|api[_ -]?key\s*[:=])/iu.test(segment.text)))throw new ImportModelAssistanceError('IMPORT_AI_SOURCE_REVIEW_REQUIRED');
 const references=await getImportAssistance(actor,id,options);current(references);
 const inference=options.generate??(async input=>{
  const key=options.key??process.env.ENCRYPTION_KEY;if(!key)throw new AIProviderError('PROVIDER_UNAVAILABLE');
  return generate(input,{key,store:freeImportStore(createAIStore(options.pool??getDatabasePool())),adapters:createProviderRegistry()});
 });
 let suggestions;
 try{suggestions=await createImportModelProposal(inference)({segments,families:references.families.map(({code,name})=>({code,name})),departments:references.departments},signal);}
 catch{if(signal.aborted)throw new ImportStagingError('CONFLICT');throw new ImportModelAssistanceError('AI_UNAVAILABLE');}
 // Reauthorizes as well as detecting edits that happened during the network call.
 const latest=await getImportAssistance(actor,id,options);current(latest);
 for(const item of suggestions){
  if(item.field!=='familyCode'&&item.field!=='departmentCode')continue;
  const group=item.field==='familyCode'?'families':'departments';
  const original=references[group].find(row=>row.code===item.value),fresh=latest[group].find(row=>row.code===item.value);
  if(!original||!fresh||fresh.name!==original.name)throw new ImportStagingError('CONFLICT');
 }
 return modelAssistanceResultSchema.parse({jobId:id,jobRevision:request.data.expectedJobRevision,extractionRevision:request.data.expectedExtractionRevision,
  suggestions:suggestions.map(item=>({...item,pageIndex:Number(item.segmentId.slice(1))-1})),omittedPages:nonempty.length-segments.length});
}
