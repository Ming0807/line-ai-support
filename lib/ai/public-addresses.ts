import {isIP} from 'node:net';
import {Resolver} from 'node:dns/promises';
import {AIProviderError} from './types';
import {parseCompatibleBaseUrl} from './compatible-endpoint';

export interface ResolvedAddress {readonly address:string;readonly family:4|6}

const fail=(code:'INVALID_REQUEST'|'CANCELLED'|'TIMEOUT'|'PROVIDER_UNAVAILABLE'):never=>{throw new AIProviderError(code);};
const deadlineMs=4500;
const resolverTimeoutMs=4000;
const zero=BigInt(0);
const one=BigInt(1);
const eight=BigInt(8);
const sixteen=BigInt(16);
const thirtyTwo=BigInt(32);
const oneTwentyEight=BigInt(128);

function cidr4(base:string,prefix:number):{network:bigint;mask:bigint}{
 const bytes=base.split('.').map(Number);
 const network=bytes.reduce((value,byte)=>(value<<eight)|BigInt(byte),zero);
 const mask=prefix===0?zero:((one<<BigInt(prefix))-one)<<(thirtyTwo-BigInt(prefix));
 return {network,mask};
}

function ipv4Value(address:string):bigint|null{
 if(isIP(address)!==4)return null;
 return address.split('.').reduce((value,part)=>(value<<eight)|BigInt(Number(part)),zero);
}

