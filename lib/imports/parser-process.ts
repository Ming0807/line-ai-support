import {spawn} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {IMPORT_LIMITS} from './types';
type Failure='IMPORT_PARSER_FAILED'|'IMPORT_PARSER_TIMEOUT'|'IMPORT_PARSER_OUTPUT_LIMIT'|'IMPORT_PARSER_ABORTED';
/** Internal server/test configuration. No request can choose executable, argv or environment. */
export interface ParserProcessConfig {scriptPath:string;loadTsx?:boolean;timeoutMs?:number;signal?:AbortSignal}
function parserEnvironment():NodeJS.ProcessEnv{
 const env:NodeJS.ProcessEnv={NODE_ENV:'production',TSX_DISABLE_CACHE:'1'};
 // Node executable is absolute. Windows DLL/runtime lookup needs only these OS locations.
 if(process.platform==='win32')for(const key of ['SystemRoot','WINDIR']){
  const value=Object.entries(process.env).find(([name])=>name.toLowerCase()===key.toLowerCase())?.[1];if(value)env[key]=value;
 }
 return env;
}
/** Bounded native process. Failures await close and never include child stdout/stderr/argv. */
export async function executeParserChild(input:Uint8Array,config:ParserProcessConfig):Promise<string>{
 const timeout=config.timeoutMs??15000;
 if(!(input instanceof Uint8Array)||!input.length||input.length>IMPORT_LIMITS.originalBytes+8192||!isAbsolute(config.scriptPath)||!Number.isInteger(timeout)||timeout<1||timeout>15000)throw new Error('IMPORT_PARSER_FAILED');
 if(config.signal?.aborted)throw new Error('IMPORT_PARSER_ABORTED');
 return new Promise((resolve,reject)=>{
  let failure:Failure|null=null,stdoutBytes=0,stderrBytes=0;const chunks:Buffer[]=[];
  const argv=['--max-old-space-size=256',...(config.loadTsx?['--import','tsx']:[]),config.scriptPath];
  let child:ReturnType<typeof spawn>;
  try{child=spawn(process.execPath,argv,{cwd:process.cwd(),env:parserEnvironment(),windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}
  catch{reject(new Error('IMPORT_PARSER_FAILED'));return;}
  const stop=(code:Failure)=>{if(failure)return;failure=code;chunks.length=0;child.stdin?.destroy();child.kill('SIGKILL');};
  const abort=()=>stop('IMPORT_PARSER_ABORTED'),timer=setTimeout(()=>stop('IMPORT_PARSER_TIMEOUT'),timeout);
  config.signal?.addEventListener('abort',abort,{once:true});if(config.signal?.aborted)abort();
  child.on('error',()=>stop('IMPORT_PARSER_FAILED'));
  child.stdin?.on('error',()=>stop('IMPORT_PARSER_FAILED'));
  child.stdout?.on('error',()=>stop('IMPORT_PARSER_FAILED'));child.stderr?.on('error',()=>stop('IMPORT_PARSER_FAILED'));
  child.stdout?.on('data',(chunk:Buffer)=>{
   if(failure)return;stdoutBytes+=chunk.length;if(stdoutBytes>32*1024*1024){stop('IMPORT_PARSER_OUTPUT_LIMIT');return;}chunks.push(chunk);
  });
  child.stderr?.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>65536)stop('IMPORT_PARSER_OUTPUT_LIMIT');});
  child.on('close',(code,signal)=>{
   clearTimeout(timer);config.signal?.removeEventListener('abort',abort);
   if(failure){reject(new Error(failure));return;}if(code!==0||signal!==null||stdoutBytes===0){reject(new Error('IMPORT_PARSER_FAILED'));return;}
   try{resolve(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,stdoutBytes)));}catch{reject(new Error('IMPORT_PARSER_FAILED'));}
  });
  if(!failure)child.stdin?.end(input);
 });
}
