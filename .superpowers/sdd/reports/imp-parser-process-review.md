# IMP-01B-CHILD parser process review — 5 October 2026

**Reviewer:** Luna max, read-only IMP-01B-CHILD follow-up
**Scope:** `lib/imports/parser-process.ts`, `lib/imports/parser-child-protocol.ts`, `lib/imports/parse-source.ts`, `scripts/import-parser-child.ts`, and the native-child/runtime tests.

## Result

The runtime path selects the checked-in child script from `process.cwd()`; request bytes cannot select the executable, script, argv, or environment. The child receives a bounded JSON metadata header followed by the immutable source bytes on stdin. It re-creates and verifies source format/checksum/length before dispatch. The parent accepts only the exact `{schemaVersion, extraction}` response shape and revalidates the full located extraction against the original verified source. Uploaded filenames and paths are not argv values.

The child starts with the absolute `process.execPath`, a fixed Node heap flag, optional fixed `tsx` loader, `shell: false`, hidden Windows window, and piped stdio. Its environment is constructed from an allowlist (`NODE_ENV`, `TSX_DISABLE_CACHE`, plus Windows system-root variables when present); it does not copy `NODE_OPTIONS`, credentials, `PATH`, or proxy settings. The real-child environment test returns key names only and uses a dummy test sentinel; it never prints environment values. `tsx@4.23.15` is pinned under production `dependencies`.

The parent counts actual stdout bytes and kills the child above 32 MiB; it counts stderr without retaining or forwarding it and kills above 65,536 bytes. Both streams are drained. Output must be nonempty fatal UTF-8 and the child must exit successfully. Spawn, pipe, malformed-output, and nonzero-exit failures use fixed errors without argv, stderr, stdout, or stack details. Timeout, abort, and output-limit paths destroy stdin, send `SIGKILL`, and wait for the child's `close` event before rejecting. Runtime concurrency is capped at two active child calls per Node process.

The total deadline now starts in `parseImportSource`, covers source verification and request encoding, and passes only its remaining time to the child. The parent rechecks timeout/cancellation after child completion and after parsing/validating the response, so a late valid response is rejected. The deterministic deadline tests cover late completion, cancellation at the child-to-parent boundary, and reduced child timeout from parent work.

## Findings and closure

I found no remaining source-level defect in the reviewed timeout/close/abort, input/output, environment, or response-validation paths after the total-deadline changes. The review-time gap—parent verification, response parsing, and schema validation were outside the 15-second budget—was corrected before final verification with three regression tests.

The parent-side `JSON.parse` and Zod/schema revalidation are synchronous and cannot be interrupted while a JavaScript call is running. The deadline and abort checks reject a result once that call returns, but do not guarantee that the caller regains control at exactly 15 seconds if the parent event loop is blocked. The 32 MiB output cap bounds the input to this synchronous work. This is a completion-latency limit, not evidence that late output is accepted.

## Verification

- `pnpm exec vitest run tests/import-parser-process.test.ts tests/import-parse-source.test.ts tests/import-parse-source-deadline.test.ts --maxWorkers=1`: **3 files, 14 tests passed** on the updated source.
- `pnpm exec eslint lib/imports/parser-process.ts lib/imports/parser-child-protocol.ts lib/imports/parse-source.ts scripts/import-parser-child.ts tests/import-parser-process.test.ts tests/import-parse-source.test.ts tests/import-parse-source-deadline.test.ts`: **passed with no warnings**.
- The native child tests exercise real spawned Node processes for environment allowlisting, the 256 MiB V8 heap flag, a hung child deadline, actual stdout/stderr overflow, malformed UTF-8, spawn failure, and cancellation before/during execution. Runtime dispatch tests invoke real supervised CSV, HTML, DOCX, and XLSX parsers and verify representative Thai content, exact strings, locations, and sanitized failures.
- PDF runtime dispatch was not exercised in this review; its parser/fixture work was still active. No whole-workspace typecheck/build or end-to-end staging/publication acceptance is claimed here.

## Isolation and deployment limits

`--max-old-space-size=256` limits V8 old-space, not total RSS, native buffers, or operating-system memory. The child inherits the application process's filesystem and network permissions; there is no OS sandbox, job-object/resource limit, or network/filesystem denial in this code. Killing the direct child is not a process-tree sandbox. Production must separately supervise CPU/RSS and filesystem/network access as the design specifies. The two-child cap is per Node process, not a fleet-wide concurrency limit.

The runtime requires the checked-in `scripts/import-parser-child.ts` at the path resolved from the process working directory and the production `tsx` dependency. This checkout has no deployment image/manifest proving those files are included in a production artifact, so deployment packaging remains unverified. Actual parser-process/component checks do not establish PDF support, production supervision, private staging, review/publication, or full M7 acceptance.
