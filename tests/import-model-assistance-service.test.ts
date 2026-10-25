import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({authorize:vi.fn(),preview:vi.fn(),assistance:vi.fn()}));
vi.mock('@/lib/imports/import-staging',async original=>({...await original<typeof import('@/lib/imports/import-staging')>(),authorizeImportAdmin:mocks.authorize}));
vi.mock('@/lib/imports/import-extraction',()=>({getImportPreview:mocks.preview}));
vi.mock('@/lib/imports/assistance',()=>({getImportAssistance:mocks.assistance}));
import {getImportModelAssistance} from '@/lib/imports/model-assistance';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',input={expectedJobRevision:1,expectedExtractionRevision:1,externalProcessingConfirmed:true};
beforeEach(()=>{vi.resetAllMocks();mocks.authorize.mockResolvedValue(undefined);mocks.assistance.mockResolvedValue({jobId:id,jobRevision:1,extractionRevision:1,families:[],departments:[]});mocks.preview.mockResolvedValue({job:{id,revision:1,filename:'private-name'},extractionRevision:1,analysis:{sensitiveRisk:false,flags:[]},extraction:{pages:[{text:'คู่มือห้องสมุด',requiresReview:false}]}});});
it('dispatches only bounded source data and rechecks revision after a successful proposal',async()=>{
 const generate=vi.fn().mockResolvedValue({output:{suggestions:[{field:'title',value:'คู่มือห้องสมุด',segmentId:'p1',quote:'คู่มือห้องสมุด'}]},toolCalls:[]});
 const result=await getImportModelAssistance('admin',id,input,{generate});
 expect(result.suggestions[0]).toMatchObject({pageIndex:0,value:'คู่มือห้องสมุด'});expect(JSON.stringify(generate.mock.calls)).not.toContain('private-name');
 expect(mocks.assistance).toHaveBeenCalledTimes(2);
});
it('requires permission, consent, matching revisions and safe extraction before inference',async()=>{
 const generate=vi.fn();
 await expect(getImportModelAssistance('admin',id,{...input,externalProcessingConfirmed:false},{generate})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 mocks.preview.mockResolvedValueOnce({job:{id,revision:2},extractionRevision:1});
 await expect(getImportModelAssistance('admin',id,input,{generate})).rejects.toMatchObject({code:'CONFLICT'});
 const preview=await mocks.preview();preview.analysis.sensitiveRisk=true;
 await expect(getImportModelAssistance('admin',id,input,{generate})).rejects.toMatchObject({code:'IMPORT_AI_SOURCE_REVIEW_REQUIRED'});
 expect(generate).not.toHaveBeenCalled();
});
it('rejects a stale inference result instead of exposing suggestions',async()=>{
 mocks.assistance.mockResolvedValueOnce({jobId:id,jobRevision:1,extractionRevision:1,families:[],departments:[]}).mockResolvedValueOnce({jobId:id,jobRevision:2,extractionRevision:2});
 const generate=vi.fn().mockResolvedValue({output:{suggestions:[]},toolCalls:[]});
 await expect(getImportModelAssistance('admin',id,input,{generate})).rejects.toMatchObject({code:'CONFLICT'});
});
it('rejects references removed while inference was running',async()=>{
 mocks.assistance.mockResolvedValueOnce({jobId:id,jobRevision:1,extractionRevision:1,families:[{code:'LIBRARY_GUIDE',name:'คู่มือห้องสมุด'}],departments:[]})
  .mockResolvedValueOnce({jobId:id,jobRevision:1,extractionRevision:1,families:[],departments:[]});
 const generate=vi.fn().mockResolvedValue({output:{suggestions:[{field:'familyCode',value:'LIBRARY_GUIDE',segmentId:'p1',quote:'คู่มือห้องสมุด'}]},toolCalls:[]});
 await expect(getImportModelAssistance('admin',id,input,{generate})).rejects.toMatchObject({code:'CONFLICT'});
});
it('counts only nonempty extracted parts as omitted text',async()=>{
 const preview=await mocks.preview();
 preview.extraction.pages=['','หนึ่ง','  ','สอง','สาม','','สี่','ห้า'].map(text=>({text,requiresReview:false}));
 const generate=vi.fn().mockResolvedValue({output:{suggestions:[]},toolCalls:[]});
 const result=await getImportModelAssistance('admin',id,input,{generate});
 expect(result.omittedPages).toBe(1);
 const projection=JSON.parse(generate.mock.calls[0][0].messages[1].content);
 expect(projection.segments.map((segment:{id:string})=>segment.id)).toEqual(['p2','p4','p5','p7']);
});
