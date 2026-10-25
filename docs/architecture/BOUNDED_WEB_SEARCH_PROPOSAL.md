# Bounded Web Search — ADV-05B/C Proposal

> **Status: PROPOSED — NOT ROOT-ACCEPTED.** This document defines a reviewable backend design. It is not evidence that a connector is configured, that any live search has run, or that ADV-05B/C is implemented or accepted.

## Scope and governing requirements

ADV-05B/C completes the web-search portion of ADV-05 while preserving the current staff-assistance slice. Relevant contracts are `USR-WEB`, `USR-STAFFASSIST`, CH018, CH029–34, CH044, CH052, CH060–63, original overview §§14, 20 and 27, master guide §§52 and 63, and the current [task board](../tasks/V1_TASK_BOARD.md). The required university-information preference is:

```text
YRU structured data → reviewed YRU RAG → official YRU website → generic Internet
```

This is a source preference and answer-eligibility contract, not permission to crawl arbitrary websites. An external university's procedures, fees, deadlines, eligibility rules or forms never establish YRU policy. An unresolved YRU-policy question must say that current YRU evidence could not be verified; a generic result must not fill that gap.

The original §14 allows staff help during HUMAN mode, including knowledge search and suggested answers, while the staff member sends the reply. The current staff-assistance design likewise calls its first slice a no-knowledge/no-citation draft and reserves verified knowledge and bounded official-first lookup for ADV-05B/C. Rich Menu remains explicitly optional/deferred under the current board and is outside this proposal.

## Current implementation boundary

The repository already has strict, server-owned pieces that this proposal reuses:

- `lib/ai/tools.ts` provides strict typed schemas and an exact allowlist. Existing controlled tools cover `search_knowledge`, `search_structured`, routing and ticket creation; there is no web-search tool today.
- `lib/knowledge/answer-producer.ts` uses a bounded deterministic source-selection/answer flow. Structured selectors are fixed and validated; reviewed RAG eligibility is checked before similarity; model output cites only supplied evidence IDs. It has no live web adapter.
- `lib/knowledge/structured-search.ts`, `lib/knowledge/structured-citations.ts`, `lib/knowledge/citations.ts` and `lib/knowledge/delivery-fence.ts` provide typed source evidence, server-built citations and final revalidation for structured/RAG answers.
- ADV-05A is now verified and pushed as `a19b028`. `lib/staff/ai-assistance.ts` snapshots an authorized active HUMAN ticket, commits before provider HTTP, uses the existing FREE_ONLY generation gateway, then rechecks actor/scope/ticket/conversation/messages/departments. Its result is ephemeral and the UI places a reviewed draft in the composer; it does not send or mutate the ticket. Root is starting the separate verified-knowledge staff slice; this proposal must compose with that contract.
- `lib/imports/url-importer.ts` implements `acquireOfficialUrl()` for a known-URL **import**: HTTPS YRU host restriction, fresh public A/AAAA validation, pinned TLS, per-redirect revalidation, time/decoded-byte bounds, and provenance. It is not a web search tool or a runtime answer source; import publication still requires review.
- `lib/ai/public-addresses.ts`, `lib/ai/compatible-network.ts` and the bounded pinned HTTPS request helper provide relevant DNS/TLS/network patterns. Provider and LINE calls remain outside SQL transactions.
- The current source-aware student path has final evidence revalidation before dispatch. The staff draft path has actor/ticket snapshot revalidation and relies on the existing manual reply authorization, HUMAN-mode, revision-CAS and outbox path when the staff member later sends.

There is no configured generic-web connector/key and no live retrieval evidence in the repository. That is an honest configuration state, not a reason to leave the adapter untestable: contracts and provider behavior can be implemented and exercised against deterministic fakes while the connector reports `NOT_CONFIGURED`. No claim of live free-provider, Thai-quality, or website behavior is made here.

The student `AISnapshot`/LINE authorization is not a staff authorization contract. The staff source path must take a fresh active actor/grants/department/sensitivity snapshot for the exact HUMAN ticket, apply staff-visible evidence scope, commit before external/provider work, and recheck that staff scope plus ticket/source digest afterward. It may reuse low-level typed retrieval primitives only where their authorization assumptions fit; it must not call the student producer as if the LINE user were the staff actor or reuse a student's scope as proof for staff access.

