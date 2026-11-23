$ErrorActionPreference = 'Stop'
# Pipeline-local runtime for the QGIS 4 Python: the pinned Pillow WebP encoder and a pinned pyarrow
# (QGIS 4.2.3's bundled pyarrow cannot write Parquet wider than ~4 columns; see qgis_runtime.py).
$python = 'E:\Program Files\QGIS 4.2.3\bin\python-qgis.bat'
$requirements = Join-Path $PSScriptRoot 'runtime-requirements.txt'
$target = Join-Path $PSScriptRoot '.runtime\site-packages'
New-Item -ItemType Directory -Force -Path $target | Out-Null
& $python -m pip install --disable-pip-version-check --no-color --only-binary=:all: --no-deps --upgrade --requirement $requirements --target $target
if ($LASTEXITCODE -ne 0) { throw "Pipeline-local runtime installation failed ($LASTEXITCODE)" }
& $python -c "import sys; sys.path.insert(0, r'$target'); import pyarrow, pyarrow.parquet, PIL; from PIL import features; assert PIL.__version__ == '12.3.0' and features.check('webp'); assert pyarrow.__version__ == '25.0.1' and pyarrow.__file__.startswith(r'$target'); print('Pillow', PIL.__version__, 'WebP encoder ready;', 'pyarrow', pyarrow.__version__, 'ready')"
if ($LASTEXITCODE -ne 0) { throw "Pipeline-local runtime validation failed ($LASTEXITCODE)" }
