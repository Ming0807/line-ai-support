import {expect,it,vi} from 'vitest';
import {createPriceReader} from '../lib/ai/pricing';

const signal=()=>new AbortController().signal;
const query={adapter:'OPENROUTER',baseUrl:'https://openrouter.ai/api/v1',modelId:'fixture/model:free',purpose:'GENERATION' as const};
const json=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
function fixture(pricing:unknown){const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(json({data:[{id:query.modelId,pricing}]}));return {fetchImpl,read:createPriceReader({fetchImpl})};}

it('reads actual zero catalog prices without credentials or trusting a free suffix',async()=>{
 const f=fixture({prompt:'0',completion:'0',request:'0',image:'0',web_search:'0'});
 expect(await f.read(query,signal())).toMatchObject({status:'FREE',inputPricePerMillion:0,outputPricePerMillion:0,apiFormat:'CHAT'});
 const [url,init]=f.fetchImpl.mock.calls[0];expect(url).toBe('https://openrouter.ai/api/v1/models');
 expect(init?.method).toBe('GET');expect(init?.redirect).toBe('error');expect(JSON.stringify(init)).not.toContain('authorization');
});
it.each([null,{}, {prompt:null,completion:'0'},{prompt:'',completion:'0'},{prompt:'-1',completion:'0'},
 {prompt:'0',completion:'NaN'},{prompt:'0'}, {prompt:'0',completion:'0',request:null}])('does not turn incomplete or invalid pricing into free %j',async pricing=>{
 expect((await fixture(pricing).read(query,signal())).status).toBe('UNKNOWN');
});
it('marks a free-named model paid when any fee is positive',async()=>{
 expect((await fixture({prompt:'0',completion:'0',request:'0.01'}).read(query,signal())).status).toBe('PAID');
 expect((await fixture({prompt:'0.000001',completion:'0.000002'}).read(query,signal()))).toMatchObject({status:'PAID',inputPricePerMillion:1,outputPricePerMillion:2});
});
it('uses a separate embedding catalog and requires its explicit zero output price',async()=>{
 const f=fixture({prompt:'0',completion:'0'});
 expect((await f.read({...query,purpose:'EMBEDDING'},signal())).status).toBe('FREE');
 expect(f.fetchImpl.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/embeddings/models');
});
it('rejects duplicate, missing model and response overflow rather than guessing',async()=>{
 const fetchImpl=vi.fn<typeof fetch>();const read=createPriceReader({fetchImpl});
 fetchImpl.mockResolvedValueOnce(json({data:[{id:query.modelId,pricing:{prompt:'0',completion:'0'}},{id:query.modelId,pricing:{prompt:'0',completion:'0'}}]}));
 expect((await read(query,signal())).status).toBe('UNKNOWN');
 fetchImpl.mockResolvedValueOnce(json({data:[]}));expect((await read(query,signal())).status).toBe('UNKNOWN');
 fetchImpl.mockResolvedValueOnce(new Response('x',{headers:{'content-length':'99999999'}}));
 await expect(read(query,signal())).rejects.toMatchObject({code:'INVALID_OUTPUT'});
});
it('requires both zero Zen metadata and live availability; does not guess embedding support',async()=>{
 const fetchImpl=vi.fn<typeof fetch>().mockImplementation(async(url)=>url==='https://models.dev/api.json'?
  json({opencode:{api:'https://opencode.ai/zen/v1',models:{'fixture-free':{id:'fixture-free',cost:{input:0,output:0},provider:{npm:'@ai-sdk/openai'}}}}}):json({data:[{id:'fixture-free'}]}));
 const read=createPriceReader({fetchImpl}),zen={...query,adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',modelId:'fixture-free'};
 expect(await read(zen,signal())).toMatchObject({status:'FREE',apiFormat:'RESPONSES'});
 fetchImpl.mockImplementation(async(url)=>url==='https://models.dev/api.json'?json({opencode:{api:zen.baseUrl,models:{'fixture-free':{id:'fixture-free',cost:{input:0,output:0}}}}}):json({data:[]}));
 expect((await read(zen,signal())).status).toBe('UNKNOWN');
 expect((await read({...zen,purpose:'EMBEDDING'},signal())).status).toBe('UNKNOWN');
});
it('cannot route pricing metadata to a user-supplied host or infer unknown native pricing',async()=>{
 const fetchImpl=vi.fn<typeof fetch>(),read=createPriceReader({fetchImpl});
 expect((await read({...query,baseUrl:'https://attacker.example/v1'},signal())).status).toBe('UNKNOWN');
 expect((await read({...query,adapter:'OPENAI',baseUrl:'https://api.openai.com/v1'},signal())).status).toBe('UNKNOWN');
 expect(fetchImpl).not.toHaveBeenCalled();
});
it.each([
 ['https://opencode.ai/inference/v1','FREE'],
 ['https://opencode.ai/inference/v1.evil','UNKNOWN'],
 ['https://attacker.example/inference/v1','UNKNOWN'],
])('recognizes only official Zen metadata API aliases: %s',async(api,status)=>{
 const fetchImpl=vi.fn<typeof fetch>().mockImplementation(async url=>url==='https://models.dev/api.json'
  ?json({opencode:{api,npm:'@ai-sdk/openai-compatible',models:{'fixture-free':{id:'fixture-free',cost:{input:0,output:0}}}}})
  :json({data:[{id:'fixture-free'}]}));
 const result=await createPriceReader({fetchImpl})({...query,adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',modelId:'fixture-free'},signal());
 expect(result.status).toBe(status);
 expect(fetchImpl.mock.calls.map(([url])=>url)).toEqual(['https://models.dev/api.json','https://opencode.ai/zen/v1/models']);
 if(status==='FREE')expect(result.apiFormat).toBe('CHAT');
});
it.each([
 [false,{input:0,output:0},'UNKNOWN'],
 [true,{input:0,output:0,cache_write:1},'PAID'],
])('keeps availability and ancillary-price gates on the new metadata identity',async(available,cost,status)=>{
 const fetchImpl=vi.fn<typeof fetch>().mockImplementation(async url=>url==='https://models.dev/api.json'
  ?json({opencode:{api:'https://opencode.ai/inference/v1',npm:'@ai-sdk/openai-compatible',models:{'fixture-free':{id:'fixture-free',cost}}}})
  :json({data:available?[{id:'fixture-free'}]:[]}));
 expect((await createPriceReader({fetchImpl})({...query,adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',modelId:'fixture-free'},signal())).status).toBe(status);
});
it('cancels a stalled metadata body and normalizes network errors without leaking details',async()=>{
 const controller=new AbortController();
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({start(){}})));
 const pending=createPriceReader({fetchImpl})(query,controller.signal);controller.abort();
 await expect(pending).rejects.toMatchObject({code:'CANCELLED'});
 fetchImpl.mockRejectedValue(new Error('private network details'));
 await expect(createPriceReader({fetchImpl})(query,signal())).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
});

const currentZenMetadataApi='https://opencode.ai/inference/openai/v1';
function zenMetadataFixture(api:string,provider:unknown,cost:unknown={input:0,output:0,cache_read:0,cache_write:0},available=true){
 const fetchImpl=vi.fn<typeof fetch>().mockImplementation(async url=>url==='https://models.dev/api.json'
  ?json({opencode:{api,npm:'@ai-sdk/openai-compatible',models:{'space-bunny-free':{id:'space-bunny-free',cost,...(provider===undefined?{}:{provider})}}}})
  :json({data:available?[{id:'space-bunny-free'}]:[]}));
 return {fetchImpl,read:()=>createPriceReader({fetchImpl})({...query,adapter:'ZEN',baseUrl:'https://opencode.ai/zen/v1',modelId:'space-bunny-free'},signal())};
}
it('reads the current observed Zen metadata without changing the configured transport',async()=>{
 const f=zenMetadataFixture(currentZenMetadataApi,{api:currentZenMetadataApi});
 expect(await f.read()).toMatchObject({status:'FREE',inputPricePerMillion:0,outputPricePerMillion:0,apiFormat:'CHAT'});
 expect(f.fetchImpl.mock.calls.map(([url])=>url)).toEqual(['https://models.dev/api.json','https://opencode.ai/zen/v1/models']);
 expect(f.fetchImpl.mock.calls.every(([,init])=>init?.method==='GET'&&init.redirect==='error'&&!JSON.stringify(init).toLowerCase().includes('authorization'))).toBe(true);
});
it('recognizes the exact new metadata identity even without a model provider override',async()=>{
 expect(await zenMetadataFixture(currentZenMetadataApi,undefined).read()).toMatchObject({status:'FREE',apiFormat:'CHAT'});
});
it('inherits the declared provider npm for an API-only override of that same verified identity',async()=>{
 const api='https://opencode.ai/inference/v1';
 expect(await zenMetadataFixture(api,{api}).read()).toMatchObject({status:'FREE',apiFormat:'CHAT'});
});
it.each([
 ['https://opencode.ai/inference/openai/v1.evil',undefined],
 ['https://opencode.ai.evil/inference/openai/v1',undefined],
 [currentZenMetadataApi,{api:'https://attacker.example/v1'}],
 [currentZenMetadataApi,{api:'https://opencode.ai/inference/anthropic/v1'}],
 [currentZenMetadataApi,{api:currentZenMetadataApi,npm:null}],
 [currentZenMetadataApi,{api:currentZenMetadataApi,npm:0}],
])('does not infer a free protocol from a lookalike identity or invalid model override %s %j',async(api,provider)=>{
 expect((await zenMetadataFixture(api,provider).read()).status).toBe('UNKNOWN');
});
it('retains ancillary-price and exact live availability gates for the observed partial override',async()=>{
 expect((await zenMetadataFixture(currentZenMetadataApi,{api:currentZenMetadataApi},{input:0,output:0,cache_read:0,cache_write:1}).read()).status).toBe('PAID');
 expect((await zenMetadataFixture(currentZenMetadataApi,{api:currentZenMetadataApi},undefined,false).read()).status).toBe('UNKNOWN');
});
