import 'dotenv/config';
import assert from 'node:assert/strict';
import {createLocalE5EmbeddingProvider,readLocalEmbeddingConfig,embedLocalConfigured} from '../../lib/knowledge/embedding-client';

const provider=createLocalE5EmbeddingProvider();
const health=await provider.healthCheck();assert.equal(health.healthy,true);assert.equal(health.httpStatus,200);
const checks=[];
for(const [name,text] of [['thai_query','การเทียบโอนรายวิชาต้องทำอย่างไร'],['english_query','How do I transfer course credits?']]){
 const started=Date.now();const result=await embedLocalConfigured({input:[text],requestType:'EMBEDDING_QUERY'},provider);
 assert.equal(result.dimensions,384);assert.equal(result.vectors[0].length,384);assert(Math.abs(Math.hypot(...result.vectors[0])-1)<0.001);
 checks.push({name,dimension:384,length:384,normalized:true,latencyMs:Date.now()-started});
}
const passages=await embedLocalConfigured({input:['Reviewed course credit transfer information','ข้อมูลการเทียบโอนรายวิชาที่ผ่านการตรวจแล้ว'],requestType:'EMBEDDING_DOCUMENT'},provider);
assert.equal(passages.vectors.length,2);assert(passages.vectors.every(vector=>vector.length===384&&Math.abs(Math.hypot(...vector)-1)<0.001));
checks.push({name:'passages',dimension:384,length:384,count:2,normalized:true});
const rawPassages=['Reviewed course credit transfer information','ข้อมูลการเทียบโอนรายวิชาที่ผ่านการตรวจแล้ว'];
const counts=await provider.countPassageTokens(rawPassages);
assert.equal(counts.length,rawPassages.length);assert(counts.every(count=>Number.isSafeInteger(count)&&count>0&&count<=512));
checks.push({name:'exact_passage_counts',counts});
const denseThai='สวัสดี '.repeat(300);
assert(Buffer.byteLength(denseThai,'utf8')<=6000);
const [denseCount]=await provider.countPassageTokens([denseThai]);assert(denseCount>512);
await assert.rejects(provider.embedPassages([denseThai]),{code:'EMBEDDING_HTTP_ERROR',httpStatus:422});
checks.push({name:'thai_count_above_limit_embedding_rejected',count:denseCount,httpStatus:422});
const unavailable=createLocalE5EmbeddingProvider({config:{...readLocalEmbeddingConfig(),apiUrl:'http://127.0.0.1:65530'}});
await assert.rejects(unavailable.embedQuery('Controlled availability check'),{message:'EMBEDDING_UNAVAILABLE'});
assert.equal((await unavailable.healthCheck()).healthy,false);
await assert.rejects(unavailable.countPassageTokens(['Controlled availability check']),{message:'EMBEDDING_UNAVAILABLE'});
console.log(JSON.stringify({status:'PASS',health,checks,controlledUnavailable:true,generationCalled:false,documentsImported:false}));
