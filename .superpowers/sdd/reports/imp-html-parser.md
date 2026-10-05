# IMP-01B-HTML component report

**Date:** 2026-10-05
**Owner:** `/root/prv_compatible_review` (Luna max)
**Scope:** `lib/imports/html-parser.ts`, `tests/import-html-parser.test.ts`
**Review provenance:** root review corrections incorporated; no claim of an unavailable independent review.

## Result

Implemented synchronous HTML extraction with the pinned `parse5@8.0.1` parser. `parseHtmlSource(source)` verifies the immutable source, requires HTML, performs fatal UTF-8 decoding, parses with scripting disabled, rejects parse errors other than a missing doctype, and returns the root-owned `LocatedExtraction` after `validateLocatedExtraction` accepts it. Failure is normalized to `IMPORT_PARSE_INVALID`; original text, URLs, resource attributes, and parser diagnostics are not placed in errors or logs.

The parser does not fetch, render, execute, or submit HTML resources. It extracts decoded title/headings/body text and table rows, preserves blank cells and table order, and associates pages/tables with the verified source URL plus stable one-based block/table indexes and heading paths. HTML page numbers remain null. Tables with nested/merged or ragged shapes keep their extracted rows and receive unresolved review flags. Resource and hidden-content warnings contain only code, severity, location, count, and `UNRESOLVED` disposition.

The DOM walk skips script/style/template/frame/object/embed, SVG/MathML, resource-bearing media/control subtrees, and recognized hidden markers (`hidden`, `aria-hidden=true`, hidden inputs, common hidden classes, and inline hidden styles). Ignored descendants are still scanned structurally against depth/node limits; their attribute references can trigger a safe external-resource warning without returning the URL or contents. The parser measures actual output counts and rejects excessive input, depth, nodes, text, pages, tables, rows, columns, cells, or cell size rather than returning truncated data.

Low-text quality is measured before a fallback title/empty page is added. Blank-table and title-only sources retain their title, rows, and locations but receive `LOW_TEXT_QUALITY` with `REVIEW`/`UNRESOLVED`, and extracted pages require review. This avoids treating an HTML head title or an empty table as evidence of substantive content.

## Verification

Test-first evidence for this slice:

- Before subtree scanning, the hidden-descendant depth regression failed because the parser accepted the over-depth hidden tree. It passes after the scanner began enforcing limits inside ignored subtrees.
- Before quality measurement was moved ahead of fallback-page generation, both new blank-table and title-only tests failed for missing `LOW_TEXT_QUALITY`. Both pass after the change.
- Final `pnpm exec vitest run tests/import-html-parser.test.ts`: **1 file, 10 tests passed**.
- Final `pnpm exec eslint lib/imports/html-parser.ts tests/import-html-parser.test.ts`: **passed with no warnings**.
- Final isolated TypeScript check for the parser, test, and their imports: `pnpm exec tsc --noEmit --skipLibCheck --strict --esModuleInterop --module esnext --moduleResolution bundler --target ES2017 --lib "dom,dom.iterable,esnext" lib/imports/html-parser.ts tests/import-html-parser.test.ts`: **passed**.
- A whole-workspace `pnpm exec tsc --noEmit` at 16:39 Asia/Bangkok time was not green while the separate URL-importer slice was in flight. It reported errors in `lib/imports/url-importer.ts` and `tests/import-url-importer.test.ts`; it reported no HTML parser/test diagnostics. This is not evidence of a passing application typecheck.
- The no-network behavior is covered by a `fetch` spy in the hidden/resource test; no live URLs or provider calls were used.

## Review notes and limits

- `parse5` builds its in-memory tree before the parser's depth/node traversal checks run. The 20 MiB verified-original limit and pre-parse markup-marker bound constrain input, while traversal/output limits constrain extraction work and result size; they are not a hard process RSS or CPU limit. Deployment resource isolation remains a separate acceptance gate.
- Hidden detection is intentionally static and non-rendering. It recognizes explicit hidden attributes, a small set of common classes, and inline hidden styles; it cannot compute arbitrary CSS or media-query visibility. Stylesheets and style subtrees are skipped and produce review evidence, and no external CSS is loaded.
- Visible text and cell content are HTML-decoded and whitespace-normalized (NBSP becomes a regular space; whitespace runs collapse and edges trim). Exact cell order, values after that normalization, and empty cells are retained; source markup/byte-level whitespace is not reproduced.
- This is parser-component evidence only. URL acquisition, source-location persistence/citations, storage, authentication, staging, review UI, and publication are owned by other slices and remain unverified here.

## Primary reference

- [parse5 `parse` API](https://parse5.js.org/functions/parse5.parse.html), used with the installed `scriptingEnabled` and `onParseError` options. The resolved dependency is pinned to `parse5@8.0.1` in `package.json`.
