import {createHash,createHmac,hkdfSync,timingSafeEqual} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {AISnapshot} from '../ai/run-worker';
import {copyStructuredJson,freezeStructuredData,canonicalDigest} from '../imports/structured-mapping-contract';
import {knowledgeScopeSchema,searchKnowledge} from './retrieval';
import {structuredQuerySchema,validateStructuredQuery,assessStructuredQuery} from './structured-query';
import {searchStructured} from './structured-search';
import {LOCAL_EMBEDDING_FINGERPRINT} from './embedding-space';
import {isValidKnowledgeDate} from './metadata-filter';
import {structuredProcedureCertificateSchema,structuredProcedureApplies} from './structured-not-applicable';

const policy='LOCAL_E5_384_THRESHOLD_065_LIMIT_12_V1' as const;
const proceduralPolicy='LOCAL_E5_384_THRESHOLD_065_LIMIT_12_STRUCTURED_PROCEDURE_V1' as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/u);
const vector=z.array(z.number().finite().min(-1).max(1)).length(384)
 .refine(v=>Math.abs(v.reduce((sum,n)=>sum+n*n,0)-1)<=0.001);
const common={scope:knowledgeScopeSchema,queryVector:vector,fingerprint:z.literal(LOCAL_EMBEDDING_FINGERPRINT)};
const explicitCandidate=z.object({...common,structuredQuery:structuredQuerySchema}).strict();
const proceduralCandidate=z.object({...common,structuredQuery:z.null(),notApplicable:structuredProcedureCertificateSchema}).strict();
const candidateSchema=z.union([explicitCandidate,proceduralCandidate]);
const receipt={evaluatedOn:z.string().refine(isValidKnowledgeDate),sourceDigest:hash,signature:hash};
export const internalMissProofSchema=z.union([
 explicitCandidate.extend({...receipt,version:z.literal(1),policy:z.literal(policy)}),
 proceduralCandidate.extend({...receipt,version:z.literal(2),policy:z.literal(proceduralPolicy)}),
]);
export type InternalMissProof=z.infer<typeof internalMissProofSchema>;
export type InternalMissResult={status:'EMPTY';proof:InternalMissProof}|{status:'STRUCTURED_MATCH'|'RAG_MATCH'|'CLARIFY'|'UNAVAILABLE'};
const sourceSchema=z.object({jobId:z.uuid(),sessionId:z.uuid(),conversationId:z.uuid(),messageId:z.uuid(),revision:z.number().int().min(0),
 question:z.string().min(1).max(6000).refine(value=>value.trim().length>0&&Buffer.byteLength(value,'utf8')<=6000),
 history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(3000)}).strict()).max(8)});
export function internalMissSourceDigest(snapshot:AISnapshot):string{
 return canonicalDigest('internal-miss-source-v1',sourceSchema.parse(copyStructuredJson(snapshot,128*1024,6000)));
}
function receiptKey(key:string):Buffer{
 const master=Buffer.from(key,'base64');
 if(master.length!==32||master.toString('base64')!==key)throw new Error('INTERNAL_MISS_UNAVAILABLE');
 return Buffer.from(hkdfSync('sha256',master,'yru-helpdesk-v1','internal-miss-receipt',32));
}
function sign(body:{version:number},key:Buffer):string{
 return createHmac('sha256',key).update(canonicalDigest(body.version===2?'internal-miss-receipt-v2':'internal-miss-receipt-v1',body)).digest('hex');
}
function candidate(input:unknown,snapshot:AISnapshot){
 const parsed=candidateSchema.parse(copyStructuredJson(input,64*1024,2000));
 if(parsed.structuredQuery===null){if(!structuredProcedureApplies(parsed.notApplicable,snapshot))throw new Error('INTERNAL_MISS_UNAVAILABLE');return freezeStructuredData(parsed);}
 return freezeStructuredData({...parsed,structuredQuery:validateStructuredQuery(parsed.structuredQuery)});
}

