# ADV-05B/C Bounded Web Search Implementation Plan

> **Status: PROPOSED — NOT ROOT-ACCEPTED.** This is an execution proposal for root review, not authorization evidence or an implementation report. Root owns contracts, schema/auth/privacy, integration and acceptance. Keep current ADV-05A work intact.

## Goal

Implement the required source order for bounded university assistance: typed YRU structured data, reviewed RAG, official YRU web, then generic Internet where it cannot substitute for YRU policy. Add a separately cost-bounded search adapter whose missing-key behavior is honest and testable offline. Preserve staff HUMAN draft-only behavior, student delivery proof, citation provenance, approved-source authority/applicability and the existing FREE_ONLY inference contract.

Requirements: `USR-WEB`, `USR-STAFFASSIST`, CH018, CH029–34, CH044, CH052, CH060–63; original overview §§14, 27; master guide §§52 and 63. See [proposal](../../architecture/BOUNDED_WEB_SEARCH_PROPOSAL.md), [staff assistance design](../../architecture/STAFF_AI_ASSISTANCE_DESIGN.md), [working protocol](../../agents/WORKING_PROTOCOL.md), and the current [task board](../../tasks/V1_TASK_BOARD.md).

## Architecture

The producer remains deterministic around typed backend evidence. It selects a strict search scope and public topic code; backend policy decides whether the fixed structured/RAG/official/generic stages may run. The external search provider receives only the minimized public query, never a ticket transcript or internal rows. `NO_MATCH` may advance; ambiguity, missing required filters, conflict, stale evidence, lost authorization and unsupported policy scope stop the cascade. Official search results become YRU policy evidence only when they bind to an approved current source/version with matching authority, effective interval, applicability and canonical content proof. Unregistered/changed YRU pages are source leads for staff and the normal import/review path.

For HUMAN staff assistance, build a fresh staff-scoped source snapshot for the exact ticket, including actor grants and department/sensitivity visibility; student `AISnapshot`/LINE authorization is not reusable proof of staff authorization. Root's ADV-05A `a19b028` is verified and pushed, and root is starting staff verified-knowledge assistance separately. The web implementation must consume that staff source boundary when available without duplicating or replacing it. All external/provider calls remain outside the staff snapshot transaction and the actor/ticket/source digest is rechecked before returning the ephemeral cited draft.

For student messages, external citations/proof join the existing final delivery fence. For staff assistance, all network happens outside SQL, the actor/ticket/message digest is rechecked after generation, citations are displayed with the ephemeral draft, and staff still uses the ordinary manual reply action. The implementation introduces no automatic send, answer publication, arbitrary fetch or source approval.

Provider evaluation as of 2026-10-08 supports **Tavily Search Free** as a conditional candidate: its current official pricing page states 1,000 credits/month, no card, and stop-until-reset-or-upgrade when exhausted; basic/fast/ultra-fast use one credit and its API supports a per-key monthly limit. Exa's free credits are documented, but the official pages reviewed do not prove a hard no-paid exhaustion boundary or preflight remaining-credit query. Do not route search through the generation model cost registry. The full source comparison and links are in the proposal. No key/config is present and no live call was made.

## Tech Stack

- Existing Next.js 16.3.8 App Router, TypeScript, Zod 4 and Vitest; follow repository-owned server/auth/database patterns.
- Existing PostgreSQL transaction helper and private migration/test harness for atomic usage reservation if root accepts a quota ledger.
- Existing pinned public-DNS/TLS request primitives and `lib/imports/url-importer.ts` contracts as references. Do not reuse the importer as answer retrieval.
- Tavily Search API fixed HTTPS endpoint as the proposed adapter, enabled only under explicit normal server configuration for the free plan/key. No new SDK/package is required for the first slice unless root's reviewed implementation choice justifies one.
- Offline tests use injected DNS, transport, clock, provider response and quota adapters. Do not require secrets, provider internet, live LINE or staging for deterministic tests.

## Global Constraints

