# Guarded wrapper for the #1071 disposable-database proof.
# Holds the shared named mutex for the WHOLE R process (including cleanup), like
# run-retained-baseline-smoke.ps1 and the guarded Python integration suites.
# The target is HARD-CODED: no host/database/role override can reach `lusk`.
param(
  [Parameter(Mandatory = $true)][string]$PgPassFile
)

$testHost = '192.168.1.120'
$testDatabase = 'lusk_it_contract'
$testUser = 'lusk_it_contract_pub'

$env:PGPASSFILE = (Resolve-Path -LiteralPath $PgPassFile).Path
$env:LUSK_BRIDGE_TEST_HOST = $testHost
$env:LUSK_BRIDGE_TEST_DATABASE = $testDatabase
$env:LUSK_BRIDGE_TEST_USER = $testUser
$env:LUSK_BRIDGE_TEST_CLEANUP = '1'
$env:TESTTHAT_PARALLEL = 'FALSE'
$env:PGCONNECT_TIMEOUT = '5'
$env:PGOPTIONS = '-c statement_timeout=45000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000'

# Rscript must start in pipeline/ so .Rprofile activates the populated renv
# library and pkgload::load_all('.') resolves the pipeline package.
$pipelineDir = Split-Path -Parent $PSScriptRoot
Write-Host "bridge DB proof: $testHost/$testDatabase/$testUser from $pipelineDir"

$mutex = New-Object System.Threading.Mutex($false, 'Local\LuskIntegrationContractDb')
$acquired = $false
try {
  $acquired = $mutex.WaitOne([TimeSpan]::FromMinutes(45))
  if (-not $acquired) { throw 'Timed out waiting for Local\LuskIntegrationContractDb' }
  $env:LUSK_BRIDGE_TEST_MUTEX_HELD = '1'
  Push-Location $pipelineDir
  try {
    # Stream R's stdout and stderr to the caller; do not capture or swallow.
    & Rscript -e "testthat::test_local(filter='offre-tc-bridge-db', stop_on_failure=TRUE)" 2>&1 | ForEach-Object { Write-Output $_ }
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($code -ne 0) { throw "offre_tc bridge database proof failed with exit $code" }
} finally {
  Remove-Item Env:LUSK_BRIDGE_TEST_MUTEX_HELD -ErrorAction SilentlyContinue
  if ($acquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
