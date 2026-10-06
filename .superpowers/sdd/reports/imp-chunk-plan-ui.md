# IMP-PLAN-01 — private chunk-plan preview UI

6 October 2026. Scoped implementation report for Task4C-3b. This is source-level UI evidence only; backend integration and browser acceptance remain with root.

## Scope

Implemented only `app/(dashboard)/knowledge/import/chunk-plan-panel.tsx` and this report, using the frozen props and GET snapshot contract in the import execution plan. The panel requires a saved review before lookup, requests the three expected counters with `cache: 'no-store'`, validates the exact response envelope, echoed snapshot counters, plan binding, schema/chunker, fixed E5 identity, digest, chunk/warning bounds, token and UTF-8 text limits, and all five discriminated source-location shapes.

The UI shows one actual chunk at a time with its ordinal, reported token count, original-format coordinates, review marker, and conservative warning summary. The response validator now mirrors `sourceLocationSchema` bounds: block offsets 1–100,000, heading depth at most 20, table indexes 1–1,000 or null, workbook sheet/row/column limits, CSV row/column limits, and valid HTTPS HTML source URLs without credentials. It also enforces section-title and source-location list bounds and the exact unresolved extraction-warning enum. A user must check the plain-language acknowledgment for the displayed plan. A previous acknowledgment can be cleared even when the current lookup has no usable result. Request serial, abort, mounted, and counter-key guards discard stale responses; failures preserve the parent-owned draft and offer retry. The panel reports the preview as private and states that it does not approve or publish.

Known preparation errors now have specific Thai recovery messages: unavailable (503), timeout (408), excessive plan size (413), and unsplittable table row or grapheme (422). Each message says the draft remains and explains the next action.

Design direction follows the frozen Task4C-3b contract and incumbent `knowledge-review` / `knowledge-button` patterns in `DESIGN.md`. I read the frontend skill, Impeccable Operate guidance and craft floor, and the installed Next.js forms/client-fetching guides. The brainstorming skill's design-approval gate was already satisfied for this slice by the root's explicitly frozen design and user-authorized delegation; no additional design decisions were introduced.

## Checks

- `pnpm exec eslint 'app/(dashboard)/knowledge/import/chunk-plan-panel.tsx'` — exit 0, no output.
- `pnpm exec tsx -e "import { LOCAL_EMBEDDING_FINGERPRINT } from './lib/knowledge/embedding-space'; console.log(LOCAL_EMBEDDING_FINGERPRINT)"` — exit 0; output `42259817e85c6d44dc81af6b26fe209c9b744c6342eb4ac1c6bbd2bcdd032f82`, matching the browser-safe literal. The browser component does not import `embedding-space` or Node crypto.
- Impeccable detector on the changed component — no findings (`[]`).
- No unit tests, typecheck, build, or browser acceptance were run in this scoped UI task. Root owns compiled and actual-browser integration acceptance after the backend contract is ready.

## Limits

The parent review form does not yet render this component in this scoped change. Shared styling for the new `knowledge-chunk-plan-*` classes and visual/keyboard/browser verification are integration work owned by root. No approval, publication, or milestone completion is claimed.
