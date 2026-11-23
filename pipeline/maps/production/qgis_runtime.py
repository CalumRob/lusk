"""Pipeline-local Python runtime for QGIS 4; import this before any `qgis` or `pyarrow` import.

QGIS 4.2.3 (OSGeo4W) bundles a pyarrow 25.0.1 whose Parquet writer fails on any table
wider than ~4 columns ("Couldn't serialize thrift: Internal buffer size overflow").
The pinned PyPI wheel in `.runtime/site-packages` works, but only if it is loaded before
QGIS: importing `qgis.core` loads GDAL, which loads the system `arrow.dll`, and a wheel
imported afterwards binds to that DLL and fails the same way.

Every production module that uses QGIS or pyarrow imports this module first, so the
order holds whatever entrypoint runs. It refuses to continue if the order was already
broken, instead of producing a late, cryptic Parquet error.
"""
from __future__ import annotations

from pathlib import Path
import sys

RUNTIME_SITE = Path(__file__).resolve().with_name(".runtime") / "site-packages"
PYARROW_VERSION = "25.0.1"
_INSTALL_HINT = "run pipeline/maps/production/install_webp_encoder.ps1"


def _bootstrap() -> None:
    if not (RUNTIME_SITE / "pyarrow").is_dir():
        raise RuntimeError(f"Pipeline-local pyarrow {PYARROW_VERSION} is missing from {RUNTIME_SITE}; {_INSTALL_HINT}")
    loaded = sys.modules.get("pyarrow")
    if loaded is not None:
        if Path(loaded.__file__).resolve().is_relative_to(RUNTIME_SITE.resolve()):
            return
        raise RuntimeError(
            f"pyarrow was imported from {Path(loaded.__file__).parent} before the pipeline runtime; "
            "import qgis_runtime before any pyarrow import")
    if "qgis" in sys.modules or "osgeo" in sys.modules:
        raise RuntimeError(
            "QGIS/GDAL was imported before the pipeline runtime; their arrow.dll would shadow the "
            "pinned pyarrow. Import qgis_runtime before any qgis/osgeo import")
    if str(RUNTIME_SITE) not in sys.path:
        sys.path.insert(0, str(RUNTIME_SITE))
    import pyarrow
    import pyarrow.parquet  # noqa: F401 — load the Parquet DLLs while no other Arrow is in the process
    if pyarrow.__version__ != PYARROW_VERSION:
        raise RuntimeError(f"pyarrow {PYARROW_VERSION} is required; found {pyarrow.__version__}; {_INSTALL_HINT}")


_bootstrap()
