import {z} from 'zod';
import {sourceLocationSchema} from '../imports/extraction';
import {extractionFlags,IMPORT_LIMITS} from '../imports/types';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_FINGERPRINT} from './embedding-space';
import {computeLocatedChunkPlanDigest} from './located-chunk-plan';
import {LocatedPlanError,type LocatedChunkPlan} from './located-plan-types';
const number=(max:number)=>z.number().int().min(0).max(max);
const location=sourceLocationSchema.refine(value=>{
 if(value.kind!=='HTML'||value.sourceUrl===null)return true;
 try{const url=new URL(value.sourceUrl);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!/[\r\n]/.test(value.sourceUrl);}catch{return false;}
});
const coverage=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('PAGE'),index:number(IMPORT_LIMITS.pages-1),start:number(IMPORT_LIMITS.characters),end:number(IMPORT_LIMITS.characters),overlapPrefixLength:number(200)}).strict(),
 z.object({kind:z.literal('TABLE'),index:number(IMPORT_LIMITS.tables-1),rowStartIndex:number(IMPORT_LIMITS.rows-1),rowEndIndex:number(IMPORT_LIMITS.rows-1)}).strict(),
]);
const schema=z.object({
 schemaVersion:z.literal(1),chunkerVersion:z.literal('located-e5-v1'),binding:z.object({jobId:z.uuid(),extractionRevision:z.number().int().min(1).max(999_999_999)}).strict(),
 sourceChecksum:z.string().regex(/^[a-f0-9]{64}$/),model:z.literal(LOCAL_EMBEDDING_MODEL),modelRevision:z.literal(LOCAL_EMBEDDING_REVISION),embeddingFingerprint:z.literal(LOCAL_EMBEDDING_FINGERPRINT),
 chunks:z.array(z.object({index:number(1999),pageNumber:z.number().int().min(1).max(IMPORT_LIMITS.pages).nullable(),sectionTitle:z.string().max(180).nullable(),
  content:z.string().min(1).max(6000).refine(text=>text.trim().length>0&&Buffer.byteLength(text,'utf8')<=6000),requiresReview:z.boolean(),
  sourceLocations:z.array(location).min(1).max(16),passageTokenCount:z.number().int().min(1).max(512),coverage,
 }).strict()).min(1).max(2000),
 warnings:z.array(z.object({code:z.enum(extractionFlags),severity:z.enum(['BLOCKING','REVIEW']),location:location.nullable(),count:z.number().int().min(1).max(IMPORT_LIMITS.characters),disposition:z.literal('UNRESOLVED')}).strict()).max(1000),
 digest:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const invalid=():never=>{throw new LocatedPlanError('KNOWLEDGE_PLAN_INPUT_INVALID');};
/** Validates/copies server-produced plan evidence; never authorizes publication or substitutes for original reconstruction. */
export function validateLocatedChunkPlan(input:unknown):LocatedChunkPlan{
 try{
  const parsed=schema.safeParse(input);if(!parsed.success)return invalid();const plan=parsed.data;
  const kind=plan.chunks[0].sourceLocations[0].kind;
  for(const [index,chunk] of plan.chunks.entries()){
   if(chunk.index!==index||Buffer.byteLength(JSON.stringify(chunk.sourceLocations),'utf8')>65536||chunk.sourceLocations.some(l=>l.kind!==kind))return invalid();
   if(chunk.sourceLocations.some(l=>l.kind==='PDF'?l.pageNumber!==chunk.pageNumber:chunk.pageNumber!==null))return invalid();
   const range=chunk.coverage;
   if(range.kind==='PAGE'){
    if(range.end<=range.start||range.end-range.start!==chunk.content.length||range.overlapPrefixLength>=chunk.content.length||chunk.sourceLocations.some(l=>l.tableIndex!==null))return invalid();
   }else if(range.rowEndIndex<range.rowStartIndex||chunk.sourceLocations.some(l=>l.tableIndex!==range.index+1||('rowStart' in l&&l.rowEnd-l.rowStart!==range.rowEndIndex-range.rowStartIndex)))return invalid();
  }
  if(plan.warnings.some(w=>w.location!==null&&w.location.kind!==kind))return invalid();
  if(computeLocatedChunkPlanDigest(plan.binding,plan.sourceChecksum,plan.chunks,plan.warnings)!==plan.digest)return invalid();
  return plan;
 }catch{return invalid();}
}
