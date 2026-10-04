$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskContainer = 'supabase_db_line-ai-yru'
foreach ($taskSql in @('tests\database\foundation.sql')) {
    $taskSqlPath = Join-Path $taskRoot $taskSql
    Get-Content -Raw -LiteralPath $taskSqlPath | docker exec -i $taskContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw "Database verification failed: $taskSql" }
}
Push-Location $taskRoot
try {
    # Each suite claims a real channel queue; serialize fixture suites, while their workers race internally.
    pnpm exec tsx --test --test-concurrency=1 tests/database/queue.integration.ts tests/database/ingress.integration.ts tests/database/staff-ingress.integration.ts tests/database/worker.integration.ts tests/database/tickets.integration.ts tests/database/student-ticket.integration.ts tests/database/ticket-security.integration.ts tests/database/outbox.integration.ts tests/database/staff-outbox.integration.ts tests/database/takeover.integration.ts tests/database/token-clock.integration.ts
    if ($LASTEXITCODE -ne 0) { throw 'Queue integration verification failed' }
} finally { Pop-Location }
