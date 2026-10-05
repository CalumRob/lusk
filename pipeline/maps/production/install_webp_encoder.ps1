$ErrorActionPreference = 'Stop'
$python = 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat'
$requirements = Join-Path $PSScriptRoot 'webp-requirements.txt'
$target = Join-Path $PSScriptRoot '.runtime\site-packages'
New-Item -ItemType Directory -Force -Path $target | Out-Null
& $python -m pip install --only-binary=:all: --no-deps --upgrade --requirement $requirements --target $target
if ($LASTEXITCODE -ne 0) { throw "Pipeline-local WebP encoder installation failed ($LASTEXITCODE)" }
& $python -c "import sys; sys.path.insert(0, r'$target'); import PIL; from PIL import features; assert PIL.__version__ == '12.3.0' and features.check('webp'); print('Pillow', PIL.__version__, 'WebP encoder ready')"
if ($LASTEXITCODE -ne 0) { throw "Pipeline-local WebP encoder validation failed ($LASTEXITCODE)" }