- Preserve AI inference `FREE_ONLY`, Zen/OpenRouter startup, local CPU `intfloat/multilingual-e5-small`/384 embeddings and all provider/model/LINE/database transaction boundaries.
- No raw ticket/student messages, identity, case IDs, structured private rows or reviewed passage text in external search queries or logs. Prefer server-built terms from approved topic/category/system/family codes. An explicitly entered public-search field, if supported, is independent of the ticket and is not claimed to be automatically free of personal data.
- `YRU_POLICY` is the safe default for ambiguous intent. Generic Internet/foreign-university policies never establish YRU policy. Generic results are `GENERIC_CONTEXT`, not authority/effectiveness evidence.
- No caller/model-controlled endpoint, domain list, URL, SQL, crawling, search loop, redirect chain or output URL. Use exact schemas and fixed server configuration.
- All provider work stays outside SQL transactions. Persist usage reservation before network; a dispatch consumes its reserved quota even on uncertain timeout. No retries, paid fallback, alternate free provider fallback, silent auto-upgrade or model-generated search answer.
- Search provider result text/URL is untrusted. Server validates HTTPS/domain and constructs citation metadata; model cites only passed opaque IDs. Do not infer YRU authority, effectiveness or applicability from a result's domain/title/published date.
- Known-URL import is a separate user-supplied official URL workflow and remains import/review-only. Generic result URLs are never server-fetched in the first slice.
- Keep changes scoped to the planned files; do not touch unrelated ADV-05A files without root integration review. Do not stage/commit/push, use secrets, alter staging, or make live provider/LINE requests as part of this implementation plan.

---

## Ownership, files and dependencies

Root owns this plan, final contracts, new persistence/migration decisions, source-authority rules, any staff UI/API integration and final acceptance. Avoid overlapping edits with the active ADV-05A working tree. If root assigns a later implementation slice, the actual implementer and review provenance must be recorded then; this proposal claims no unavailable review.

| Area | Proposed files | Depends on |
|---|---|---|
| Typed search request/result/config | `lib/ai/web-search-contracts.ts` (new), `lib/ai/web-search-provider.ts` (new), `lib/ai/web-search-config.ts` (new) | Tavily official API, Zod strict schemas, normal server-secret configuration |
| Network / URL bounds | `lib/ai/web-search-network.ts` (new) or narrowly extend existing pinned HTTPS helper; `lib/knowledge/official-source-fetch.ts` (new, if canonical YRU fetch is accepted) | `lib/ai/public-addresses.ts`, `lib/ai/compatible-network.ts`, `lib/imports/url-importer.ts`; no arbitrary fetch |
| Usage/cost reservation | `lib/ai/web-search-quota.ts` (new), proposed `supabase/migrations/<next>_web_search_usage.sql`, owned database verification-runner addition | Root decision on a private usage counter/table; reserve transaction commits before HTTP; no use of generation pricing rows as a substitute |
| Query building and cascade | `lib/knowledge/external-search-plan.ts` (new), `lib/knowledge/external-evidence.ts` (new), `lib/knowledge/answer-producer.ts` for student integration, `lib/knowledge/structured-search.ts` only if a source proof adapter needs a bounded selector | Existing exact structured selectors, E5 local query, authority/applicability/version rules, reviewed evidence and citations |
| Staff-specific retrieval boundary | `lib/staff/ai-assistance-sources.ts` (new) or root's in-progress equivalent; staff API/service/contracts only after reconciling the actual branch | Fresh staff actor/grants/department/sensitivity snapshot; do not reuse student authorization/snapshot for HUMAN staff tools |
| Student delivery proof | `lib/knowledge/delivery-fence.ts`, `lib/knowledge/citations.ts`, worker/outbox integration file identified by source search before edits | Existing source revalidation, final dispatch lock and send idempotency |
| Staff draft route and UI | `lib/staff/ai-assistance-contracts.ts`, `lib/staff/ai-assistance.ts`, `lib/staff/ai-assistance-api.ts`, `app/api/tickets/[id]/assist/route.ts`, `app/(dashboard)/tickets/[id]/staff-ai-panel.tsx`, related ticket page/styles | Active HUMAN snapshot, post-network digest/grants check, citations on ephemeral draft, existing manual reply route |
| Tests | New `tests/ai/web-search-provider.test.ts`, `tests/ai/web-search-quota.test.ts`, `tests/knowledge/external-search-plan.test.ts`; extend `tests/knowledge/answer-producer.test.ts`, `tests/knowledge/delivery-fence.test.ts`, `tests/staff-ai-assistance.test.ts`, database verification and staff route/browser tests | Injected fake transports and clocks; actual PG only for quota locks, source eligibility and delivery race invariants |
| Project bookkeeping | Root updates `docs/tasks/V1_TASK_BOARD.md`, `docs/requirements/V1_REQUIREMENTS_MATRIX.md`, `docs/decisions/DECISION_LOG.md`, `docs/operations/FINAL_SETUP_CHECKLIST.md`, and dated report/index after accepted implementation | Working protocol; implementation evidence and live/config status must remain separate |

