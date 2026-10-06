# IMP-03B-2 / Task4C — located, token-bounded chunk contract audit

Date: 6 October 2026
Status: read-only contract proposal for root decision; no implementation or acceptance claim.
Owner: `/root/imp_chunk_contract_audit` (scoped audit agent).

## Scope and authority

This audit covers the next Task4 publication prerequisite: creating E5 passage chunks that fit the actual tokenizer limit and preserving the five-format `SourceLocation` values from extraction through persisted chunks, retrieval, citations, and delivery. It does not authorize or implement publication, a migration, a UI phase, corpus indexing, or a change to the current IMP-03B-1 version-resolution work.

Read: `AGENTS.md`; `docs/PROJECT_INDEX.md`; `docs/tasks/V1_TASK_BOARD.md`; `docs/decisions/DECISION_LOG.md`; master guide §§35–40, 43 and 50; `docs/requirements/sources/README.md`; the original overview and versioning sources; matrix rows CH009/010/035–040/043/045/049/050/061, USR-IMPORT5, USR-AMENDS and USR-EMB-LOCAL; `docs/architecture/YRU_V1_DESIGN.md`; `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md`; Task4 in `docs/superpowers/plans/2026-10-04-yru-knowledge-import.md`; the 5 October E5 source/design; the extraction and E5 component reports; and the implementation files cited below. The pending publication proposal was read only as historical evidence; current human instructions, design, decisions, and Task4 control.

No tests, typecheck, lint, build, database replay, service, model, or network inference were run. Inspection was against the shared working tree on 6 October; no Git/source hash was read. The only intended file write for this task is this report.

## Findings from the current source

1. **The chunker has a character cap, not an E5 token cap.** [`chunkPages`](../../../lib/knowledge/chunking.ts) defaults to 1,800 Unicode code points, uses grapheme-safe splits and paragraph overlap, and keeps Markdown table rows together where possible. It does not count E5 tokens or UTF-8 bytes. In contrast, [`services/embedding/app.py`](../../../services/embedding/app.py) adds the query/passage prefix and rejects an input with more than 512 tokens; it never truncates. The Next client also rejects a text over 6,000 UTF-8 bytes. Therefore today’s preparation can fail with a controlled 422/invalid-input error after chunking; it cannot promise that every chunk is embeddable. Thai text length is not a bound on this tokenizer’s token count.

2. **The chunk helper does not receive the located extraction.** `SourceLocation` is a strict five-variant import type in [`lib/imports/types.ts`](../../../lib/imports/types.ts), and `LocatedExtraction` keeps locations in parallel arrays for `pages` and `tables`. [`lib/knowledge/types.ts`](../../../lib/knowledge/types.ts) defines only `pageNumber` and `sectionTitle` on `ChunkDraft`. [`prepareEmbeddedKnowledgeChunks`](../../../lib/knowledge/embedding-preparation.ts) accepts only `ExtractedPage[]`, runs `chunkPages`, and returns vectors with those compatibility fields. It has no `SourceLocation` field or table input. The current source search found no production publication caller; its only caller is the preparation test. The E5 component’s “location-preserving” evidence therefore covers the existing page/section view, not all five import location types.

3. **Table cells can be absent from RAG chunk preparation.** Import extraction stores tables separately from page text. CSV emits an empty page and a separate table; XLSX emits an empty page per sheet and separate tables; PDF also returns separate page text and detected tables. Passing only `extraction.pages` to preparation omits those table values, including data needed for RAG. The 5 October shortlist explicitly includes PDF documents intended as “RAG + Table”/“Table + RAG”; structured M8 publication remains a separate dependency.

4. **Locations stop at private preview.** The existing RAG schema stores `page_number` and `section_title`, not discriminated source locations. [`retrieval.ts`](../../../lib/knowledge/retrieval.ts) selects only those compatibility fields, and [`citationEvidenceSchema` / `buildCitedAnswer`](../../../lib/knowledge/citations.ts) accept and render only page, section, and document URL. `evidenceStillMatches` does not compare a format-specific location. The import design already requires an additive persisted chunk location and citation/delivery equality before format provenance can be accepted.

