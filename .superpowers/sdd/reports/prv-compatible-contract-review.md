# PRV-02C compatible-provider contract review

Date: 2026-10-05  
Reviewer: `/root/prv_compatible_review`  
Scope: read-only design/security review of the compatible Chat Completions and embeddings contract. This report is implementation guidance, not evidence that the transport, migration, UI, or tests exist or pass.

## Verdict

The existing provider boundary is closed over three official adapters and their fixed HTTPS roots. A compatible-provider slice can fit the current gateway, but it must add a bounded, code-installed protocol adapter and a pinned HTTPS transport. Accepting an arbitrary base URL in the existing fetch adapters would weaken the current fixed-host guarantee and create an authenticated SSRF proxy.

The highest-risk integration point is admin save ordering. `providerWrite` authenticates a staff session before calling the admin operation, but SUPER_ADMIN authorization currently occurs inside `provider-admin.ts`'s SQL transaction. Do not put DNS resolution before that authorization, or perform it while that transaction is open. The save path needs a short authorization/snapshot transaction, DNS validation after commit, then a final transaction that reauthorizes, locks, compares revisions, and persists atomically.

No implementation files or tests were changed or executed for this review. No live provider request, credential, environment file, or database was accessed.

## Sources and current implementation

Reviewed `AGENTS.md`, the project index, current task board, decision log, provider design, system design, the 5 October cooldown/compatible plan, the requirements source index and original overview §§32–36, master guide §§14/29/30, and matrix rows CH014/029/030 plus USR-FREE/USR-UI.

Relevant source state:

- [`types/providers.ts`](../../../types/providers.ts) accepts only `ZEN`, `OPENROUTER`, and `OPENAI`; provider schemas require the corresponding exact official base URL. [`provider-registry.ts`](../../../lib/ai/provider-registry.ts) pins Zen/OpenRouter endpoints and registers native OpenAI separately. There is no compatible adapter or free-form endpoint UI in [provider-forms.tsx](<../../../app/(dashboard)/providers/provider-forms.tsx>).
- [`provider-admin.ts`](../../../lib/ai/provider-admin.ts) authorizes SUPER_ADMIN inside `run()`, which owns the SQL transaction. Create/update currently validate fixed endpoint choices and persist the encrypted key in that transaction. Provider updates require a replacement key when adapter/base URL changes.
- [`pricing.ts`](../../../lib/ai/pricing.ts) only trusts Zen/OpenRouter catalogs; all other adapters return `UNKNOWN`. [`authorizeModelCost`](../../../lib/ai/cost-policy.ts) blocks `FREE_ONLY` unless fresh trusted pricing is exactly zero, before key decryption. [`model-probe.ts`](../../../lib/ai/model-probe.ts) currently allowlists only the three official adapter kinds and forces selected inference probes to `FREE_ONLY`.
- Generation and embedding adapters bound input/output and use `redirect: 'error'`, but their injectable fetch transport does not pin resolved addresses. The compatible transport should be a separate native HTTPS implementation; official adapter behavior and its exact roots should stay fixed.
- Current public DTOs return endpoint and `keyConfigured`, not the key. Normalized provider errors expose a fixed error code and optional actual HTTP status. Preserve those privacy properties.

## Required interaction contract

Use the existing authenticated provider create/update APIs. A compatible provider row is a protocol selection, not an arbitrary network tool. Only the installed `COMPATIBLE` implementation may consume it, and it may issue the fixed standard paths below. Do not accept caller-supplied HTTP methods, headers, request paths, schemes, or redirects.

For create/update, the sequence should be:

1. Parse and normalize the candidate URL without network access. Verify the active SUPER_ADMIN in a short committed transaction. For updates, read and return the expected provider/configuration revisions in this preflight.
2. Outside every SQL transaction, resolve A and AAAA records and reject an empty or unsafe address set. Keep any accepted DNS snapshot in memory only for this validation; never persist it or reuse it for a later request. A DNS failure is a safe save failure.
3. Start a new SQL transaction, reauthorize the actor, lock in the existing provider-first order, compare the expected revision and current network identity, then insert/update plus audit in one commit. A concurrent edit returns conflict. Do not decrypt or transmit the replacement key during validation.

At runtime and for each manual network action, reload the authorized configuration snapshot, pass the fresh endpoint through the same parser, resolve/validate again, and pin that request to one address from that exact resolution result. DNS, TLS, provider HTTP, and body reading all stay outside SQL transactions. Each outbound HTTP request performs a new resolution; a reused socket or global agent would bypass that guarantee.

