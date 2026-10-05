# IMP-02B-ARCHIVE component report

**Date:** 2026-10-05
**Owner:** `/root/imp_safe_archive`
**Scope:** `lib/imports/safe-archive.ts`, `tests/import-safe-archive.test.ts`, `tests/fixtures/import-zip.ts`
**Dependency:** pinned `yauzl@3.4.0` and `@types/yauzl@3.4.0`, installed by root.

## Result

Implemented `readSafeOfficeArchive(bytes, signal)` as an in-memory ZIP reader. It uses yauzl's buffer API with lazy entries, strict file names, and declared-size validation. It does not open files, extract to disk, fetch URLs, log names or file contents, or include archive/parser diagnostics in errors.

The reader enforces the 2,000-entry, 16 MiB-per-entry, and 64 MiB-total limits against declared metadata before inflation and against actual stream output while reading. It validates actual CRC-32 values, local-to-central header agreement, path safety, duplicate and case-colliding names, single-disk metadata including per-entry start disks, and symlink metadata. It rejects nested archive signatures/names, macro indicators, executable/script parts, and unsupported ZIP compression or flag modes. Abort and parser/limit failures return only `Error('IMPORT_ARCHIVE_INVALID')`. Returned part bytes are held in a `ReadonlyMap`.

ZIP64 archives are rejected. The supported original input cap is 20 MiB, expanded limits are at most 64 MiB, and 2,000 entries; these limits are below ZIP64 thresholds. Explicit ZIP64 rejection avoids relying on yauzl fields that its API does not expose for independently verifying every disk number.

## Verification

- Tests use generated ZIP record bytes with native `deflateRawSync` and CRC-32. Cases cover valid Thai content, malformed archives, duplicate/case-colliding and traversal names, local/central header disagreement, incorrect CRC, encryption, symlinks, split-disk fields, declared and actual per-entry/total size limits, entry count, nested archives, macro-enabled package parts, executable parts, and an already-aborted signal.
- Initial test-first run, before `safe-archive.ts` existed: `pnpm exec vitest run tests/import-safe-archive.test.ts --maxWorkers=1` failed during module resolution with **0 tests collected**. This is recorded as the observed missing-module RED; it was not an assertion-level behavioral RED.
- Final `pnpm exec vitest run tests/import-safe-archive.test.ts --maxWorkers=1`: **1 file, 23 tests passed**.
- Final `pnpm exec tsc --noEmit --pretty false`: **passed** for the current workspace snapshot.
- Final `pnpm exec eslint lib/imports/safe-archive.ts tests/import-safe-archive.test.ts tests/fixtures/import-zip.ts`: **passed with no output**.

## Review notes and limits

- Root owns the parser-consumption security contract review; no independent review is claimed here.
- This component proves bounded in-process package-part extraction only. It does not establish child-process isolation, hard RSS/CPU bounds, DOCX/XLSX semantic parsing, malware scanning, or application staging/publication acceptance.
- No full repository test suite or live/private-source archive was run for this slice.

## Primary reference

- [Installed yauzl 3.4.0 README](https://github.com/thejoshwolfe/yauzl): buffer-only lazy iteration, strict file-name validation, `validateEntrySizes`, and its stated lack of automatic CRC-32 checking.
