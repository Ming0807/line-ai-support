import {spawn} from 'node:child_process';
import {isIP} from 'node:net';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {copyStructuredJson,freezeStructuredData} from '../imports/structured-mapping-contract';
import {buildPublicSearchQuery,type PublicSearchQuery} from './public-search-query';

export type DdgsSearchErrorCode='DDGS_INVALID'|'DDGS_UNAVAILABLE'|'DDGS_TIMEOUT'|'DDGS_CANCELLED';
export class DdgsSearchError extends Error{
 constructor(readonly code:DdgsSearchErrorCode){super(code);this.name='DdgsSearchError';}
}
export type DdgsRunner=(input:{pythonPath:string;query:string},signal:AbortSignal)=>Promise<unknown>;
interface Options {pythonPath:string;runner?:DdgsRunner;timeoutMs?:number}
export interface DdgsLead {readonly title:string;readonly url:string;readonly content:string}
const rowSchema=z.object({title:z.string().min(1).max(500),href:z.string().min(1).max(2048),body:z.string().max(4000)}).strict();
const rowsSchema=z.array(rowSchema).min(1).max(8);
const unavailable=():never=>{throw new DdgsSearchError('DDGS_UNAVAILABLE');};
const scriptPath=fileURLToPath(new URL('../../scripts/knowledge/ddgs_search.py',import.meta.url));

/** Execute the fixed bridge without inheriting application secrets or proxy settings. */
const spawnRunner:DdgsRunner=({pythonPath,query},signal)=>new Promise((resolve,reject)=>{
 const env:NodeJS.ProcessEnv={NODE_ENV:'production',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};
 for(const name of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[name])env[name]=process.env[name];
 let settled=false,bytes=0;const chunks:Buffer[]=[];
 const child=spawn(pythonPath,[scriptPath],{env,windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
 const finish=(value?:unknown,error?:Error)=>{
  if(settled)return;settled=true;signal.removeEventListener('abort',abort);
  if(error)reject(error);else resolve(value);
 };
 const abort=()=>{child.kill();finish(undefined,new DdgsSearchError('DDGS_CANCELLED'));};
 child.once('error',()=>finish(undefined,new DdgsSearchError('DDGS_UNAVAILABLE')));
 child.stdin.once('error',()=>{child.kill();finish(undefined,new DdgsSearchError('DDGS_UNAVAILABLE'));});
 child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65536){child.kill();finish(undefined,new DdgsSearchError('DDGS_UNAVAILABLE'));}else chunks.push(chunk);});
 child.once('close',code=>{
  if(code!==0)return finish(undefined,new DdgsSearchError('DDGS_UNAVAILABLE'));
  try{finish(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(undefined,new DdgsSearchError('DDGS_UNAVAILABLE'));}
 });
 signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted)return abort();
 child.stdin.end(JSON.stringify({query}));
});

function checkedUrl(value:string,query:PublicSearchQuery):string|null{
 try{
  if(/[\s\\\p{Cc}]/u.test(value)||/%(?:5c|0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value))return null;
  const url=new URL(value),host=url.hostname;
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||isIP(host)!==0||host.length>253||
   host.split('.').length<2||host.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)))return null;
  if(query.purpose==='YRU_INFORMATION'&&!query.includeDomains.some(domain=>host===domain||host.endsWith(`.${domain}`)))return null;
  return url.href;
 }catch{return null;}
}

/** Standalone connector only: callers must establish ownership, durable admission and source proof. */
export function createDdgsSearchAdapter(options:Options){
 const runner=options.runner??spawnRunner,timeout=options.timeoutMs??12000;
 return {async search(input:unknown,signal:AbortSignal):Promise<readonly DdgsLead[]>{
  let query:PublicSearchQuery;
  try{query=buildPublicSearchQuery(input);}catch{throw new DdgsSearchError('DDGS_INVALID');}
  if(!(signal instanceof AbortSignal)||typeof options.pythonPath!=='string'||!isAbsolute(options.pythonPath)||
   !Number.isInteger(timeout)||timeout<1||timeout>20000)throw new DdgsSearchError('DDGS_INVALID');
  if(signal.aborted)throw new DdgsSearchError('DDGS_CANCELLED');
  const inner=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let abort:()=>void=()=>{};
  const boundary=new Promise<never>((_resolve,reject)=>{
   abort=()=>{inner.abort();reject(new DdgsSearchError('DDGS_CANCELLED'));};
   signal.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>{inner.abort();reject(new DdgsSearchError('DDGS_TIMEOUT'));},timeout);
  });
  try{
   if(signal.aborted){abort();return await boundary;}
   const raw=await Promise.race([boundary,Promise.resolve().then(()=>runner({pythonPath:options.pythonPath,query:query.query},inner.signal))]);
   const copied=copyStructuredJson(raw,65536,300);
   if(Buffer.byteLength(JSON.stringify(copied),'utf8')>65536)return unavailable();
   const rows=rowsSchema.safeParse(copied);if(!rows.success)return unavailable();
   const leads=rows.data.flatMap(row=>{const url=checkedUrl(row.href,query);return url?[{title:row.title,url,content:row.body}]:[];}).slice(0,3);
   if(!leads.length)return unavailable();
   return freezeStructuredData(leads);
  }catch(error){if(error instanceof DdgsSearchError)throw error;return unavailable();}
  finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);inner.abort();}
 }};
}
