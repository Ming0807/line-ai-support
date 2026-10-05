# IMP-02B-XML review — 5 October 2026

**Reviewer:** Luna max, read-only IMP-02C-REVIEW
**Scope:** `lib/imports/safe-xml.ts`, `tests/import-safe-xml.test.ts`; XML behavior as consumed by the Office package boundary.

## Result

The XML boundary decodes bytes with fatal UTF-8, accepts only XML 1.0 declarations with UTF-8 encoding, and builds a namespace-aware ordered tree with decoded text/CDATA in source order. It rejects DTDs and processing instructions before an extraction result can be returned; parser errors and all other failures collapse to `IMPORT_XML_INVALID`. The parser has no file or network resolver. Per-input bounds cover 16 MiB, 100,000 elements, depth 64, 256 attributes per element, and 5,000,000 combined text and attribute characters. Nodes, attribute records, and child arrays are frozen before return.

The tests exercise namespace identity, Thai text, entities, CDATA and mixed order; malformed tags and duplicate attributes; internal/external DTDs, unknown entities and processing instructions; XML-version/encoding and invalid UTF-8; empty/oversized input; depth, element, attribute and character caps; and preservation of whitespace/numeric-looking strings. I found no demonstrated entity-resolution, external-resource, encoding, or namespace bypass in this boundary.

## Verification

- `pnpm exec vitest run tests/import-safe-xml.test.ts tests/import-office-package.test.ts --maxWorkers=1`: **2 files, 41 tests passed**. The package tests use generated ZIP bytes and run the XML parser through the package boundary.
- `pnpm exec eslint lib/imports/safe-xml.ts lib/imports/office-package.ts lib/imports/xlsx-parser.ts tests/import-safe-xml.test.ts tests/import-office-package.test.ts tests/import-xlsx-parser.test.ts`: **passed with no warnings**.
- Installed `saxes@6.0.0` README was inspected; its primary project documentation is [saxes](https://github.com/lddubeau/saxes).

## Review note

`append()` has an additional 200,000-segment cap that is absent from the frozen XML contract. I reproduced it with `<a>` followed by 200,001 `<![CDATA[x]]>` sections and `</a>`: the 2,600,020-byte document has one element and only 200,001 text characters, but is rejected with `IMPORT_XML_INVALID`. This is a stricter compatibility limit rather than an entity/resource vulnerability. Record the cap in the contract and add a boundary test, or remove it if those valid inputs must remain accepted.

`parseSafeXml` is synchronous and cannot be interrupted during one XML parse by an `AbortSignal`. A bounded parser child with timeout/termination remains a separate IMP-01B-CHILD gate; this review does not claim CPU/RSS or OS-level isolation. DOCX/XLSX semantics, staging, review/publication, and UI are outside this XML component verdict.
