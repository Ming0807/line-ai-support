import {resolve} from 'node:path';
import {verifyImportSource} from './source';
import {validateLocatedExtraction} from './extraction';
import {encodeParserRequest} from './parser-child-protocol';
import {executeParserChild} from './parser-process';
import type {ImportSource,LocatedExtraction} from './types';
let activeChildren=0;
/** Runtime parser selection is fixed checked-in code; uploads never select an executable. */
export async function parseImportSource(source:ImportSource,signal?:AbortSignal):Promise<LocatedExtraction>{
 const deadline=performance.now()+15000;
 const checkBudget=()=>{if(signal?.aborted)throw new Error('IMPORT_PARSER_ABORTED');if(performance.now()>=deadline)throw new Error('IMPORT_PARSER_TIMEOUT');};
 if(activeChildren>=2)throw new Error('IMPORT_PARSER_BUSY');activeChildren++;
 try{
  checkBudget();const verified=verifyImportSource(source),request=encodeParserRequest(verified);checkBudget();
  const remaining=Math.floor(deadline-performance.now());if(remaining<1)throw new Error('IMPORT_PARSER_TIMEOUT');
  const output=await executeParserChild(request,{scriptPath:resolve(process.cwd(),'scripts/import-parser-child.ts'),loadTsx:true,signal,timeoutMs:remaining});
  checkBudget();let extraction:LocatedExtraction;
  try{
   const response:unknown=JSON.parse(output);
   if(!response||typeof response!=='object'||Array.isArray(response)||Object.keys(response).sort().join(',')!=='extraction,schemaVersion'||!('schemaVersion' in response)||response.schemaVersion!==1||!('extraction' in response))throw new Error('IMPORT_PARSE_INVALID');
   extraction=validateLocatedExtraction(verified,response.extraction);
  }catch{throw new Error('IMPORT_PARSE_INVALID');}
  checkBudget();return extraction;
 }finally{activeChildren--;}
}
