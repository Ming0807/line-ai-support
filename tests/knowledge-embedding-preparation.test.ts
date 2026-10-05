import {it,expect,vi} from 'vitest';
import {prepareEmbeddedKnowledgeChunks} from '../lib/knowledge/embedding-preparation';
import {createLocalE5EmbeddingProvider} from '../lib/knowledge/embedding-client';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION} from '../lib/knowledge/embedding-space';

it('prepares location-preserving drafts through passage embeddings without publishing or changing source',async()=>{
 const vector=[1,...Array<number>(383).fill(0)];
 const request=vi.fn<typeof fetch>().mockImplementation(async(_url,options)=>{
  const body=JSON.parse(String(options?.body));return new Response(JSON.stringify({model:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,embeddings:body.texts.map(()=>vector)}));
 });
 const provider=createLocalE5EmbeddingProvider({fetchImpl:request});
 const pages=[{pageNumber:3,text:'# ข้อกำหนด\n\nข้อมูลการเทียบโอน',requiresReview:false}];
 const original=structuredClone(pages);
 const result=await prepareEmbeddedKnowledgeChunks(pages,provider);
 expect(pages).toEqual(original);expect(result.length).toBeGreaterThan(0);
 expect(result[0]).toMatchObject({pageNumber:3,sectionTitle:'ข้อกำหนด',embeddingDimensions:384,embeddingFingerprint:provider.fingerprint});
 expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({type:'passage',texts:result.map(chunk=>chunk.content)});
});
it('withholds unresolved review pages from indexing before an embedding request',async()=>{
 const request=vi.fn<typeof fetch>();const provider=createLocalE5EmbeddingProvider({fetchImpl:request});
 await expect(prepareEmbeddedKnowledgeChunks([{pageNumber:1,text:'OCR requires human review',requiresReview:true}],provider)).rejects.toThrow('KNOWLEDGE_EXTRACTION_REVIEW_REQUIRED');
 expect(request).not.toHaveBeenCalled();
});
