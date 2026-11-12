# Guarded test-only harness for the #989 retained-backend baseline proof.
# Holds the shared PowerShell named mutex across the entire R run (including
# schema cleanup) so API #984/#991 and this pipeline proof never touch the
# integration database concurrently. No credentials are read or printed here;
# PGPASSFILE must already point at the operator's private libpq file.
param(
  [Parameter(Mandatory = $true)][string]$CandidateDir,
  [Parameter(Mandatory = $true)][string]$BaselineDir,
  [string]$Scope = 'mobilite:stations_service,stations_service_1000,bornes_recharge_1000'
)
$ErrorActionPreference = 'Stop'
foreach ($required in @('PGPASSFILE', 'LUSK_SCALAR_TEST_DATABASE', 'LUSK_SCALAR_TEST_USER')) {
  if (-not (Get-Item "Env:$required" -ErrorAction SilentlyContinue)) {
    throw "Missing required environment variable: $required"
  }
}
if (-not (Test-Path -LiteralPath $CandidateDir -PathType Container)) {
  throw "Candidate artifact directory not found: $CandidateDir"
}
if (-not (Test-Path -LiteralPath $BaselineDir -PathType Container)) {
  throw "Baseline artifact directory not found: $BaselineDir"
}
$env:LUSK_SCALAR_TEST_HOST = '192.168.1.120'
$env:LUSK_SCALAR_TEST_PORT = '5432'
$env:LUSK_SCALAR_TEST_DATABASE = 'lusk_it_contract'
$env:LUSK_SCALAR_TEST_CLEANUP = '1'
$env:LUSK_SCALAR_SCOPE = $Scope
$env:LUSK_RETAINED_BASELINE_TEST_CANDIDATE_DIR = (Resolve-Path -LiteralPath $CandidateDir).Path
$env:LUSK_RETAINED_BASELINE_TEST_BASELINE_DIR = (Resolve-Path -LiteralPath $BaselineDir).Path
$env:LUSK_RETAINED_BASELINE_MUTEX_HELD = '1'

$mutex = New-Object System.Threading.Mutex($false, 'Local\LuskIntegrationContractDb')
$acquired = $false
try {
  $acquired = $mutex.WaitOne([TimeSpan]::FromMinutes(45))
  if (-not $acquired) { throw 'Timed out waiting for Local\LuskIntegrationContractDb' }
  Push-Location (Join-Path $PSScriptRoot '..')
  try {
    & Rscript scripts/smoke-retained-baseline-postgres.R
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($code -ne 0) { throw "Retained baseline smoke failed with exit $code" }
} finally {
  Remove-Item Env:LUSK_RETAINED_BASELINE_MUTEX_HELD -ErrorAction SilentlyContinue
  if ($acquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