// Body fingerprints of accepted migrations36/38, normalized only for CRLF.
// A version row or a same-named no-op function is not installation evidence.
const bodies:Record<string,string>={
 lock_structured_selection_catalog:'460afdc340bd82beddb66bdc4f85cd6e437fcccef1c099cd2a589bc3e10a22e2',
 lock_rag_selection_catalog:'d9a5f183aa4c918085aa3b897cdda44276cf64118147403a52b05ed85c818865',
};
const publicTables=['document_families','documents','document_relationships','departments','academic_calendar_events','tuition_fees',
 'transfer_courses','university_services','university_systems','service_forms','announcements'];
const privateTables=['structured_row_provenance','structured_publication_effects','knowledge_import_publications'];
const expected=[
 ...publicTables.map(table=>({schema:'public',table,name:'structured_selection_catalog',function:'lock_structured_selection_catalog',events:62,columns:[] as string[]})),
 ...privateTables.map(table=>({schema:'private',table,name:'structured_selection_catalog',function:'lock_structured_selection_catalog',events:62,columns:[] as string[]})),
 {schema:'private',table:'knowledge_import_jobs',name:'structured_selection_catalog_lifecycle',function:'lock_structured_selection_catalog',events:46,columns:[]},
 {schema:'private',table:'knowledge_import_jobs',name:'structured_selection_catalog_source',function:'lock_structured_selection_catalog',events:18,
  columns:['checksum','publication_status','source_metadata_encrypted']},
 {schema:'public',table:'knowledge_chunks',name:'rag_selection_catalog',function:'lock_rag_selection_catalog',events:62,columns:[]},
];
interface Guard {schema:string;table:string;name:string;function:string;events:number;columns:string[];enabled:string;args:number;qual:string|null;
 functionSchema:string;language:string;definer:boolean;volatility:string;config:string[]|null;source:string;anonymous:boolean;browser:boolean;service:boolean}