5. **The current review gate is not sufficient evidence for publication.** Preparation rejects raw `page.requiresReview` and chunk booleans, but it receives neither the current saved review receipt nor parser/analysis warnings. Conversely, analysis warnings can exist without a page boolean; analysis represents `SENSITIVE_DATA_REVIEW_REQUIRED` as a document-level flag with `location: null`. The chunker can mark an overlong table row `requiresReview=true`, but the review-warning receipt has no stable chunk-plan warning key or location for that new condition. Root’s publication service must derive eligibility from the exact current extraction/review revisions and server warning evidence; a boolean on a page/chunk cannot authorize publication.

These are publication-prerequisite gaps, not a failure of the accepted EMB-01…05 component checkpoint and not evidence that publication or all-format provenance has passed. The current authorities still require local E5 CPU/384, raw caller text with one server-added prefix, normalized vectors, exact model/revision/fingerprint, no silent truncation, and all embedding work outside SQL. Master §50’s older in-transaction embedding sequence is superseded by the later human E5 choice, `AGENTS.md`, the E5 design, and the current Task4 plan.

## Proposed Task4C contract to freeze before implementation

### 1. Build a review-bound located chunk plan before vectors

Do not let the browser submit extraction pages, source locations, token counts, chunk text, or vectors as publication facts. The server loads the authorized READY job, exact immutable extraction revision and saved review receipt; validates the located extraction against the staged source/format; and constructs chunks from that committed snapshot outside SQL. The eventual approval transaction still reauthorizes and compares the exact job, extraction, review and target/family revisions before writing.

Use a distinct no-vector plan DTO, then add vectors only after its token counts and review gates pass:

```ts
interface LocatedChunkDraft extends ChunkDraft {
  sourceLocations: SourceLocation[];
  passageTokenCount: number; // includes `passage: ` and special tokens
}

interface LocatedChunkPlan {
  schemaVersion: 1;
  chunkerVersion: string;
  model: 'intfloat/multilingual-e5-small';
  modelRevision: '614241f622f53c4eeff9890bdc4f31cfecc418b3';
  fingerprint: string;
  chunks: LocatedChunkDraft[];
  digest: string; // canonical server hash over identity, ordered content hashes, locations and warnings
}

interface EmbeddedLocatedChunkDraft extends LocatedChunkDraft {
  embedding: number[];
  embeddingDimensions: 384;
  embeddingFingerprint: string;
}
```

`ChunkDraft.pageNumber` and `sectionTitle` remain compatibility views derived from the locations, parser-provided `sectionTitle`/heading path, and current heading context. They must never be used to fabricate pagination for DOCX, XLSX, CSV or HTML. Chunk locations are strict, nonempty, source-format-consistent arrays copied from validated parser locations, in stable source order with duplicate entries removed. Any configured maximum for locations per chunk is a root-owned bounded-resource policy; exceeding it must split at a source-unit boundary or fail closed, never truncate provenance. These locations promise the parser’s current source-unit granularity, not character-accurate page geometry: for example, the PDF parser currently records a page-wide block range of `1..1`.

The plan digest should bind the source job/extraction revision, fixed E5 tokenizer identity, chunker version, ordered chunk text hashes, source locations, and chunk-plan warnings. Preview should show the actual token-bounded chunks and locations. For reliable approval, version the encrypted review payload and require a reviewed chunk-plan digest (and explicit chunk-plan review when the plan produces warnings); an existing v1 review receipt without that digest is history, not consent to an unshown chunk plan. Approval recomputes the plan outside SQL and requires the same digest. The client may echo a digest as an expectation, but the server recomputes it and never accepts client-supplied chunk contents or locations.

### 2. Count with the loaded tokenizer, not an estimate

Add a private, bounded FastAPI count-only batch operation using the tokenizer already loaded with the exact cached E5 snapshot. No new model, npm tokenizer, download, registry/provider UI, or duplicate cache is needed. A suitable strict contract is:

