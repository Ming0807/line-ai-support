import {expect,it,vi} from 'vitest';
import {createImportSource,isOfficialYruUrl} from '../lib/imports/source';
import {acquireOfficialUrl} from '../lib/imports/url-importer';
import {validateUrlAcquisition} from '../lib/imports/source-provenance';
const input={bytes:Buffer.from('a,b\nc,d'),filename:'source.csv',mimeType:'text/csv',sourceUrl:null,acquiredFrom:'UPLOAD' as const,fetchedAt:null};
it('admits the actual catalog query routes and numeric public document identifiers',()=>{
 for(const query of ['view=info_guide','view=guide','view=aor','view=doc_form','view=fee','group=17&view=standard','menu=manual','page=rule','t=n4','id=123']){
  expect(isOfficialYruUrl(`https://eduservice.yru.ac.th/page/?${query}`)).toBe(true);
 }
 expect(createImportSource({...input,sourceUrl:'https://drive.google.com/file/d/fixture/view?usp=sharing'}).sourceUrl).toContain('usp=sharing');
});
it('rejects opaque credentials under ordinary names before acquisition DNS or transport',async()=>{
 const resolvePublicAddresses=vi.fn(async()=>[{address:'8.8.8.8',family:4 as const}]),transport=vi.fn();
 await expect(acquireOfficialUrl('https://yru.ac.th/rules.csv?download=PRIVATE_CREDENTIAL_FIXTURE',{testOnly:{resolvePublicAddresses,transport}}))
  .rejects.toMatchObject({code:'IMPORT_URL_INVALID'});
 expect(resolvePublicAddresses).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
});
it('applies the same public query rule to upload metadata and every retained URL',()=>{
 const source=createImportSource({...input,sourceUrl:'https://yru.ac.th/final.csv',acquiredFrom:'URL',fetchedAt:'2026-10-05T03:00:00.000Z'});
 for(const query of ['download=PRIVATE_CREDENTIAL_FIXTURE','id=opaque','view=opaque','id=1&id=2','ID=1','id=1234567890123','unknown=value','usp=private']){
  const url=`https://yru.ac.th/rules.csv?${query}`;
  expect(()=>createImportSource({...input,sourceUrl:url})).toThrow(/^IMPORT_SOURCE_INVALID$/);
  expect(()=>validateUrlAcquisition(source,{requestedUrl:url,finalUrl:source.sourceUrl,redirectChain:[url,source.sourceUrl]}))
   .toThrow(/^IMPORT_PROVENANCE_INVALID$/);
 }
 expect(()=>createImportSource({...input,sourceUrl:'https://drive.google.com/file/d/fixture/view?download=private'})).toThrow(/^IMPORT_SOURCE_INVALID$/);
});
