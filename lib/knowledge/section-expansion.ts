import type {PoolClient} from 'pg';
import type {KnowledgeEvidence,KnowledgeScope} from './types';
import {searchKnowledge} from './retrieval';
import {LOCAL_EMBEDDING_FINGERPRINT} from './embedding-space';

/** Matches the citation evidence cap used by the answer producers. */
export const SECTION_EXPANSION_LIMIT = 12;
/** Total evidence content budget, so an expanded packet still fits the answer prompt. */
export const SECTION_EXPANSION_MAX_CHARS = 12_000;

export interface SectionChunkRow {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  page_number: number | null;
  section_title: string;
  content: string;
  source_locations: KnowledgeEvidence['sourceLocations'] | null;
  eligible: boolean;
  similarity: number | null;
}

export interface SectionExpansionInput {
  vector: number[];
  fingerprint: string;
  limit?: number;
  maxChars?: number;
}

export interface SectionExpansionResult {
  evidence: KnowledgeEvidence[];
  /** Sections that had more steps than could be added; the answer must say the procedure may be incomplete. */
  incompleteSections: number;
}

interface Seed {
  documentId: string;
  documentRevision: number;
  sectionTitle: string;
  /** The selected evidence item whose metadata and rule proof the added chunks share. */
  source: KnowledgeEvidence;
}

function seedKey(documentId: string, revision: number, title: string): string {
  return JSON.stringify([documentId, revision, title]);
}

/** Distinct (document revision, section) pairs, in the relevance order of the selected evidence. */
function collectSeeds(evidence: KnowledgeEvidence[]): Seed[] {
  const seeds = new Map<string, Seed>();
  for (const item of evidence) {
    if (item.sectionTitle === null) continue;
    const key = seedKey(item.documentId, item.documentRevision, item.sectionTitle);
    if (!seeds.has(key)) {
      seeds.set(key, {
        documentId: item.documentId,
        documentRevision: item.documentRevision,
        sectionTitle: item.sectionTitle,
        source: item,
      });
    }
  }
  return [...seeds.values()];
}

/**
 * The maximal run of consecutive chunk indexes with this heading that contains a selected chunk.
 * A different heading between two runs means a different section, even when the title repeats.
 */
function runsContainingSelected(rows: SectionChunkRow[], selected: Set<string>): SectionChunkRow[][] {
  const sorted = [...rows].sort((a, b) => a.chunk_index - b.chunk_index);
  const runs: SectionChunkRow[][] = [];
  let current: SectionChunkRow[] = [];
  for (const row of sorted) {
    const previous = current.at(-1);
    if (previous && row.chunk_index !== previous.chunk_index + 1) {
      runs.push(current);
      current = [];
    }
    current.push(row);
  }
  if (current.length > 0) runs.push(current);
  return runs.filter(run => run.some(row => selected.has(row.chunk_id)));
}

function toEvidence(row: SectionChunkRow, source: KnowledgeEvidence): KnowledgeEvidence {
  const item: KnowledgeEvidence = {
    chunkId: row.chunk_id,
    documentId: source.documentId,
    documentRevision: source.documentRevision,
    title: source.title,
    familyCode: source.familyCode,
    academicYear: source.academicYear,
    authorityLevel: source.authorityLevel,
    pageNumber: row.page_number,
    sectionTitle: row.section_title,
    content: row.content,
    sourceUrl: source.sourceUrl,
    similarity: row.similarity ?? 0,
  };
  if (Array.isArray(row.source_locations)) item.sourceLocations = row.source_locations;
  // Same document revision means the same rule group, so the selection proof still applies.
  if (source.ruleProof) item.ruleProof = structuredClone(source.ruleProof);
  return item;
}

/**
 * Adds the remaining chunks of each already selected document section, in document order.
 *
 * Runs inside the caller's transaction, right after the eligible evidence was selected there.
 * Only chunks of the same document revision, the same contiguous section and the same
 * eligibility filters as retrieval (reviewed, same embedding space) are added. A section is
 * added completely or not at all; a skipped section is counted in `incompleteSections`.
 */