const nonPublicV4=[
 ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
 ['192.0.0.0',24],['192.0.2.0',24],['192.31.196.0',24],['192.52.193.0',24],['192.88.99.0',24],['192.168.0.0',16],
 ['192.175.48.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],
].map(([base,prefix])=>cidr4(base as string,prefix as number));

function ipv6Value(address:string):bigint|null{
 if(isIP(address)!==6||address.includes('%'))return null;
 let input=address.toLowerCase();
 const lastColon=input.lastIndexOf(':');
 if(input.includes('.')){
  const tail=input.slice(lastColon+1);
  const v4=ipv4Value(tail);
  if(v4===null)return null;
  const high=Number((v4>>sixteen)&BigInt(0xffff)).toString(16);
  const low=Number(v4&BigInt(0xffff)).toString(16);
  input=`${input.slice(0,lastColon)}:${high}:${low}`;
 }
 const split=input.split('::');
 if(split.length>2)return null;
 const left=split[0]?split[0].split(':'):[];
 const right=split.length===2&&split[1]?split[1].split(':'):[];
 const missing=8-left.length-right.length;
 if((split.length===1&&missing!==0)||(split.length===2&&missing<1))return null;
 const parts=[...left,...Array.from({length:missing},()=> '0'),...right];
 if(parts.length!==8||parts.some(part=>!/^[0-9a-f]{1,4}$/.test(part)))return null;
 return parts.reduce((value,part)=>(value<<sixteen)|BigInt(`0x${part}`),zero);
}

function cidr6(base:bigint,prefix:number):{network:bigint;mask:bigint}{
 const mask=((one<<BigInt(prefix))-one)<<(oneTwentyEight-BigInt(prefix));
 return {network:base&mask,mask};
}

const nonGlobalV6=[
 cidr6(BigInt('0x20010000000000000000000000000000'),23), // IETF protocol and special assignments (includes Teredo/ORCHID)
 cidr6(BigInt('0x20020000000000000000000000000000'),16), // 6to4
 cidr6(BigInt('0x20010db8000000000000000000000000'),32), // documentation
 cidr6(BigInt('0x3ffe0000000000000000000000000000'),16), // deprecated 6bone
 cidr6(BigInt('0x3fff0000000000000000000000000000'),20), // documentation
 cidr6(BigInt('0x30000000000000000000000000000000'),4), // currently unallocated portion of Global Unicast space
];
const globalUnicastV6=cidr6(BigInt('0x20000000000000000000000000000000'),3);

/** Fail-closed classifier for addresses safe to pin as public internet destinations. */
export function isPublicAddress(value:ResolvedAddress):boolean{
 if(!value||typeof value.address!=='string'||(value.family!==4&&value.family!==6))return false;
 if(value.family===4){
  const address=ipv4Value(value.address);
  return address!==null&&!nonPublicV4.some(range=>(address&range.mask)===range.network);
 }
 const address=ipv6Value(value.address);
 return address!==null&&(address&globalUnicastV6.mask)===globalUnicastV6.network&&
  !nonGlobalV6.some(range=>(address&range.mask)===range.network);
}

function normalizeHostname(hostname:string):string{
 if(typeof hostname!=='string'||hostname.length===0||hostname.length>253)fail('INVALID_REQUEST');
 try{
  const parsed=parseCompatibleBaseUrl(`https://${hostname}`);
  return parsed.hostname;
 }catch{return fail('INVALID_REQUEST');}
}

function dnsFailure(error:unknown):AIProviderError{
 const code=(error as {code?:unknown}|null)?.code;
 return new AIProviderError(code==='ETIMEOUT'?'TIMEOUT':'PROVIDER_UNAVAILABLE');
}

/** Resolve A and AAAA once, reject unsafe mixtures, and return only a bounded public answer set. */
export async function resolvePublicAddresses(hostname:string,signal:AbortSignal):Promise<readonly ResolvedAddress[]>{
 const normalized=normalizeHostname(hostname);
 if(signal.aborted)throw new AIProviderError('CANCELLED');
 let resolver:Resolver;
 try{resolver=new Resolver({timeout:resolverTimeoutMs,tries:1});}catch{throw new AIProviderError('PROVIDER_UNAVAILABLE');}

 const query=(family:4|6):Promise<string[]>=>{
  return Promise.resolve().then(()=>{
   if(signal.aborted)throw new AIProviderError('CANCELLED');
   return family===4?resolver.resolve4(normalized):resolver.resolve6(normalized);
  }).catch(error=>{
   if((error as {code?:unknown}|null)?.code==='ENODATA')return [];
   throw error;
  });
 };

 return new Promise<readonly ResolvedAddress[]>((resolve,reject)=>{
  let settled=false;
  const timer:{id?:ReturnType<typeof setTimeout>}={};
  const cleanup=()=>{
   if(timer.id!==undefined)clearTimeout(timer.id);
   signal.removeEventListener('abort',onAbort);
  };
  const finish=(action:()=>void)=>{
   if(settled)return;
   settled=true;
   cleanup();
   action();
  };
  let cancelled=false;
  const cancel=()=>{
   if(cancelled)return;
   cancelled=true;
   try{resolver.cancel();}catch{}
  };
  const onAbort=()=>{
   cancel();
   finish(()=>reject(new AIProviderError('CANCELLED')));
  };
  signal.addEventListener('abort',onAbort,{once:true});
  timer.id=setTimeout(()=>{
   cancel();
   finish(()=>reject(new AIProviderError('TIMEOUT')));
  },deadlineMs);
  if(signal.aborted){onAbort();return;}

  Promise.all([query(4),query(6)]).then(([ipv4,ipv6])=>{
   if(!Array.isArray(ipv4)||!Array.isArray(ipv6)||ipv4.length+ipv6.length===0||ipv4.length+ipv6.length>64){
    finish(()=>reject(new AIProviderError('PROVIDER_UNAVAILABLE')));
    return;
   }
   const addresses:ResolvedAddress[]=[
    ...ipv4.map(address=>({address,family:4 as const})),
    ...ipv6.map(address=>({address,family:6 as const})),
   ];
   if(addresses.some(address=>!isPublicAddress(address))){
    finish(()=>reject(new AIProviderError('PROVIDER_UNAVAILABLE')));
    return;
   }
   finish(()=>resolve(addresses));
  }).catch(error=>{
   cancel();
   finish(()=>reject(dnsFailure(error)));
  });
 });
}
