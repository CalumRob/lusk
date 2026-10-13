[CmdletBinding()]
param(
    [switch]$Setup,
    [switch]$Upload,
    [string]$Prefix,
    [string]$Manifest,
    [string]$Qa,
    [string]$PublicationManifest,
    [string]$CompletedLog,
    [string]$OutputDir
)
$ErrorActionPreference = 'Stop'
if ($Setup -and $Upload) { throw 'Choose -Setup or -Upload, not both.' }
$legacyOutput = Join-Path $PSScriptRoot 'output'
$output = if ($OutputDir) { [System.IO.Path]::GetFullPath($OutputDir) } else { $legacyOutput }
$helper = Join-Path $PSScriptRoot 'upload_maps.py'
$requirements = Join-Path $PSScriptRoot 'r2-requirements.txt'
$runtime = Join-Path $legacyOutput '.r2-upload-runtime'
$basePython = 'C:\Users\calum\AppData\Local\Programs\Python\Python312\python.exe'
if (-not (Test-Path -LiteralPath $basePython)) { $basePython = (Get-Command python.exe -ErrorAction Stop).Source }
$python = $basePython
if ($Setup -or $Upload) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtime 'Scripts\python.exe'))) {
        & $basePython -m venv $runtime
        if ($LASTEXITCODE -ne 0) { throw "Could not create isolated R2 helper environment (exit $LASTEXITCODE)." }
    }
    $python = Join-Path $runtime 'Scripts\python.exe'
    & $python -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('boto3') else 1)"
    if ($LASTEXITCODE -ne 0) {
        $ErrorActionPreference = 'Continue'
        & $python -m pip install --disable-pip-version-check -r $requirements 2>&1 | ForEach-Object { $_.ToString() }
        $ErrorActionPreference = 'Stop'
        if ($LASTEXITCODE -ne 0) { throw "Could not install pinned boto3 dependency (exit $LASTEXITCODE)." }
    }
}
$arguments = @($helper, '--output-dir', $output)
if ($Prefix) { $arguments += @('--prefix', $Prefix) }
if ($Manifest) { $arguments += @('--manifest', $Manifest) }
if ($Qa) { $arguments += @('--qa', $Qa) }
if ($PublicationManifest) { $arguments += @('--publication-manifest', $PublicationManifest) }
if ($CompletedLog) { $arguments += @('--completed-log', $CompletedLog) }
if ($Setup) { $arguments += '--setup' }
if ($Upload) { $arguments += '--upload' }
if ($Setup) {
    $ErrorActionPreference = 'Continue'
    & $python @arguments
    if ($LASTEXITCODE -ne 0) { throw "R2 credential setup failed (exit $LASTEXITCODE)." }
} else {
    $logDir = Join-Path $output 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $log = Join-Path $logDir ("r2-helper-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $ErrorActionPreference = 'Continue'
    & $python @arguments 2>&1 | ForEach-Object { $_.ToString() } | Tee-Object -FilePath $log -ErrorAction Stop
    if ($LASTEXITCODE -ne 0) { throw "R2 helper did not finish successfully (exit $LASTEXITCODE). Log: $log" }
}
