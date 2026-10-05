import type {ImportSource} from './types';
import {z} from 'zod';
import {isOfficialYruUrl,verifyImportSource} from './source';
export interface UrlAcquisitionProvenance {requestedUrl:string;finalUrl:string;redirectChain:string[]}
const canonicalOfficial=z.string().min(1).max(2048).refine(value=>{
 try{
  const url=new URL(value);return isOfficialYruUrl(value)&&url.href===value&&url.search.length<=1024&&
   !/%(?:5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value);
 }catch{return false;}
});
export const urlAcquisitionSchema=z.object({requestedUrl:canonicalOfficial,finalUrl:canonicalOfficial,redirectChain:z.array(canonicalOfficial).min(1).max(4)}).strict()
 .refine(value=>value.requestedUrl===value.redirectChain[0]&&value.finalUrl===value.redirectChain.at(-1));
export function validateUrlAcquisition(source:ImportSource,input:unknown):UrlAcquisitionProvenance {
 try{
  const checked=verifyImportSource(source),parsed=urlAcquisitionSchema.safeParse(input);
  if(checked.acquiredFrom!=='URL'||!parsed.success||parsed.data.finalUrl!==checked.sourceUrl)throw new Error();
  return parsed.data;
 }catch{throw new Error('IMPORT_PROVENANCE_INVALID');}
}
