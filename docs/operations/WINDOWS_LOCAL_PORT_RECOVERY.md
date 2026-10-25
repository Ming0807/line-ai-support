# Windows local YRU port recovery

Use only when Docker reports forbidden socket access for YRU ports54421/54422 and the following read-only check shows a reserved range containing them:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
docker port supabase_db_line-ai-yru
docker port supabase_kong_line-ai-yru
```

On17October2026 Windows reserved54328–54427 after reboot. The existing database remained in its volume, but host connections failed. A container restart alone did not restore publishing. This is an OS port reservation, not a migration or application-password failure.

Save work in applications that depend on local container networking first. Open PowerShell with **Run as administrator**. The following briefly stops WinNAT, restarts only the two named YRU containers, and restores WinNAT even if Docker fails:

```powershell
$ErrorActionPreference = 'Stop'
Stop-Service winnat
try {
    foreach ($yruContainer in @('supabase_db_line-ai-yru', 'supabase_kong_line-ai-yru')) {
        docker stop $yruContainer
        if ($LASTEXITCODE -ne 0) { throw "Could not stop $yruContainer" }
        docker start $yruContainer
        if ($LASTEXITCODE -ne 0) { throw "Could not start $yruContainer" }
    }
} finally {
    Start-Service winnat
}
docker port supabase_db_line-ai-yru
docker port supabase_kong_line-ai-yru
```

Expected mappings are database5432→54422 and gateway8000→54421. Then verify actual database/API connectivity and use the normal launcher. Do not reset the database, delete containers/volumes, change credentials, delete Windows exclusions, or restart unrelated projects to address this symptom. If excluded ports remain unavailable, retain the diagnostic output and investigate before changing configuration.

This procedure restored the mappings in the actual17October run. It does not prove permanent immunity after future Windows updates/reboots, and it is separate from PG/model/OA acceptance. See [observed recovery and gates](../reports/SOL06K_RESTART_RECOVERY_2026-10-17.md).