Changing adapter/platform, host, or key requires a replacement key when the existing key might otherwise cross that boundary. Increment a network identity revision on any effective endpoint/key/model ID/purpose/embedding-dimension change. Preserve the ordinary configuration revision for UI concurrency. Path-prefix changes also change network identity even if they keep the same host. Network cooldown evidence must be attached to the network identity revision so a renamed/reordered row does not erase it and a different key/endpoint cannot inherit it.

## Recommended typed boundary

Keep the transport narrow enough that it cannot become a proxy. The public methods below are the proposed application contract; resolver and HTTPS request functions should be injectable behind the implementation for tests.

```ts
export type CompatibleRoute =
  | 'models'
  | 'chat/completions'
  | 'embeddings';

export interface CompatibleEndpoint {
  /** Canonical HTTPS origin plus optional API prefix; no query, fragment, or credentials. */
  readonly baseUrl: string;
  readonly origin: string;
  readonly hostname: string;
  readonly pathPrefix: string;
}

export function parseCompatibleBaseUrl(value: unknown): CompatibleEndpoint;

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type ResolvePublicAddresses = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly ResolvedAddress[]>;

export type CompatibleHttpRequest =
  | { route: 'models'; apiKey: string; signal: AbortSignal }
  | { route: 'chat/completions'; apiKey: string; json: unknown; signal: AbortSignal }
  | { route: 'embeddings'; apiKey: string; json: unknown; signal: AbortSignal };

export interface CompatibleHttpResponse {
  /** Preserve the actual upstream status, including redirects and error responses. */
  readonly status: number;
  readonly contentType: string | null;
  /** Bounded, internal-only hint for PRV-04 retry normalization; never log raw headers. */
  readonly retryAfter: string | null;
  /** Parsed only for a bounded successful JSON response; never include in errors/logs/DTOs. */
  readonly json: unknown | null;
}

export interface PinnedHttpsRequestInput {
  readonly url: URL;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | null;
  readonly pinnedAddress: ResolvedAddress;
  readonly signal: AbortSignal;
  readonly maxResponseBytes: number;
}

export type PinnedHttpsRequest = (
  input: PinnedHttpsRequestInput,
) => Promise<CompatibleHttpResponse>;

export interface CompatibleTransport {
  request(
    baseUrl: string,
    request: CompatibleHttpRequest,
  ): Promise<CompatibleHttpResponse>;
}

export function createCompatibleTransport(options?: {
  resolvePublicAddresses?: ResolvePublicAddresses;
  requestImpl?: PinnedHttpsRequest;
}): CompatibleTransport;

export function createCompatibleChatAdapter(options: {
  transport: CompatibleTransport;
}): AIProviderAdapter;

export function createCompatibleEmbeddingAdapter(options: {
  transport: CompatibleTransport;
}): EmbeddingAdapter;
```

`PinnedHttpsRequest` should be an internal narrow function, not an arbitrary `fetch` option bag: it receives only a canonical URL, fixed method/path, bounded JSON bytes, bearer key, verified `{address,family}` pin, abort signal, and fixed response limits. Build these paths only by joining the normalized prefix with `/models`, `/chat/completions`, or `/embeddings`; accept no path from the request payload. Restrict method/route pairs (`GET` for `models`, `POST` for the two inference routes).

Suggested integration files are `types/providers.ts`, `lib/ai/compatible-network.ts`, `lib/ai/providers/compatible-chat-completions.ts`, `lib/ai/providers/compatible-embeddings.ts`, `lib/ai/provider-registry.ts`, `lib/ai/model-probe.ts`, `lib/ai/provider-admin.ts`, `lib/ai/provider-pricing.ts`/`lib/ai/pricing.ts`, the existing provider form, one additive provider migration, and focused unit/PostgreSQL/browser fixtures. Do not alter Zen/OpenRouter/OpenAI fixed roots or dynamically load adapter code from a row. Keep protocol evolution explicit: a later protocol requires a code adapter.

## URL, DNS, and TLS rules

