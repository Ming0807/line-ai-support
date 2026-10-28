import {serviceTranscriptionSchema,serviceTranscriptionProofSchema,reviewerAssignedServiceCodeSchema,type ServiceTranscription,type ServiceTranscriptionProof} from './public-service-transcription-contract';
import {canonicalDigest,copyStructuredJson,type StructuredMappingPlan} from './structured-mapping-contract';
import type {LocatedExtraction,SourceLocation} from './types';
import {isOfficialYruUrl} from './source';
export class PublicServiceTranscriptionError extends Error{constructor(){super('PUBLIC_TRANSCRIPTION_INVALID');}}
const invalid=():never=>{throw new PublicServiceTranscriptionError();};
export function serviceTranscriptionProof(manifest:ServiceTranscription):ServiceTranscriptionProof{
 const checked=serviceTranscriptionSchema.parse(copyStructuredJson(manifest,64*1024,3000));
 const locations=new Map(checked.fields.flatMap(f=>f.kind==='TEXT'?f.parts.map(p=>[canonicalDigest('transcription-location-v1',p.location),p.location] as const):[]));
 return serviceTranscriptionProofSchema.parse({kind:'PUBLIC_SERVICE_TRANSCRIPTION_PROOF_V1',manifestDigest:canonicalDigest('public-service-transcription-v1',checked),parent:checked.parent,sourceLocations:[...locations.values()].sort((a,b)=>a.blockStart-b.blockStart||a.blockEnd-b.blockEnd)});
}
/** Recheck currently approved coverage even when the parent document/receipt itself is unchanged. */
export function assertServiceTranscriptionLocations(manifest:ServiceTranscription,approvedLocations:readonly SourceLocation[]):void{
 try{for(const location of serviceTranscriptionProof(manifest).sourceLocations)if(!approvedLocations.some(approved=>approved.kind==='HTML'&&approved.sourceUrl===location.sourceUrl&&approved.tableIndex===null&&approved.blockStart<=location.blockStart&&approved.blockEnd>=location.blockEnd))return invalid();}catch{return invalid();}
}
/** Values are derived from approved original HTML, never from unverified CSV assertions. */
export function validateServiceTranscriptionValues(manifest:ServiceTranscription,plan:StructuredMappingPlan,context:{parent:ServiceTranscription['parent'];extraction:LocatedExtraction;approvedLocations:SourceLocation[]}):void{
 try{
  const checked=serviceTranscriptionSchema.parse(copyStructuredJson(manifest,64*1024,3000));
  if(plan.dataset!=='university_services'||plan.sourceFormat!=='CSV'||plan.sourceUrl!==checked.parent.sourceUrl||plan.rows.length!==1||!isOfficialYruUrl(checked.parent.sourceUrl)||canonicalDigest('transcription-parent-v1',checked.parent)!==canonicalDigest('transcription-parent-v1',context.parent))invalid();
  serviceTranscriptionProof(checked);
  assertServiceTranscriptionLocations(checked,context.approvedLocations);
  const row=plan.rows[0],payload=row.payload as Record<string,string|null>,code=row.fields.find(f=>f.field==='service_code');
  if(code?.kind!=='CONSTANT'||!code.note.trim()||!reviewerAssignedServiceCodeSchema.safeParse(code.value).success||code.value!==payload.service_code||plan.mapping.tables.length!==1||plan.mapping.tables[0].fields.service_code.kind!=='CONSTANT')invalid();
  const proofs=new Map(checked.fields.map(f=>[f.field,f]));
  for(const [field,value]of Object.entries(payload)){
   if(field==='service_code')continue;
   const proof=proofs.get(field as ServiceTranscription['fields'][number]['field']);
   if(value===null){if(proof)invalid();continue;}
   if(typeof value!=='string'||!proof)return invalid();
   if(proof.kind==='PARENT_URL'){if(field!=='url'||value!==checked.parent.sourceUrl)invalid();continue;}
   if(row.fields.find(f=>f.field===field)?.kind!=='CELL')invalid();
   const snippets=proof.parts.map(part=>{
    if(part.location.sourceUrl!==checked.parent.sourceUrl)invalid();
    const index=context.extraction.locations.pages.findIndex(location=>canonicalDigest('transcription-location-v1',location)===canonicalDigest('transcription-location-v1',part.location));
    if(index<0||!context.approvedLocations.some(location=>location.kind==='HTML'&&location.sourceUrl===part.location.sourceUrl&&location.tableIndex===null&&location.blockStart<=part.location.blockStart&&location.blockEnd>=part.location.blockEnd))invalid();
    const text=context.extraction.pages[index]?.text;if(text===undefined||part.end>text.length)return invalid();
    const snippet=text.slice(part.start,part.end);if(!snippet.isWellFormed()||!snippet.trim())invalid();return snippet.trim();
   });
   if(snippets.join('\n')!==value)invalid();
  }
  if(checked.fields.some(proof=>!Object.hasOwn(payload,proof.field)||payload[proof.field]===null))invalid();
 }catch{invalid();}
}