## Proposed source cascade

The backend owns the cascade. The model cannot supply a URL, search endpoint, domain list, result count, crawl depth, raw SQL, or an unbounded tool loop. A strict, bounded intent selection is checked by backend rules before any network request.

1. **Structured YRU data.** For an exact-date, fee, course, service-hour, form-link or announcement request, use the existing fixed dataset selector and evidence rules first. A complete matching row wins. A clarification, ambiguous scope, incomplete filter, conflict or unauthorized scope stops the cascade; web search cannot guess the missing year, cohort, audience or department. A structured query that is not applicable to the topic is `NOT_APPLICABLE`, not a false empty result.
2. **Reviewed YRU RAG.** When structured data does not apply or has no eligible complete match, try the existing E5-small/384 local retrieval over reviewed sources. Approval, official/public scope, current version, effective dates, audience/student/dept applicability, amendments/cancellations and historical intent are resolved before similarity. A sufficient evidence set wins. Similarity alone cannot make an old, superseded, unreviewed or inapplicable document eligible.
3. **Official YRU web.** Only after no eligible internal evidence, the backend may call the configured bounded search adapter with a fixed allowlist of the current official hosts in master §63 (for example `yru.ac.th`, `eduservice.yru.ac.th`, `acdservice.yru.ac.th`, `stddev.yru.ac.th`, `nse.yru.ac.th`, `library.yru.ac.th`, `dormet.yru.ac.th`). The allowlist is server configuration, not a caller argument. The provider's domain filter is a first filter; every returned URL is still parsed and checked by the server.
4. **Generic Internet.** This tier is available only for a request classified and grounded as `GENERAL_PUBLIC`, or where a staff member explicitly asks for separately labeled general context. It is never a fallback answer to a YRU-policy question, including a question whose official YRU search produced no usable evidence. If intent is ambiguous, use `YRU_POLICY` and stop rather than treating a foreign institution's policy as applicable.

The cascade distinguishes `NO_MATCH` (may advance) from `CLARIFICATION_REQUIRED`, `CONTEXT_INCOMPLETE`, `CONFLICT`, `UNAVAILABLE`, `NOT_AUTHORIZED` and stale evidence (stop or state a limitation). The model cannot turn one of those stop states into permission for a lower-authority source.

### Official search results need ephemeral policy proof

The YRU domain proves only that a URL is on an allowed host; it does not establish the publisher's authority, whether the page is current/effective, or which YRU audience it applies to. The original web-search requirement calls for official YRU website fallback, while import publication approval governs persistent knowledge. No reviewed source requires a runtime page to already have an approved database source/version row. Do not make that row a prerequisite for this ephemeral fallback.

For a policy-bearing runtime answer, the backend may fetch one bounded candidate returned by official YRU search only after validating HTTPS, the exact configured host, and a server-owned host/path/topic-to-office scope. Authority comes from this scope and the page's explicit source class/issuing-office evidence, never from a domain, title, search rank, or model inference alone. The bounded fetch captures final canonical URL, HTTP status, content type, response entity byte count, SHA-256 of the received entity bytes, retrieval time, and exact bounded text spans/locators for the page title, issuing office, document class/identifier, issue date/year, explicit effective/current status, and audience/program/department/term applicability when relevant. A provider-published timestamp is not a substitute for page evidence.

The proposed evidence status is `VERIFIED_EPHEMERAL_YRU_POLICY` only when the configured source scope and exact page evidence establish authority, effective status at the request's `asOf`, and the user's applicable audience/scope; the applicable amendment/cancellation evidence is not conflicting; and the digest and source proof still pass the delivery fence. A missing/ambiguous office, document class, effective interval/current status, required year, applicability, or unresolved official-source conflict is `YRU_SOURCE_LEAD`/`CLARIFICATION_REQUIRED`, not verified policy. A bounded web search cannot prove that no later amendment exists when the official page does not itself establish current status; in that case it must remain a lead. Keep the captured page evidence ephemeral and request-bound. Never auto-import, approve, publish, or silently create a database record from it. Persistent knowledge still follows the existing import → review → publication contract; this proposal adds no separate university-approval workflow.

For non-policy public facts, an allowed official page may be shown as clearly labeled external context with its URL and retrieval time; that context does not satisfy a YRU-policy claim. Generic or foreign-university material never establishes YRU policy.