- Accept HTTPS only. Reject any userinfo, query, fragment, IP-literal hostname, non-default port, localhost/single-label/local-use hostname, backslash, control/whitespace, or ambiguous encoded path. URL parsing must not silently normalize a `..`/encoded-dot path into an accepted value. Normalize host case/IDNA through `URL`; normalize the optional safe path prefix to one slash between segments and no trailing slash. Preserve path case. `/v1/` and `/v1` should produce the same canonical base and exactly one appended route segment.
- For host resolution, Node v24 provides `node:dns/promises.Resolver`, `resolve4()`, `resolve6()`, and `cancel()`. Prefer a per-request resolver using the system-configured recursive servers and query both A and AAAA. Unlike `dns.lookup()`, `resolve*()` performs DNS protocol queries rather than consulting `/etc/hosts`; `Resolver.cancel()` provides a cancellation point for the shared request deadline. Treat only an explicit no-data answer for one family as empty; other resolver failures fail closed. Do not use an injected `dns.lookup` result alone as proof of public DNS.
- Parse and classify every returned address before choosing one. Reject the entire answer set if any address is private, reserved, loopback, link-local, unspecified, multicast, documentation, shared-address, IPv4-mapped IPv6, NAT64/translation, tunnel, or otherwise special/non-global. A mixed public/private set must fail as a whole. Use a reviewed IP parser/CIDR classifier and conservative policy based on the live IANA special-purpose registries; Node core does not provide an `isPublicUnicast` predicate.
- In Node v24, `node:https.request()` accepts the HTTP `lookup` option and TLS options including `servername` and `rejectUnauthorized`. Pass a custom `lookup` that returns only the chosen checked `{address,family}` pin, while the request URL/hostname remains the configured domain. Set `servername` to that hostname and `rejectUnauthorized: true`; leave Node's default `checkServerIdentity` intact. This keeps Host/SNI/certificate hostname verification tied to the hostname while TCP connects to the checked address. Never disable TLS checks or send the key before the pin is accepted.
- Do not use `https.globalAgent`: Node's HTTPS global agent keeps connections alive, so a later request might reuse an old connection without fresh DNS. Use `agent: false` or a one-request non-keepalive agent with a fresh resolver result each time. Disable redirects by construction: native `https.request` does not follow them. A 3xx response is an upstream response with its real status, not an instruction to contact `Location`.
- Bound request bytes, response bytes, response headers, DNS time, TLS/connect/response time, and total operation deadline. Use the existing gateway/probe `AbortSignal`; cancellation must cancel DNS where possible, destroy the `ClientRequest`, and stop/cancel a stalled response stream. Ensure late DNS/request callbacks cannot start a socket after abort.
- Use only fixed headers (`Authorization: Bearer …`, `Content-Type`, `Accept`, computed `Content-Length`, optional fixed user-agent). Never put credentials in URLs, query parameters, path, or redirects. Keep error bodies in memory only long enough to discard or parse a successful bounded JSON body. Persist/return only normalized error code, actual nullable HTTP status, bounded safe retry evidence, and existing observation metadata. Network failures with no response have `httpStatus: null`; do not synthesize 504/0. A malformed/oversized body after HTTP 200 remains an application error with HTTP 200.

