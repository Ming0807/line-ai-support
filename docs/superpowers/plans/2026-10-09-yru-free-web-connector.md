# ADV-05C-2-T/R — fixed free-search connector and durable admission

9 October 2026 root; CH032/052/USR-WEB, original overview§27/master§32. Read AGENTS/index/current board/requirements/system/source cascade and DEC-060/071. Depends on accepted C2-Q. Root accepts the contract below under continuous V1 authorization; the broader vendor proposal remains unaccepted. This slice establishes the connector/admission boundary. Producer, semantic scope, complete internal-miss proof, source authority, Student dispatch and Staff draft integration remain separate required work; no low-level adapter call itself grants permission to search or to answer university policy.

## C2-T frozen network adapter

Actual requested Luna high owns only new `lib/knowledge/tavily-search.ts` and `tests/tavily-search.test.ts`. Root owns contract, caller/admission, DB/privacy, integration and final gates. No package installation, live network, provider secrets/env edits, SQL/migration/old-source edits, authority acceptance or Git.

Execution update: the requested Luna high hit its usage limit before this assignment ran. Root owns the actual adapter/test implementation and review; no delegated implementation/review result is credited for C2-T. The requested Luna max combined-flow assignment also failed at the limit before execution; root retains that work.

Export `createTavilySearchAdapter(options?)` returning:

```ts
interface TavilyUsage {
  keyUsage:number; keyLimit:number;
  currentPlan:string; planUsage:number; planLimit:number;
  paygoUsage:number; paygoLimit:number;
}
interface TavilyCandidate {title:string;url:string;content:string;score:number}
interface TavilySearchResult {requestId:string;credits:1;results:readonly TavilyCandidate[]}
interface TavilySearchAdapter {
  usage(apiKey:string,signal:AbortSignal):Promise<TavilyUsage>;
  search(input:unknown,apiKey:string,signal:AbortSignal):Promise<TavilySearchResult>;
}
```

`options` contains test-only public resolver and `PinnedHttpsRequest` seams matching the existing `compatible-network.ts` types; default uses `resolvePublicAddresses` and `createPinnedHttpsRequest`. These are server-only injection seams, never browser/input-controlled endpoints. Export `TavilySearchError` with fixed message equal to one of `WEB_SEARCH_INVALID`, `WEB_SEARCH_UNAVAILABLE`, `WEB_SEARCH_TIMEOUT`, `WEB_SEARCH_CANCELLED`, `WEB_SEARCH_RATE_LIMITED`, `WEB_SEARCH_FREE_LIMIT`. Optional `httpStatus` is integer100..599 only. No raw error/provider body/key/query logs or messages.

