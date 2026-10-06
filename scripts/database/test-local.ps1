$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskContainer = 'supabase_db_line-ai-yru'
# Tests require the fixed reference departments even after a schema-only replay.
# Preserve pre-existing local values; this setup never replaces user records.
$taskSeed = Get-Content -Raw -LiteralPath (Join-Path $taskRoot 'supabase\seed.sql')
$taskSeed = $taskSeed -replace 'on conflict\(code\) do update[\s\S]*;\s*$','on conflict(code) do nothing;'
$taskSeed | docker exec -i $taskContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Local reference seed failed' }
foreach ($taskSql in @('tests\database\foundation.sql')) {
    $taskSqlPath = Join-Path $taskRoot $taskSql
    Get-Content -Raw -LiteralPath $taskSqlPath | docker exec -i $taskContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw "Database verification failed: $taskSql" }
}
Push-Location $taskRoot
try {
    # Each suite claims a real channel queue; serialize fixture suites, while their workers race internally.
    pnpm exec tsx --test --test-concurrency=1 tests/database/queue.integration.ts tests/database/ingress.integration.ts tests/database/staff-ingress.integration.ts tests/database/worker.integration.ts tests/database/tickets.integration.ts tests/database/student-ticket.integration.ts tests/database/ticket-security.integration.ts tests/database/outbox.integration.ts tests/database/staff-outbox.integration.ts tests/database/takeover.integration.ts tests/database/token-clock.integration.ts tests/database/ai-registry.integration.ts tests/database/provider-admin.integration.ts tests/database/provider-free-policy.integration.ts tests/database/provider-order.integration.ts tests/database/provider-pricing.integration.ts tests/database/provider-observations.integration.ts tests/database/knowledge-schema.integration.ts tests/database/knowledge-retrieval.integration.ts tests/database/embedding-store.integration.ts tests/database/ai-jobs.integration.ts tests/database/ai-worker.integration.ts tests/database/ai-tools.integration.ts
    if ($LASTEXITCODE -ne 0) { throw 'Queue integration verification failed' }
    pnpm exec tsx --test --test-concurrency=1 tests/database/provider-cooldown.integration.ts tests/database/provider-protocol-identity.integration.ts tests/database/provider-compatible.integration.ts
    if ($LASTEXITCODE -ne 0) { throw 'Provider cooldown verification failed' }
    pnpm exec tsx --test --test-concurrency=1 tests/database/local-e5-knowledge.integration.ts
    if ($LASTEXITCODE -ne 0) { throw 'Local E5 vector space verification failed' }
    pnpm exec tsx --test --test-concurrency=1 tests/database/import-staging.integration.ts
    if ($LASTEXITCODE -ne 0) { throw 'Knowledge import staging verification failed' }
    pnpm exec tsx --test --test-concurrency=1 tests/database/import-extraction.integration.ts
    if ($LASTEXITCODE -ne 0) { throw 'Knowledge extraction revision verification failed' }
    pnpm exec tsx --test --test-concurrency=1 tests/database/import-review.integration.ts
    if ($LASTEXITCODE -ne 0) { throw 'Knowledge review receipt verification failed' }
    pnpm exec tsx --test --test-concurrency=1 tests/database/import-storage.integration.ts
    if ($LASTEXITCODE -ne 0) { throw 'Knowledge import storage staging verification failed' }
    pnpm exec tsx --test --test-concurrency=1 tests/database/original-storage-http.integration.ts
    if ($LASTEXITCODE -ne 0) { throw 'Actual local Storage authorization verification failed' }
} finally { Pop-Location }
