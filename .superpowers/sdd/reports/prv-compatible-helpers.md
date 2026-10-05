# PRV-02C compatible helper review

Date: 2026-10-05  
Reviewer: `/root/prv_compatible_review`  
Scope: review of the endpoint parser and public-address resolver/classifier, followed by the assigned hostname special-use suffix fix. This report does not certify the compatible HTTPS transport, authentication ordering, SQL boundaries, provider adapters, or pricing gates.

## Verdict

The helpers implement the central URL canonicalization and DNS fail-closed behavior in the PRV-02C plan: only normalized HTTPS/default-port hostnames are returned; network DNS queries both A and AAAA through a fresh `Resolver`; an unsafe answer rejects the entire set; an empty total result fails; and caller abort plus a 4.5-second deadline cancel outstanding queries. The focused suite passes 90/90 cases.

The review found a policy gap in the hostname suffix denylist: it missed IANA special-use `example.com`, `example.net`, `example.org`, and `.alt`. A follow-up extended the label-boundary checks and added focused regressions. The gap is now closed in the helper slice; this still does not certify the transport or its integration boundaries.

## Scope and evidence

Reviewed the current task board, provider design and decision log; the PRV-02C section of [the current cooldown/compatible plan](../../../docs/superpowers/plans/2026-10-05-yru-provider-cooldown-compatible.md); [the compatible contract review](prv-compatible-contract-review.md); [compatible-endpoint.ts](../../../lib/ai/compatible-endpoint.ts), [public-addresses.ts](../../../lib/ai/public-addresses.ts), and their two focused test files.

Checks run on the current shared source checkpoint:

- `pnpm exec vitest run tests/compatible-endpoint.test.ts tests/public-addresses.test.ts` — **2 files, 90/90 tests passed**.
- `pnpm typecheck` — **passed**.
- `pnpm exec eslint lib/ai/compatible-endpoint.ts lib/ai/public-addresses.ts tests/compatible-endpoint.test.ts tests/public-addresses.test.ts` — **passed**.
- Before the follow-up, a read-only parser probe via `pnpm exec tsx -e ...` confirmed `api.example.com`, `api.example.net`, `api.example.org`, and `provider.alt` were accepted. It also confirmed `.home.arpa` and noncanonical numeric IPv4 literals were rejected.

Earlier in the helper TDD cycle, each focused test file first returned RED because its implementation module was absent; after both helpers were added, the focused suites were rerun and are now green. No live DNS/provider request, PostgreSQL test, full regression suite, production build, or auth/transaction integration test was run for this review. No credentials or environment files were read.

Follow-up RED→GREEN evidence for the suffix fix: after replacing positive `.example.com` fixtures with `api.compatible-provider.com`, the new exact/subdomain/case/trailing-dot cases produced **8 expected failures** while 93 other assertions passed. Adding the four missing suffixes made the focused suite **101/101 green**. `pnpm typecheck` and targeted ESLint also passed on that updated checkpoint.

Latest shared-tree recheck: the focused suites remain **101/101 green** and targeted ESLint remains clean. A fresh full `pnpm typecheck` now fails at root-owned `tests/compatible-network.test.ts:21:73` (`TS2493`: mock call tuple `[]` has no element at index `0`), which landed after the prior passing typecheck. The helper review did not modify that transport test.

## Finding

**Resolved P2 — IANA special-use suffix coverage.** The parser now rejects exact matches and subdomains for `example.com`, `example.net`, `example.org`, and `alt` after URL case normalization and trailing-dot canonicalization. Tests cover exact names, subdomains, mixed case, a trailing dot, and positive lookalikes (`notexample.com`, `example.com.evil`, and `altitude`) to verify label-boundary matching. The [IANA Special-Use Domain Names registry](https://www.iana.org/assignments/special-use-domain-names) says its designation applies to each listed name and its subdomains and lists these names. Positive parser and mocked-DNS fixtures now use `api.compatible-provider.com` instead of a reserved example domain. Public-IP validation remains a separate necessary control.

## Address policy note

`isPublicAddress` conservatively rejects all of `192.31.196.0/24`, `192.52.193.0/24`, and `192.175.48.0/24`, as well as all of IPv6 `2001::/23`. The IANA registries identify some more-specific addresses inside those ranges as globally reachable. Rejecting the whole special-purpose parent ranges is fail-closed and consistent with the plan's prohibition on special-purpose destinations, but it intentionally denies some globally reachable anycast/service addresses. The test label “non-public IPv4” for those three examples is broader than the IANA terminology; describe this set as “blocked special-purpose ranges” if that distinction is useful to operators.

The address implementation otherwise covers the requested high-risk categories in its current allow/deny logic: malformed and family-mismatched forms, RFC1918/shared/loopback/link-local/benchmark/documentation/multicast/reserved IPv4, and IPv6 outside GUA plus mapped, translation, 6to4, Teredo/IETF-protocol, documentation, and currently unallocated space. This is a static policy snapshot, not a runtime IANA registry fetch. The primary range references are the [IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry) and [IANA IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry).

## Integration boundary still to prove

The helper itself cannot enforce authentication. Every create/update/probe/runtime caller must establish authorization before calling `resolvePublicAddresses`, and must do all DNS and provider I/O outside SQL transactions. The resolver only returns checked addresses; the transport still has to re-resolve for each request, connect to one of those exact answers, retain the configured hostname for SNI/Host/certificate validation, use no reusable connection that bypasses fresh resolution, and never follow redirects. These are separate root-owned transport/integration acceptance items in PRV-02C, not results established by this helper test run.

The implementation uses Node's [v24 DNS promises Resolver API](https://nodejs.org/download/release/v24.20.0/docs/api/dns.html): the per-call resolver and `resolve4`/`resolve6` use DNS queries rather than `dns.lookup()`'s OS name-service path, and `cancel()` cancels outstanding resolver queries. The configured timeout is 4,000 ms with one try; the enclosing abortable deadline is 4,500 ms. No claim is made here about socket pinning or TLS certificate verification.
