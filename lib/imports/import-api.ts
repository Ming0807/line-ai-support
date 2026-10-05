import {ImportStagingError} from './import-staging';
import {OfficialUrlImportError} from './url-importer';
export class ImportBodyError extends Error {
 constructor(readonly code:'INVALID_REQUEST'|'IMPORT_BODY_TOO_LARGE'|'IMPORT_BODY_TIMEOUT'|'IMPORT_BODY_CANCELLED',readonly status:number){super(code);this.name='ImportBodyError';}
}
export function importPrivateHeaders():Headers {
 return new Headers({'cache-control':'private, no-store, max-age=0','vary':'Cookie','x-content-type-options':'nosniff'});
}
export function importApiFailure(error:unknown):Response {
 if(error instanceof ImportBodyError)return importPrivateJson({error:error.code},error.status);
 if(error instanceof OfficialUrlImportError){
  const status=error.code==='IMPORT_URL_TOO_LARGE'?413:error.code==='IMPORT_URL_TIMEOUT'||error.code==='IMPORT_URL_CANCELLED'?408:error.code==='IMPORT_URL_UNAVAILABLE'?503:400;
  return importPrivateJson({error:error.code},status);
 }
 const code=error instanceof ImportStagingError?error.code:'INTERNAL_ERROR';
 const status=({FORBIDDEN:403,NOT_FOUND:404,CONFLICT:409,INVALID_REQUEST:400,INTERNAL_ERROR:503})[code];
 if(status===503)console.error('IMPORT_API_FAILED',{code:'INTERNAL_ERROR'});
 return Response.json({error:code},{status,headers:importPrivateHeaders()});
}
export function importPrivateJson(value:unknown,status=200):Response {return Response.json(value,{status,headers:importPrivateHeaders()});}

/** Bound receive time and streamed bytes; Content-Length is an early reject only. */
export async function readImportRequestBody(request:Request,maxBytes:number):Promise<Uint8Array>{
 const declared=request.headers.get('content-length');
 if(declared!==null){if(!/^\d{1,10}$/.test(declared))throw new ImportBodyError('INVALID_REQUEST',400);if(Number(declared)>maxBytes)throw new ImportBodyError('IMPORT_BODY_TOO_LARGE',413);}
 if(request.signal.aborted)throw new ImportBodyError('IMPORT_BODY_CANCELLED',408);
 if(!request.body)return new Uint8Array();
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,complete=false;
 let rejectReceive:(error:Error)=>void=()=>undefined;
 const interrupted=new Promise<never>((_resolve,reject)=>{rejectReceive=reject;});
 const onAbort=()=>rejectReceive(new ImportBodyError('IMPORT_BODY_CANCELLED',408));
 request.signal.addEventListener('abort',onAbort,{once:true});
 const timer=setTimeout(()=>rejectReceive(new ImportBodyError('IMPORT_BODY_TIMEOUT',408)),10_000);
 try{
  if(request.signal.aborted)onAbort();
  for(;;){
   const {done,value}=await Promise.race([reader.read(),interrupted]);if(done){complete=true;break;}
   size+=value.byteLength;if(size>maxBytes)throw new ImportBodyError('IMPORT_BODY_TOO_LARGE',413);chunks.push(Uint8Array.from(value));
  }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
 }catch(error){if(error instanceof ImportBodyError)throw error;throw new ImportBodyError('INVALID_REQUEST',400);}
 finally{clearTimeout(timer);request.signal.removeEventListener('abort',onAbort);if(!complete)void reader.cancel().catch(()=>undefined);try{reader.releaseLock();}catch{}}
}
