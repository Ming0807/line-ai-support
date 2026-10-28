import {describe,expect,it} from 'vitest';
import {buildStructuredMappingPlan,computeStructuredExtractionDigest} from '../lib/imports/structured-mapper';
import {serviceTranscriptionSchema,transcriptionHtmlLocationSchema,type ServiceTranscription} from '../lib/imports/public-service-transcription-contract';
import {validateServiceTranscriptionValues} from '../lib/imports/public-service-transcription';
import {structuredMappingFixture} from './fixtures/structured-mapping';
import type {SourceLocation} from '../lib/imports/types';
import {createImportSource} from '../lib/imports/source';

const parentId='123e4567-e89b-42d3-a456-426614174111';

function fixture(){
 const base=structuredMappingFixture('university_services','CSV');
 const parentSource=structuredMappingFixture('university_services','HTML');
 const sourceUrl='https://library.yru.ac.th/qa-transcription';
 for(const fixture of [base,parentSource])fixture.source=createImportSource({bytes:fixture.source.bytes,filename:fixture.source.filename,mimeType:fixture.source.mimeType,sourceUrl,acquiredFrom:'UPLOAD',fetchedAt:null});
 for(const location of [...parentSource.extraction.locations.pages,...parentSource.extraction.locations.tables])if(location.kind==='HTML')location.sourceUrl=sourceUrl;
 base.extraction.tables[0]!.rows[1]![1]='Library 🧑';
 base.extraction.report.textCharacters=base.extraction.pages.reduce((sum,page)=>sum+page.text.length,0)+base.extraction.tables.flatMap(table=>table.rows.flat()).reduce((sum,cell)=>sum+cell.length,0);
 const mapping=structuredClone(base.mapping) as typeof base.mapping;
 const table=(mapping as unknown as {tables:Array<{fields:Record<string,unknown>}>}).tables[0]!;
 table.fields.service_code={kind:'CONSTANT',value:'LIB-01',note:'Service code assigned by reviewed catalog policy.'};
 table.fields.url={kind:'CONSTANT',value:sourceUrl,note:'Use the exact official page URL bound to this reviewed source.'};
 const row:Record<string,string|number|null>={...base.expectedPayload,name:'Library 🧑'};
 const fields=['name','description','location','opening_hours','phone','email'] as const;
 const text=fields.map(field=>String(row[field])).join('\n');
 const location=transcriptionHtmlLocationSchema.parse(parentSource.extraction.locations.pages[0]!);
 parentSource.extraction.pages[0]!.text=text;
 parentSource.extraction.report.textCharacters=text.length+parentSource.extraction.tables.flatMap(table=>table.rows.flat()).reduce((sum,cell)=>sum+cell.length,0);
 (mapping as {source:{extractionDigest:string}}).source.extractionDigest=computeStructuredExtractionDigest(base.source,base.extraction);
 const plan=buildStructuredMappingPlan(base.source,base.extraction,base.binding,mapping);
 const textFields:ServiceTranscription['fields']=[];
 let cursor=0;
 for(const field of fields){
  const value=String(row[field]);
  textFields.push({field,kind:'TEXT',parts:[{location,start:cursor,end:cursor+value.length}]});
  cursor+=value.length+1;
 }
 const parent:ServiceTranscription['parent']={
  documentId:parentId,familyId:'123e4567-e89b-42d3-a456-426614174112',documentRevision:2,jobId:'123e4567-e89b-42d3-a456-426614174113',
  jobRevision:7,extractionRevision:7,reviewRevision:11,
  sourceChecksum:parentSource.source.checksum,sourceUrl,title:parentSource.extraction.title!,
 };
 const manifest:ServiceTranscription={kind:'REVIEWED_HTML_TO_CSV_V1',dataset:'university_services',reason:'Reviewed transcription of the current official service page.',parent,
  fields:[...textFields,{field:'url',kind:'PARENT_URL'}]};
 const context={parent,extraction:parentSource.extraction,approvedLocations:[location] as SourceLocation[]};
 return {base,parentSource,plan,manifest,context,location};
}