```json
POST /tokens/count
{"texts":["raw passage"],"type":"passage"}

{"model":"intfloat/multilingual-e5-small",
 "revision":"614241f622f53c4eeff9890bdc4f31cfecc418b3",
 "dimension":384,
 "tokenCounts":[123]}
```

Require 1–16 nonempty raw texts, at most 6,000 UTF-8 bytes per text, fixed `query|passage` type, the existing service authentication, private no-store behavior, and fixed errors. As `encode()` does now, the service adds exactly one prefix and counts `model.tokenizer(prefixed, truncation=False, add_special_tokens=True)`; this makes the count include the prefix and model special tokens that the embedding path uses. Return only counts and fixed model identity, never input text. Count requests should use a non-queuing bounded path and controlled busy response, and share the request/deadline/cancellation protections of the embedding service.

Keep token counting as an internal E5-preparation capability, not an admin/provider setting. Either expose it on the fixed `LocalE5EmbeddingProvider` or pass a separately typed E5 `PassageTokenCounter` into preparation; do not make unrelated embedding adapters/UI responsible for E5 tokenizer semantics. Validate count-response model, revision, dimension, count-array length and integer range against the same fixed identity as vectors. In production, require the exact fixed model/revision/fingerprint, not only `dimension === 384`.

Chunking keeps the existing semantic order (heading/section, paragraph, table boundary) and grapheme-safe fallback. First form bounded candidates, then count exact prefixed inputs and split only oversized candidates at safe semantic boundaries, falling back to grapheme boundaries. Recount every final chunk **after overlap**. Accept only counts `1..512` and raw payloads within the 6,000-byte service/client limit; never rely on 1,800 characters or a guessed Thai-token ratio. A single unsplittable unit or a result over the existing 2,000-chunk limit returns a fixed failure with no partial publication. Never truncate.

The total preparation deadline (currently at most 45 seconds) covers both token-count and embedding HTTP, with caller cancellation checked between requests, bounded batches of 16, and remaining time passed to each call. Keep every count and embedding request before opening the SQL publication transaction. Count failure, identity mismatch, timeout, cancellation, embedding failure or bad vector aborts preparation. The model revision, one-prefix convention and normalization remain unchanged, so token-aware boundaries do not create a new E5 vector space; do not re-chunk or delete already-published historical content automatically.

### 3. Make tables and warning policy explicit

Construct source units from both `LocatedExtraction.pages`/`locations.pages` and `tables`/`locations.tables`. Preserve every cell string, blank cell, row and column order; use a deterministic readable table rendering for RAG without inferring dates/fees or altering the reviewed table values. Split tables on row groups where possible, retain/repeat header context only with its header location included, and narrow XLSX/CSV row/column locations when a chunk covers a subset. Do not silently omit a table because its page text is empty.

An oversized row/cell split must either fail closed pending a previewable, reason-bound chunk-plan warning or be supported by a tested deterministic representation that does not lose cell boundaries. Do not set an opaque chunk `requiresReview` boolean with no receipt key. The saved review receipt must bind the exact plan and resolve any allowed structural split warning; blocking/provenance/sensitivity warnings still prevent PUBLIC publication. Overlap stays within the same source unit and section; a chunk containing overlap must carry the locations for all included source units. Tests must reconstruct the original narrative text losslessly after removing declared overlap and verify every table cell is represented by a chunk or a specific blocking/warning outcome.

Keep privacy conservative. Existing sensitivity detection scans joined page/table text and creates a global analysis warning with no `SourceLocation`. Before calling a warning “granular,” add server-computed, content-free location evidence at the source page/block/table/row/cell level. Do not log matched text. A detected sensitive category requires redaction plus a new extraction/reanalysis revision before PUBLIC publication; a false-positive acknowledgment alone cannot make it public. The current design also has no accepted staff-scoped retrieval path for INTERNAL/RESTRICTED knowledge, so those modes are not a workaround for publishing sensitive chunks.

### 4. Persist and cite the same locations

