# V1 production release contract

9 October 2026, root. This is the executable release contract for an operator-selected host; it does not record a deployed service or a successful live Flow A–F. See [final setup](FINAL_SETUP_CHECKLIST.md), [local setup](LOCAL_SETUP.md), and [embedding design](../architecture/EMBEDDING_SERVICE_DESIGN.md). Checked against the installed Next 16.3.8 deployment/self-hosting guides and current package/worker/parser sources.

Use a Node 24 host that supports persistent processes and native child processes. The supported artifact is a full source checkout with its lockfile, runtime dependencies, `.next` build output, `public/`, `lib/`, `scripts/`, `services/`, and `tsconfig.json`. `tsx` is a production dependency. The import child resolves `scripts/import-parser-child.ts` and transitive parser source at runtime; a web-only standalone directory has not been accepted as a complete artifact. Keep E5 weights in the existing offline cache separately from this checkout.

Install and build the selected revision with the pnpm version pinned in `package.json`:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Configure the selected production Supabase project and verify its migration history, RLS, grants and private original storage before starting consumers. Current development evidence covers 38 migrations and 59 RLS tables; production must be checked separately. Use session/direct Postgres for approved migrations and transaction-pooler configuration for runtime as described in local setup. Apply the saved migration files in order after a restorable backup; do not recreate schema for new documents or copy development accounts and corpus approvals as production authority.

Set public Supabase URL/publishable configuration before `next build`, because `NEXT_PUBLIC_*` values are included at build time. Provide server database, Supabase secret, encryption, LINE channel and embedding configuration through protected server environment. All four workers and the web service use the same encryption key and database; retain the key with the encrypted-data backup. Keep generation FREE_ONLY and enable the configured AI worker only after testing the selected free models through Dashboard. Optional web search remains disabled until the owner has verified the free/no-pay-as-you-go account and exact-key attestation described in the setup checklist.

The process supervisor owns these separate persistent services, with the checkout as working directory:

| Service | Command | Responsibility |
|---|---|---|
| Web | `pnpm start --hostname 127.0.0.1 --port 3000` | Dashboard and signed Student/Staff webhook intake |
| Inbox | `pnpm worker` | Durable inbound events and semantic context routing |
| AI | `pnpm worker:ai` | Owned AI jobs and support actions; requires `YRU_AI_ENABLED=true` |
| Outbox | `pnpm worker:outbox` | Owned Student/Staff delivery and current-evidence checks |
| Incidents | `pnpm worker:incidents` | Scoped incident jobs and context enrichment |
| Local embedding | `<configured embedding venv interpreter> services/embedding/run.py` | Existing offline CPU E5-small/384 service; use the dedicated Python3.13 environment and pinned dependencies in [embedding setup](../../services/embedding/README.md), with offline cache configuration from the embedding design |

Imports are supervised native children of the web request, not an additional durable import worker. Their existing limit is 15 seconds, 256 MiB JS heap, 32 MiB stdout and bounded concurrency. Verify PDF/DOCX/XLSX/CSV/HTML child extraction and private-original recovery on the selected host before accepting uploads; require OS resource controls as part of host configuration. Do not assume local parser evidence proves a different platform.

The supervisor restarts crashed workers with a delay and sends SIGTERM for planned shutdown, allowing the current bounded cycle to finish and the pool to close. Configure its stop grace period above the longest AI stage/cycle; if terminated earlier, retained leases and idempotency govern recovery. Inspect the Dashboard's observed worker timestamps and queue/log states after restart; an old heartbeat is not a live process-health pass. `--once` is a guarded one-cycle operation for an isolated acceptance environment, not a production health probe: it can consume queued work.

Expose only the selected stable HTTPS domain through a reverse proxy to the web service. Preserve webhook raw bytes and `x-line-signature`; do not cache webhook responses or private Dashboard/API output. Use the existing upload-size limit and preserve authenticated same-origin behavior. Configure these exact LINE paths on the chosen domain:

```text
/api/line/student/webhook
/api/line/staff/webhook
```

Accept a release only after both Verify requests, fresh Student messages, authorized Staff binding/alerts, manual HUMAN replies, local embedding health and controlled-then-live Flow A–F evidence are recorded. Disable conflicting OA automatic replies. Staff web references remain editable drafts until explicit Send; General references do not establish university rules or actual campus outages.

Back up Postgres, private originals, configuration and encryption key consistently, including immutable publication/delivery/admission history. Restore into a separate owned environment and verify original-byte equality, historical/current citations, scoped auth, encrypted history and queued-job recovery without delivering to live LINE recipients. Keep the previous application artifact for rollback, but require schema compatibility; do not reverse migrations or remove retained versions/attempts to roll back an application release. Record the selected host, domain, supervisor, backup owner and successful restoration in the final setup checklist.