The reviewed runtime is Node 26.1.0, while `package.json` declares `node >=24` and `@types/node` 24.10.0. The recommended APIs are present in the official [Node.js v24.20 HTTPS docs](https://nodejs.org/download/release/v24.20.0/docs/api/https.html), [HTTP request options](https://nodejs.org/download/release/v24.20.0/docs/api/http.html), [DNS resolver docs](https://nodejs.org/download/release/v24.20.0/docs/api/dns.html), and [TLS verification docs](https://nodejs.org/download/release/v24.20.0/docs/api/tls.html). The Node DNS documentation distinguishes OS-level `lookup()` from network DNS and documents resolver cancellation. The [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) and [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) special-purpose registries are the primary address-range source. `dns.lookup(..., { all: true, order: 'verbatim' })` is available in v24, but a custom `https.request` lookup callback must receive only the already-validated pin; resolver behavior and pinning behavior should be tested separately.

## Pricing and startup policy

The compatible protocol provides no trusted generic pricing contract. Keep its pricing result `UNKNOWN` and do not infer zero from a model name, provider URL, manual price fields, a `:free` suffix, or a 200 response. Existing model rows may retain manually entered prices for display, but those values must never become FREE eligibility. `FREE_ONLY` generation, embedding, and selected-model inference tests must stop before key decryption, DNS, and inference when compatible pricing is unknown. This proves both “manual zero still blocks” and no accidental startup paid call.

The university may explicitly opt in to paid runtime through the existing SUPER_ADMIN/audited UI policy later. The PRV-02C probe path still forces `FREE_ONLY`; tests in this slice should assert the explicit policy/audit boundary without sending any live paid request. No paid inference is part of startup verification.

## Main assumptions and implementation traps

1. A URL syntax check at save is not network validation. A safe DNS preflight at save is not a substitute for fresh resolution before every runtime, metadata, or probe request.
2. Resolving and validating a hostname, then letting a default client resolve it again creates a DNS-rebinding gap. Pin the socket's address from the same checked result.
3. Filtering out private answers and keeping the public ones is insufficient; reject a mixed A/AAAA set. Do not treat IPv4-mapped IPv6 as an ordinary global IPv6 address.
4. A custom socket IP alone is insufficient: SNI, HTTP Host, and certificate name checks must continue to use the configured hostname. Keep certificate chain and hostname verification enabled.
5. Redirect rejection in `fetch` does not cover a new native transport; native HTTPS must not add a redirect loop/helper. Do not follow `Location` even after returning a 3xx from the original host.
6. Current `provider-admin.run()` holds a SQL transaction across its callback. Calling DNS from inside it violates the documented no-network-in-transaction invariant and holds role/provider locks on a slow DNS service.
7. Reusing existing global `fetch` preserves redirect and byte guards but cannot demonstrate a socket pinned to the address that passed checks. Keep the new compatible transport separate unless the chosen client exposes a verified custom connector.
8. Generic `UNKNOWN` pricing must block before both decryption and any provider/network request. A successful `/models` metadata request is not pricing or inference success.

## Test matrix required before claiming PRV-02C green

| Area | Required cases and assertions |
|---|---|
| Endpoint parser | Accept normalized `https://host/v1` and `/v1/` as one endpoint; preserve safe prefixes; reject HTTP, IP literals, userinfo, query/empty query, fragment/empty fragment, non-443 port, localhost and local suffixes, single-label names, backslash, control/space, duplicate slash, dot segments, percent-encoded slash/dot, and paths that append duplicate protocol routes. Assert the exact final paths are `/prefix/models`, `/prefix/chat/completions`, `/prefix/embeddings`. |
| Auth/order/SQL | Unauthenticated and non-SUPER_ADMIN create/update/probe attempts make zero DNS calls. Instrument SQL transaction state: no resolver or HTTPS call runs while a transaction is open. For save, assert authorize/snapshot commit → DNS → final reauthorize/lock/revision check/write+audit; stale revision after DNS returns conflict and writes nothing. |
| Address classifier | Accept representative public IPv4/IPv6; reject RFC1918, CGNAT, loopback, link-local, unspecified, multicast, broadcast, documentation, benchmark, reserved, IPv6 ULA/site/link local, IPv4-mapped IPv6, NAT64, 6to4/Teredo, and malformed/family-mismatched answers. Empty answers and resolver failure fail closed. Any mixed global/private or global/reserved A+AAAA answers reject the complete set. |
| Rebinding and pin | A fake resolver returning public on one call and private on the next proves each separate request re-resolves and the second sends no bytes. The HTTP seam receives exactly the chosen address/family; it cannot resolve the hostname again. Assert the URL hostname is still used for Host/SNI and no network starts after DNS rejection or abort. |
| TLS | With a local test TLS server and test-only trust fixture, verify trusted hostname succeeds, wrong SAN fails, untrusted CA fails, and certificate verification is never disabled. Verify SNI is the domain while the TCP peer is the injected pin. Keep private-IP rejection tested at the production classifier boundary; any loopback allowance belongs only in a lower-level test seam. |
| Redirects/status | 3xx with `Location: http://127.0.0.1/...` is not followed and retains exact 3xx. Cover 200 valid/invalid JSON, oversized or stalled 200, 400, 401/403, 404, 429/Retry-After, 5xx, socket reset, and no-response timeout. Statuses with a response are preserved exactly; timeout/DNS/TLS failures without a response record null. |
| Bounded I/O/cancellation | Oversized request rejected before DNS/socket/key transmission; Content-Length and streamed response over limit rejected; header limit; timeout in DNS, TLS/connect, headers, and body; abort before DNS, during DNS, before connect, and during body. Assert resolver cancellation/request destruction/body cancellation and no late request. |
| Privacy | Capture returned DTOs, observations, and logs for failures with a canary key and canary upstream body. Assert neither appears; no raw URL/query, `Location`, headers, prompt, answer, or error body leaks. Only fixed normalized code, actual status, and bounded normalized Retry-After evidence are exposed. |
| Protocol and policy | Verify strict Chat Completions JSON schema/tools and response validation; embedding response model identity, dimension, order, finiteness, and nonzero vectors. Compatible price lookup remains UNKNOWN with no provider call; FREE_ONLY manual price `0/0` and selected probes do not decrypt, resolve, or infer; provider/model registry uses only the fixed installed compatible adapter. Paid setting changes remain explicit and audited, with no live paid request in this suite. |
| PostgreSQL/browser | Add additive migration checks for adapter/endpoint constraints, network identity revisions, existing official rows and private RLS/grants; actual PG tests cover role and revision races. Browser test creates and reloads a compatible provider with a validated base URL, preserves hidden key behavior, requires replacement key on host/platform switch, keeps official endpoint fields immutable, and shows UNKNOWN/free-test blocked without sending inference. |

## Review completion

This was a read-only source/spec pass; no code, schema, UI, or test files were edited, and no test/type/lint/build command was run. The component and final PRV-05 gates remain pending until the implementation above exists and evidence is recorded against the current task board.
