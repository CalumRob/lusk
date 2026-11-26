# Guarded R test runner (#1177). Target is HARD-CODED to lusk_it_contract; it never
# reads or names the serving passfile. All external runner guards are retained.
#   powershell -NoProfile -File pipeline/scripts/run-guarded-r.ps1 -PipelineDir <worktree>\pipeline -Filter 'adopt-db|apply-shapes-db'
param(
  [Parameter(Mandatory = $true)][string]$PipelineDir,
  [Parameter(Mandatory = $true)][string]$Filter,
  [string]$LogPath = '',
  [string]$ReceiptPath = ''
)
$ErrorActionPreference = 'Stop'
$RunnerVersion = '1.0.0'
. (Join-Path $PSScriptRoot 'heavy-test-lock.ps1')
. (Join-Path $PSScriptRoot 'guarded-r-receipt.ps1')

$pipeline = (Resolve-Path -LiteralPath $PipelineDir).Path
if (-not (Test-Path -LiteralPath (Join-Path $pipeline 'DESCRIPTION')) -or
    -not (Test-Path -LiteralPath (Join-Path $pipeline '_targets.R'))) {
  throw 'PipelineDir must contain DESCRIPTION and _targets.R.'
}
$repo = Split-Path -Parent $pipeline
$identity = Get-GuardedRIdentity -RepoDir $repo
if ($identity.git_status_porcelain.Count) {
  throw 'Refusing: guarded proof requires a clean git status --porcelain.'
}

if (-not $LogPath) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $safeFilter = $Filter -replace '[^A-Za-z0-9_.-]+', '_'
  $LogPath = Join-Path ([IO.Path]::GetTempPath()) "lusk-guarded-$safeFilter-$stamp-$PID.log"
}
$log = [IO.Path]::GetFullPath($LogPath)
if (-not $ReceiptPath) { $ReceiptPath = [IO.Path]::ChangeExtension($log, '.receipt.json') }
$receipt = [IO.Path]::GetFullPath($ReceiptPath)
$repoPrefix = $repo.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($path in @($log, $receipt)) {
  if ($path.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or
      $path.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'LogPath and ReceiptPath must stay outside the repository so the proof tree remains clean.'
  }
}
$logParent = Split-Path -Parent $log
if (-not (Test-Path -LiteralPath $logParent)) {
  New-Item -ItemType Directory -Path $logParent -Force | Out-Null
}
"Guarded R runner $RunnerVersion | HEAD=$($identity.head) | filter=$Filter" |
  Add-Content -LiteralPath $log -Encoding UTF8

# 1. Credentials: the libpq default passfile only, and it must hold nothing but
# lusk_it_* entries. This is the external runner's guard unchanged.
Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
$pass = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$dbs = Get-Content $pass | Where-Object { $_ -and $_ -notmatch '^\s*#' } | ForEach-Object { ($_ -split ':')[2] }
if (@($dbs | Where-Object { $_ -notlike 'lusk_it_*' }).Count -gt 0) {
  throw 'Refusing: the default passfile holds a non-test entry. Stop and report to the orchestrator.'
}
$env:PGPASSFILE = $pass

# 2. Hard-coded target.
$env:LUSK_SCALAR_TEST_HOST = '192.168.1.120'; $env:LUSK_SCALAR_TEST_PORT = '5432'
$env:LUSK_SCALAR_TEST_DATABASE = 'lusk_it_contract'; $env:LUSK_SCALAR_TEST_USER = 'lusk_it_contract_pub'
$env:LUSK_SCALAR_TEST_CLEANUP = '1'; $env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP = '1'
$env:TESTTHAT_PARALLEL = 'FALSE'; $env:PGCONNECT_TIMEOUT = '10'
$env:PGOPTIONS = '-c statement_timeout=180000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=300000'
foreach ($v in 'DATABASE_URL', 'PUBLISH_DATABASE_URL', 'LUSK_PUBLISH_HOST', 'LUSK_PUBLISH_DATABASE', 'LUSK_PUBLISH_USER') {
  Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}

