import {expect,it,vi,afterEach} from 'vitest';
import {Pool} from 'pg';
import {embedConfigured} from '../lib/ai/configured';
import {createConfiguredKnowledgeProducer} from '../lib/knowledge/configured';
import {LOCAL_EMBEDDING_FINGERPRINT,LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION} from '../lib/knowledge/embedding-space';

const vector=[1,...Array<number>(383).fill(0)];
const input={input:['การเทียบโอนรายวิชาต้องทำอย่างไร'],requestType:'EMBEDDING_QUERY' as const};
type QueryInput=typeof input;
const producer=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('../lib/knowledge/answer-producer',()=>({createKnowledgeProducer:producer.create}));
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

it('configured embeddings require no generation provider, API key or database registry',async()=>{
 vi.stubEnv('ENCRYPTION_KEY','');vi.stubEnv('EMBEDDING_MODEL','intfloat/multilingual-e5-small');vi.stubEnv('EMBEDDING_API_KEY','');
 const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({model:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,embedding:vector})));vi.stubGlobal('fetch',request);
 const result=await (async()=>embedConfigured(input))();
 expect(result).toMatchObject({dimensions:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,providerId:'LOCAL_E5',fallbackUsed:false});
 expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:8000/embed');
});
it('configured RAG producer composes the local provider instead of the external embedding gateway',async()=>{
 const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({model:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,embedding:vector})));
 producer.create.mockImplementation((options:{embed:(input:QueryInput)=>Promise<unknown>})=>()=>options.embed(input));
 const pool=new Pool();const configured=createConfiguredKnowledgeProducer(pool,'fixture-only', {fetchImpl:request});
 try{await configured({} as Parameters<typeof configured>[0],new AbortController().signal);
  expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:8000/embed');
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({type:'query'});
 }finally{await pool.end();}
});
