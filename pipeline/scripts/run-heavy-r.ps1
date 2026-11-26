# Run one full R suite under the machine-wide heavy-run lock (#1177).
# Filtered testthat iteration deliberately does not use this wrapper.
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [string]$ScriptArgumentsJson = '[]',
  [int]$LockTimeoutSeconds = 3600
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'heavy-test-lock.ps1')
$scriptArguments = @($ScriptArgumentsJson | ConvertFrom-Json)
$mutex = New-Object System.Threading.Mutex($false, $script:HeavyTestMutexName)
$acquired = $false
$code = 1
try {
  $null = Enter-HeavyTestLock -Mutex $mutex -TimeoutSeconds $LockTimeoutSeconds
  $acquired = $true
  $env:LUSK_HEAVY_TEST_LOCK_HELD = '1'
  Write-Output "Heavy-run lock acquired: $script:HeavyTestMutexName"
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
