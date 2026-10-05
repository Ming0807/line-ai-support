# IMP-01C — Original envelope security review

Date: 5 October 2026
Reviewer: `/root/imp_operations_docs` (Luna high)
Verdict: **PASS for the encryption-envelope component; no actionable P1/P2 findings**

## Scope

Read-only review of `lib/imports/original-envelope.ts`, `tests/import-original-envelope.test.ts`, `lib/imports/source.ts`, `lib/imports/types.ts`, and `lib/security/identity.ts` against the frozen original-reference contract in `docs/architecture/KNOWLEDGE_IMPORT_DESIGN.md` and the current Import plan. Only this report was created. No code, shared design, board, matrix, package, database, or Git history was changed.

This verdict covers envelope creation/decryption only. Private Storage/DB persistence, streaming, authorization, audit records, staging revision checks, API error mapping, and deployment controls are not implemented or accepted by this review.

## Findings

No actionable P1, P2, or P3 defect was found in the reviewed component.

The implementation derives a 32-byte AES key with HKDF-SHA-256 using a purpose string distinct from the existing `identity.ts` purposes (`encryption`, `identity-index`, and `staff-identity-index`). It validates the existing canonical 32-byte base64 key form before use. AES-256-GCM uses a fresh 12-byte nonce and 16-byte tag. The fixed magic/version header is checked before decryption.

Authenticated data includes the import job ID and every immutable reference field: original ID, backend, format, byte length, SHA-256 checksum, and key version. This prevents moving a ciphertext across jobs, original IDs, backends, or altered metadata. `OriginalRef` is strict, server-side, UUID/checksum/version validated, and bounds the original to 1–20 MiB. Exact envelope-length validation bounds ciphertext allocation before decryption. Decryption checks both plaintext length and SHA-256 after GCM authentication. `verifyImportSource` revalidates format and checksum before encryption, and tests confirm byte-exact recovery including BOM and CRLF.

Invalid headers, malformed references, unsupported key version, truncated/extended envelopes, wrong key, and tampering of header, nonce, tag, or ciphertext fail with `IMPORT_ORIGINAL_INVALID`. Malformed configured encryption keys fail with `INVALID_ENCRYPTION_KEY`; neither error includes plaintext, key material, or crypto-library details. That configuration error is appropriate internally; the future API/streaming caller must map internal errors to its established safe response instead of returning raw exceptions.

Version handling is deliberately limited to version 1 in both header and reference schema. This rejects unsupported versions. Key rotation is not implemented; the design requires an explicit reviewed operation and retention of old keys, so no implicit rotation or key fallback is claimed.

## Verification

- `pnpm exec vitest run tests/import-original-envelope.test.ts tests/identity.test.ts`: **20/20 tests passed** (16 envelope, 4 identity).
- `pnpm exec eslint lib/imports/original-envelope.ts tests/import-original-envelope.test.ts lib/security/identity.ts tests/identity.test.ts`: passed with no diagnostics.
- No full unit suite, build, typecheck, PostgreSQL/Storage test, or live provider/LINE test was run. The root-reported concurrent typecheck failure during active HTML-worker edits was not investigated or attributed to this envelope component.

## Remaining acceptance boundary

Before M7 can claim original storage acceptance, add the shared encrypted envelope to both private database and private `knowledge-originals` Storage paths; enforce active SUPER_ADMIN reauthorization immediately before streaming; deny direct browser/object access; audit actor/job/byte count without content; verify exact checksum and job/reference binding through retries and parse failures; and prove bounded streaming/error handling. No real original or corpus has been approved by this component review.
