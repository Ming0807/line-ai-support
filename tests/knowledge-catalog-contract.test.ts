import {describe,it,expect} from 'vitest';
import * as catalogTypes from '../lib/knowledge/catalog-types';
import {catalogEnvelopeSchema,historyEnvelopeSchema,documentEnvelopeSchema,catalogQuerySchema} from '../lib/knowledge/catalog-types';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const family={id,code:'TEST',name:'Family',category:'GUIDE',defaultStorageMode:'RAG'};
const summary={id,familyId:id,title:'Version',documentType:'GUIDE',versionName:'2569',versionStream:'ALL',academicYear:2569,department:null,status:'ACTIVE',isCurrent:true,visibility:'PUBLIC',storageMode:null,publishedAt:null,effectiveFrom:'2026-10-06',effectiveTo:null,authorityLevel:70,approvedAt:'2026-10-06T00:00:00.000Z',sourceUrl:null,sourcePageUrl:null,lastImportAt:null};
const catalog={families:[{...family,documentCount:1,hasMoreVersions:false,versionsPreview:[summary],lastImportAt:null}],departments:[],totalFamilies:1,totalDocuments:1,page:1,pageSize:10};
describe('private catalog response contracts',()=>{
 it('keeps legacy unknown mode and import time distinct from family defaults',()=>{const result=catalogEnvelopeSchema.parse({catalog});expect(result.catalog.families[0].versionsPreview[0].storageMode).toBeNull();expect(result.catalog.families[0].versionsPreview[0].lastImportAt).toBeNull();});
 it('rejects extra private source, storage or vector fields at every response layer',()=>{
  for(const field of ['content','original','storagePath','vector','encryptedReview'])expect(catalogEnvelopeSchema.safeParse({catalog:{...catalog,families:[{...catalog.families[0],versionsPreview:[{...summary,[field]:'private'}]}]}}).success).toBe(false);
  expect(catalogEnvelopeSchema.safeParse({catalog,secret:'private'}).success).toBe(false);
 });
 it('retains historical noncurrent and future-date facts without rewriting them',()=>{const old={...summary,status:'SUPERSEDED',isCurrent:false,effectiveFrom:'2027-01-01'};const result=historyEnvelopeSchema.parse({history:{family,documents:[old],totalDocuments:1,page:1,pageSize:25}});expect(result.history.documents[0]).toMatchObject(old);});
 it('rejects invalid enums, impossible civil dates and oversized preview arrays',()=>{
  for(const patch of [{status:'CURRENT'},{storageMode:'GUESSED'},{effectiveFrom:'2026-02-30'}])expect(catalogEnvelopeSchema.safeParse({catalog:{...catalog,families:[{...catalog.families[0],versionsPreview:[{...summary,...patch}]}]}}).success).toBe(false);
  expect(catalogEnvelopeSchema.safeParse({catalog:{...catalog,families:[{...catalog.families[0],versionsPreview:Array.from({length:6},()=>summary)}]}}).success).toBe(false);
 });
 it('recognizes exact metadata and paginated stored relationships without content',()=>{
  const document={summary,scope:{semester:null,audience:'ALL',studentType:'ALL',programCode:null,curriculumCode:null,cohort:null},review:{officialSource:true,extractionReviewed:true,requiresReview:false,archiveOnly:false},supersedesDocumentId:null,createdAt:'2026-10-06T00:00:00.000Z',updatedAt:'2026-10-06T00:00:00.000Z',relationships:[{type:'AMENDS',direction:'INCOMING',documentId:id,title:'Amendment',versionName:'One',status:'ACTIVE'}],totalRelationships:1,relationsPage:1,relationsPageSize:25};
  expect(documentEnvelopeSchema.safeParse({document}).success).toBe(true);expect(documentEnvelopeSchema.safeParse({document:{...document,checksum:'private'}}).success).toBe(false);
 });
 it('requires bounded typed filters and rejects SQL or extra selectors',()=>{
  expect(catalogQuerySchema.safeParse({q:null,departmentCode:null,status:null,page:1,pageSize:10}).success).toBe(true);
  for(const patch of [{page:0},{pageSize:51},{departmentCode:'IT;DROP TABLE'},{sql:'select *'},{q:'x'.repeat(121)}])expect(catalogQuerySchema.safeParse({q:null,departmentCode:null,status:null,page:1,pageSize:10,...patch}).success).toBe(false);
 });
 it('trims catalog search text and rejects an empty query after trimming',()=>{
  const base={q:null,departmentCode:null,status:null,page:1,pageSize:10};
  expect(catalogQuerySchema.parse({...base,q:'  calendar  '}).q).toBe('calendar');
  expect(catalogQuerySchema.safeParse({...base,q:' \t  '}).success).toBe(false);
 });
 it('rejects preview and history documents from a different family',()=>{
  const otherFamilyId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const wrongFamilySummary={...summary,familyId:otherFamilyId};
  expect(catalogEnvelopeSchema.safeParse({catalog:{...catalog,families:[{...catalog.families[0],versionsPreview:[wrongFamilySummary]}]}}).success).toBe(false);
  expect(historyEnvelopeSchema.safeParse({history:{family,documents:[wrongFamilySummary],totalDocuments:1,page:1,pageSize:25}}).success).toBe(false);
 });
 it('requires preview counts and hasMoreVersions to match the visible preview',()=>{
  const familyPreview=catalog.families[0]!;
  for(const invalid of [
   {...familyPreview,documentCount:0},
   {...familyPreview,documentCount:2,hasMoreVersions:false},
   {...familyPreview,documentCount:2,hasMoreVersions:true,versionsPreview:[summary,summary,summary]},
  ])expect(catalogEnvelopeSchema.safeParse({catalog:{...catalog,families:[invalid]}}).success).toBe(false);
  const secondSummary={...summary,id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
  expect(catalogEnvelopeSchema.safeParse({catalog:{...catalog,totalDocuments:2,families:[{...familyPreview,documentCount:2,hasMoreVersions:false,versionsPreview:[summary,secondSummary]}]}}).success).toBe(true);
  const fivePreviews=['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',id].map(documentId=>({...summary,id:documentId}));
  expect(catalogEnvelopeSchema.safeParse({catalog:{...catalog,totalDocuments:6,families:[{...familyPreview,documentCount:6,hasMoreVersions:true,versionsPreview:fivePreviews}]}}).success).toBe(true);
 });
 it('binds history and detail parsing to the requested family or document',()=>{
  const expectedDocumentId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const differentDocument={...summary,id:expectedDocumentId};
  const history={history:{family,documents:[summary],totalDocuments:1,page:1,pageSize:25}};
  const document={document:{summary:differentDocument,scope:{semester:null,audience:'ALL',studentType:'ALL',programCode:null,curriculumCode:null,cohort:null},review:{officialSource:true,extractionReviewed:true,requiresReview:false,archiveOnly:false},supersedesDocumentId:null,createdAt:'2026-10-06T00:00:00.000Z',updatedAt:'2026-10-06T00:00:00.000Z',relationships:[],totalRelationships:0,relationsPage:1,relationsPageSize:25}};
  const parseHistoryForFamily=Reflect.get(catalogTypes,'parseCatalogHistoryForFamily') as (input:unknown,expectedFamilyId:string)=>unknown;
  const parseDetailForDocument=Reflect.get(catalogTypes,'parseCatalogDetailForDocument') as (input:unknown,expectedDocumentId:string)=>unknown;
  expect(parseHistoryForFamily).toBeTypeOf('function');
  expect(parseDetailForDocument).toBeTypeOf('function');
  expect(parseHistoryForFamily(history,id)).not.toBeNull();
  expect(parseHistoryForFamily(history,expectedDocumentId)).toBeNull();
  expect(parseDetailForDocument(document,expectedDocumentId)).not.toBeNull();
  expect(parseDetailForDocument(document,id)).toBeNull();
 });
 it('preserves explicit null legacy provenance even when the family default differs',()=>{
  const legacy={...catalog,families:[{...catalog.families[0]!,defaultStorageMode:'BOTH',versionsPreview:[{...summary,storageMode:null,lastImportAt:null}],lastImportAt:null}]};
  const result=catalogEnvelopeSchema.parse({catalog:legacy});
  expect(result.catalog.families[0]?.defaultStorageMode).toBe('BOTH');
  expect(result.catalog.families[0]?.versionsPreview[0]).toMatchObject({storageMode:null,lastImportAt:null});
 });
});
