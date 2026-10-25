import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {publishOwnedAssistantSources} from '../../scripts/qa/assistant-owned-publication';
import {LOCAL_EMBEDDING_FINGERPRINT,LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION} from '../../lib/knowledge/embedding-space';
const database=process.env.YRU_STRUCTURED_SCHEMA_DATABASE;
assert(database&&/^yru_structured_schema_[a-f0-9]{12}$/u.test(database),'OWNED_DATABASE_REQUIRED');
const pool=new Pool({host:'127.0.0.1',port:54422,database,user:'postgres',password:'postgres',max:4});after(()=>pool.end());
const key=randomBytes(32).toString('base64');
const vector=[1,...Array(383).fill(0)];
const embeddingProvider={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,
 countPassageTokens:async(texts:string[])=>texts.map(()=>42),embedPassages:async(texts:string[])=>texts.map(()=>vector),embedQuery:async()=>vector,
 healthCheck:async()=>({healthy:true,model:LOCAL_EMBEDDING_MODEL,dimension:384,mode:'Local' as const,observedAt:new Date().toISOString(),httpStatus:200})};
test('official A10/A11 evaluation sources publish exact rows through one-case review calls only in disposable DB',async()=>{
 const actor=randomUUID();await pool.query('insert into auth.users(id) values($1)',[actor]);
 await pool.query("insert into public.staff_profiles(id,role,display_name,active) values($1,'SUPER_ADMIN','Synthetic evaluation publication',true)",[actor]);
 const frozenText=await readFile('tests/fixtures/assistant-conversations.json','utf8');
 const companion=JSON.parse(await readFile('tests/fixtures/assistant-conversation-context.json','utf8'));
 const input={pool,key,actor,database:database!,caseIds:['A10'],companion,frozenText};
 await assert.rejects(publishOwnedAssistantSources({...input,database:'postgres'}),/OWNED_PUBLICATION_DATABASE_REQUIRED/);
 await assert.rejects(publishOwnedAssistantSources({...input,database:'yru_structured_schema_000000000000'}),/OWNED_PUBLICATION_CONNECTION_REQUIRED/);
 await assert.rejects(publishOwnedAssistantSources({...input,caseIds:['A19']}),/OWNED_PUBLICATION_CASES_INVALID/);
 await assert.rejects(publishOwnedAssistantSources({...input,caseIds:['A10','A11']}),/OWNED_PUBLICATION_CASE_ISOLATION_REQUIRED/);
 const results=[await publishOwnedAssistantSources(input),await publishOwnedAssistantSources({...input,caseIds:['A11']})];
 assert.deepEqual(results.map(result=>result.contexts.map(row=>row.scenarioId)),[['A10'],['A11']]);
 const receipts=results.flatMap(result=>result.receipts);assert.equal(receipts.length,3);
 for(const item of receipts){
  const proof=(await pool.query('select count(*)::int n from private.structured_row_provenance where job_id=$1',[item.receipt.jobId])).rows[0];assert.equal(proof.n,1);
  const doc=(await pool.query('select approval_status,visibility,official_source from public.documents where id=$1',[item.receipt.documentId])).rows[0];
  assert.deepEqual(doc,{approval_status:'APPROVED',visibility:'PUBLIC',official_source:true});
 }
 assert.equal((await pool.query('select count(*)::int n from public.knowledge_chunks where document_id=any($1::uuid[])',[receipts.map(item=>item.receipt.documentId)])).rows[0].n,0);
});

test('A14/A15 RAG fixtures require isolated normal reviewed publication calls and retain current-source witnesses',async()=>{
 const actor=randomUUID();await pool.query('insert into auth.users(id) values($1)',[actor]);
 await pool.query("insert into public.staff_profiles(id,role,display_name,active) values($1,'SUPER_ADMIN','Synthetic RAG evaluation publication',true)",[actor]);
 const frozenText=await readFile('tests/fixtures/assistant-conversations.json','utf8');
 const companion=JSON.parse(await readFile('tests/fixtures/assistant-conversation-context.json','utf8'));
 const input={pool,key,actor,database:database!,caseIds:['A14'],companion,frozenText,embeddingProvider};
 await assert.rejects(publishOwnedAssistantSources({...input,embeddingProvider:undefined}),/OWNED_RAG_EMBEDDING_PROVIDER_REQUIRED/);
 await assert.rejects(publishOwnedAssistantSources({...input,caseIds:['A14','A15']}),/OWNED_PUBLICATION_CASE_ISOLATION_REQUIRED/);
 const results=[await publishOwnedAssistantSources(input),await publishOwnedAssistantSources({...input,caseIds:['A15']})];
 assert.deepEqual(results.map(result=>result.contexts.map(row=>row.scenarioId)),[['A14'],['A15']]);
 assert.deepEqual(results.flatMap(result=>result.receipts.map(item=>item.sourceId)),['a14-announcement','a15-system-guide']);
 assert.deepEqual(results.flatMap(result=>result.sourceEvidence.map(item=>item.caseId)),['A14','A15']);
 for(const evidence of results.flatMap(result=>result.sourceEvidence)){
  assert.equal(evidence.review.allWarningsResolved,true);
  assert(Object.values(evidence.review.attestations).every(Boolean));
  assert.deepEqual(evidence.document,{status:'ACTIVE',isCurrent:true,approvalStatus:'APPROVED',visibility:'PUBLIC',officialSource:true,
   effectiveToday:true,sourceUrl:evidence.sourceUrl,checksum:evidence.sourceChecksum,authorityLevel:90});
  assert(evidence.chunks.count>0&&evidence.chunks.normalized&&evidence.chunks.reviewClear&&evidence.chunks.allLocatedToSource&&evidence.chunks.fixtureTextWitness);
 }
});
