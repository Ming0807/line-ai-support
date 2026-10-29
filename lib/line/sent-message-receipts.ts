/** Receipt extraction is optional: its failure can never retry an accepted LINE send. */
const MAX_BYTES=16_384;

function preserveNumberLexemes(text:string):unknown{
 // Validate original JSON first, so converting number tokens cannot repair invalid JSON.
 JSON.parse(text);
 let result='',quoted=false,escaped=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){result+=char;if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
  if(char==='"'){quoted=true;result+=char;continue;}
  if(char==='-'||/\d/u.test(char)){
   const token=/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(i))?.[0];
   if(!token)throw new Error('INVALID_RECEIPT');
   result+=JSON.stringify(token);i+=token.length-1;
  }else result+=char;
 }
 return JSON.parse(result);
}

export async function readSentMessageIds(response:Response,count:number,signal:AbortSignal):Promise<string[]|undefined>{
 const reader=(()=>{try{return response.body?.getReader();}catch{return undefined;}})();if(!reader)return;
 let onAbort=()=>{};
 const aborted=new Promise<undefined>(resolve=>{onAbort=()=>{void reader.cancel().catch(()=>{});resolve(undefined);};
  if(signal.aborted)onAbort();else signal.addEventListener('abort',onAbort,{once:true});});
 const read=async():Promise<string[]|undefined>=>{
  try{
   const chunks:Uint8Array[]=[];let bytes=0;
   for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>MAX_BYTES)return;
    chunks.push(next.value);}
   const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
   const parsed=preserveNumberLexemes(new TextDecoder('utf-8',{fatal:true}).decode(body));
   if(!parsed||typeof parsed!=='object'||!('sentMessages'in parsed)||!Array.isArray(parsed.sentMessages)||parsed.sentMessages.length!==count)return;
   const ids:string[]=[];
   for(const item of parsed.sentMessages){
    if(!item||typeof item!=='object'||!('id'in item)||typeof item.id!=='string'||!/^[0-9]{1,256}$/u.test(item.id))return;
    ids.push(item.id);
   }
   return new Set(ids).size===count?ids:undefined;
  }catch{return;}
 };
 try{return await Promise.race([read(),aborted]);}
 finally{signal.removeEventListener('abort',onAbort);void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{/* aborted pending read settles independently */}}
}
