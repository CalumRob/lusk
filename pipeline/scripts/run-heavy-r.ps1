# Run one full R suite under the machine-wide heavy-run lock (#1177).
# Filtered testthat iteration deliberately does not use this wrapper.
# Test-only LUSK_HEAVY_TEST_STUB=1 permits LUSK_HEAVY_TEST_LOCK_NAME and refuses
# real DB environment; real runs always use Local\LuskIntegrationContractDb.
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [string]$ScriptArgumentsJson = '[]',
  [int]$LockTimeoutSeconds = 3600
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'heavy-test-lock.ps1')
$scriptArguments = @($ScriptArgumentsJson | ConvertFrom-Json)
$testStub = $env:LUSK_HEAVY_TEST_STUB -eq '1'
$requestedLockName = $env:LUSK_HEAVY_TEST_LOCK_NAME
$mutexName = $script:HeavyTestMutexName
if ($testStub) {
  $realDbVariables = @('PGPASSFILE', 'LUSK_SCALAR_TEST_HOST', 'LUSK_SCALAR_TEST_PORT',
    'LUSK_SCALAR_TEST_DATABASE', 'LUSK_SCALAR_TEST_USER', 'LUSK_SCALAR_TEST_CLEANUP',
    'LUSK_TEST_ALLOW_SCHEMA_CLEANUP', 'DATABASE_URL', 'PUBLISH_DATABASE_URL',
    'LUSK_PUBLISH_HOST', 'LUSK_PUBLISH_DATABASE', 'LUSK_PUBLISH_USER', 'PGOPTIONS',
    'PGCONNECT_TIMEOUT')
  foreach ($v in $realDbVariables) {
    if ([Environment]::GetEnvironmentVariable($v, 'Process')) {
      throw "Refusing: heavy test stub cannot be combined with real DB environment ($v)."
    }
  }
  if ($requestedLockName) { $mutexName = $requestedLockName }
  else { $mutexName = 'Local\LuskHeavyWrapperTest-' + [Guid]::NewGuid().ToString('N') }
  Write-Output "Heavy-run TEST STUB lock: $mutexName"
} elseif ($requestedLockName) {
  throw 'LUSK_HEAVY_TEST_LOCK_NAME requires LUSK_HEAVY_TEST_STUB=1.'
}
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$acquired = $false
$code = 1
try {
  $null = Enter-HeavyTestLock -Mutex $mutex -TimeoutSeconds $LockTimeoutSeconds -Name $mutexName
  $acquired = $true
  $env:LUSK_HEAVY_TEST_LOCK_HELD = '1'
  Write-Output "Heavy-run lock acquired: $mutexName"
  Push-Location (Split-Path -Parent $PSScriptRoot)
  try {
    # Windows PowerShell 5 records native stderr as ErrorRecord objects; stderr
    # alone is not a failed R run, so only Rscript's exit code decides success.
    $ErrorActionPreference = 'Continue'
    & Rscript $Script @scriptArguments
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 1 }
  } finally {
    Pop-Location
    $ErrorActionPreference = 'Stop'
  }
} finally {
  Remove-Item Env:LUSK_HEAVY_TEST_LOCK_HELD -ErrorAction SilentlyContinue
  if ($acquired) { Exit-HeavyTestLock -Mutex $mutex } else { $mutex.Dispose() }
}
exit $code
