# DB-free receipt writer/verifier for run-guarded-r.ps1 (#1177).
# A receipt is evidence about one exact clean commit, never a rerun instruction.

function Get-GuardedRIdentity {
  param([Parameter(Mandatory = $true)][string]$RepoDir)
  $repo = (Resolve-Path -LiteralPath $RepoDir).Path
  $head = @(& git -C $repo rev-parse HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or $head.Count -ne 1) {
    throw 'Could not read the repository HEAD.'
  }
  $status = @(& git -C $repo status --porcelain 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'Could not read git status --porcelain.' }
  [pscustomobject]@{
    head = [string]$head[0]
    git_status_porcelain = @($status | ForEach-Object { [string]$_ })
  }
}

function Get-GuardedRReceiptLines {
  param([object[]]$LogLines)
  $lines = @($LogLines | ForEach-Object { [string]$_ })
  $summary = @($lines | Where-Object {
    $_ -match '^\[ (FAIL|PASS) ' -or $_ -match 'testthat results' -or
      $_ -match '(^|\s)Tests:'
  } | Select-Object -Last 1)
  if ($summary.Count) { return [string]$summary[0] }
  '<missing testthat summary>'
}

function Get-GuardedRLeftoverLine {
  param([object[]]$LogLines)
  $lines = @($LogLines | ForEach-Object { [string]$_ })
  $leftovers = @($lines | Where-Object { $_ -match '^LEFTOVER SCHEMAS' })
  if ($leftovers.Count) { return [string]$leftovers[0] }
  $clean = @($lines | Where-Object { $_ -match '^Leftover schemas:' } | Select-Object -Last 1)
  if ($clean.Count) { return [string]$clean[0] }
  '<missing leftover-schema line>'
}

function Get-GuardedRLogSha256 {
  param([Parameter(Mandatory = $true)][string]$LogPath)
  if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) {
    throw 'Guarded runner log is missing.'
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha.ComputeHash([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $LogPath).Path))
    -join ($bytes | ForEach-Object { $_.ToString('x2') })
  } finally { $sha.Dispose() }
}

function Write-GuardedRReceipt {
  param(
    [Parameter(Mandatory = $true)][string]$RepoDir,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][string]$Filter,
    [Parameter(Mandatory = $true)][string]$RunnerVersion,
    [Parameter(Mandatory = $true)][string]$StartedAtUtc,
    [Parameter(Mandatory = $true)][string]$EndedAtUtc,
    [Parameter(Mandatory = $true)][bool]$Succeeded,
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [object[]]$LogLines = @(),
    [string]$Error = '',
    [string]$ReceiptPath = ''
  )
  $identity = Get-GuardedRIdentity -RepoDir $RepoDir
  $log = (Resolve-Path -LiteralPath $LogPath).Path
  if (-not $ReceiptPath) { $ReceiptPath = [IO.Path]::ChangeExtension($log, '.receipt.json') }
  $receipt = [IO.Path]::GetFullPath($ReceiptPath)
  $parent = Split-Path -Parent $receipt
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  $value = [pscustomobject]@{
    head = $identity.head
    git_status_porcelain = @($identity.git_status_porcelain)
    clean_tree = ($identity.git_status_porcelain.Count -eq 0)
    filter = $Filter
    testthat_summary = (Get-GuardedRReceiptLines -LogLines $LogLines)
    leftover_schema_line = (Get-GuardedRLeftoverLine -LogLines $LogLines)
    started_at_utc = $StartedAtUtc
    ended_at_utc = $EndedAtUtc
    runner_version = $RunnerVersion
    succeeded = $Succeeded
    exit_code = $ExitCode
    log_path = $log
    log_sha256 = (Get-GuardedRLogSha256 -LogPath $log)
    error = $Error
  }
  $json = $value | ConvertTo-Json -Depth 8
  $temporary = "$receipt.tmp-$PID"
  [IO.File]::WriteAllText($temporary, $json, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $receipt -Force
  $receipt
}

function Test-GuardedRSummaryPassed {
  param([Parameter(Mandatory = $true)][string]$Summary)
  if ($Summary -match '^\[ FAIL ([0-9]+)') { return ([int]$Matches[1] -eq 0) }
  if ($Summary -match '([1-9][0-9]*) failures?') { return $false }
  $true
}

function Assert-GuardedRReceipt {
  param(
    [Parameter(Mandatory = $true)][string]$ReceiptPath,
    [Parameter(Mandatory = $true)][string]$RepoDir,
    [Parameter(Mandatory = $true)][string]$ExpectedHead,
    [Parameter(Mandatory = $true)][string]$ExpectedFilter
  )
  if (-not (Test-Path -LiteralPath $ReceiptPath -PathType Leaf)) {
    throw 'Guarded runner receipt is missing.'
  }
  $receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
  $identity = Get-GuardedRIdentity -RepoDir $RepoDir
  if ([string]$receipt.head -ne $ExpectedHead -or [string]$receipt.head -ne $identity.head) {
    throw 'Receipt HEAD mismatch: expected, recorded and current commits must agree.'
  }
  $recordedStatus = @($receipt.git_status_porcelain | Where-Object { $null -ne $_ })
  if ($recordedStatus.Count -or $identity.git_status_porcelain.Count) {
    throw 'Receipt verification requires an empty git status --porcelain.'
  }
  if ([string]$receipt.filter -ne $ExpectedFilter) { throw 'Receipt filter mismatch.' }
  if ([string]$receipt.testthat_summary -notmatch '^\[ (FAIL|PASS) |testthat results|Tests:') {
    throw 'Receipt has no testthat summary line.'
  }
  if (-not (Test-GuardedRSummaryPassed -Summary ([string]$receipt.testthat_summary))) {
    throw 'Receipt records failing tests.'
  }
  if ([string]$receipt.leftover_schema_line -ne 'Leftover schemas: none') {
    throw 'Receipt does not prove that no schema was left behind.'
  }
  if ($receipt.succeeded -ne $true -or [int]$receipt.exit_code -ne 0) {
    throw 'Receipt records a failed guarded run.'
  }
  if (-not [string]$receipt.runner_version) { throw 'Receipt runner version is missing.' }
  $culture = [Globalization.CultureInfo]::InvariantCulture
  $styles = [Globalization.DateTimeStyles]::AdjustToUniversal
  $started = [DateTimeOffset]::Parse([string]$receipt.started_at_utc, $culture, $styles)
  $ended = [DateTimeOffset]::Parse([string]$receipt.ended_at_utc, $culture, $styles)
  if ($started -gt $ended) { throw 'Receipt start/end times are reversed.' }
  $hash = Get-GuardedRLogSha256 -LogPath ([string]$receipt.log_path)
  if ($hash -ne [string]$receipt.log_sha256) { throw 'Receipt log hash mismatch.' }
  $receipt
}