Exact route/helper choices must be confirmed against source at implementation time. The list is a proposed owned-file boundary, not permission to modify every listed file. If the implementation requires Next route behavior, inspect the corresponding installed guide under `node_modules/next/dist/docs/` before writing code.

## Execution phases

### Phase 0 — Root contract acceptance and board split

- Root accepts/amends this provider choice, the server-owned vocabulary/public-query path, authority binding, proposed limits and delivery scope.
- Root records ADV-05B/C task IDs/dependencies and linked requirement rows on the board without replacing the active ADV-05A work.
- Confirm whether a private persistent quota bucket is needed or whether an existing safe persistence contract can serve. Do not add schema by assumption.
- Confirm the current source-authority record can prove canonical page content hash and applicability; if it cannot, design that missing evidence explicitly before code rather than implying domain trust.

### Phase 1 — Strict adapter, query builder and no-key behavior

- Define exact strict Zod schemas for purpose, topic code, bounded evidence and safe status. Reject unexpected request fields, URLs, provider options and oversized output.
- Add server-owned public topic vocabulary and query construction. For policy topics, include only fixed public labels and explicitly grounded public selectors. Do not use ticket text, user IDs or internal source content. If a dedicated free-form public search field is selected, keep it separate from the ticket and document its raw-input limit honestly.
- Add the fixed Tavily `/search` adapter with `basic`, `max_results: 5`, one chunk/source, no answer/raw-content/images/auto-parameters, restricted server-selected domains, fixed origin, pinned DNS/TLS, 5s deadline and 512KiB body maximum.
- Missing connector/key, unsupported scope, malformed provider data and provider failure produce typed unavailable statuses with zero false success. No key means no provider egress. Use fake transport tests for request serialization, auth-header secrecy, response bounds, HTTP statuses and no retries.
- Do not make a live provider request. Confirm startup FREE_ONLY generation code is untouched.

### Phase 2 — Atomic quota, source order and applicability proof

- Implement root-accepted quota reservation (proposed 800 basic credits/app UTC-month, 20/staff Bangkok-day) with a transaction committed before HTTP; consume the reservation for every dispatched attempt, including timeout/uncertain results.
- Require the external key's ordinary configured free plan and monthly key cap; treat key/account remainder as provider scope/unknown unless the provider reports it. App counters must not be labeled as provider account remaining quota.
- Wire structured retrieval, RAG, official search and generic context through one backend-owned `SearchPlan`. For staff, obtain the exact-ticket data through a fresh staff-scoped adapter and actor/grants/department/sensitivity checks, not the student producer's authorization. Distinguish `NOT_APPLICABLE`/`NO_MATCH` from every stop condition. Structured complete facts and sufficient reviewed RAG prevent later calls.
- Restrict official search to the fixed YRU host list and validate every candidate URL server-side. Bind policy evidence to a current approved source/version and revalidate authority, effective dates, applicability, amendments/cancellations and canonical body digest. Unbound results remain `YRU_SOURCE_LEAD`.
- Permit generic web only under `GENERAL_PUBLIC` or explicit staff context selection; no foreign-institution rule can satisfy `YRU_POLICY`. Keep generic result source class and citation separate.
- Verify zero outbound search within transaction using the existing test probe pattern.