async function catalogReady(client:PoolClient):Promise<boolean>{
 // Both transaction and session advisory locks have this same pg_locks identity.
 const held=(await client.query(`select current_setting('transaction_isolation')='read committed' and exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted
  and objsubid=1 and mode in ('ShareLock','ExclusiveLock')
  and ((classid::bigint<<32)|objid::bigint)=hashtextextended('knowledge-structured-selection-catalog:v1',0)) held`)).rows[0]?.held;
 if(held!==true)return false;
 const rows=(await client.query<Guard>(`select n.nspname schema,c.relname "table",t.tgname name,p.proname "function",t.tgtype::integer events,
  coalesce((select array_agg(a.attname::text order by a.attname) from unnest(t.tgattr::smallint[]) u(num)
   join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=u.num),'{}'::text[]) columns,
  t.tgenabled enabled,t.tgnargs args,t.tgqual::text qual,pn.nspname "functionSchema",l.lanname language,
  p.prosecdef definer,p.provolatile volatility,p.proconfig config,p.prosrc source,
  has_function_privilege('anon',p.oid,'EXECUTE') anonymous,has_function_privilege('authenticated',p.oid,'EXECUTE') browser,
  has_function_privilege('service_role',p.oid,'EXECUTE') service
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where not t.tgisinternal and n.nspname in ('public','private')
  and t.tgname in ('structured_selection_catalog','structured_selection_catalog_lifecycle','structured_selection_catalog_source','rag_selection_catalog')`)).rows;
 if(rows.length!==expected.length)return false;
 return expected.every(binding=>{
  const row=rows.find(r=>r.schema===binding.schema&&r.table===binding.table&&r.name===binding.name);
  return !!row&&row.function===binding.function&&row.functionSchema==='private'&&row.events===binding.events&&
   JSON.stringify(row.columns)===JSON.stringify(binding.columns)&&row.enabled==='O'&&row.args===0&&row.qual===null&&
   row.language==='plpgsql'&&!row.definer&&row.volatility==='v'&&row.config?.length===1&&row.config[0]==='search_path=""'&&
   !row.anonymous&&!row.browser&&row.service&&createHash('sha256').update(row.source.replaceAll('\r\n','\n')).digest('hex')===bodies[row.function];
 });
}
async function complete(client:PoolClient,input:z.infer<typeof candidateSchema>,key:string,expectedDay?:string):Promise<
 {status:'EMPTY';day:string}|{status:'STRUCTURED_MATCH'|'RAG_MATCH'|'CLARIFY'|'UNAVAILABLE'}>{
 if(input.structuredQuery!==null&&assessStructuredQuery(input.structuredQuery).status!=='READY')return {status:'CLARIFY'};
 if(!await catalogReady(client))return {status:'UNAVAILABLE'};
 const day=(await client.query("select (clock_timestamp() at time zone 'Asia/Bangkok')::date::text evaluation_day")).rows[0]?.evaluation_day;
 if(typeof day!=='string'||!isValidKnowledgeDate(day)||expectedDay!==undefined&&day!==expectedDay)return {status:'UNAVAILABLE'};
 if(input.structuredQuery!==null){
  const structured=await searchStructured(client,{scope:input.scope,query:input.structuredQuery},key,day);
  if(structured.status==='READY')return {status:'STRUCTURED_MATCH'};
  if(structured.status==='CLARIFICATION_REQUIRED')return {status:'CLARIFY'};
  if(structured.status!=='EMPTY')return {status:'UNAVAILABLE'};
 }
 const rag=await searchKnowledge(client,{scope:input.scope,vector:input.queryVector,fingerprint:input.fingerprint,threshold:0.65,limit:12},day);
 if(rag.length!==0)return {status:'RAG_MATCH'};
 // A midnight crossover cannot seal yesterday's negative search.
 const stillDay=(await client.query("select (clock_timestamp() at time zone 'Asia/Bangkok')::date::text evaluation_day")).rows[0]?.evaluation_day;
 return stillDay===day?{status:'EMPTY',day}:{status:'UNAVAILABLE'};
}

/** Caller owns a short authorized transaction and catalog-before-conversation lock order. No network here. */
export async function proveInternalMiss(client:PoolClient,input:unknown,snapshot:AISnapshot,key:string):Promise<InternalMissResult>{
 try{
  const derived=receiptKey(key),parsed=candidate(input,snapshot),source=internalMissSourceDigest(snapshot);
  const result=await complete(client,parsed,key);if(result.status!=='EMPTY')return result;
  const body=parsed.structuredQuery===null?{...parsed,version:2 as const,policy:proceduralPolicy,evaluatedOn:result.day,sourceDigest:source}:
   {...parsed,version:1 as const,policy,evaluatedOn:result.day,sourceDigest:source};
  return freezeStructuredData({status:'EMPTY' as const,proof:internalMissProofSchema.parse({...body,signature:sign(body,derived)})});
 }catch{return {status:'UNAVAILABLE'};}
}

/** A stored receipt is never an EMPTY bit: authenticate context and repeat both actual searches. */
export async function internalMissStillApplies(client:PoolClient,input:unknown,snapshot:AISnapshot,key:string):Promise<boolean>{
 try{
  const derived=receiptKey(key),parsed=internalMissProofSchema.parse(copyStructuredJson(input,64*1024,2200));
  const {signature,...body}=parsed;
  if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(body,derived),'hex'))||parsed.sourceDigest!==internalMissSourceDigest(snapshot))return false;
  const selected=candidate({scope:parsed.scope,structuredQuery:parsed.structuredQuery,queryVector:parsed.queryVector,fingerprint:parsed.fingerprint,
   ...(parsed.structuredQuery===null?{notApplicable:parsed.notApplicable}:{})},snapshot);
  return (await complete(client,selected,key,parsed.evaluatedOn)).status==='EMPTY';
 }catch{return false;}
}