### Search is separate from known-URL import

`searchOfficialYru` and `searchGenericPublic` discover bounded result candidates through the fixed search API; neither accepts a URL from the model, caller, ticket, or conversation. For official policy lookup only, the backend may fetch at most the configured small number of candidates that pass exact host and host/path/topic-to-office checks, through a purpose-specific runtime evidence adapter. That fetch creates the ephemeral proof above; it does not import the page or establish permanent approval. Generic result URLs are not server-fetched in the first slice.

`acquireOfficialUrl()` remains a staff-supplied known-URL **import** path. It downloads an explicitly supplied, validated official page for extraction, review, versioning and eventual publication. It must not be repurposed for runtime web evidence. Runtime official search and its bounded evidence fetch are a separate automatic lookup path; neither accepts a chat-supplied URL nor enters the import/publication pipeline. Both may reuse the proven pinned-DNS/TLS primitives with their own tighter limits.

For the initial generic-search slice, consume only the search API's bounded result snippets and HTTPS citations; do not server-fetch arbitrary generic result URLs or crawl their domains. The browser may follow an explicitly displayed citation URL, but the backend makes no second outbound request to it.

## Typed adapter and evidence contract

Use private backend adapters, not model-controlled network functions. Suggested service shapes (names are proposals):

```ts
type SearchPurpose = 'OFFICIAL_YRU' | 'GENERAL_PUBLIC';
type PublicTopicCode = string; // strict enum/registry code, never arbitrary provider options

type WebSearchRequest = {
  purpose: SearchPurpose;       // derived/authorized by backend policy
  topicCode: PublicTopicCode;   // validated against server-owned public vocabulary
  explicitYear?: number;        // only when explicit and already grounded by source scope
};

type WebSearchStatus =
  | 'NOT_CONFIGURED' | 'NOT_APPLICABLE' | 'NO_RESULTS' | 'SOURCE_LEAD'
  | 'QUOTA_EXHAUSTED' | 'RATE_LIMITED' | 'UPSTREAM_UNAVAILABLE';

type WebSourceEvidence = {
  sourceId: string;             // server-created opaque ID bound to this result set
  sourceKind: 'VERIFIED_EPHEMERAL_YRU_POLICY' | 'YRU_SOURCE_LEAD' | 'GENERIC_CONTEXT';
  title: string;
  canonicalUrl: string;          // server-validated HTTPS URL
  snippet: string;               // bounded provider result text, untrusted
  retrievedAt: string;
  publishedAt: string | null;    // provider metadata only; not an effective date
  pageProof: {
    httpStatus: 200;
    contentType: string;
    entityBytes: number;
    sha256: string;
    sourceScopeCode: string;      // server-owned host/path/topic-to-office mapping
    authorityClass: string;       // server enum supported by exact page evidence
    evidenceSpans: Array<{ field: string; exactText: string; locator: string }>;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    applicabilityCode: string | null;
  } | null;
  internalSourceRevision: number | null; // only for an independently matched DB source
};
```

The concrete TypeScript contracts must be strict Zod schemas (`.strict()`), size-limited, and tied to an actor/ticket snapshot and request digest. The model may cite only `sourceId`s included in its context. The server constructs titles, host labels, citations and timestamps from validated evidence; the model cannot invent, edit or add a URL. A provider `published_date` is not a YRU effective date. A generic result always has `pageProof = null`, `internalSourceRevision = null`, and `sourceKind = GENERIC_CONTEXT`. A YRU source lead may carry a partial page proof, but it cannot satisfy policy evidence.

### Query minimization

Do not send ticket summaries, student/case messages, technical LINE identities, user identifiers, internal ticket/conversation/message IDs, private document passages, structured row payloads or provider prompts to the search vendor. Do not claim a detector makes arbitrary text safe.

The default query builder should use a server-owned vocabulary of public topic/category/system/family labels and only explicitly grounded public selectors such as an academic year. For example, a `LIBRARY_HOURS` code can map to a fixed phrase assembled by the backend; the original ticket text never enters the provider request. If broad free-form generic search is required, expose it as a separate, explicit public-query field/action that is not prefilled from the ticket or conversation; bound it and send only that one field. Such an explicit field is not a claim that user-entered text is free of personal data.

