# PRV-02C-NET transport review

Date: 2026-10-05  
Reviewer: `/root/prv_compatible_review`  
Scope: review of the compatible network boundary and its focused endpoint, address, network, HTTPS, and local TLS evidence, plus the narrow request-envelope hardening described below. This does not review or certify root-owned configuration, auth, registry, pricing, database, or UI integration.

## Verdict

I found no blocking SSRF, DNS-rebinding, TLS-identity, redirect, response-limit, cancellation, or status-preservation defect in the reviewed transport path. The implementation keeps protocol routes fixed, resolves on each call, rejects a complete unsafe answer set, and supplies one validated address to a fresh native HTTPS request while retaining the configured hostname for SNI and certificate verification. Non-2xx responses preserve their actual status and discard the body; malformed or oversized successful responses retain the received status in the normalized error.

The initial review found that accessor-backed or proxy-backed request envelopes could vary route values between validation and dispatch. The follow-up hardening now snapshots validated own data properties, rejects accessors, symbols, custom prototypes, and Proxies, and uses only the snapshot for deadline and request construction. Regression tests confirm rejection occurs before DNS or HTTPS.

This review does not prove that application callers authenticate and authorize before DNS, that network calls occur outside SQL transactions, or that `FREE_ONLY` blocks unknown compatible pricing before decrypt/DNS/inference. Those are root-owned integration acceptance gates and are not established by the transport tests below.

## Evidence and implementation review

Reviewed [`compatible-network.ts`](../../../lib/ai/compatible-network.ts), [`compatible-pinned-https.ts`](../../../lib/ai/compatible-pinned-https.ts), [`compatible-endpoint.ts`](../../../lib/ai/compatible-endpoint.ts), [`public-addresses.ts`](../../../lib/ai/public-addresses.ts), their four focused Vitest files, [`compatible-tls.ts`](../../../scripts/qa/compatible-tls.ts), the PRV-02C execution plan, and the earlier contract review.

- The network boundary permits only `models`, `chat/completions`, and `embeddings`; it constructs the HTTP method, path, headers, and byte limits internally. Endpoint validation and request serialization occur before DNS. Each request then resolves again, rejects empty, oversized, or any mixed/non-public address list, and passes the first accepted address to the HTTPS layer. DNS results are neither persisted nor reused between calls.
- The request envelope must be a plain object or null-prototype record with the exact route-specific enumerable own data keys. Accessors, symbol keys, custom prototypes, and Proxies are rejected; field values are copied into a validated snapshot once, and later DNS/deadline/dispatch logic reads only that snapshot.
- Native HTTPS uses `agent: false`, a custom lookup returning only the validated pin, hostname-based `servername`, `rejectUnauthorized: true`, Node's default hostname checker, TLS 1.2 minimum, and a 16 KiB header limit. It does not use a redirect helper. These settings align with the official [Node.js v24.20 HTTPS API](https://nodejs.org/download/release/v24.20.0/docs/api/https.html), [HTTP request options](https://nodejs.org/download/release/v24.20.0/docs/api/http.html), and [TLS API](https://nodejs.org/download/release/v24.20.0/docs/api/tls.html). The address-set policy should continue to track the primary [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) and [IANA IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) special-purpose registries.
- Response content is streamed under a per-route byte cap; declared length is checked before reading, unsupported content encoding is rejected, and successful JSON requires fatal UTF-8 decoding and parsing. Response timeout/abort and malformed body errors preserve an already received status. Non-success bodies are destroyed without being exposed. Transport failures discard native error details.
- The resolver injection and native request injection are useful test seams. They must remain backend-only dependencies: neither may be populated from database fields or API input in production.

### Focused verification run

Commands run from `D:\project-next\line-ai-yru` on 2026-10-05:

```text
pnpm exec vitest run tests/compatible-endpoint.test.ts tests/public-addresses.test.ts tests/compatible-network.test.ts tests/compatible-pinned-https.test.ts
4 files passed; 141 tests passed; exit 0

pnpm exec tsx scripts/qa/compatible-tls.ts
PASS: 8 local TLS scenarios; liveProviderCalls=0; committedPrivateKeys=false

pnpm exec eslint lib/ai/compatible-network.ts tests/compatible-network.test.ts
exit 0

pnpm exec tsc --noEmit --pretty false
exit 0
```

Before the fix, the accessor-envelope and route-changing Proxy tests both resolved through the transport instead of rejecting. They pass after snapshot/reject behavior was added; the focused network suite contains 18 tests. The full four-file focused suite passes 141 tests. The TLS harness evidence covers trusted hostname with pinned TCP and expected Host/SNI, wrong SAN and untrusted chain rejected before HTTP, an actual 307 not followed, invalid JSON retaining HTTP 200, native header limit, body timeout retaining HTTP 200, and handshake timeout before HTTP. It creates and removes local certificates using Git OpenSSL. These are local fixtures, not proof against every deployed proxy/network configuration. No full build, database suite, live provider request, or application integration gate was run for this review.

## P3 finding resolution

### N1 — Request-envelope snapshot (resolved)

`compatible-network.ts` now rejects Proxy envelopes before invoking their traps, requires an ordinary or null prototype, enumerates all own keys (including symbols), and reads each property descriptor once. Only exact, enumerable data properties are accepted. It copies route, key, signal, and serialized body into an internal snapshot before DNS and uses that snapshot for the timeout, path, method, headers, and response limit. Tests cover an accessor route getter, a route-changing Proxy, custom prototypes, and unexpected symbol keys; invalid inputs reach neither resolver nor HTTPS seam. No type assertions were added to production code.

## Integration gates still open

- Prove all externally reachable config, probe, runtime, and manual-network paths authorize before invoking this transport or its resolver. A transport-level test cannot establish that ordering.
- Prove DNS, HTTPS, and response handling run outside SQL transactions, and save performs the planned authorize/snapshot commit → DNS → final reauthorization/revision-guarded write sequence.
- Prove unknown compatible pricing, including manual zero pricing, blocks `FREE_ONLY` before key decryption, DNS, and inference; no live paid request belongs in startup tests.
- Complete actual PostgreSQL, registry, adapter/protocol, admin/UI, and end-to-end acceptance before describing PRV-02C as integrated or green. This review only supports the focused network-layer result above.
