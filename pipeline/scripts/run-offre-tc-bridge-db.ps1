# Guarded wrapper for the #1071 disposable-database proof.
# Holds the shared named mutex for the WHOLE R process (including cleanup), like
# run-retained-baseline-smoke.ps1 and the guarded Python integration suites.
# The R test verifies the mutex is held (WaitOne(0) must fail) before connecting.
# Never point any of these variables at the serving database `lusk`.
param(
  [Parameter(Mandatory = $true)][string]$PgPassFile,
  [string]$HostName = '192.168.1.120',
  [string]$Database = 'lusk_it_contract',
  [string]$User = 'lusk_it_contract_pub'
)

$env:PGPASSFILE = (Resolve-Path -LiteralPath $PgPassFile).Path
$env:LUSK_BRIDGE_TEST_HOST = $HostName
$env:LUSK_BRIDGE_TEST_DATABASE = $Database
$env:LUSK_BRIDGE_TEST_USER = $User
$env:LUSK_BRIDGE_TEST_CLEANUP = '1'

$mutex = New-Object System.Threading.Mutex($false, 'Local\LuskIntegrationContractDb')
$acquired = $false
try {
  $acquired = $mutex.WaitOne([TimeSpan]::FromMinutes(45))
  if (-not $acquired) { throw 'Timed out waiting for Local\LuskIntegrationContractDb' }
  $env:LUSK_BRIDGE_TEST_MUTEX_HELD = '1'
  Push-Location $PSScriptRoot
  try {
    & Rscript -e "testthat::test_local(filter='offre-tc-bridge-db', stop_on_failure=TRUE)"
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
