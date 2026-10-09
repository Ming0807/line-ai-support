import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {canonicalDigest} from '../lib/imports/structured-mapping-contract';
import {encryptValue} from '../lib/security/identity';
import {decodeIncidentSupportSource} from '../lib/incidents/context-source';

const key=Buffer.alloc(32,9).toString('base64');
const ids={ticket:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',conversation:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',session:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',department:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
const ticket={id:ids.ticket,conversationId:ids.conversation,sessionId:ids.session,departmentId:ids.department};
const facts=[{field:'PROBLEM',source:'U0',quote:'เข้าใช้ระบบ YRU-Student ไม่ได้'},{field:'SYSTEM',source:'U0',quote:'YRU-Student'},{field:'LOCATION',source:'U0',quote:'อาคาร 2'}];
function source(){return {version:1,context:{sessionId:ids.session,conversationId:ids.conversation,messageId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',revision:4},aiJobId:'ffffffff-ffff-4fff-8fff-ffffffffffff',sourceDigest:'a'.repeat(64),directoryDigest:'b'.repeat(64),minimumSensitivity:'GENERAL',deliveredGuidance:false,
 proposal:{intent:'TROUBLESHOOT',category:'IT_SUPPORT',subcategory:'SYSTEM_ACCESS',needsTicket:false,department:'IT',urgency:'medium',needsKnowledgeSearch:true,needsStructuredSearch:true,needsWebSearch:false,confidence:.95,impact:'SINGLE_USER',sensitivity:'GENERAL',missingContext:null,facts},
 interpreted:{sensitiveLevel:'GENERAL',collectedContext:structuredClone(facts)},departmentId:ids.department,guidanceOutboxId:null};}
function copy(overrides:Record<string,unknown>={}){
 const support=source(),supportJson=JSON.stringify(support);
 const wrapper={version:1,ticketId:ids.ticket,departmentId:ids.department,sensitiveLevel:'GENERAL',support};
 return {input:{ticket_id:ids.ticket,conversation_id:ids.conversation,line_session_id:ids.session,source_digest:support.sourceDigest,state_digest:createHash('sha256').update(supportJson).digest('hex'),context_encrypted:encryptValue(JSON.stringify(wrapper),key)},support,...overrides};
}

it('decodes a strict owned immutable copy into exact claims and copy binding digest',()=>{
 const fixture=copy(),decoded=decodeIncidentSupportSource(ticket,fixture.input,key);
 expect(decoded).toEqual({status:'READY',claims:{system:'YRU-Student',location:'อาคาร 2'},sourceDigest:'a'.repeat(64),stateDigest:fixture.input.state_digest,
  bindingDigest:canonicalDigest('incident-support-copy-v1',fixture.input)});
});
it('returns NO_COPY for an absent copy and remains compatible with old no-system facts',()=>{
 expect(decodeIncidentSupportSource(ticket,null,key)).toEqual({status:'NO_COPY',claims:{system:null,location:null},bindingDigest:null});
 const old=copy();old.support.proposal.facts=old.support.proposal.facts.filter((fact:{field:string})=>fact.field!=='SYSTEM');old.support.interpreted.collectedContext=old.support.interpreted.collectedContext.filter((fact:{field:string})=>fact.field!=='SYSTEM');
 old.input.state_digest=createHash('sha256').update(JSON.stringify(old.support)).digest('hex');old.input.context_encrypted=encryptValue(JSON.stringify({version:1,ticketId:ids.ticket,departmentId:ids.department,sensitiveLevel:'GENERAL',support:old.support}),key);
 expect(decodeIncidentSupportSource(ticket,old.input,key)).toMatchObject({status:'READY',claims:{system:null,location:'อาคาร 2'}});
 const noClaim=copy();noClaim.support.proposal.facts=noClaim.support.proposal.facts.filter((fact:{field:string})=>!['SYSTEM','LOCATION'].includes(fact.field));noClaim.support.interpreted.collectedContext=noClaim.support.interpreted.collectedContext.filter((fact:{field:string})=>!['SYSTEM','LOCATION'].includes(fact.field));
 noClaim.input.state_digest=createHash('sha256').update(JSON.stringify(noClaim.support)).digest('hex');noClaim.input.context_encrypted=encryptValue(JSON.stringify({version:1,ticketId:ids.ticket,departmentId:ids.department,sensitiveLevel:'GENERAL',support:noClaim.support}),key);
 expect(decodeIncidentSupportSource(ticket,noClaim.input,key)).toMatchObject({status:'READY',claims:{system:null,location:null}});
});
it('fails closed on absent key, corrupt ciphertext, invalid JSON and malformed input bounds',()=>{
 const fixture=copy();expect(decodeIncidentSupportSource(ticket,fixture.input)).toEqual({status:'UNAVAILABLE'});
 expect(decodeIncidentSupportSource(ticket,{...fixture.input,context_encrypted:'v1.bad'},key)).toEqual({status:'UNAVAILABLE'});
 expect(decodeIncidentSupportSource(ticket,{...fixture.input,context_encrypted:encryptValue('{',key)},key)).toEqual({status:'UNAVAILABLE'});
 expect(decodeIncidentSupportSource({...ticket,extra:'x'},fixture.input,key)).toEqual({status:'UNAVAILABLE'});
 expect(decodeIncidentSupportSource(ticket,{...fixture.input,context_encrypted:'x'.repeat(300_000)},key)).toEqual({status:'UNAVAILABLE'});
});
it('rejects cross-owner, department, source-digest, and raw-state-hash mismatches',()=>{
 const fixture=copy();
 expect(decodeIncidentSupportSource({...ticket,id:'99999999-9999-4999-8999-999999999999'},fixture.input,key)).toEqual({status:'UNAVAILABLE'});
 expect(decodeIncidentSupportSource({...ticket,departmentId:'99999999-9999-4999-8999-999999999999'},fixture.input,key)).toEqual({status:'UNAVAILABLE'});
 for(const field of ['ticket_id','conversation_id','line_session_id','source_digest','state_digest'] as const){const changed={...fixture.input,[field]:field==='source_digest'?'c'.repeat(64):field==='state_digest'?'d'.repeat(64):'99999999-9999-4999-8999-999999999999'};expect(decodeIncidentSupportSource(ticket,changed,key)).toEqual({status:'UNAVAILABLE'});}
 const sensitivity=copy();sensitivity.input.context_encrypted=encryptValue(JSON.stringify({version:1,ticketId:ids.ticket,departmentId:ids.department,sensitiveLevel:'RESTRICTED',support:sensitivity.support}),key);
 expect(decodeIncidentSupportSource(ticket,sensitivity.input,key)).toEqual({status:'UNAVAILABLE'});
});
it('hashes the raw support JSON before parsing and checks proposal facts exactly',()=>{
 const fixture=copy(),reordered=JSON.stringify(Object.fromEntries(Object.entries(fixture.support).reverse()));
 const reorderedCopy={...fixture.input,state_digest:createHash('sha256').update(reordered).digest('hex'),context_encrypted:encryptValue(JSON.stringify({version:1,ticketId:ids.ticket,departmentId:ids.department,sensitiveLevel:'GENERAL',support:JSON.parse(reordered)}),key)};
 expect(decodeIncidentSupportSource(ticket,reorderedCopy,key)).toMatchObject({status:'READY'});
 const mismatch=copy();mismatch.support.interpreted.collectedContext[1].quote='different';mismatch.input.state_digest=createHash('sha256').update(JSON.stringify(mismatch.support)).digest('hex');mismatch.input.context_encrypted=encryptValue(JSON.stringify({version:1,ticketId:ids.ticket,departmentId:ids.department,sensitiveLevel:'GENERAL',support:mismatch.support}),key);
 expect(decodeIncidentSupportSource(ticket,mismatch.input,key)).toEqual({status:'UNAVAILABLE'});
});
it('rejects duplicate facts and getter/proxy inputs without reading them',()=>{
 const duplicate=copy();duplicate.support.interpreted.collectedContext.push({...duplicate.support.interpreted.collectedContext[1]});duplicate.input.state_digest=createHash('sha256').update(JSON.stringify(duplicate.support)).digest('hex');duplicate.input.context_encrypted=encryptValue(JSON.stringify({version:1,ticketId:ids.ticket,departmentId:ids.department,sensitiveLevel:'GENERAL',support:duplicate.support}),key);
 expect(decodeIncidentSupportSource(ticket,duplicate.input,key)).toEqual({status:'UNAVAILABLE'});
 const duplicateBoth=copy();duplicateBoth.support.proposal.facts.push({...duplicateBoth.support.proposal.facts[1]});duplicateBoth.support.interpreted.collectedContext.push({...duplicateBoth.support.interpreted.collectedContext[1]});
 duplicateBoth.input.state_digest=createHash('sha256').update(JSON.stringify(duplicateBoth.support)).digest('hex');duplicateBoth.input.context_encrypted=encryptValue(JSON.stringify({version:1,ticketId:ids.ticket,departmentId:ids.department,sensitiveLevel:'GENERAL',support:duplicateBoth.support}),key);
 expect(decodeIncidentSupportSource(ticket,duplicateBoth.input,key)).toEqual({status:'UNAVAILABLE'});
 const overLimit=copy();Object.assign(overLimit.support.interpreted,{padding:'x'.repeat(100_001)});overLimit.input.state_digest=createHash('sha256').update(JSON.stringify(overLimit.support)).digest('hex');overLimit.input.context_encrypted=encryptValue(JSON.stringify({version:1,ticketId:ids.ticket,departmentId:ids.department,sensitiveLevel:'GENERAL',support:overLimit.support}),key);
 expect(overLimit.input.context_encrypted.length).toBeGreaterThan(100_000);expect(decodeIncidentSupportSource(ticket,overLimit.input,key)).toEqual({status:'UNAVAILABLE'});
 let reads=0;const proxy=new Proxy(ticket,{get(target,property,receiver){reads++;return Reflect.get(target,property,receiver);}});
 expect(decodeIncidentSupportSource(proxy,copy().input,key)).toEqual({status:'UNAVAILABLE'});expect(reads).toBe(0);
 const copyProxy=new Proxy(copy().input,{get(target,property,receiver){reads++;return Reflect.get(target,property,receiver);}});
 expect(decodeIncidentSupportSource(ticket,copyProxy,key)).toEqual({status:'UNAVAILABLE'});expect(reads).toBe(0);
});
