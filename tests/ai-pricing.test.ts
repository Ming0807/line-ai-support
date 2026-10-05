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
it('cancels a stalled metadata body and normalizes network errors without leaking details',async()=>{
 const controller=new AbortController();
 const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({start(){}})));
 const pending=createPriceReader({fetchImpl})(query,controller.signal);controller.abort();
 await expect(pending).rejects.toMatchObject({code:'CANCELLED'});
 fetchImpl.mockRejectedValue(new Error('private network details'));
 await expect(createPriceReader({fetchImpl})(query,signal())).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',message:'PROVIDER_UNAVAILABLE'});
});
