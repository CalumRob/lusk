"""One QGIS lifetime for AEDAR fixture modules sharing a Python process.

Qt/QGIS cannot safely be destroyed and recreated between these test classes.
OGR's pooled Windows file handles also require fixture deletion after shutdown.
"""
import atexit
import gc
from pathlib import Path
import shutil

from qgis.core import QgsApplication, QgsProject

_APP = None
_FOLDERS = []


def qgis_application():
    global _APP
    if _APP is None:
        _APP = QgsApplication.instance() or QgsApplication([], False)
        _APP.initQgis()
    return _APP


def fixture_folder(path):
    _FOLDERS.append(Path(path))
    return Path(path)


def cleanup():
    if _APP is not None:
        QgsProject.instance().clear()
        _APP.exitQgis()
        gc.collect()
    for folder in _FOLDERS:
        shutil.rmtree(folder, ignore_errors=True)


atexit.register(cleanup)
