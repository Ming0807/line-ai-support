import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

// Cached native runtime is provisioned separately; never package its private run homes or cache.
const server='.next/server';
const copilot=join(server,'app','api','tickets','[id]','copilot','route.js.nft.json');
try{
 if(!existsSync(copilot))throw new Error('TRACE_MISSING');
 const pending=[server];let manifests=0;
 while(pending.length){
  const directory=pending.pop();
  for(const entry of readdirSync(directory,{withFileTypes:true})){
   const path=join(directory,entry.name);
   if(entry.isDirectory())pending.push(path);
   else if(entry.isFile()&&entry.name.endsWith('.nft.json')){
    const trace=JSON.parse(readFileSync(path,'utf8'));
    if(!Array.isArray(trace.files)||trace.files.some(file=>typeof file!=='string'||file.replaceAll('\\','/').toLowerCase().includes('.superpowers/staging/hermes-runtime/')))
     throw new Error('TRACE_INVALID');
    manifests++;
   }
  }
 }
 if(!manifests)throw new Error('TRACE_MISSING');
 console.log('HERMES_RUNTIME_TRACE_CHECK_PASSED');
}catch{console.error('HERMES_RUNTIME_TRACE_CHECK_FAILED');process.exitCode=1;}
