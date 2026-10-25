# LIVE-KILO-06 — Kilo AI Gateway actual tests and inactive registration

10 October 2026, root execution on `feat/yru-helpdesk-v1` at `aa90f09`; CH014/USR-FREE/TEST/QUOTA/STATUS, DEC-089. **DIAGNOSTICS_PASS / INACTIVE_REGISTRATION_PASS / APP_INTEGRATION_PENDING.** The human supplied a Kilo credential, requested current research and real tests, and authorized adding Auto Free if it passes. Preserve current providers, FREE_ONLY, local E5, backend tool validation and remaining V1 acceptance.

## Current official offering

The exact free Auto identifier is **`kilo-auto/free`**; `kilo-auto/frontier` and `kilo-auto/efficient` are paid. Auto Free routes among currently available free upstream models; its underlying model can change. Kilo warns that Auto Free may route to providers that log prompts/outputs for improvement and must not receive personal/confidential data. These tests sent only short synthetic connectivity inputs, never student/LINE identities or private tickets. [Auto documentation](https://kilo.ai/docs/code-with-ai/agents/auto-model).

Kilo documents **200 free-model requests/hour/IP**, shared across anonymous/authenticated requests and free models. This is not200 per model or a guaranteed daily allowance. Free `:free` models are unbilled; BYOK being zero on Kilo's side does not imply the original provider is free. No actual remaining counter or account balance was observed; all tested rate-limit header projections were null. [Usage and billing](https://kilo.ai/docs/gateway/usage-and-billing).

OpenAI-compatible Base URL: `https://api.kilo.ai/api/gateway`; generation appends `/chat/completions`, metadata `/models`. [API reference](https://kilo.ai/docs/gateway/api-reference), [models](https://kilo.ai/docs/gateway/models-and-providers).

Actual public catalog GET200 at11:39:56 Bangkok returned390 models and12 free-labelled entries. Auto Free's eight advertised price fields were zero. Its advertised parameters include tools but not response_format/structured_outputs; the JSON observation below is therefore a tested sample, not a permanent capability guarantee. Exact Liquid and Super entries advertise both schema output and tools. Safe snapshot: `.superpowers/staging/kilo-catalog.json`.

## Executed authenticated inference

Root read the human key from stdin into process memory. The probe script/results contain no credential. Fixed official HTTPS destination, rejected redirects, current exact-ID zero-price guards, sequential requests,1,024 output-token ceiling,30second boundary and2MiB response ceiling were enforced. No paid tier, retry loop or tool execution occurred. Each success requires the requested Thai marker, exact JSON object or exactly one validated synthetic `connectivity_probe` call; HTTP alone is not success.

| Exact model | Plain Thai | Strict JSON | Tool-only | Combined JSON + tools |
| --- | --- | --- | --- | --- |
| `kilo-auto/free` | 200 accepted /2,184ms | 200 accepted /1,806ms | 200 accepted /2,064ms | 200, requested tool absent /3,020ms |
| `liquid/lfm-2.5-2.6b:free` | 200 accepted /1,205ms | 200 accepted /1,469ms | 200 accepted /1,212ms | 200, requested tool absent /1,009ms |
| `nvidia/nemotron-3-super-120b-a12b:free` | 200 accepted /1,585ms | 200 accepted /2,039ms | 200 accepted /1,229ms | 200, requested tool absent /1,695ms |

All12 requests returned HTTP200 and `usage.cost:0`;9 outputs passed their requested acceptance and3 combined requests did not return the required tool call. Auto's four responses identified `nvidia/nemotron-3-ultra-550b-a55b:free` as the routed model. No tool was executed. Timings are individual samples, not averages, Thai helpdesk quality, strict-schema enforcement against adversarial prompts or production/OA acceptance. Safe results: `.superpowers/staging/kilo-live-results.json`; script completed exit0 (diagnostic completion, not12/12 acceptance).

## Added to selected development Dashboard

Root registered **Kilo AI Gateway → Kilo Auto Free** at11:48:31 Bangkok through existing `createProvider`/`createModel` services, with the actual existing active SUPER_ADMIN actor and selected-development target guards. The key was stored **encrypted in the existing database**, not `.env` or documentation. Existing provider configurations/revisions/order were compared before/after and retained. No schema/migration, other key replacement, existing provider activation or LINE state was changed.

| Field | Saved value |
| --- | --- |
| Provider | `Kilo AI Gateway` |
| Type / Base URL | `COMPATIBLE` / `https://api.kilo.ai/api/gateway` |
| Model ID / display name | `kilo-auto/free` / `Kilo Auto Free` |
| Purpose / cost policy | Generation / `FREE_ONLY` |
| Provider enabled / model enabled | **false / false** |
| JSON / Tools / Vision | true / **false** / false; JSON is sample-tested, combined tool contract remains unaccepted |
| Timeout / manual prices |15,000ms / null input and output; manual zero is not free admission |
| Current app price / observation | **UNKNOWN**; direct probe is not fabricated as an in-app observation |

Readback asserts encrypted-key presence via `keyConfigured:true`, redacted DTO, exact provider/model identities and inactive flags. Safe persisted-registration projection: `.superpowers/staging/kilo-registration.json`. This is actual selected-development persistence, not merely proposed fields. Provider UUID `6c7aa31f-df0d-4708-9b8c-6330a0bbc8c2`; model UUID `65b6c82f-a954-4c34-a282-292141ceb619`.

Two initial registration attempts failed before inserts with `ENDPOINT_UNAVAILABLE`. Diagnosis reproduced Node DNS A/AAAA `ECONNREFUSED` while actual Windows OS lookup returned two addresses. Root used the admin service's existing resolver injection for a bounded real OS lookup, still retaining its public-address classification and existing SUPER_ADMIN/encryption guards. This is not fake DNS or disabling address checks. Production native DNS resolution remains application work; no global DNS/host setting or resolver source was changed.

## Application gates and verification

Independent actual Luna max read-only source audit confirmed accepted base-path/model-ID contracts and encrypted inactive registration semantics. It found that the trusted price reader supports only Zen/OpenRouter; COMPATIBLE Kilo remains UNKNOWN and the selected generation test stops before decrypt/network. It also confirmed that the installed compatible generator always requests strict schema and adds tools when required. The reviewer ran no tests, network or DB and inspected no secrets; root owns execution.

Root `pnpm exec tsx .superpowers/staging/kilo-app-admission.ts` exited0 at11:49:23: actual schema modules accept the exact configuration; actual price reader returns UNKNOWN with zero fetches; actual `probeModel` returns BLOCKED/PRICE_UNKNOWN/httpStatus:null with zero transport calls. Deliberately undecryptable synthetic canaries demonstrate refusal before key access. Root existing compatible configuration/endpoint/chat suites passed **84/84 in3 files** at11:49:24. These pass the existing refusal contract, not Kilo runtime readiness.

UI-PROVIDER-CONTEXT-01 separately passed125 focused tests/typecheck/changed-file lint and a fresh full-current-source isolated Next build at11:45; its report retains real-component browser and screenshot scope. No production code change belongs to this Kilo diagnostic/registration slice. Credential/evidence/whitespace verification is recorded at handoff.

Remaining root/team work under LIVE-FREE-05: trusted fresh exact Kilo zero-cost admission, production-compatible native DNS, separate schema/tool request strategy with capability fencing and bounded semantic/support/answer acceptance, then explicit activation and real OA verification. Do not solve these by manual zero prices, ALLOW_PAID, a fabricated quota meter or merely enabling this candidate. Auto Free's changing upstream/data policy must remain part of that decision. The user need not re-enter the registered key; whole V1 and actual LINE AI response remain pending.

## Final readback and handoff

Root signed into the actual Local Dashboard with the existing development SUPER_ADMIN account and read `/providers`. The actual page displays three providers, Kilo AI Gateway disabled, exact `kilo-auto/free` disabled/price unknown/untested, and a named add-model form with `api.kilo.ai` owner context. No form was submitted or in-app observation fabricated. [Actual screenshot](../../.superpowers/staging/provider-context-qa/kilo-dashboard.png) was saved and visually inspected. This readback supplements service persistence; it is not a full browser create/edit acceptance.

Root `node .superpowers/staging/provider-handoff-check.mjs` exited0 at11:54:42:25task files scanned with0credential-pattern/trailing-whitespace matches, all12live records/cost0/9accepted/3unaccepted combined results asserted, inactive registration flags/config preservation verified and final production TSX/CSS hashes matched the11:45 build. `git diff --check` exited0; unrelated existing files produce only LF/CRLF advisories. Older LIVE-FREE-04 saved evidence/21-file credential scan was rerun and passed at11:55:25. Final report additions are rescanned at finalization.

The prior Local web endpoint refused connections during attempted browser readback. Root restarted the existing launcher without changing `.env`;39migrations/65RLS/Structured readiness, offline E5/384, all four worker check-ins and local/public signed empty-event webhook requests passed. Invalid signatures were rejected. Current temporary tunnel is `https://arabia-composite-feed-conventions.trycloudflare.com`; both OA webhook settings must use its exact Student/Staff paths before the next real-message test. The original enabled generation model is retained and approved PUBLIC documents remain0. No actual OA answer is passed by this restart.