- Only `https://api.tavily.com/usage` GET and `https://api.tavily.com/search` POST; Bearer auth, JSON Accept, POST content type/byte length. Endpoint/headers never come from model/input. Keys are nonempty printable ASCII1..512 with no spaces/control characters. A cancelled/invalid call performs no resolver/transport work.
- Rebuild POST query with `buildPublicSearchQuery(input)`; no caller query/domain override. Fixed body: `query`, `topic:'general'`, `search_depth:'basic'`, `max_results:3`, `include_domains` from builder, `include_domains_mode:'restrict'`, `include_answer:false`, `include_raw_content:false`, `include_images:false`, `include_image_descriptions:false`, `include_favicon:false`, `auto_parameters:false`, `include_usage:true`. No other case/identity/URL/history/model data. These bounds/options are engineering choices, not claims copied from the user spec.
- Fresh DNS,1..64 addresses and every address public; pin first public address while preserving TLS/SNI. Reuse the existing native bounded JSON socket transport; no redirect/retry/paid fallback. Race BOTH resolver and transport against a4-second usage/8-second search deadline even if a test seam ignores abort. Parent abort cancels promptly; clean all timers/listeners and consume late rejection.
- Response limits: usage32KiB; search256KiB. Socket enforces bytes/content type/identity encoding; bound/copy injected JSON before validating too. Usage requires nonnegative safe integers for exact documented key.usage/key.limit and account.current_plan (1..80 chars)/plan_usage/plan_limit/paygo_usage/paygo_limit. Ignore other bounded JSON fields, never project them. Eligibility decisions are root caller work.
- Search requires request_id UUID, usage.credits exactly1 and results array0..3; entries title1..500, URL1..2048, content0..4000, finite score0..1. Empty is a complete response, malformed/over-budget is unavailable. Candidate URL must be canonical HTTPS/no userinfo/port/IP literal/fragment/control/backslash, hostname DNS syntax; no fetch of result URLs. YRU-purpose candidates must match exactly the builder's allowed hostname or its subdomains; unexpected hosts make the whole response unavailable, not a filtered fake miss. General candidates are only public-source leads, not university authority. Returned values are detached/deep frozen. Ignore bounded extras; don't retain provider echo/answer/raw content/images.
- Map429 to RATE_LIMITED;432/433 to FREE_LIMIT; every other non200 (including3xx) to UNAVAILABLE with safe status. Invalid JSON/shape/oversize/provider error never becomes empty. Native TLS/address/socket failures map fixed errors. Search status/request ID/credits are observations, not source authority or a no-charge guarantee.

Primary vendor API/pricing checked9October: [usage](https://docs.tavily.com/documentation/api-reference/endpoint/usage), [search](https://docs.tavily.com/documentation/api-reference/endpoint/search), [pricing](https://www.tavily.com/pricing). A live response/current plan/no-PAYG owner setup is still unobserved. No inference FREE_ONLY fact authorizes a search call.

## C2-R root admission/reservation contract

Root owns `lib/knowledge/web-search-runtime.ts`, its unit tests, a CLI-generated additive private quota/attempt migration, actual owned PG admission tests and verification-runner registration. Freeze exact schema/privileges/identities before migration authoring. Default is disabled. Missing key/owner free-only attestation, unknown/conflicting usage plan, paygo enabled/used, exhausted key/account budget, invalid request, cancellation, missing quota infrastructure or duplicate consumed attempt makes zero POST searches. Usage GET requires owner free-only attestation first; it is a fresh observation, not atomic vendor billing authorization.

The app reserves exactly1 basic-search unit in an atomic DB transaction and commits before POST. Reservation is durable and purpose/owner/tier-bound; worker takeover/timeout/unknown transport cannot refund or repeat it. All configured keys share one app quota so key replacement cannot reset capacity. Engineering bounds to freeze in the schema plan: calendar UTC day50/month500 attempts, shared Student+Staff budget. Vendor account owner controls free Researcher/no-PAYG/no automatic paid upgrade; the app cannot prevent later external account mutation. Never enable paid search/fallback or claim local counters prove vendor billing state.

## Checks and checkpoints

- [x] Root adapter RED→17GREEN: minimized fixed request, invalid/cancelled zero calls, public pin/endpoint/SNI seam, mixed/private DNS, safe URL projection/official-host rejection, detached output, complete empty versus malformed, ignored-abort deadlines, non200/rate/free-limit/no retry and fixed redacted errors. Requested Luna high hit its limit before execution; no delegated result is credited.
- [x] Root adapter review and meaningful RED→GREEN admission/reservation/runtime gates;15 actual DB concurrency/deduplication/committed-unknown/no-refund/least grants/retention checks. No network in SQL.
- [x] Root2,007unit/type/full lint/build/321ownedPG/37replay/RLS/advisors and15fresh final-helper PG pass. [Evidence](../../reports/FREE_WEB_CONNECTOR_REPORT.md) scopes the helper refinement and timeout correction. No normal/remote migration apply follows this preparation component.
- [ ] Integrate with the accepted complete internal-miss and result/source/retention contract; Student/Staff/delivery tests and actual source lead/proof coverage are required before full web acceptance.
