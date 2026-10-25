# INC-BATCH-01 / BATCH-01A — 10 October 2026

**FOCUSED_PASS / FULL_GATES_PENDING**. Source starts at local aa90f09. Preview is read-only, with no migration, AI/LINE call, message/outbox creation or ticket transition. Root owns contracts/service/API/integration. Actual Luna max authored15 owned PG cases; root independently executed15 and added/executed3 cursor/authority-ABA/membership-ABA cases. No independent source-review verdict is claimed.

## Implemented

Strict browser-safe contracts canonicalize UUIDs, reject extra/duplicate fields and bound explicit selections1..100, membership<=500 and common text<=4000. Active Staff must see the complete incident. Same-snapshot workload counts distinct anonymous sessions, not verified people. Own assigned active GENERAL HUMAN cases are eligible; supervisors explicitly acknowledge intervention for another assignee. Private, unassigned, terminal, foreign and AI cases are ineligible.

Authenticated GET `/api/incidents/[id]/reply-options` and POST `/api/incidents/[id]/replies/preview` have private headers, strict query/body/UTF8 limits, same-origin POST and fixed errors. `REVIEW_ONLY` includes selected labels/counts/text and a ten-minute encrypted preparation receipt. It binds authority/membership versions, owner/revision/epoch, conversation/session state, latest USER source/count, complete USER-order digest and actor read cursor. Missing source mapping fails closed. ACK or source/member/authority changes require review again. Future confirmation must recheck inside its own immutable enqueue transaction; this receipt never grants send authority.

## Actual checks

-17 focused unit PASS; fresh TypeScript and changed-file ESLint PASS. Full ESLint initially found an unused fixture variable; root removed it and scoped lint then passed without warnings.
-18 actual focused PG PASS against an owned39-migration database. Covers counts/selection/scope/intervention/no effects/receipt expiry+purpose+key+actor/context, stale source/member/owner/revocation, mapping loss/move, 501-member cap, ACK and authority/membership ABA. Missing-module and mapping RED evidence is retained.
- Registered suite added. First broad attempt failed at preflight, exit2, without creating a database. Second replay reached39 migrations/foundation and passed32 owned-web/15 web-admission cases, then failed starting RAG-catalog tests; owned cleanup PASS. Isolated RAG-catalog subsequently PASS5/5. Current broad registered acceptance remains pending.
- Full unit attempt reports167 files,2,144 passed/2 failed plus two worker startup errors: native `VirtualAlloc failed`/V8 startup OOM and parser `IMPORT_PARSER_FAILED`. Isolated real CSV/HTML/Office parser tests subsequently PASS3/3. Post-run Windows committed memory was close to its limit; resource pressure is the leading diagnosis, not a proven code regression or broad pass.
- Fresh isolated build failed with V8 `Zone Allocation failed - process out of memory` during typechecking. Build acceptance remains pending; no skip or relaxed parser limit was introduced.

Ignored logs: `incident-batch-preview-author-red.log`, `incident-batch-preview-author-final.log`, `incident-batch-final-unit.log`, `incident-batch-final-registered-pg.log`, `incident-batch-final-registered-pg-retry.log`, `incident-batch-parser-isolated.log`, `incident-batch-rag-isolated.log`, `incident-batch-build.log` under `.superpowers/staging`. Prior Staff422PG/2,138unit/build evidence is historical, not this change's acceptance.

## Remaining team work

Complete fresh full unit/registered PG/build checks with bounded resource use, then accept the preview component. Implement immutable confirm/batch+recipient provenance, fresh dispatch fences, original-set unsent-only retry/results and integrated operator review UI/digest. No send control or recipient expansion exists now. This is implementation work, not human configuration. Real multi-staff/multi-session OA follows integration; live Zen restriction is separately diagnosed in DEC-085.
