# guard-worktree-remove.ps1 ----------------------------------------------------
# Before ANY `git worktree remove` (orchestrator OR worker): verify the worktree
# contains no junction / symbolic link pointing OUTSIDE the worktree. On
# Windows, recursive deletes (git worktree remove, Remove-Item -Recurse,
# rm -rf) FOLLOW junctions and wipe the target -- this destroyed the real
# cache E:\Lusk\pipeline\data (~14 GB) twice.
#
# Usage : powershell -File scripts/guard-worktree-remove.ps1 <worktree-path>
# Exit 0 = no external link (safe to remove) ; Exit 1 = ABORT.
param([Parameter(Mandatory = $true)][string]$Worktree)

if (-not (Test-Path -LiteralPath $Worktree)) {
  Write-Error "Worktree not found: $Worktree"
  exit 1
}

$root = (Resolve-Path -LiteralPath $Worktree).Path.TrimEnd('\')

$external = Get-ChildItem -LiteralPath $root -Recurse -Depth 4 -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.LinkType -eq 'Junction' -or $_.LinkType -eq 'SymbolicLink' } |
  Where-Object {
    $_.Target -and
    -not $_.Target.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)
  }

if ($external) {
  Write-Error "ABORT: the worktree contains external links (a recursive delete would follow them):"
  $external | ForEach-Object {
    Write-Error ("  {0} -> {1}  [{2}]" -f $_.FullName, $_.Target, $_.LinkType)
  }
  Write-Error ""
  Write-Error "Remove each LINK first (never with -Recurse, which would follow the target):"
  Write-Error "  Remove-Item -LiteralPath '<link>' -Force   # removes the link, NOT the target"
  Write-Error "Then re-run this guard and the git worktree remove."
  exit 1
}

Write-Output "OK: no external link in $root - safe to remove."
exit 0