Use a new additive migration; do not edit applied RAG migrations. Add a JSONB array field such as `knowledge_chunks.source_locations`, defaulting to `[]` only for legacy chunks that have no proven format location. Add a database type/size check and strict application-side parsing with the existing five-variant `sourceLocationSchema`. The new publication path must reject an empty/mismatched location array; legacy `[]` stays explicitly incomplete and must not be backfilled with invented format/page data. Optionally persist `passage_token_count smallint` (nullable for legacy, `1..512` for new E5 rows) as audit evidence; SQL cannot independently recount, so the preparation/service boundary remains the authoritative tokenizer check.

Extend `KnowledgeEvidence`, retrieval SQL, `citationEvidenceSchema`, worker/outbox evidence validation, and `buildCitedAnswer` with those exact `sourceLocations`. Citation fields must come from retrieved/persisted evidence, never model output. Render PDF page/block/table, DOCX block/heading/table (no page), XLSX sheet/row/column/table, CSV record/column/table, and HTML final sanitized URL/block/heading/table. Keep current page/section fields only as compatibility values. Include the canonical location array in `evidenceStillMatches` so a queued answer is rejected if its persisted citation provenance changes. HTML location URLs must remain the reviewed final official URL, not the immutable acquisition URL or private storage reference.

## Focused acceptance needed for Task4C

- Service/client tests with a fake loaded tokenizer prove raw input gets exactly one query/passage prefix and special tokens are counted; the count endpoint reports both `512` and `513`, while `/embed` accepts `512` and rejects `513` before encoding; request bounds/auth/identity are enforced, malformed tokenizer output maps to a fixed error, and count requests never return text or vectors.
- Preparation tests with an injected deterministic counter cover a Thai high-token-density fixture that fits the old character cap but exceeds 512; exact split/reconstruction at grapheme boundaries; prefix/special-token boundary; UTF-8 byte cap; post-overlap recount; section/page/table boundaries; all chunks `<=512`; no embed call before all token counts pass; bad E5 identity; timeout/cancel; fixed 2,000-chunk overflow; and no partial result.
- Table tests cover PDF/DOCX/XLSX/CSV/HTML source units, blank cells, row-group splits, header location, a too-long cell/row, and exact `SourceLocation` kind/range. Assert no table text disappears from RAG prep. Explicitly test XLSX/CSV empty-page extraction so the separate table list still produces chunks.
- Review/privacy tests prove the exact saved job/extraction/review tuple and plan digest are bound; stale edits, stale warning dispositions or a changed plan cannot approve; sensitive findings stay blocking through `FALSE_POSITIVE`; safe nonblocking dispositions remain reason-bound; no raw PII text reaches warnings/logs.
- Actual PostgreSQL tests cover additive migration/replay/RLS, JSONB roundtrip, new-publication nonempty/format-matched locations, legacy empty-location compatibility, token-count column policy if selected, and atomic rollback on chunk/location insertion failure.
- End-to-end provenance tests run supervised PDF, DOCX, XLSX, CSV and HTML through extraction → immutable revision/edit → preview/review → located token plan → passage vector → persisted chunk → retrieval → citation/outbox. Assert exact source-location arrays survive each step, compatibility page/section values are correct or null, and `evidenceStillMatches` detects a location change. Mock the embedding HTTP and assert neither count nor embedding HTTP runs while a SQL publication transaction is open.

## Dependencies and limits

Proposed Task4C should follow the current IMP-03B-1 version-resolver source/UI/browser/commit freeze and depend on the accepted private extraction/edit and review-receipt contracts plus EMB-01…05. It prepares and proves the exact inputs needed by approval; it does not complete approval, family/delivery locks, amendment/cancellation invalidation, atomic version publication, M8 BOTH, real YRU corpus acceptance, or Flow A–F. Those remain Task4 publication/overall M7 gates.

Separate metadata/date/year-zero semantics were not audited here. No task-board, matrix, decision, design, source, test, migration, UI, or credential file was changed. This proposal is not the root’s final implementation contract or a new authoritative phase.