# 3. One guarded/heavy run at a time across all sessions, including cleanup and
# receipt writing. A contender waits and prints the shared mutex name.
$mutex = New-Object System.Threading.Mutex($false, $script:HeavyTestMutexName)
$acquired = $false
$sortie = @()
$avant = @(); $apres = @(); $restes = @()
$testExitCode = 1
$effectiveExitCode = 1
$snapshotOk = $false
$runError = ''
$success = $false
$startedAt = (Get-Date).ToUniversalTime().ToString('o')
try {
  $null = Enter-HeavyTestLock -Mutex $mutex
  $acquired = $true
  Write-Output "Heavy-run lock acquired: $script:HeavyTestMutexName"
  $startedAt = (Get-Date).ToUniversalTime().ToString('o')
  $avant = @(& Rscript (Join-Path $PSScriptRoot 'it-schemas.R') 2>$null |
    Where-Object { $_ -notmatch '^\[1\]' })
  if ($LASTEXITCODE -ne 0) { throw 'Schema snapshot failed (identity check or connection).' }
  $snapshotOk = $true
  Push-Location $pipeline
  try {
    # Native stderr is not failure by itself under Windows PowerShell 5.
    $ErrorActionPreference = 'Continue'
    & Rscript -e "testthat::test_local(filter='$Filter', stop_on_failure=FALSE)" 2>&1 |
      ForEach-Object { $sortie += "$_"; "$_" } |
      Tee-Object -LiteralPath $log -Append
    $testExitCode = $LASTEXITCODE
    if ($null -eq $testExitCode) { $testExitCode = 1 }
    $ErrorActionPreference = 'Stop'
  } finally { Pop-Location }
  $summary = Get-GuardedRReceiptLines -LogLines $sortie
  if ($testExitCode -eq 0 -and -not (Test-GuardedRSummaryPassed -Summary $summary)) {
    $testExitCode = 1
  }
  if ($testExitCode -ne 0) { $runError = "Rscript exited with code $testExitCode." }

  $apres = @(& Rscript (Join-Path $PSScriptRoot 'it-schemas.R') 2>$null |
    Where-Object { $_ -notmatch '^\[1\]' })
  if ($LASTEXITCODE -ne 0) { throw 'Schema snapshot failed after tests (identity check or connection).' }
  $restes = @($apres | Where-Object { $avant -notcontains $_ })
  if ($restes.Count) {
    $line = "LEFTOVER SCHEMAS (report to the orchestrator, do not drop): $($restes -join ', ')"
    $sortie += $line
    $line | Add-Content -LiteralPath $log -Encoding UTF8
    Write-Output $line
    $runError = 'Leftover schemas were detected.'
    $testExitCode = 2
  } else {
    $sortie += 'Leftover schemas: none'
    'Leftover schemas: none' | Add-Content -LiteralPath $log -Encoding UTF8
    Write-Output 'Leftover schemas: none'
  }
  $finalIdentity = Get-GuardedRIdentity -RepoDir $repo
  if ($finalIdentity.git_status_porcelain.Count) {
    $runError = 'The worktree became dirty during the guarded run.'
    $testExitCode = 1
  }
  $success = ($snapshotOk -and $testExitCode -eq 0 -and $runError -eq '')
} catch {
  $runError = $_.Exception.Message
  $sortie += "GUARDED RUN ERROR: $runError"
  "GUARDED RUN ERROR: $runError" | Add-Content -LiteralPath $log -Encoding UTF8
  Write-Output "GUARDED RUN ERROR: $runError"
  throw
} finally {
  $endedAt = (Get-Date).ToUniversalTime().ToString('o')
  $effectiveExitCode = if ($testExitCode -ne 0) { $testExitCode } elseif ($success) { 0 } else { 1 }
  try {
    $null = Write-GuardedRReceipt -RepoDir $repo -LogPath $log -ReceiptPath $receipt `
      -Filter $Filter -RunnerVersion $RunnerVersion -StartedAtUtc $startedAt `
      -EndedAtUtc $endedAt -Succeeded $success -ExitCode $effectiveExitCode `
      -LogLines $sortie -Error $runError
    Write-Output "Guarded receipt: $receipt"
  } finally {
    if ($acquired) { Exit-HeavyTestLock -Mutex $mutex } else { $mutex.Dispose() }
  }
}
exit $effectiveExitCode
