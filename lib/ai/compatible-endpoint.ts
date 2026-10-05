import {isIP} from 'node:net';
import {AIProviderError} from './types';

export interface CompatibleEndpoint {
 readonly baseUrl:string;
 readonly origin:string;
 readonly hostname:string;
 readonly pathPrefix:string;
}

const fail=():never=>{throw new AIProviderError('INVALID_REQUEST');};
const specialSuffixes=['localhost','local','internal','test','invalid','example','example.com','example.net','example.org','alt','arpa','onion'];

/** Parse and canonicalize a compatible API base URL without accepting route URLs. */
export function parseCompatibleBaseUrl(value:unknown):CompatibleEndpoint{
 if(typeof value!=='string'||value.length===0||value.length>2048||/[\u0000-\u0020\u007f-\u009f\s\\?#%]/u.test(value))return fail();
 if(!/^https:\/\//i.test(value))return fail();

 const authorityStart=8;
 const slash=value.indexOf('/',authorityStart);
 const authority=slash<0?value.slice(authorityStart):value.slice(authorityStart,slash);
 const rawPath=slash<0?'':value.slice(slash);
 if(!authority||authority.includes('@')||authority.includes('[')||authority.includes(']'))return fail();

 let rawHostname=authority;
 const colon=authority.lastIndexOf(':');
 if(colon>=0){
  if(authority.slice(colon)!==':443'||authority.indexOf(':')!==colon)return fail();
  rawHostname=authority.slice(0,colon);
 }
 if(!rawHostname||rawHostname.endsWith(':')||rawHostname.includes('%'))return fail();

 let url:URL;
 try{url=new URL(value);}catch{return fail();}
 if(url.protocol!=='https:'||url.username!==''||url.password!==''||url.port!==''||url.search!==''||url.hash!=='')return fail();

 let hostname=url.hostname.toLowerCase();
 if(hostname.endsWith('.'))hostname=hostname.slice(0,-1);
 if(!hostname||hostname.length>253||isIP(hostname)!==0||!hostname.includes('.'))return fail();
 const labels=hostname.split('.');
 if(labels.some(label=>label.length<1||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))return fail();
 if(specialSuffixes.some(suffix=>hostname===suffix||hostname.endsWith(`.${suffix}`)))return fail();

 if(rawPath&&rawPath!=='/'){
  if(rawPath.startsWith('//')||rawPath.endsWith('//'))return fail();
  const path=rawPath.endsWith('/')?rawPath.slice(0,-1):rawPath;
  if(!path.startsWith('/')||path.includes('//'))return fail();
  const segments=path.slice(1).split('/');
  if(segments.some(segment=>!segment||segment==='.'||segment==='..'||!/^[A-Za-z0-9._~-]+$/.test(segment)))return fail();
  const lowered=segments.map(segment=>segment.toLowerCase());
  if(lowered.at(-1)==='models'||lowered.at(-1)==='embeddings'||(lowered.at(-2)==='chat'&&lowered.at(-1)==='completions'))return fail();
  const pathPrefix=`/${segments.join('/')}`;
  const origin=`https://${hostname}`;
  return {baseUrl:`${origin}${pathPrefix}`,origin,hostname,pathPrefix};
 }

 const origin=`https://${hostname}`;
 return {baseUrl:origin,origin,hostname,pathPrefix:''};
}