The vendor receives only the public query, chosen locale, fixed source purpose/domain filter and bounded search settings. Search logs store provider, request ID, purpose, status, credit count, elapsed time and opaque source digests; never store the API key, complete query, case text or raw provider body. Existing model prompts remain behind the separate FREE_ONLY inference gateway.

## Provider evaluation and free-only contract (verified 2026-10-08)

### Candidate: Tavily Search, conditional recommendation

Tavily is a conditional first-adapter candidate because its official pricing page describes the Researcher free plan as **1,000 API credits per month**, no credit card required, and says requests stop at exhaustion until reset or upgrade. Pay As You Go is separately priced at **$0.008 per credit**. The official Search API is `POST https://api.tavily.com/search`, Bearer-key authenticated, returns bounded result URLs/content and per-request credit usage, supports `include_domains` with `include_domains_mode: restrict`, and documents plan-limit errors (including HTTP 432) and pay-as-you-go-limit errors (433). `basic`, `fast` and `ultra-fast` are one credit; `advanced` is two. Tavily documents a configurable monthly API-key usage limit.

Proposed fixed request: `search_depth: 'basic'`, `max_results: 5`, `chunks_per_source: 1`, `include_answer: false`, `include_raw_content: false`, `include_images: false`, `auto_parameters: false`, `include_usage: true`, and `include_domains_mode: 'restrict'` for official YRU searches. Set `include_domains` from server configuration only. The public documentation currently describes a 100 requests/minute Development limit and 1,000 requests/minute Production limit; the app's tighter caps below remain authoritative.

Tavily's primary pricing page establishes a hard stop for a free-plan account at exhaustion, but does not make a paid account or Pay As You Go safe for `FREE_ONLY`. The official `GET https://api.tavily.com/usage` reference documents key-level `usage`/`limit` and account-level `current_plan`, `plan_usage`/`plan_limit`, `paygo_usage`/`paygo_limit`, plus endpoint counters; it optionally accepts `X-Project-ID`. This is an observability endpoint, not a credit reservation: the docs promise no atomic reservation or no-charge preflight, and another key/user can change account usage or plan state after a read. Do not treat any `/usage` value, a project-scoped view, a key limit, or a PAYG spend cap as proof that the next search cannot incur a charge. A PAYG limit is still a paid ceiling, not free service. Missing, unknown, or unexpected usage fields fail closed for any monitoring decision and must not be interpreted using guessed sentinel values.

The no-paid operating condition is a provider account kept on the Researcher free plan with Pay As You Go disabled and no automatic upgrade, plus no app path to paid fallback. A shared account can remain `FREE_ONLY` only while that account-level condition is held: other users/keys may consume the free pool and make this app unavailable, but the free tier's published exhaustion behavior is to stop. If other account users can enable PAYG/upgrade, or the app cannot verify/attest that the account remains free-only, this application cannot guarantee no paid search from its own counters or `/usage` preflight; keep the connector disabled (`FREE_ONLY_UNVERIFIABLE`) until normal provider configuration isolates or constrains it. A per-key monthly cap and the app's own atomic local quota are defense in depth and availability controls, not substitutes for the account-level no-PAYG condition.

The service's search query is still data sent to an external provider. Its privacy policy says user-provided query data is used to retrieve content, may be used in portions to improve future responses, and may be sent to third-party search-index providers when its own index cannot retrieve content. Its Terms also describe training/improvement use for Customer Input and Output submitted to AI Functionality. This is why the design sends public vocabulary rather than private case context; it is data minimization, not a privacy guarantee or additional approval prerequisite.

