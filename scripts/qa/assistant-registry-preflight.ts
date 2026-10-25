type RetryObservation={stage:'registry_read_only_retry';attempt:2;code:'ECONNRESET'};
/** QA preflight only. The callback must only read the registry, never invoke AI or mutate state. */
export async function readRegistryPreflight<T>(read:()=>Promise<T>,options:{
 pause?:(milliseconds:number)=>Promise<void>;observe?:(event:RetryObservation)=>void;
}={}):Promise<T>{
 try{return await read();}
 catch(error){
  if(!error||typeof error!=='object'||!('code' in error)||error.code!=='ECONNRESET')throw error;
 }
 // pg discards a client on query failure; the next pool query acquires a usable client.
 // Never wrap a write, transaction commit or provider call with this helper.
 options.observe?.({stage:'registry_read_only_retry',attempt:2,code:'ECONNRESET'});
 await (options.pause??(milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds))))(250);
 return read();
}
