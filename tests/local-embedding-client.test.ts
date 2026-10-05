import {describe,it,expect,vi} from 'vitest';
import {createLocalE5EmbeddingProvider} from '../lib/knowledge/embedding-client';
import {LOCAL_EMBEDDING_FINGERPRINT,LOCAL_EMBEDDING_REVISION} from '../lib/knowledge/embedding-space';

const vector=[1,...Array<number>(383).fill(0)];
const health={status:'ok',model:'intfloat/multilingual-e5-small',dimension:384,revision:LOCAL_EMBEDDING_REVISION};
const config={model:health.model,dimension:384,revision:LOCAL_EMBEDDING_REVISION,apiUrl:'http://127.0.0.1:8000',apiKey:undefined};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value&&typeof value==='object'&&('embedding'in value||'embeddings'in value)?{model:health.model,revision:LOCAL_EMBEDDING_REVISION,...value}:value),{status});

describe('local E5 backend client',()=>{
 it('sends raw query/passages through the backend API with the right type and stable identity',async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValueOnce(response(health)).mockResolvedValueOnce(response({dimension:384,embedding:vector})).mockResolvedValueOnce(response({dimension:384,embeddings:[vector,vector]}));
  const provider=createLocalE5EmbeddingProvider({config,fetchImpl:request});
  expect((await provider.healthCheck()).healthy).toBe(true);
  expect(await provider.embedQuery('การเทียบโอนรายวิชาต้องทำอย่างไร')).toEqual(vector);
  expect(await provider.embedPassages(['หนึ่ง','two'])).toEqual([vector,vector]);
  expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({text:'การเทียบโอนรายวิชาต้องทำอย่างไร',type:'query'});
  expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({texts:['หนึ่ง','two'],type:'passage'});
  expect(provider.fingerprint).toBe(LOCAL_EMBEDDING_FINGERPRINT);
  expect(createLocalE5EmbeddingProvider({config:{...config,apiUrl:'https://embedding.example.org',apiKey:'fixture-only-key'}}).fingerprint).toBe(provider.fingerprint);
 });
 it.each([383,385])('rejects dimension %i',async dimension=>{
  const provider=createLocalE5EmbeddingProvider({config,fetchImpl:vi.fn<typeof fetch>().mockResolvedValue(response({dimension,embedding:Array<number>(dimension).fill(1)}))});
  await expect(provider.embedQuery('test')).rejects.toThrow('EMBEDDING_INVALID_RESPONSE');
 });
 it.each([Array<number>(384).fill(0),Array<number>(384).fill(1),[null,...vector.slice(1)]].map(embedding=>({embedding})))('rejects zero, unnormalized or non-finite/malformed vector',async({embedding})=>{
  await expect(createLocalE5EmbeddingProvider({config,fetchImpl:vi.fn<typeof fetch>().mockResolvedValue(response({dimension:384,embedding}))}).embedQuery('test')).rejects.toThrow('EMBEDDING_INVALID_RESPONSE');
 });
 it('requires batch output count to equal input',async()=>{
  await expect(createLocalE5EmbeddingProvider({config,fetchImpl:vi.fn<typeof fetch>().mockResolvedValue(response({dimension:384,embeddings:[vector]}))}).embedPassages(['one','two'])).rejects.toThrow('EMBEDDING_INVALID_RESPONSE');
 });
 it('reports controlled unavailable without leaking URL/key/raw upstream errors',async()=>{
  const provider=createLocalE5EmbeddingProvider({config,fetchImpl:vi.fn<typeof fetch>().mockRejectedValue(new Error('secret endpoint failure'))});
  await expect(provider.embedQuery('test')).rejects.toThrow(/^EMBEDDING_UNAVAILABLE$/);
  expect(await provider.healthCheck()).toMatchObject({healthy:false,model:health.model,dimension:384});
  expect(JSON.stringify(await provider.healthCheck())).not.toContain('127.0.0.1');
 });
 it('bounds a fetch that ignores abort and respects caller cancellation',async()=>{
  const request=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(()=>{}));
  const provider=createLocalE5EmbeddingProvider({config,fetchImpl:request});
  await expect(provider.embedQuery('test',{timeoutMs:15})).rejects.toThrow('EMBEDDING_TIMEOUT');
  const controller=new AbortController();controller.abort();
  await expect(provider.embedQuery('test',{signal:controller.signal})).rejects.toThrow('EMBEDDING_ABORTED');
 });
 it('does not follow redirects, swallow HTTP errors, or accept oversized response',async()=>{
  for(const result of [new Response('',{status:302,headers:{location:'https://elsewhere.invalid'}}),response({detail:'private-secret'},503),new Response('x'.repeat(300_000))]){
   const provider=createLocalE5EmbeddingProvider({config,fetchImpl:vi.fn<typeof fetch>().mockResolvedValue(result)});
   await expect(provider.embedQuery('test')).rejects.toThrow(/^EMBEDDING_(HTTP_ERROR|INVALID_RESPONSE)$/);
  }
 });
 it('rejects invalid input and insecure/unauthenticated remote config before HTTP',async()=>{
  const request=vi.fn<typeof fetch>();const provider=createLocalE5EmbeddingProvider({config,fetchImpl:request});
  await expect(provider.embedQuery('')).rejects.toThrow('EMBEDDING_INPUT_INVALID');
  await expect(provider.embedQuery('ไทย'.repeat(3000))).rejects.toThrow('EMBEDDING_INPUT_INVALID');
  await expect(provider.embedPassages(Array<string>(17).fill('x'))).rejects.toThrow('EMBEDDING_INPUT_INVALID');
  for(const apiUrl of ['http://remote.example.org','https://remote.example.org','http://user:pass@127.0.0.1:8000','http://127.0.0.1:8000?token=x'])expect(()=>createLocalE5EmbeddingProvider({config:{...config,apiUrl}})).toThrow('EMBEDDING_CONFIG_INVALID');
  expect(request).not.toHaveBeenCalled();
 });
 it('does not label a wrong model/revision healthy',async()=>{
  for(const value of [{...health,model:'other'},{...health,revision:'a'.repeat(40)}])expect((await createLocalE5EmbeddingProvider({config,fetchImpl:vi.fn<typeof fetch>().mockResolvedValue(response(value))}).healthCheck()).healthy).toBe(false);
 });
 it('rejects inference from a different model or weight revision even when normalized and 384-dimensional',async()=>{
  for(const mismatch of [{model:'other'},{revision:'a'.repeat(40)}])await expect(createLocalE5EmbeddingProvider({config,fetchImpl:vi.fn<typeof fetch>().mockResolvedValue(response({dimension:384,embedding:vector,...mismatch}))}).embedQuery('test')).rejects.toThrow('EMBEDDING_INVALID_RESPONSE');
 });
});