const invalid=(manifest:ServiceTranscription,plan:ReturnType<typeof buildStructuredMappingPlan>,context:ReturnType<typeof fixture>['context'])=>
 expect(()=>validateServiceTranscriptionValues(manifest,plan,context)).toThrowError(/^PUBLIC_TRANSCRIPTION_INVALID$/u);

describe('reviewed public service transcription',()=>{
 it('requires a distinct reviewer-assigned identifier rather than a short letter or natural word',()=>{const f=fixture();for(const value of ['A','LIB','LIBRARY']){const mapping=structuredClone(f.plan.mapping);mapping.tables[0].fields.service_code={kind:'CONSTANT',value,note:'Reviewer assigned an internal selector.'};const plan=buildStructuredMappingPlan(f.base.source,f.base.extraction,f.base.binding,mapping);invalid(f.manifest,plan,f.context);}});
 it('never admits a nonofficial or executable parent URL into the browser-visible manifest',()=>{const f=fixture();for(const sourceUrl of ['javascript:alert(1)','https://attacker.example.org/source'])expect(serviceTranscriptionSchema.safeParse({...f.manifest,parent:{...f.manifest.parent,sourceUrl}}).success).toBe(false);});
 it('rejects a derivative whose reviewed reference URL differs from the bound parent',()=>{const f=fixture();const wrong=structuredClone(f.plan);wrong.sourceUrl='https://www.yru.ac.th/other';invalid(f.manifest,wrong,f.context);});
 it('accepts the complete reviewed transcription manifest shape',()=>{
  const {manifest,plan,context}=fixture();
  expect(serviceTranscriptionSchema.safeParse(manifest).success).toBe(true);
  expect(plan.rows).toHaveLength(1);
  expect(context.approvedLocations).toHaveLength(1);
 });

 it('accepts a complete single-row transcription with exact HTML text proof and the bound parent URL',()=>{
  const {manifest,plan,context}=fixture();
  expect(()=>validateServiceTranscriptionValues(manifest,plan,context)).not.toThrow();
 });

 it('rejects copied text that does not equal the reviewed row value',()=>{
  const f=fixture(),changed=structuredClone(f.manifest);
  const name=changed.fields.find(field=>field.field==='name');
  if(name?.kind==='TEXT')name.parts[0]!.end--;
  invalid(changed,f.plan,f.context);
 });

 it('rejects an unapproved or hidden logical block even when its text matches',()=>{
  const f=fixture(),changed=structuredClone(f.manifest);
  const name=changed.fields.find(field=>field.field==='name');
  if(name?.kind==='TEXT')name.parts[0]!.location={...name.parts[0]!.location,blockStart:name.parts[0]!.location.blockStart+1};
  invalid(changed,f.plan,f.context);
  invalid(f.manifest,f.plan,{...f.context,approvedLocations:[]});
 });

 it('binds the transcription to the exact source URL and parent checksum/revisions',()=>{
  const f=fixture(),wrongUrl=structuredClone(f.manifest);
  wrongUrl.parent.sourceUrl='https://example.org/other';
  invalid(wrongUrl,f.plan,f.context);
  const wrongChecksum=structuredClone(f.manifest);
  wrongChecksum.parent.sourceChecksum='0'.repeat(64);
  invalid(wrongChecksum,f.plan,f.context);
  invalid(f.manifest,f.plan,{...f.context,parent:{...f.context.parent,reviewRevision:f.context.parent.reviewRevision+1}});
 });

 it('rejects out-of-bounds and surrogate-splitting source ranges',()=>{
  const f=fixture(),outOfBounds=structuredClone(f.manifest);
  const name=outOfBounds.fields.find(field=>field.field==='name');
  if(name?.kind==='TEXT')name.parts[0]!.end=f.base.extraction.pages[0]!.text.length+1;
  invalid(outOfBounds,f.plan,f.context);
  const surrogate=fixture(),value=String((surrogate.plan.rows[0]!.payload as Record<string,string|null>).name);
  const proof=surrogate.manifest.fields.find(field=>field.field==='name');
  if(proof?.kind==='TEXT')proof.parts[0]!.end=value.length-1;
  invalid(surrogate.manifest,surrogate.plan,surrogate.context);
 });

 it('rejects duplicate or extra manifest fields',()=>{
  const f=fixture(),duplicate=structuredClone(f.manifest);
  duplicate.fields.push(structuredClone(duplicate.fields[0]!));
  invalid(duplicate,f.plan,f.context);
  const extra=structuredClone(f.manifest);
  extra.fields.push({field:'url',kind:'PARENT_URL'});
  invalid(extra,f.plan,f.context);
  const unknown=structuredClone(f.manifest) as ServiceTranscription&{fields:Array<unknown>};
  unknown.fields.push({field:'administrator_family_name',kind:'TEXT',parts:[]});
  expect(serviceTranscriptionSchema.safeParse(unknown).success).toBe(false);
 });

 it('requires exactly one mapped CSV row and a constant service code with a note',()=>{
  const f=fixture(),extraRow=structuredClone(f.plan);
  extraRow.rows.push(structuredClone(extraRow.rows[0]!));
  invalid(f.manifest,extraRow,f.context);
  const nonconstant=structuredClone(f.plan);
  const binding=nonconstant.mapping.tables[0]!.fields.service_code;
  if(binding.kind==='CONSTANT')nonconstant.mapping.tables[0]!.fields.service_code={kind:'COLUMN',columnIndex:0,transform:'TEXT_V1',blank:'REJECT'};
  invalid(f.manifest,nonconstant,f.context);
 });

 it('rejects a non-null constant payload field without exact source proof',()=>{
  const f=fixture(),mapping=structuredClone(f.plan.mapping);
  mapping.tables[0]!.fields.location={kind:'CONSTANT',value:'Invented location',note:'Attempted non-null bypass.'};
  const plan=buildStructuredMappingPlan(f.base.source,f.base.extraction,f.base.binding,mapping);
  const proof= f.manifest.fields.findIndex(field=>field.field==='location');
  if(proof>=0)f.manifest.fields.splice(proof,1);
  invalid(f.manifest,plan,f.context);
 });

 it('allows a nullable field mapped explicitly to null without source text proof',()=>{
  const f=fixture(),mapping=structuredClone(f.plan.mapping);
  mapping.tables[0]!.fields.location={kind:'CONSTANT',value:null,note:'The reviewed page states no separate location.'};
  const plan=buildStructuredMappingPlan(f.base.source,f.base.extraction,f.base.binding,mapping);
  const proof=f.manifest.fields.findIndex(field=>field.field==='location');
  if(proof>=0)f.manifest.fields.splice(proof,1);
  expect(()=>validateServiceTranscriptionValues(f.manifest,plan,f.context)).not.toThrow();
 });

 it('rejects a non-CSV child mapping plan',()=>{
  const f=fixture(),html=structuredMappingFixture('university_services','HTML'),mapping=structuredClone(html.mapping) as typeof html.mapping;
  const table=(mapping as unknown as {tables:Array<{fields:Record<string,unknown>}>}).tables[0]!;
  table.fields.service_code={kind:'CONSTANT',value:'LIB-01',note:'Service code assigned by reviewed catalog policy.'};
  table.fields.url={kind:'CONSTANT',value:f.manifest.parent.sourceUrl,note:'Use the exact official page URL.'};
  const plan=buildStructuredMappingPlan(html.source,html.extraction,html.binding,mapping);
  invalid(f.manifest,plan,f.context);
 });
});
