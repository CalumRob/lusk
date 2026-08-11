# set-data-acl.ps1 -------------------------------------------------------------
# Protects E:\Lusk\pipeline\data against accidental deletion (the safety net
# behind the no-junction rule for worktrees). Denies DELETE (DE) and DELETE
# CHILD (DC) on data\raw and data\processed, inherited to files -- a recursive
# delete that follows a junction fails loudly at the first file instead of
# wiping ~14 GB.
#
# Accepted, documented trade-off (AGENTS.md): download_sources' corrupt-file
# replacement (an unlink) fails under the lock -- a LOUD failure, never a
# silent loss. To replace a corrupt file or deliberately clear the cache,
# remove the lock first:
#
#   powershell -File scripts/set-data-acl.ps1 -Remove
#   ( ... maintenance ... )
#   powershell -File scripts/set-data-acl.ps1
#
# Usage : powershell -File scripts/set-data-acl.ps1 [-Remove]
param([switch]$Remove)

$racine = "E:\Lusk\pipeline\data"
$cibles = @("$racine\raw", "$racine\processed")
$everyone = "*S-1-1-0"   # Everyone (language-independent SID)

if ($Remove) {
  foreach ($c in $cibles) {
    if (Test-Path -LiteralPath $c) {
      icacls $c /remove:d $everyone | Out-Null
      Write-Output "lock removed: $c"
    }
  }
  exit 0
}

foreach ($c in $cibles) {
  if (-not (Test-Path -LiteralPath $c)) {
    New-Item -ItemType Directory -Path $c -Force | Out-Null
  }
  icacls $c /deny "$everyone`:(DE,DC)" | Out-Null
  Write-Output "lock applied: $c"
}
Write-Output "Verification (must show Deny):"
icacls "$racine\raw"
