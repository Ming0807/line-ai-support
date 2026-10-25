import {expect,it,vi} from 'vitest';
import {createPriceReader,type PriceQuery} from '../lib/ai/pricing';

const baseUrl='https://api.kilo.ai/api/gateway';
const modelId='kilo-auto/free';
const query=(overrides:Partial<PriceQuery>={}):PriceQuery=>({
 adapter:'COMPATIBLE',baseUrl,modelId,purpose:'GENERATION',...overrides,
});
const catalog=(entries:unknown[])=>new Response(JSON.stringify({data:entries}),{
 headers:{'content-type':'application/json'},
});
const model=(id=modelId,pricing:Record<string,unknown>={prompt:0,completion:0})=>({id,pricing});
const read=(fetchImpl:typeof fetch,request=query(),signal=new AbortController().signal)=>
 createPriceReader({fetchImpl})(request,signal);

it('reads only the public Kilo catalog with a credential-free GET and exact free identity',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(catalog([
  model(modelId,{prompt:0,completion:0,request:0,web_search:0}),
 ]));
 const result=await read(fetchImpl);

 expect(result).toMatchObject({status:'FREE',inputPricePerMillion:0,outputPricePerMillion:0,apiFormat:'CHAT'});
 expect(fetchImpl).toHaveBeenCalledTimes(1);
 expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${baseUrl}/models`);
 expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({method:'GET',redirect:'error',cache:'no-store'});
 expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({accept:'application/json'});
 expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
});

it('requires the fixed official Kilo COMPATIBLE endpoint and generation purpose before HTTP',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 for(const request of [
  query({adapter:'OPENROUTER'}),
  query({adapter:'ZEN'}),
  query({baseUrl:'https://api.kilo.ai.attacker.example/api/gateway'}),
  query({baseUrl:'https://api.kilo.ai/api/gateway/v1'}),
  query({baseUrl:'http://api.kilo.ai/api/gateway'}),
  query({baseUrl:'https://api.kilo.ai/api/gateway',purpose:'EMBEDDING'}),
 ]){
  expect((await read(fetchImpl,request)).status).toBe('UNKNOWN');
 }
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('classifies any positive published fee as paid, regardless of free-looking model suffixes',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(catalog([
  model(modelId,{prompt:0,completion:0,request:0.000001}),
 ]));
 expect((await read(fetchImpl)).status).toBe('PAID');

 const suffixFetch=vi.fn<typeof fetch>().mockResolvedValue(catalog([
  model('kilo-auto/free:free',{prompt:0,completion:0}),
 ]));
 expect((await read(suffixFetch)).status).toBe('UNKNOWN');
});

it('requires exactly one matching catalog identity',async()=>{
 for(const entries of [
  [],
  [model('kilo-auto/other')],
  [model(),model()],
 ]){
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(catalog(entries));
  expect((await read(fetchImpl)).status).toBe('UNKNOWN');
 }
});

it('keeps missing, empty, malformed, negative, or non-finite published fee data unknown',async()=>{
 const badPricing:unknown[]=[
  undefined,
  {},
  {prompt:0},
  {prompt:0,completion:0,request:null},
  {prompt:0,completion:0,request:'not-a-price'},
  {prompt:0,completion:0,request:-0.01},
  {prompt:0,completion:0,request:Number.POSITIVE_INFINITY},
  {prompt:0,completion:0,request:'1e999'},
 ];
 for(const pricing of badPricing){
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(catalog([{id:modelId,pricing}]));
  expect((await read(fetchImpl)).status).toBe('UNKNOWN');
 }
});

it('treats an already-cancelled public catalog request as cancelled without HTTP',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();
 const controller=new AbortController();controller.abort();
 await expect(read(fetchImpl,query(),controller.signal)).rejects.toMatchObject({code:'CANCELLED'});
 expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects a catalog body above the inherited metadata bound',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response('{}',{
  headers:{'content-length':String(8*1024*1024+1)},
 }));
 await expect(read(fetchImpl)).rejects.toMatchObject({code:'INVALID_OUTPUT',httpStatus:200});
});
