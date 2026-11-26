# Shared heavy-run mutex (#1177). The guarded PostgreSQL runner and the Python
# integration proofs already use this exact Windows name.
$script:HeavyTestMutexName = 'Local\LuskIntegrationContractDb'

function Enter-HeavyTestLock {
  param(
    [Parameter(Mandatory = $true)][System.Threading.Mutex]$Mutex,
    [int]$TimeoutSeconds = 3600
  )
  if ($TimeoutSeconds -lt 1) { throw 'LockTimeoutSeconds must be positive' }
  $acquired = $Mutex.WaitOne([TimeSpan]::FromSeconds(1))
  if (-not $acquired) {
    Write-Output "Waiting for $script:HeavyTestMutexName ..."
    $acquired = $Mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds - 1))
  }
  if (-not $acquired) { throw "Timed out waiting for $script:HeavyTestMutexName" }
  $true
}

function Exit-HeavyTestLock {
  param([Parameter(Mandatory = $true)][System.Threading.Mutex]$Mutex)
  try { $Mutex.ReleaseMutex() } finally { $Mutex.Dispose() }
}
