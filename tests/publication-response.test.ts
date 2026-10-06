import {expect,it} from 'vitest';
import type {ImportPublicationReceipt} from '@/lib/imports/import-publication';
import {isPublicationResult,isReceiptEnvelope} from '@/lib/imports/publication-response';

const jobId='33333333-3333-4333-8333-333333333333';
const receipt:ImportPublicationReceipt={jobId,jobRevision:2,extractionRevision:3,reviewRevision:4,documentId:'44444444-4444-4444-8444-444444444444',familyId:'55555555-5555-4555-8555-555555555555',storageMode:'RAG',action:'ADD_ADDITIONAL',relationship:null,planDigest:'a'.repeat(64),createdAt:'2026-10-06T12:30:00.000Z'};

it('accepts a private receipt envelope and an explicit empty receipt',()=>{
 expect(isReceiptEnvelope({publication:{receipt}},jobId)).toBe(true);
 expect(isReceiptEnvelope({publication:{receipt:null}},jobId)).toBe(true);
});

it('accepts completed and replayed publication results for their job',()=>{
 expect(isPublicationResult({publication:{receipt,replayed:false}},jobId)).toBe(true);
 expect(isPublicationResult({publication:{receipt,replayed:true}},jobId)).toBe(true);
});

it('binds receipts to the route job and enforces strict envelope/result keys',()=>{
 const otherJob='66666666-6666-4666-8666-666666666666';
 expect(isReceiptEnvelope({publication:{receipt}},otherJob)).toBe(false);
 expect(isPublicationResult({publication:{receipt,replayed:false}},otherJob)).toBe(false);
 expect(isReceiptEnvelope({publication:{receipt},extra:true},jobId)).toBe(false);
 expect(isReceiptEnvelope({publication:{receipt,extra:true}},jobId)).toBe(false);
 expect(isReceiptEnvelope({publication:{}},jobId)).toBe(false);
 expect(isPublicationResult({publication:{receipt,replayed:false,extra:true}},jobId)).toBe(false);
 expect(isPublicationResult({publication:{receipt,replayed:'false'}},jobId)).toBe(false);
 expect(isPublicationResult({publication:{receipt}},jobId)).toBe(false);
});

it.each([
 ['uppercase/non-UUID job id',{jobId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'}],
 ['invalid document id',{documentId:'not-a-uuid'}],
 ['invalid family id',{familyId:'66666666-6666-4666-8666-666666666666x'}],
 ['zero job revision',{jobRevision:0}],
 ['fractional extraction revision',{extractionRevision:1.5}],
 ['out-of-range review revision',{reviewRevision:1_000_000_000}],
 ['uppercase digest',{planDigest:'A'.repeat(64)}],
 ['short digest',{planDigest:'a'.repeat(63)}],
 ['invalid timestamp',{createdAt:'yesterday'}],
 ['noncanonical timestamp',{createdAt:'2026-10-06T12:30:00Z'}],
 ['unknown storage mode',{storageMode:'ARCHIVE'}],
 ['unknown action',{action:'PUBLISH'}],
 ['unsupported relationship',{relationship:'SUPERSEDES'}],
 ['CANCELS on a non-additional action',{relationship:'CANCELS',action:'REPLACE_CURRENT'}],
 ['unknown receipt field',{unexpected:'value'}],
] as const)('rejects a receipt with %s',(_name,change)=>{
 const malformed={...receipt,...change};
 expect(isReceiptEnvelope({publication:{receipt:malformed}},jobId)).toBe(false);
 expect(isPublicationResult({publication:{receipt:malformed,replayed:false}},jobId)).toBe(false);
});

it('accepts a well-formed whole-document cancellation receipt',()=>{
 const cancellation={...receipt,relationship:'CANCELS' as const};
 expect(isReceiptEnvelope({publication:{receipt:cancellation}},jobId)).toBe(true);
 expect(isPublicationResult({publication:{receipt:cancellation,replayed:false}},jobId)).toBe(true);
});
