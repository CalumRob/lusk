"""Run-owned spatial index of the authoritative commune map-ready source.

Frame queries retain the OGR source provider's rectangle-intersection contract,
but never reopen or rescan the national GeoJSON for each territory. Bounding-box
candidates alone would include irregular communes the provider excludes.
"""
from pathlib import Path

from qgis.core import (QgsCoordinateReferenceSystem, QgsCoordinateTransform,
                       QgsFeatureRequest, QgsGeometry, QgsSpatialIndex, QgsVectorLayer)


class CommuneFrameIndex:
    def __init__(self, source: str | Path, project):
        layer = QgsVectorLayer(str(source), "AEDAR frame communes", "ogr")
        if not layer.isValid() or "code_insee" not in layer.fields().names():
            raise ValueError("Could not open authoritative commune map-ready geography")
        self._transform = QgsCoordinateTransform(QgsCoordinateReferenceSystem("EPSG:2154"),
                                                 layer.crs(), project)
        self._index = QgsSpatialIndex(flags=QgsSpatialIndex.FlagStoreFeatureGeometries)
        self._codes = {}
        request = QgsFeatureRequest().setSubsetOfAttributes(["code_insee"], layer.fields())
        for feature in layer.getFeatures(request):
            if not self._index.addFeature(feature):
                raise ValueError("Could not index authoritative commune geometry")
            self._codes[feature.id()] = str(feature["code_insee"])
        self.feature_count = len(self._codes)

    def codes_in_frame(self, extent):
        bounds = self._transform.transformBoundingBox(extent)
        frame = QgsGeometry.fromRect(bounds)
        codes = tuple(sorted({self._codes[identifier]
                              for identifier in self._index.intersects(bounds)
                              if self._index.geometry(identifier).intersects(frame)}))
        if not codes:
            raise ValueError("No authoritative commune intersects the AEDAR map frame")
        return codes
