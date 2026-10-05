import {expect,it} from 'vitest';
import {createImportSource} from '../lib/imports/source';
import {validateUrlAcquisition} from '../lib/imports/source-provenance';
const input=createImportSource({bytes:Buffer.from('a,b\nc,d'),filename:'source.csv',mimeType:'text/csv',sourceUrl:'https://library.yru.ac.th/final.csv',acquiredFrom:'URL',fetchedAt:'2026-10-05T03:00:00.000Z'});
const provenance={requestedUrl:'https://yru.ac.th/original',finalUrl:input.sourceUrl,redirectChain:['https://yru.ac.th/original',input.sourceUrl]};
it('preserves canonical requested/final/redirect URLs separately from the fetch date',()=>{
 expect(validateUrlAcquisition(input,provenance)).toEqual(provenance);
});
it('rejects incomplete, external, mismatched and oversized redirect provenance',()=>{
 for(const changed of [null,{}, {...provenance,redirectChain:[]},{...provenance,requestedUrl:'https://yru.ac.th/other'},
  {...provenance,finalUrl:'https://library.yru.ac.th/other.csv'}, {...provenance,redirectChain:['https://external.invalid/original',input.sourceUrl]},
  {...provenance,requestedUrl:'https://YRU.AC.TH/original'}, {...provenance,redirectChain:Array(5).fill(input.sourceUrl)},
  {...provenance,redirectChain:['https://yru.ac.th/original','https://yru.ac.th/guide?signature=private',input.sourceUrl]},
  {...provenance,publicObjectKey:'original/key'}])expect(()=>validateUrlAcquisition(input,changed)).toThrow(/^IMPORT_PROVENANCE_INVALID$/);
});
it('cannot assert URL acquisition for an upload or changed source',()=>{
 expect(()=>validateUrlAcquisition({...input,acquiredFrom:'UPLOAD',fetchedAt:null},provenance)).toThrow(/^IMPORT_PROVENANCE_INVALID$/);
 expect(()=>validateUrlAcquisition({...input,checksum:'0'.repeat(64)},provenance)).toThrow(/^IMPORT_PROVENANCE_INVALID$/);
});

it('rejects credential aliases in every retained URL in the chain',()=>{
 for(const key of ['sig','code','ticket','jwt','X-Sig','oauth_code','JWT']){
  const secretUrl=`https://yru.ac.th/original?${key}=fixture`;
  expect(()=>validateUrlAcquisition(input,{...provenance,requestedUrl:secretUrl,redirectChain:[secretUrl,input.sourceUrl]}))
   .toThrow(/^IMPORT_PROVENANCE_INVALID$/);
 }
});
