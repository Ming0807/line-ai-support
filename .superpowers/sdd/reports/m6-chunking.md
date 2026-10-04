# M6 pure chunking report

Implemented `chunkPages(pages, options)` in `lib/knowledge/chunking.ts` using the frozen M6 `ExtractedPage`, `ChunkDraft`, and `ChunkOptions` types. It assumes pages are ordered by the extractor and belong to one document. It preserves page and review provenance, carries the latest observed Markdown or Thai heading into continuation pages, and leaves section provenance `null` until a heading is seen. A later heading replaces that section context. It keeps paragraph and Markdown table boundaries and emits deterministic zero-based indexes. Chunks are bounded by Unicode codepoints and split only at Unicode grapheme boundaries, so Thai marks, combining accents, and joined emoji stay intact. Paragraph overlap applies only within its page and section; grapheme boundaries can make actual overlap shorter than the requested count. A table row that exceeds the configured bound is split and every resulting piece is marked `requiresReview`. If one grapheme alone exceeds the configured character bound, chunking throws `CHUNK_LIMIT_EXCEEDED` rather than splitting it or emitting an oversized chunk.

The function defaults to 1,800 characters, 120 overlap characters, and 2,000 chunks. It validates the option ranges, accepts at most 1,000 pages and 5,000,000 input codepoints, skips whitespace-only pages, and throws the fixed codes `CHUNK_INPUT_INVALID` or `CHUNK_LIMIT_EXCEEDED` for invalid or over-limit input. Unknown source page numbers remain `null`. It performs no file parsing, persistence, provider calls, or publication decisions.

## TDD evidence

- Initial RED: the focused Vitest run failed while loading `../lib/knowledge/chunking`, with `Error: Cannot find module '../lib/knowledge/chunking'`.
- Additional RED: the grapheme regression test failed on the Thai case because the existing splitter produced separate base and tone graphemes across a chunk boundary.
- Additional RED: the continuation-page test failed with `sectionTitle: null` on page 2 after a heading on page 1.
- GREEN: `vitest run tests/knowledge-chunking.test.ts --maxWorkers=1` passed all 12 tests, covering page and section provenance including continuation pages and heading replacement, Thai/Markdown headings, unchanged date and fee text, Markdown table rows, grapheme-safe Thai/combining/emoji splitting, within-page overlap, review propagation, oversized grapheme handling, unknown page numbers, empty text, validation, and configured input/output limits.
- Focused ESLint passed for `lib/knowledge/chunking.ts` and `tests/knowledge-chunking.test.ts`.
- File-scoped strict TypeScript compilation passed for `lib/knowledge/chunking.ts` with the repository's ES2017 target and bundler resolution.

No full-project or database verification was run; this module is pure and its assigned scope excludes retrieval, worker, corpus approval, and live resources.
