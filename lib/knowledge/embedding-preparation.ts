import {z} from 'zod';
import {chunkPages} from './chunking';
import type {ExtractedPage,ChunkDraft} from './types';
import type {EmbeddingProvider,EmbeddingCallOptions} from './embedding-client';

export interface EmbeddedKnowledgeChunkDraft extends ChunkDraft {embedding:number[];embeddingDimensions:384;embeddingFingerprint:string}
const vector=z.array(z.number().finite()).length(384).refine(values=>Math.abs(Math.hypot(...values)-1)<=0.001);

/** Prepare reviewed drafts only. No SQL/publication/network transaction or original mutation. */
export async function prepareEmbeddedKnowledgeChunks(pages:ExtractedPage[],provider:EmbeddingProvider,options:EmbeddingCallOptions={}):Promise<EmbeddedKnowledgeChunkDraft[]> {
 const chunks=chunkPages(pages);
 if(pages.some(page=>page.requiresReview)||chunks.some(chunk=>chunk.requiresReview))throw new Error('KNOWLEDGE_EXTRACTION_REVIEW_REQUIRED');
 if(provider.dimension!==384)throw new Error('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
 const timeout=options.timeoutMs??45_000;
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>45_000)throw new Error('KNOWLEDGE_EMBEDDING_INPUT_INVALID');
 const deadline=performance.now()+timeout;const result:EmbeddedKnowledgeChunkDraft[]=[];
 for(let index=0;index<chunks.length;index+=16){
  if(options.signal?.aborted)throw new Error('KNOWLEDGE_EMBEDDING_ABORTED');
  const remaining=Math.floor(deadline-performance.now());if(remaining<1)throw new Error('KNOWLEDGE_EMBEDDING_TIMEOUT');
  const batch=chunks.slice(index,index+16);
  const vectors=await provider.embedPassages(batch.map(chunk=>chunk.content),{signal:options.signal,timeoutMs:remaining});
  if(options.signal?.aborted)throw new Error('KNOWLEDGE_EMBEDDING_ABORTED');
  if(performance.now()>deadline)throw new Error('KNOWLEDGE_EMBEDDING_TIMEOUT');
  if(vectors.length!==batch.length||vectors.some(value=>!vector.safeParse(value).success))throw new Error('KNOWLEDGE_EMBEDDING_SPACE_INVALID');
  result.push(...batch.map((chunk,at)=>({...chunk,embedding:vectors[at],embeddingDimensions:384 as const,embeddingFingerprint:provider.fingerprint})));
 }
 return result;
}
