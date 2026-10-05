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
const unavailable=createLocalE5EmbeddingProvider({config:{...readLocalEmbeddingConfig(),apiUrl:'http://127.0.0.1:65530'}});
await assert.rejects(unavailable.embedQuery('Controlled availability check'),{message:'EMBEDDING_UNAVAILABLE'});
assert.equal((await unavailable.healthCheck()).healthy,false);
console.log(JSON.stringify({status:'PASS',health,checks,controlledUnavailable:true,generationCalled:false,documentsImported:false}));