Sources: [Tavily pricing and free-plan exhaustion behavior](https://www.tavily.com/pricing), [credit reset](https://help.tavily.com/articles/6846808029-understanding-api-credits-reset), [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search), [Usage API reference](https://docs.tavily.com/documentation/api-reference/endpoint/usage), [Pay As You Go monthly spending cap](https://help.tavily.com/articles/8280756099-how-to-set-a-limit-for-pay-as-you-go-option), [rate limits](https://help.tavily.com/articles/3240802908-rate-limits), [API-key monthly limit](https://help.tavily.com/articles/9170796666-how-can-i-create-an-api-key), [privacy policy](https://www.tavily.com/privacy), [Terms](https://www.tavily.com/terms).

### Comparison: Exa Search is not yet a free-only choice

Exa's official pricing page currently says $10 credits each month plus a $10 onboarding bonus (the monthly grant is recurring; the separate bonus is an onboarding grant), no payment method required, and 10 QPS. Search pricing is $4/1,000 Instant requests or $7/1,000 Fast/Auto requests (up to 10 results; additional-result pricing applies above that). Its Search API supports an `includeDomains` filter and returns `costDollars`, and it lists HTTP 402/429 outcomes. However, the official pages reviewed do not document that API calls hard-stop at free-credit exhaustion without any billable transition, nor do they expose a remaining-free-credit preflight. The Team Management usage endpoint reports billing totals for an API key and requires a service key/team feature; it is not a remaining-credit check. Exa's privacy policy says Query Data is used to improve products and technology, including model training/fine-tuning. A model `costDollars` field is post-request evidence, so it cannot authorize a request as free in advance.

Do not describe Exa as `FREE_ONLY` or enable it as a no-paid fallback unless its current account/product contract demonstrates a hard non-billable stop and the app can bind that limit to the configured key/account. Sources: [Exa pricing](https://exa.ai/pricing), [Search API reference](https://exa.ai/docs/reference/search), [API-key usage reference](https://exa.ai/docs/reference/team-management/get-api-key-usage), [privacy policy](https://exa.ai/privacy-policy).

### What the existing `FREE_ONLY` gate does and does not prove

`lib/ai/cost-policy.ts` authorizes generation models using fresh trusted model-price evidence. It has no search-service price/credit contract and cannot infer an external account's shared balance from this application's own logs. Therefore a web-search adapter must have a separate cost/credit gate; it must not be inserted into model pricing as if it were a generation model.

For a Tavily free-only configuration, require a provider-account configuration that stays on the Researcher free plan with Pay As You Go disabled, a scoped app key, no automatic paid fallback, and an account owner who controls that setting. The app can apply a monthly API-key limit as defense in depth. Proposed engineering budgets (not source requirements) are at most **800 basic-search credits per application UTC calendar month** and **20 basic-search credits per staff actor per Bangkok calendar day**, reserving the remaining published free allowance for account variance and failed/manual activity. A persistent atomic reservation is made and committed before outbound HTTP; do not refund an uncertain attempt. A shared free-only account may run out early because other keys consume the account pool; local limits do not represent account remaining credits. There is no search call if local reserve fails, the key is absent, or the provider account is not configured/attested free-only. If the app cannot bind the key to that no-PAYG account condition, report `FREE_ONLY_UNVERIFIABLE`/`NOT_CONFIGURED` and make no call.

Make at most one provider attempt per needed tier; disable retries and cross-provider fallback. A provider 432/433, rate limit, timeout, malformed response or non-2xx is an unavailable-search result, never a reason to use PAYG or another unverified free endpoint. `/usage` may support periodic/operator monitoring of its documented key/account usage fields, but a read immediately before `/search` is not a payment guard because it is not an atomic reservation and does not lock shared account settings. A 433 response is a stop signal, not proof that earlier requests were free. Record provider-reported per-request usage when present and present connector quota scope honestly.

## Network, request and response bounds

All numerical caps below are proposed defaults for root to review; they are application limits, not guarantees supplied by the vendor.

| Boundary | Proposed first-slice cap |
|---|---:|
| Provider request destination | Fixed `https://api.tavily.com/search`; no caller endpoint or proxy |
| Per request | 1 call for the selected eligible tier; at most 2 calls total only when policy explicitly permits distinct YRU and generic context |
| Search mode/results | Basic, 5 results, 1 chunk/source, no generated answer/raw page/image/auto mode |
| Query | ≤240 Unicode scalar values and ≤960 UTF-8 bytes after fixed-vocabulary construction; measure serialized request body separately |
| Serialized search request | ≤4,096 UTF-8 bytes after `JSON.stringify`/equivalent, including every fixed field and the exact configured domain array; reject over-cap, do not truncate |
| Official search domains | At most the seven exact hosts currently listed for this purpose; if the reviewed list grows, explicitly re-bound the serialized cap rather than silently dropping hosts |
| Search response | 512 KiB streamed maximum; parse only required fields; reject malformed/oversize body |
| Result fields | title ≤240 chars; URL ≤2,000; snippet ≤1,200; ≤5 results; published date nullable |
| Provider deadline | 5 seconds total including DNS/connect/TLS/read; abort and discard on timeout |
| Runtime official-page fetch | ≤256 KiB decoded entity bytes, ≤5 seconds, no cookies/auth; up to 2 redirects, each revalidated, and all hosts remain on the fixed YRU allowlist |
| Retry | 0 retries; every dispatch reserves budget first |

The provider adapter uses a fixed HTTPS origin, fresh public A/AAAA resolution, rejection if any resolved address is non-public, pinned socket IP with original hostname/SNI verification, strict TLS and a bounded streamed body. Construct the fixed request object, serialize it, measure `TextEncoder().encode(serialized).byteLength`, and reject above 4,096 bytes. This body cap includes the query, all fixed booleans/options, and the server-selected official domain array; the query's independent ≤960-byte UTF-8 cap follows from at most 240 Unicode scalar values. Do not follow a redirect from the search API; if the provider response redirects or the origin changes, fail closed. Never log the authorization header, request body, complete results or raw upstream error body.

Returned candidate URLs are untrusted data. Parse with the platform URL parser; require HTTPS, no userinfo, no unexpected port, no control characters, no IP literal, and canonicalize the hostname. An official YRU candidate must equal a configured official host or be its dot-delimited subdomain; reject lookalikes such as `yru.ac.th.example.net`. Do not accept a provider domain filter as a substitute for the server check.

For a YRU candidate selected for runtime policy proof, resolve every A/AAAA record freshly, reject mixed/private/special-use answers, pin the chosen public address while preserving the original TLS hostname, disable cookies/authorization, and revalidate every redirect against the official allowlist. The proposed 256 KiB/5-second runtime limit is intentionally separate from the importer's 20 MiB/10-second acquisition budget. Generic results are not fetched server-side in the first slice. Hash the bounded decoded entity bytes and retain only the digest plus exact short evidence spans/locators in the ephemeral proof, not the full page body.

## Citation, authority and final-delivery fence

Every result entering an answer/draft is server-normalized and bound to an opaque `sourceId`, request digest, actor/ticket snapshot (when staff), retrieval time and bounded content digest. The answer schema permits citations only to those IDs. The server builds citation labels and URLs. Search results and snippets are untrusted instructions/evidence and are quoted or summarized only as source content.

For YRU policy sources, eligibility is checked in this order before any model answer: configured official host and host/path/topic-to-office scope → explicit issuing office and source class with exact page-text basis → effective/current status at the query's `asOf` time → audience/department/program/student applicability and explicit historical scope → bounded applicable amendment/cancellation conflict check → ephemeral page digest and extracted proof bound to this request → answer. An existing approved DB source/version may corroborate the page, but is not a runtime prerequisite. Do not use similarity/rank to override a failed proof condition. Search-provider publication time does not stand in for source effective time, and absence of a later result in bounded search is not proof that no amendment exists.

For student answers, the final delivery fence must revalidate internal source revisions and recheck each ephemeral official-page proof immediately before dispatch without making network requests inside SQL. Proposed two-phase fence: load the dispatch/ticket/source snapshot and commit; perform a fresh bounded official-page fetch outside the transaction when the stored fetch is outside the short freshness window (proposed 60 seconds) or runtime proof must be refreshed; then enter the existing short delivery-lock transaction and compare ticket/revision/authorization plus the refreshed source URL, digest, extracted authority/effectivity/applicability proof and request-bound citation IDs before dispatch. A fetch failure, digest change, changed applicability, or stale proof discards the answer for regeneration/clarification; a generic citation cannot satisfy YRU-policy proof. The freshness window is an engineering proposal, not a source requirement. This cannot freeze a public page against changes after the final fetch, so the citation records its retrieval time and digest.

For staff assistance, network and generation calls occur after the fresh staff actor/grants/department/sensitivity snapshot transaction closes. Before returning the ephemeral draft, reload and compare that staff/ticket/conversation/message/source snapshot; refresh an aged official-page proof outside SQL and compare its digest and policy proof. A changed ticket, new message, lost grant, mode change, changed/stale page proof or unresolved lead discards the whole result. Display source URL, exact evidence basis and retrieval time beside verified citations; a source lead is visibly a lead, not a verified rule. The draft remains a snapshot for staff review and the existing normal reply action; do not insert an outbox row, automatically send, change ticket state or bypass reply authorization/CAS. If a citation is retained past its short freshness window, the manual delivery path must not present it as newly verified without revalidation. Existing manual-send rules remain the delivery gate.

## Acceptance cases for ADV-05B/C

The implementation is not accepted until the root-owned implementation has automated coverage for each of these behaviors and the board/matrix reflect evidence separately from live setup:

1. A complete, eligible structured row answers first and causes zero RAG/web calls. A structured selector that is inapplicable advances appropriately; missing required scope, ambiguity, conflict or unauthorized access stops with no external call.
2. With no structured match, sufficient reviewed current/effective/applicable RAG answers and causes zero web calls. Superseded, expired, wrong-audience, unapproved, conflicted, or amendment-incomplete evidence does not win on similarity.
3. An eligible YRU-policy miss invokes only the fixed official YRU domain list and bounded runtime page-fetch adapter. A forged foreign/lookalike URL or host/path/topic outside configured office scope is rejected even if returned by the provider. A page with complete exact ephemeral authority, current/effective, applicability and digest proof can be cited even when no database source row exists; it is never automatically imported or published. Missing/ambiguous metadata, unknown effective status, changed digest or unresolved official-source conflict yields a labeled source lead/clarification and cannot answer policy.
4. A YRU-policy miss never answers from a foreign university or generic source. A `GENERAL_PUBLIC` request can use generic result citations clearly labeled as external context. Ambiguous intent defaults to YRU policy and does not call the generic tier.
5. Runtime official search may fetch only validated official candidates to build ephemeral evidence; generic result URLs are not fetched. Known-URL import still follows the separate staff-supplied import/review pipeline and is never invoked from runtime search or a chat-supplied URL.
6. No key/config means `NOT_CONFIGURED`, zero provider network calls, and no false `searched`/success claim. A deterministic fake adapter can still test all contracts. No live provider or YRU website test is claimed without its evidence.
7. Query construction caps 240 Unicode scalar values and 960 UTF-8 bytes; after complete JSON serialization, the request (including all fixed fields and up to seven exact official domains) is capped at 4,096 UTF-8 bytes. Boundary tests measure serialized bytes; no truncation is allowed. Response/page bytes, result count, deadline, redirects, DNS/address, TLS/host, malformed JSON and content-type limits fail closed. Verify pinned DNS, mixed/private IP rejection, redirect revalidation and no network inside a transaction.
8. Search credits are reserved atomically in the app before HTTP. Local monthly/daily quota exhaustion yields zero network calls; provider 432/433/429/5xx/timeouts do not retry or switch to paid/unknown providers. Tavily `/usage` is tested/documented as observability only; a shared-account consumption race or unknown/PAYG-enabled account state cannot be authorized by that read. No-key or no-free-only-account-configuration yields `NOT_CONFIGURED`/`FREE_ONLY_UNVERIFIABLE` with zero provider calls. Logs omit keys, raw queries, case text and response bodies while preserving safe status/latency/request-id/credit observations.
9. In-flight ticket revision/message/grant/mode change or source proof change discards the draft/answer. Student outbox delivery rechecks aged official-page proof outside SQL and compares its final digest/effectivity/applicability in the short dispatch lock; changed/failed proof is discarded. Staff receives only a fresh ephemeral cited draft and must send through the current manual reply path.
10. `pnpm typecheck`, relevant focused tests, full `pnpm test`, `pnpm lint`, `pnpm build`, and actual database/migration/RLS tests pass on the final combined source. A live Tavily account configuration, actual provider billing state, available credits, official-scope mapping and YRU page quality remain separate evidence; no missing evidence is marked PASS.

## Decisions left for root

This design does not set board or requirement status. Root owns acceptance of the provider, public-query vocabulary, proposed quotas/bounds, ephemeral source-scope/proof contract, any persistence/migration for usage reservations, and integration with the current ADV-05A staff-assistance changes. The recommendation is Tavily as a **conditional free-tier adapter candidate**, not a connector already selected by the university. No extra university approval gate is proposed; configuring a provider/key and source-scope map follows normal explicit technical configuration, while persistent publication still uses the existing review contract. The implementation can be built with no key and must report `NOT_CONFIGURED` until routine setup supplies one; if an account cannot be verified as no-PAYG/free-only, it must report `FREE_ONLY_UNVERIFIABLE` and make no provider call.
