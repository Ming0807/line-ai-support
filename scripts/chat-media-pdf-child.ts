export {};
// Reuse the import parser's scrubbed environment, bounded heap and exact-process timeout.
// Never emit filenames, document metadata, contents or parser diagnostics.
console.log=()=>{};console.info=()=>{};console.warn=()=>{};console.error=()=>{};console.debug=()=>{};
try{
 const chunks:Buffer[]=[];let length=0;
 for await(const value of process.stdin){
  const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);length+=chunk.length;
  if(length>10*1024*1024)throw new Error('INVALID_ATTACHMENT');chunks.push(chunk);
 }
 if(!length)throw new Error('INVALID_ATTACHMENT');
 const {PDFParse}=await import('pdf-parse');
 const parser=new PDFParse({data:new Uint8Array(Buffer.concat(chunks,length)),verbosity:0,stopAtErrors:true,
  isEvalSupported:false,useWasm:false,useWorkerFetch:false,disableFontFace:true,useSystemFonts:false,disableAutoFetch:true});
 try{
  const info=await parser.getInfo({parsePageInfo:false});
  if(!Number.isInteger(info.total)||info.total<1||info.total>1000)throw new Error('INVALID_ATTACHMENT');
 }finally{await parser.destroy();}
 process.stdout.write('PDF_VALID');
}catch{process.stdout.write('PDF_INVALID');process.exitCode=1;}
