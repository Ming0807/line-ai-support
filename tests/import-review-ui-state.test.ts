import {expect,it} from 'vitest';
import {changeReviewMode,acknowledgeReviewChunks,restartReviewDraft,reviewPublicationEvidence} from '../app/(dashboard)/knowledge/import/review-state';
import {unfinishedReviewDraft} from './fixtures/import-review';
function completeReviewFixture(){const value=unfinishedReviewDraft();return {...value,metadata:{...value.metadata,storageMode:'RAG' as const},attestations:{...value.attestations,extractionReviewed:true}};}
const hash='a'.repeat(64);
it('clears incompatible evidence on a mode change and never downgrades schema3',()=>{
 const initial=completeReviewFixture();
 const structured=changeReviewMode(initial,'STRUCTURED');expect(structured).toMatchObject({schemaVersion:3,chunkPlan:null,structuredMapping:null,metadata:{storageMode:'STRUCTURED'}});
 const rag=changeReviewMode(structured,'RAG');expect(rag).toMatchObject({schemaVersion:3,chunkPlan:null,structuredMapping:null,metadata:{storageMode:'RAG',datasetType:null}});
 expect(acknowledgeReviewChunks(rag,hash)).toMatchObject({schemaVersion:3,chunkPlan:{digest:hash,chunkerVersion:'located-e5-v1'}});
 expect(acknowledgeReviewChunks(structured,hash)).toMatchObject({schemaVersion:3,chunkPlan:null});
 const both=changeReviewMode(acknowledgeReviewChunks(rag,hash),'BOTH');expect(both).toMatchObject({schemaVersion:3,chunkPlan:null,structuredMapping:null});
});
it('retains the floor while starting a new review, clearing stale acknowledgments and attestations',()=>{
 const saved=changeReviewMode(completeReviewFixture(),'STRUCTURED');const fresh=restartReviewDraft(completeReviewFixture(),saved);
 expect(fresh.schemaVersion).toBe(3);expect(fresh.metadata).toEqual(saved.metadata);expect(fresh.attestations.extractionReviewed).toBe(false);
 expect('structuredMapping' in fresh?fresh.structuredMapping:null).toBeNull();expect('chunkPlan' in fresh?fresh.chunkPlan:null).toBeNull();
});
it('preserves a same-mode draft without discarding reviewed evidence',()=>{
 const saved=completeReviewFixture();expect(changeReviewMode(saved,saved.metadata.storageMode!)).toBe(saved);
});
it('permits schema3 RAG and requires server readiness for structured publication',()=>{
 const rag=acknowledgeReviewChunks(changeReviewMode(changeReviewMode(completeReviewFixture(),'STRUCTURED'),'RAG'),hash);
 expect(reviewPublicationEvidence(rag,false).ready).toBe(true);
 expect(reviewPublicationEvidence(changeReviewMode(rag,'STRUCTURED'),false).ready).toBe(false);
 expect(reviewPublicationEvidence(changeReviewMode(rag,'BOTH'),true).ready).toBe(false);
});
