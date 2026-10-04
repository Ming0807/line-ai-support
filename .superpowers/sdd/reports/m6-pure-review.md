# M6 Pure Review

Reviewed the frozen M6 plan and the requested eligibility, chunking, and OpenAI embedding adapter code/tests. The focused suites pass: `pnpm exec vitest run tests/knowledge-eligibility.test.ts tests/knowledge-chunking.test.ts tests/openai-embeddings.test.ts --maxWorkers=1` (3 files, 67 tests). No live provider, database, or environment credentials were used.

## Confirmed finding

**P2 — OpenAI model dimensions are not validated against each model's maximum.** In [openai-embeddings.ts:50-51](../../../lib/ai/providers/openai-embeddings.ts), requests accept any dimension from 1 through 4096 except that `text-embedding-ada-002` is fixed to 1536. The test at [openai-embeddings.test.ts:100-112](../../../tests/openai-embeddings.test.ts) explicitly treats `text-embedding-3-small` with 4096 dimensions as valid, and [providers.ts:9-10](../../../types/providers.ts) allows that configuration to be saved. OpenAI documents the small model's default vector length as 1536 and the large model's as 3072; the `dimensions` parameter shortens these vectors. A 4096-dimension request for the small model (or a request above 3072 for the large model) therefore cannot produce the fake response the test accepts and is rejected by the live API after the request is sent. [OpenAI embeddings guide](https://developers.openai.com/api/docs/guides/embeddings), [Embeddings API reference](https://developers.openai.com/api/reference/ruby/resources/embeddings/methods/create).

Reproducer: configure `text-embedding-3-small` with `dimensions: 4096` and call `embed` with one input. The adapter sends `dimensions: 4096` instead of rejecting the unsupported pair locally; the fake transport in the existing test masks the provider rejection. Validate configured dimensions against known model maxima before HTTP and change the positive test to use a supported dimension.

## Non-blocking design concern

**Section provenance stops at page boundaries.** [chunking.ts:142-145](../../../lib/knowledge/chunking.ts) initializes `sectionTitle` to `null` for every page. With page 1 containing `# Transfer policy` and page 2 containing continuation text without a repeated heading, page 2's chunks have `sectionTitle: null`. The plan calls for page/section metadata in citations and says chunking preserves heading boundaries ([plan lines 20 and 42](../../../docs/superpowers/plans/2026-10-04-yru-rag.md)); carrying the last heading across pages would preserve that context. The frozen contract does not explicitly say whether headings carry across page breaks, so I do not classify this as a confirmed defect or acceptance blocker.

I found no other concrete issue in date/scope eligibility or the adapter's bounded response, error mapping, and abort handling during this review.

# Controller verification supplement

All initially actionable findings are resolved in current source. Thai grapheme splitting and section continuation each had a failing regression before correction. Native OpenAI known model dimensions now share one configuration/adapter validator; small/large overflow and ada fixed dimensions reject before HTTP, with unknown future dimensions explicit and response-validated. Final full unit371/371, PostgreSQL67/67, typecheck/lint/build, local advisors and actual browser17cases passed. This is a pure/configuration/retrieval checkpoint, not full M6 acceptance; durable jobs/tools/LINE answers remain under implementation.
