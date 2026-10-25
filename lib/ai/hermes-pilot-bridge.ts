import {createServer} from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {AIMessage} from './types';

const requestSchema=z.object({
 model:z.literal('yru-free-pilot'),
 messages:z.array(z.object({role:z.enum(['system','user','assistant']),content:z.string().min(1).max(20000)}).strict()).min(1).max(32),
 stream:z.literal(false).optional(),tools:z.array(z.never()).max(0).optional(),
 temperature:z.number().min(0).max(2).optional(),max_tokens:z.number().int().positive().max(16000).optional(),
 max_completion_tokens:z.number().int().positive().max(16000).optional(),
 reasoning_effort:z.enum(['none','minimal','low','medium','high','xhigh']).optional(),
}).strict();

/** Synthetic local pilot only. No route is mounted in Next/LINE; no tool or model authority crosses this bridge. */
export async function startHermesPilotBridge(options:{token:string;maxRequests:number;timeoutMs?:number;reply:(messages:AIMessage[],signal:AbortSignal)=>Promise<string>}){
 const timeout=options.timeoutMs??45000;
 if(options.token.length<32||!Number.isInteger(options.maxRequests)||options.maxRequests<1||options.maxRequests>4||!Number.isInteger(timeout)||timeout<1||timeout>45000)throw new Error('INVALID_PILOT_CONFIGURATION');
 let requests=0;
 const controllers=new Set<AbortController>();
 const server=createServer(async(req,res)=>{
  const send=(status:number,body:unknown)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));}};
  const fail=(status:number,code:string)=>send(status,{error:{message:code,type:'pilot_error',code}});
  const expected=Buffer.from(`Bearer ${options.token}`),received=Buffer.from(req.headers.authorization??'');
  if(received.length!==expected.length||!timingSafeEqual(received,expected)){fail(401,'UNAUTHORIZED');req.resume();return;}
  if(req.method!=='POST'||req.url!=='/v1/chat/completions'){fail(404,'NOT_FOUND');req.resume();return;}
  const controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),timeout);
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{
   const chunks:Buffer[]=[];let bytes=0;
   for await(const chunk of req){bytes+=chunk.length;if(bytes>65536){fail(413,'BODY_TOO_LARGE');return;}chunks.push(chunk);}
   let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON');return;}
   const parsed=requestSchema.safeParse(body);
   if(!parsed.success||parsed.data.messages.reduce((n,m)=>n+m.content.length,0)>35000){fail(400,'UNSUPPORTED_REQUEST');return;}
   if(requests>=options.maxRequests){fail(429,'PILOT_BUDGET_EXHAUSTED');return;}
   requests++;
   let cancel=()=>{};
   const aborted=new Promise<never>((_resolve,reject)=>{
    cancel=()=>reject(new Error('PILOT_ABORTED'));
    controller.signal.addEventListener('abort',cancel,{once:true});
    if(controller.signal.aborted)cancel();
   });
   let answer:string;
   try{answer=await Promise.race([options.reply(parsed.data.messages,controller.signal),aborted]);}
   finally{controller.signal.removeEventListener('abort',cancel);}
   if(controller.signal.aborted){fail(503,'GENERATION_UNAVAILABLE');return;}
   send(200,{id:`chatcmpl-${randomUUID()}`,object:'chat.completion',created:Math.floor(Date.now()/1000),model:'yru-free-pilot',
    choices:[{index:0,message:{role:'assistant',content:answer},finish_reason:'stop'}]});
  }catch{fail(503,'GENERATION_UNAVAILABLE');}
  finally{clearTimeout(timer);controllers.delete(controller);}
 });
 server.requestTimeout=45000;server.headersTimeout=10000;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw new Error('PILOT_LISTEN_FAILED');
 return {url:`http://127.0.0.1:${address.port}/v1`,close:()=>new Promise<void>((resolve,reject)=>{
  for(const controller of controllers)controller.abort();server.close(error=>error?reject(error):resolve());server.closeAllConnections();
 })};
}
