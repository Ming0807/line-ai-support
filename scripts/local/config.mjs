import {assertDevelopmentTarget} from '../../lib/database/development-target.ts';
export const MODEL='intfloat/multilingual-e5-small';
export const REVISION='614241f622f53c4eeff9890bdc4f31cfecc418b3';
const loopbacks=new Set(['127.0.0.1','localhost','[::1]']);
const pgOptions=new Set(['pgbouncer','ssl','sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat']);
const fail=code=>{throw new Error(code);};
export function parseArguments(args){
 let mode='start',port=3000,tunnel=true;const seen=new Set();
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(!['--check','--stop','--no-tunnel','--port'].includes(arg)||seen.has(arg))fail('LOCAL_ARGUMENTS_INVALID');seen.add(arg);
  if(arg==='--check'||arg==='--stop'){if(mode!=='start')fail('LOCAL_ARGUMENTS_INVALID');mode=arg.slice(2);}
  if(arg==='--no-tunnel')tunnel=false;
  if(arg==='--port'){const raw=args[++i];if(!/^[1-9]\d{0,4}$/.test(raw??'')||Number(raw)>65535)fail('LOCAL_ARGUMENTS_INVALID');port=Number(raw);}
 }
 if(mode!=='start'&&(seen.has('--no-tunnel')||seen.has('--port')))fail('LOCAL_ARGUMENTS_INVALID');
 return {mode,port,tunnel};
}
export function buildSessionEnvironment(env,service,baseUrl,port){
 for(const key of ['DATABASE_URL','DIRECT_URL','ENCRYPTION_KEY','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL',
 'SUPABASE_SECRET_KEY','LINE_STUDENT_CHANNEL_SECRET','LINE_STUDENT_CHANNEL_ACCESS_TOKEN','LINE_STAFF_CHANNEL_SECRET','LINE_STAFF_CHANNEL_ACCESS_TOKEN'])
  if(typeof env[key]!=='string'||!env[key].trim())fail('LOCAL_MISSING_'+key);
 if(env.YRU_DEPLOYMENT_ENV!=='development')fail('LOCAL_DEVELOPMENT_REQUIRED');
 const key=Buffer.from(env.ENCRYPTION_KEY,'base64');if(key.length!==32||key.toString('base64')!==env.ENCRYPTION_KEY)fail('LOCAL_ENCRYPTION_KEY_INVALID');
 const db=new URL(env.DATABASE_URL),direct=new URL(env.DIRECT_URL),web=new URL(env.SUPABASE_URL),publicWeb=new URL(env.NEXT_PUBLIC_SUPABASE_URL);
 if(web.href!==publicWeb.href)fail('LOCAL_SUPABASE_TARGET_MISMATCH');
 for(const url of [db,direct])if(!['postgres:','postgresql:'].includes(url.protocol)||!url.password||url.hash||[...url.searchParams.keys()].some(key=>!pgOptions.has(key)))fail('LOCAL_DATABASE_TARGET_INVALID');
 if(direct.port==='6543'||direct.searchParams.get('pgbouncer')==='true')fail('LOCAL_SESSION_MODE_REQUIRED');
 if(loopbacks.has(web.hostname)){
  if(web.protocol!=='http:'||web.username||web.password||web.search||web.hash||web.pathname!=='/'||
   ![db,direct].every(url=>loopbacks.has(url.hostname)&&url.pathname==='/postgres'&&url.username==='postgres'))fail('LOCAL_DATABASE_TARGET_INVALID');
 }else{
  const ref=env.DEV_SUPABASE_PROJECT_REF;
  assertDevelopmentTarget({environment:env.YRU_DEPLOYMENT_ENV,projectRef:ref,supabaseUrl:env.SUPABASE_URL,directUrl:env.DIRECT_URL},ref??'');
  const validRuntime=(db.hostname===`db.${ref}.supabase.co`&&db.username==='postgres')||(/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.hostname)&&db.username===`postgres.${ref}`);
  if(!validRuntime||!['','5432','6543'].includes(db.port)||db.pathname!=='/postgres')fail('LOCAL_DATABASE_TARGET_INVALID');
 }
 const model=service.EMBEDDING_MODEL??MODEL,revision=service.EMBEDDING_MODEL_REVISION??REVISION;
 if(model!==MODEL||revision!==REVISION||(service.EMBEDDING_DIMENSION??'384')!=='384'||!service.EMBEDDING_MODEL_CACHE_DIR)fail('LOCAL_EMBEDDING_CONFIG_INVALID');
 const host=service.EMBEDDING_HOST??'127.0.0.1',embeddingPort=service.EMBEDDING_PORT??'8000';
 if(!loopbacks.has(host)||!/^\d{1,5}$/.test(embeddingPort)||Number(embeddingPort)<1||Number(embeddingPort)>65535)fail('LOCAL_EMBEDDING_CONFIG_INVALID');
 const endpoint=new URL(env.EMBEDDING_API_URL??`http://${host}:${embeddingPort}`);
 if(endpoint.protocol!=='http:'||!loopbacks.has(endpoint.hostname)||endpoint.port!==embeddingPort||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)fail('LOCAL_EMBEDDING_ENDPOINT_INVALID');
 const serviceKey=service.EMBEDDING_API_KEY??'';
 if((env.EMBEDDING_API_KEY??'')!==serviceKey|| (serviceKey&& (serviceKey.length<16||serviceKey.length>512||/\s/.test(serviceKey))))fail('LOCAL_EMBEDDING_AUTH_MISMATCH');
 for(const [name,value] of [['EMBEDDING_MODEL',MODEL],['EMBEDDING_MODEL_REVISION',REVISION],['EMBEDDING_DIMENSION','384']])if(env[name]&&env[name]!==value)fail('LOCAL_EMBEDDING_CONFIG_INVALID');
 const base=new URL(baseUrl);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||!(base.protocol==='https:'&&/^[a-z0-9-]+\.trycloudflare\.com$/.test(base.hostname)||base.protocol==='http:'&&base.hostname==='127.0.0.1'&&base.port===String(port)))fail('LOCAL_BASE_URL_INVALID');
 return {...env,...service,EMBEDDING_HOST:host,EMBEDDING_PORT:embeddingPort,EMBEDDING_MODEL:MODEL,EMBEDDING_MODEL_REVISION:REVISION,EMBEDDING_DIMENSION:'384',
  EMBEDDING_API_URL:endpoint.origin,APP_BASE_URL:base.origin,LINE_WEBHOOK_MODE:'durable',YRU_AI_ENABLED:'true',YRU_WEB_SEARCH_ENABLED:'false',
  HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'};
}
export function validateEmbeddingHealth(value){return value?.status==='ok'&&value.model===MODEL&&value.revision===REVISION&&value.dimension===384;}
export function redactLine(line,env){
 let safe=String(line).replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
 const values=Object.entries(env).filter(([key,value])=>/SECRET|TOKEN|KEY|PASSWORD|DATABASE_URL|DIRECT_URL/.test(key)&&typeof value==='string'&&value.length>3)
  .flatMap(([,value])=>[value,encodeURIComponent(value)]).sort((a,b)=>b.length-a.length);
 for(const value of values)safe=safe.replaceAll(value,'[protected]');
 return safe.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,'[database protected]')
  .replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [protected]')
  .replace(/((?:replyToken|access_token|api[_-]?key|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,'$1[protected]');
}