### Phase 3 — Answer and staff delivery fences

- Extend student answer evidence/citation and dispatch proof so all internal/approved-YRU citations are fresh and eligible at final outbox send. Generic-context evidence cannot satisfy policy proof.
- Extend staff-assistance contracts/UI to present source status and citations alongside the draft. Search/generation remain outside SQL; after network reload actor grants and the active HUMAN ticket/source digest. Stale results are discarded. The existing reply API remains the only send path.
- Preserve any user edits through the current composer behavior; do not create a send side effect from the assistance endpoint or add ticket/outbox mutations.
- Add race tests for grant revocation, ticket/message/revision/mode changes and source version change between retrieval and draft/dispatch.

### Phase 4 — Acceptance evidence and handoff

- Run focused provider, quota, source-plan, staff assistance, student citation/delivery, and actual PostgreSQL tests. Verify cost errors, key/quota statuses, network/DNS/redirect/bytes/time limits, YRU-applicability cases, no foreign-policy substitution and no-key behavior.
- Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`, and the relevant actual database harness (`pnpm test:db` plus the owned web-search/source test runner selected for the final schema). Fix failures before reporting.
- Root updates board, matrix, decision log if a decision was made, final setup checklist and report/index. Distinguish deterministic adapter/component acceptance from live API-account, live YRU source, Thai quality and full Flow A–F evidence. No missing setup evidence becomes PASS.
- Before any later commit, stage only owned accepted files and run `node scripts/security/check-staged.mjs`; do not include existing root WIP, private originals, `.env` or keys.

## Acceptance matrix

| Case | Required result |
|---|---|
| Complete structured fact | Exact server row citation; zero RAG/web calls |
| Structured clarification/conflict/incomplete required scope | Clarify/stop; zero lower-tier calls |
| Structured miss, sufficient reviewed current RAG | RAG citation; zero web calls |
| RAG miss, eligible official YRU source | Restricted official lookup; source/version/authority/effective/applicability/content proof all match; server-owned citation |
| YRU result not registered or content changed | `YRU_SOURCE_LEAD`; no policy answer or automatic publication |
| YRU policy unavailable but foreign university result exists | Limitation; no foreign/generic source citation as YRU rule |
| Explicit general public question | Labeled generic citations; no policy classification or inferred university applicability |
| Ambiguous intent | `YRU_POLICY` safe default; no generic web request |
| No key/config or local quota exhausted | `NOT_CONFIGURED`/`QUOTA_EXHAUSTED`; no provider HTTP, no misleading searched status |
| Tavily 429/432/433/5xx, timeout or malformed/oversized response | Safe unavailable state; no retry, no paid fallback, no raw error/query log |
| DNS/private/mixed answer, wrong host, lookalike, redirect or untrusted URL | Reject before evidence/fetch; preserve null HTTP when no response exists |
| Ticket/grant/source changes during web/generation | Discard result; no draft delivery or student dispatch |
| Staff assistance success | Cited ephemeral draft; active HUMAN recheck; staff must use normal reply/send workflow |
| Known-URL import | Remains user-supplied, official-host bounded, provenance-bearing and review-only |

## Deferred configuration and evidence

The implementation and fake-provider suite do not depend on a key. Until routine server configuration supplies a selected free-plan key, the app must visibly/typedly report `NOT_CONFIGURED` and make no call. Live provider quota/account scope, current YRU website fetch/hash, approved source-corpus coverage, Thai answer quality and end-to-end LINE/manual-reply flows are separate evidence checkpoints. No raw secret belongs in source control or this plan. The configuration task is normal provider setup, not a new university approval gate.
