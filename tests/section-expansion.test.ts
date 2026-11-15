import {describe, expect, it} from 'vitest';
import type {PoolClient} from 'pg';
import {expandSameSection, type SectionChunkRow} from '../lib/knowledge/section-expansion';
import type {KnowledgeEvidence} from '../lib/knowledge/types';

const DOC_A = '00000000-0000-4000-8000-00000000000a';
const DOC_B = '00000000-0000-4000-8000-00000000000b';
const chunkId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const vector = [0.1, 0.2, 0.3];
const fingerprint = 'a'.repeat(64);

function hit(id: number, documentId: string, sectionTitle: string | null, content = `chunk ${id}`): KnowledgeEvidence {
  return {
    chunkId: chunkId(id),
    documentId,
    documentRevision: 3,
    title: `Guide ${documentId.slice(-1)}`,
    familyCode: 'IT_GUIDE',
    academicYear: null,
    authorityLevel: 50,
    pageNumber: null,
    sectionTitle,
    content,
    sourceUrl: 'https://www.yru.ac.th/guide',
    similarity: 0.9,
    ruleProof: {proof: documentId} as unknown as KnowledgeEvidence['ruleProof'],
  };
}

function row(id: number, documentId: string, chunkIndex: number, sectionTitle: string, eligible = true, content = `chunk ${id}`): SectionChunkRow {
  return {
    chunk_id: chunkId(id),
    document_id: documentId,
    chunk_index: chunkIndex,
    page_number: null,
    section_title: sectionTitle,
    content,
    source_locations: null,
    eligible,
    similarity: 0.5,
  };
}

/** Records the SQL call and returns the supplied rows, like a caller-owned transaction client. */
function fakeClient(rows: SectionChunkRow[]) {
  const calls: {text: string; values: unknown[]}[] = [];
  const client = {
    query: async (config: {text: string; values: unknown[]}) => {
      calls.push({text: config.text, values: config.values});
      return {rows};
    },
  } as unknown as PoolClient;
  return {client, calls};
}

describe('expandSameSection', () => {
  it('adds the remaining steps of the matched section in document order', async () => {
    const evidence = [hit(2, DOC_A, 'Wi-Fi setup')];
    const {client} = fakeClient([
      row(1, DOC_A, 0, 'Wi-Fi setup'),
      row(2, DOC_A, 1, 'Wi-Fi setup'),
      row(3, DOC_A, 2, 'Wi-Fi setup'),
      row(4, DOC_A, 3, 'Printing'),
    ]);
    const result = await expandSameSection(client, evidence, {vector, fingerprint});
    expect(result.incompleteSections).toBe(0);
    expect(result.evidence.map(item => item.chunkId)).toEqual([chunkId(2), chunkId(1), chunkId(3)]);
    const added = result.evidence[1];
    expect(added).toMatchObject({documentId: DOC_A, documentRevision: 3, title: 'Guide a', sectionTitle: 'Wi-Fi setup', similarity: 0.5});
    expect(added.ruleProof).toEqual(evidence[0].ruleProof);
  });

  it('does not join a later section that only repeats the same heading', async () => {
    const {client} = fakeClient([
      row(1, DOC_A, 0, 'Steps'),
      row(2, DOC_A, 1, 'Steps'),
      row(3, DOC_A, 2, 'Other'),
      row(4, DOC_A, 3, 'Steps'),
    ]);
    const result = await expandSameSection(client, [hit(1, DOC_A, 'Steps')], {vector, fingerprint});
    expect(result.evidence.map(item => item.chunkId)).toEqual([chunkId(1), chunkId(2)]);
  });

  it('leaves a section unexpanded and reports it when a chunk in the run is not eligible', async () => {
    const {client} = fakeClient([
      row(1, DOC_A, 0, 'Steps'),
      row(2, DOC_A, 1, 'Steps', false),
      row(3, DOC_A, 2, 'Steps'),
    ]);
    const result = await expandSameSection(client, [hit(1, DOC_A, 'Steps')], {vector, fingerprint});
    expect(result.evidence.map(item => item.chunkId)).toEqual([chunkId(1)]);
    expect(result.incompleteSections).toBe(1);
  });

  it('adds a whole section or nothing when the chunk budget would be exceeded', async () => {
    const {client} = fakeClient([
      row(1, DOC_A, 0, 'Steps'),
      row(2, DOC_A, 1, 'Steps'),
      row(3, DOC_A, 2, 'Steps'),
    ]);
    const result = await expandSameSection(client, [hit(1, DOC_A, 'Steps')], {vector, fingerprint, limit: 2});
    expect(result.evidence.map(item => item.chunkId)).toEqual([chunkId(1)]);
    expect(result.incompleteSections).toBe(1);
  });

  it('respects the character budget across all evidence', async () => {
    const {client} = fakeClient([
      row(1, DOC_A, 0, 'Steps', true, 'x'.repeat(40)),
      row(2, DOC_A, 1, 'Steps', true, 'y'.repeat(40)),
    ]);
    const result = await expandSameSection(client, [hit(1, DOC_A, 'Steps', 'x'.repeat(40))], {vector, fingerprint, maxChars: 60});
    expect(result.evidence).toHaveLength(1);
    expect(result.incompleteSections).toBe(1);
  });

  it('never borrows chunks from another document and keeps each document metadata', async () => {
    const {client} = fakeClient([
      row(1, DOC_A, 0, 'Steps'),
      row(2, DOC_A, 1, 'Steps'),
      row(5, DOC_B, 0, 'Steps'),
      row(6, DOC_B, 1, 'Steps'),
    ]);
    const result = await expandSameSection(client, [hit(1, DOC_A, 'Steps'), hit(6, DOC_B, 'Steps')], {vector, fingerprint});
    const byId = new Map(result.evidence.map(item => [item.chunkId, item]));
    expect(byId.get(chunkId(2))?.title).toBe('Guide a');
    expect(byId.get(chunkId(5))?.title).toBe('Guide b');
    expect(result.evidence).toHaveLength(4);
  });

  it('skips the database entirely when no evidence has a section title', async () => {
    const {client, calls} = fakeClient([]);
    const evidence = [hit(1, DOC_A, null)];
    const result = await expandSameSection(client, evidence, {vector, fingerprint});
    expect(calls).toHaveLength(0);
    expect(result).toEqual({evidence, incompleteSections: 0});
  });

  it('binds the query to the selected document revisions and the eligibility filters', async () => {
    const {client, calls} = fakeClient([row(1, DOC_A, 0, 'Steps')]);
    await expandSameSection(client, [hit(1, DOC_A, 'Steps')], {vector, fingerprint});
    expect(calls).toHaveLength(1);
    const sql = calls[0].text;
    expect(sql).toContain('d.revision=seed.revision');
    expect(sql).toContain('not c.requires_review');
    expect(sql).toContain('c.embedding_fingerprint=$4');
    expect(calls[0].values.slice(0, 3)).toEqual([[DOC_A], [3], ['Steps']]);
  });
});