export async function expandSameSection(
  client: PoolClient,
  evidence: KnowledgeEvidence[],
  input: SectionExpansionInput,
): Promise<SectionExpansionResult> {
  const seeds = collectSeeds(evidence);
  if (seeds.length === 0) return {evidence, incompleteSections: 0};

  const limit = input.limit ?? SECTION_EXPANSION_LIMIT;
  const maxChars = input.maxChars ?? SECTION_EXPANSION_MAX_CHARS;
  const localE5 = input.fingerprint === LOCAL_EMBEDDING_FINGERPRINT;
  // Fixed source-owned identifiers only; never a caller-provided column or SQL fragment.
  const column = localE5 ? 'embedding_e5' : 'embedding';
  const vectorType = localE5 ? 'extensions.vector(384)' : 'extensions.vector';
  const eligible = `(not c.requires_review and c.${column} is not null and c.embedding_fingerprint=$4 and c.embedding_dimensions=$5)`;

  // pg honours query_timeout at runtime; its QueryConfig type omits it, as in retrieval.ts.
  const config = {
    text: `select c.id chunk_id,c.document_id,c.chunk_index,c.page_number,c.section_title,c.content,c.source_locations,
  ${eligible} eligible,
  case when ${eligible} then 1-(c.${column} operator(extensions.<=>) $6::${vectorType}) end similarity
 from unnest($1::uuid[],$2::int[],$3::text[]) seed(document_id,revision,section_title)
 join public.documents d on d.id=seed.document_id and d.revision=seed.revision
 join public.knowledge_chunks c on c.document_id=d.id and c.section_title=seed.section_title
 order by c.document_id,c.chunk_index limit 400`,
    values: [
      seeds.map(seed => seed.documentId),
      seeds.map(seed => seed.documentRevision),
      seeds.map(seed => seed.sectionTitle),
      input.fingerprint,
      input.vector.length,
      JSON.stringify(input.vector),
    ],
    query_timeout: 5000,
  };
  const result = await client.query<SectionChunkRow>(config);

  const present = new Set(evidence.map(item => item.chunkId));
  let count = evidence.length;
  let chars = evidence.reduce((sum, item) => sum + item.content.length, 0);
  let incompleteSections = 0;
  const added: KnowledgeEvidence[] = [];

  for (const seed of seeds) {
    const rows = result.rows.filter(row => row.document_id === seed.documentId && row.section_title === seed.sectionTitle);
    for (const run of runsContainingSelected(rows, present)) {
      const missing = run.filter(row => !present.has(row.chunk_id));
      if (missing.length === 0) continue;
      const missingChars = missing.reduce((sum, row) => sum + row.content.length, 0);
      if (run.some(row => !row.eligible) || count + missing.length > limit || chars + missingChars > maxChars) {
        incompleteSections += 1;
        continue;
      }
      for (const row of missing) {
        added.push(toEvidence(row, seed.source));
        present.add(row.chunk_id);
      }
      count += missing.length;
      chars += missingChars;
    }
  }
  return {evidence: [...evidence, ...added], incompleteSections};
}

/**
 * Re-reads the evidence of a saved ANSWER exactly the way it was first selected, for the
 * finalization and delivery fences. Without `sectionExpanded` this is the plain search.
 */
export async function freshAnswerEvidence(
  client: PoolClient,
  result: {scope: KnowledgeScope; queryVector: number[]; fingerprint: string; sectionExpanded?: true},
): Promise<KnowledgeEvidence[]> {
  const fresh = await searchKnowledge(client, {scope: result.scope, vector: result.queryVector, fingerprint: result.fingerprint, limit: 12});
  if (result.sectionExpanded !== true) return fresh;
  return (await expandSameSection(client, fresh, {vector: result.queryVector, fingerprint: result.fingerprint})).evidence;
}
