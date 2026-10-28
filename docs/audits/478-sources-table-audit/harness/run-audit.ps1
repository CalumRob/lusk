# Audit #478 - deterministic loop: existing build + vite preview + headless Chrome CDP.
# Prereq: app/dist already built (npm run build inside app/).
# Usage: powershell -File docs/audits/478-sources-table-audit/harness/run-audit.ps1
$ErrorActionPreference = 'Stop'

$racine = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$app = Join-Path $racine 'app'
if (-not (Test-Path (Join-Path $app 'dist\index.html'))) {
  throw "app/dist missing - run 'npm run build' inside app/ first"
}

$port = 4173
$serveur = Start-Process -FilePath 'node' -ArgumentList @(
  (Join-Path $app 'node_modules\vite\bin\vite.js'), 'preview', '--host', '127.0.0.1', '--port', "$port", '--strictPort'
) -WorkingDirectory $app -PassThru -WindowStyle Hidden

try {
  # Wait until the server answers (polling, no magic sleep).
  $pret = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/sources" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $pret = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $pret) { throw 'vite preview never ready on port 4173' }

  node (Join-Path $PSScriptRoot 'expected-associations.mjs') $racine
  node (Join-Path $PSScriptRoot 'audit-sources.mjs') `
    --url "http://127.0.0.1:$port" `
    --out (Join-Path $racine 'docs\audits\478-sources-table-audit\evidence')
  node (Join-Path $PSScriptRoot 'sweep-bleed.mjs') `
    (Join-Path $racine 'docs\audits\478-sources-table-audit\evidence\sweep-bleed.json')
} finally {
  if ($serveur -and -not $serveur.HasExited) { Stop-Process -Id $serveur.Id -Force }
}
