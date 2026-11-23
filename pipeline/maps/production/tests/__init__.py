"""Load the pipeline-local runtime before any test module imports pyarrow or QGIS (see qgis_runtime.py)."""
from pathlib import Path
import sys

_PRODUCTION = str(Path(__file__).resolve().parents[1])
if _PRODUCTION not in sys.path:
    sys.path.insert(0, _PRODUCTION)
import qgis_runtime  # noqa: E402,F401
