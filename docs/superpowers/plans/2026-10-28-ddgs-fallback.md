# ROOT-WEB-DDGS-02 — bounded search-provider fallback implementation plan

> Root executes this plan under the user's continuing implementation authorization. Live model/OA checks are deferred by the latest human; component/unit/owned DB checks remain required.

**Goal:** Use the already installed pinned DDGS DuckDuckGo connector when Tavily is unavailable, exhausted or unconfigured without fabricating Tavily observations or bypassing source/owner fences.

**Architecture:** Keep Tavily first. A separate provider-aware fallback runtime invokes DDGS at most once after a non-ready Tavily outcome, except duplicates and cancellation. Reuse the retained private ledger with a provider discriminator, shared50/day500/month engineering ceilings and a10-second DDGS spacing guard under the existing global advisory lock. No HTTP/childprocess within a SQL transaction. DDGS yields nonempty domain-filtered leads only; empty/failed DDGS is unavailable and cannot mint an official-EMPTY receipt or enable lower-authority general web.

**Scope:** CH032/052/061–064, USR-WEB, master§32/original§27 and latest free-DDGS request. Root owns DB/contracts/integration. No generation/model/key/timeout changes, student profile data, search of raw private USER content, Redis or new queue. Existing dirty Tavily owner-null-limit fixes are preserved and included only where required by this working implementation.

## Alternatives and decision

1. Replace Tavily with DDGS: avoids credits but relies entirely on unofficial search and throttling; rejected as default.
2. Race both: adds duplicate external work/resource consumption and complicates crash semantics; rejected.
3. Sequential optional DDGS fallback: selected. A committed/uncertain provider attempt stays consumed. Provider-bound keys allow at most one attempt per operation/purpose/provider, and duplicates stop rather than replaying another provider. Missing authority/admission or cancellation never grants fallback access. Fresh owner/internal-miss preflight surrounds every provider call.

## Implementation slices and exact files

- [x] Provider admission: additive migration after46 adds immutable provider TAVILY(default for retained rows)|DDGS, provider-specific SUCCESS invariants and DDGS spacing check in existing invoker trigger. `lib/knowledge/web-search-admission.ts` retains legacy Tavily identity, uses separate DDGS HMAC domain, returns duplicate/capacity unavailable honestly, writes DDGS success without HTTP/requestUUID/credits. `official-web-miss.ts` explicitly accepts TAVILY only. Tests direct SQL/provider immutability, replay/cooldown/races, old Tavily data unchanged and RLS/grants.
- [x] Runtime: new `lib/knowledge/ddgs-web-runtime.ts` composes existing Tavily gate with bounded DDGS and retained provider admission. Preserve authoritative preflight/cancellation before reservation/call/result, cap one fallback, never invent empty-search proof or score/credits. `owned-web-fallback.ts` passes server-only config/adapter and keeps full source snapshot and lease checks. Existing `web-search-runtime.ts` Tavily behavior stays compatible.
- [x] Local entry: `scripts/local/config.mjs`, `.env.example`, `docs/operations/LOCAL_TEST.md` accept configured absolute DDGS Python path when web-search is explicitly enabled; Tavily attestation remains independently checked and may fail without disabling DDGS. Pinned bridge checks fixed DuckDuckGo backend; no auto download. Set local nonsecret DDGS config to the installedDvenv only after file/version verification. Preserve single command and both webhook URLs.
- [x] RED→GREEN unit tests, affected owned DB suites with all migrations, type/lint/fullunit/fullsourcebuild and credential/diff checks. Native Python smoke only imports pinned DDGS with no network; actual model/OA/user acceptance remains deferred. Root scoped independent review when available, no fabricated provenance.
- [x] Guarded DEVELOPMENT migration dry-run/apply/verify under canonical runtime stop; no data rewrite/deletion. Update current design/decision/task/requirements/checklist and commit exact owned files locally without push. Restart canonical local runner and verify E5/four workers/signed routes; report new temporaryURL if changed.

## Acceptance and quality limits

Success means actual code/DB fallback contracts work, not that DDGS is unlimited, official or reliably available. Denied source/lease, duplicate/unknown commit, cancelled signal, cap/cooldown and provider errors must perform zero unauthorized search. All externally sent queries come from the closed public registry. Known official procedural-answer completeness is tracked separately in ROOT-NATURAL-07; neither task may claim semantic accuracy from a mocked model.

Sources checked28October2026: [pinned DDGS9.16.1](https://pypi.org/project/ddgs/9.16.1/), [upstream library](https://github.com/deedy5/ddgs), [PostgreSQL17 ALTER TABLE](https://www.postgresql.org/docs/17/ddl-alter.html), current Supabase changelog (retrieved through native HTTPS after browser markdown content-type refusal). No relevant core PostgreSQL/DDL API break inferred from these checked entries.

## Execution evidence

Root observed initial8RED unit/config cases and provider-column ownedPGRED; implemented and passed85focused. Independent Luna high/max review found uncertain Tavily reservation could authorizeDDGS; root reproduced2reserves-vs1RED and added per-invocation admission guard. Confirmed TavilyHTTP failure after known commit still permits the intended singlefallback. Final3383unit249files/type/changedlint/fullsourceisolatedbuild,55ownedPG47migrations/exactcleanup PASS; first combinedPG failed a pre-existing all-history-vs-currentday oracle, corrected to count quota_day while retaining separate total-history assertion. No production history reset or deletion. Native pinned9.16.1 import PASS withoutnetwork; prior actualsinglequery is historical only. Guarded DEVELOPMENTdryrun→apply47/75RLS9departments and securityfixture PASS; oldledger(excludingnewproviderdefault)/documentdigests unchanged. CLI-generated migration filename renamed to sort after the existingfuture-dated46th migration.

Canonical stop initially reported control unavailable; exact saved runner/7servicePIDs all absent and state is stale, so no arbitraryprocess was stopped. Root will use canonical acquire/restart after the next source-quality slice; user manual/OA/modeltests remain deferred. No push.

Later same-day integration checkpoint: canonical hidden detached `local:ai --web-search` READY09:01Bangkok with current DDGS and ROOT-NATURAL-08 code, offlineCPU E5/384, four fresh worker check-ins and eight local/public signed-empty200/invalid401 checks. Current URL/log are in FINAL_SETUP_CHECKLIST. No actual search/model/OA conversation was invoked. The shared current-source fullunit3396/250files, type/changedlint and fullsourcebuild871matchinginputs pass; DDGS-specific55ownedPG evidence above remains scoped separately. Local commit `c1ad250` contains this DDGS implementation; no push.
