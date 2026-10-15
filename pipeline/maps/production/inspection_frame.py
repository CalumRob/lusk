"""Shared inspection-only framing around production furniture safe bands."""
from functools import lru_cache
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from qgis.core import QgsGeometry, QgsRectangle

OUTPUT_SIZE = 2400
EXTRA_CLEARANCE = round(OUTPUT_SIZE * 0.005)
FILLED_GEOMETRY_ANTIALIAS_REACH = 1.0
FILLED_CONTACT_DETECTION_REACH = 0.5


def _padded_band(path):
    from inspection_plate import TEXT_BAND_PADDING_X, TEXT_BAND_PADDING_Y

    return path.boundingRect().adjusted(
        -TEXT_BAND_PADDING_X - EXTRA_CLEARANCE,
        -TEXT_BAND_PADDING_Y - EXTRA_CLEARANCE,
        TEXT_BAND_PADDING_X + EXTRA_CLEARANCE,
        TEXT_BAND_PADDING_Y + EXTRA_CLEARANCE,
    )


def shared_ground_extent(features, profiles):
    """Union base frames and the inspection-only frames needed by this run."""
    features = tuple(features)
    if not features:
        raise ValueError("Cannot derive shared context extent from an empty binding")
    extent = QgsRectangle(features[0]["extent"])
    if "inspection" in profiles and features[0].get("inspection_extent") is not None:
        extent.combineExtentWith(QgsRectangle(features[0]["inspection_extent"]))
    for feature in features[1:]:
        extent.combineExtentWith(QgsRectangle(feature["extent"]))
        if "inspection" in profiles and feature.get("inspection_extent") is not None:
            extent.combineExtentWith(QgsRectangle(feature["inspection_extent"]))
    return extent


@lru_cache(maxsize=8)
def _measure_heading_bands(serialized_headings):
    from qgis.PyQt.QtGui import QColor
    templates = json.loads(serialized_headings)
    from inspection_plate import _prepare_title
    from qgis.PyQt.QtGui import QPainterPath

    assets = Path(__file__).with_name("assets")
    bands = []
    with TemporaryDirectory(prefix="lusk-inspection-heading-bands-") as temporary:
        temporary = Path(temporary)
        for _name, declared_runs in templates:
            runs = tuple((text, QColor(*rgb), opacity, solid)
                         for text, rgb, opacity, solid in declared_runs)
            prepared, _, _ = _prepare_title(runs, "AgjpqÅy", assets, temporary)
            title_path = QPainterPath()
            for path, _colour, _opacity, _solid in prepared.runs:
                title_path.addPath(path)
            bands.append(_padded_band(title_path))
    return tuple(bands)


class InspectionFramePolicy:
    """Measure registered headings once, then frame each named geography."""

    def __init__(self, heading_templates):
        self.heading_bands = _measure_heading_bands(
            json.dumps(heading_templates, separators=(",", ":")))
        from inspection_plate import SUBTITLE_SIZE, SUBTITLE_WEIGHT, TITLE_LEFT_MARGIN, SUBTITLE_TOP
        from inspection_plate import _load_static_face

        self._subtitle_layout = (SUBTITLE_SIZE, SUBTITLE_WEIGHT, TITLE_LEFT_MARGIN, SUBTITLE_TOP)
        assets = Path(__file__).with_name("assets")
        with TemporaryDirectory(prefix="lusk-inspection-frame-font-") as temporary:
            self._subtitle_family = _load_static_face(
                "mozilla-headline", SUBTITLE_WEIGHT, assets, Path(temporary))

    def extent_for(self, geometry: QgsGeometry, base_extent: QgsRectangle,
                   territory_name: str) -> QgsRectangle:
        """Return the least larger square frame clearing filled-geography contacts."""
        original = QgsRectangle(base_extent)
        bands = (*self.heading_bands, self._subtitle_band(territory_name))
        if not self._contacts(geometry, original, bands, 1.0,
                              FILLED_CONTACT_DETECTION_REACH):
            return original

        lower, upper = 1.0, 2.0
        while self._contacts(geometry, original, bands, upper,
                             FILLED_GEOMETRY_ANTIALIAS_REACH):
            upper *= 2
            if upper > 64:
                raise ValueError(f"Could not clear inspection furniture bands for {territory_name!r}")

        # A territory can have disconnected filled parts that enter a safe band
        # as the square frame grows, so contact is not assumed monotone. Find
        # the first clear interval, then refine its boundary.
        previous = lower
        found_clear = False
        for index in range(1, 513):
            candidate = 1.0 + (upper - 1.0) * index / 512
            if not self._contacts(geometry, original, bands, candidate,
                                  FILLED_GEOMETRY_ANTIALIAS_REACH):
                lower, upper = previous, candidate
                found_clear = True
                break
            previous = candidate
        if not found_clear:
            raise ValueError(f"Could not find a clear inspection frame for {territory_name!r}")
        for _ in range(40):
            middle = (lower + upper) / 2
            if self._contacts(geometry, original, bands, middle,
                              FILLED_GEOMETRY_ANTIALIAS_REACH):
                lower = middle
            else:
                upper = middle
        return self._scaled_square(original, upper * (1 + 1e-8))

    def _subtitle_band(self, territory_name):
        from inspection_plate import _font, _text_path

        size, weight, left, top = self._subtitle_layout
        path = _text_path(territory_name, _font(self._subtitle_family, size, weight))
        bounds = path.boundingRect()
        path.translate(left - bounds.left(), top - bounds.top())
        return _padded_band(path)

    @staticmethod
    def _scaled_square(extent, factor):
        side = max(extent.width(), extent.height()) * factor
        center_x = (extent.xMinimum() + extent.xMaximum()) / 2
        center_y = (extent.yMinimum() + extent.yMaximum()) / 2
        half = side / 2
        return QgsRectangle(center_x - half, center_y - half, center_x + half, center_y + half)

    @classmethod
    def _contacts(cls, geometry, original, bands, factor, fill_antialias_reach):
        extent = cls._scaled_square(original, factor)
        center_x = (extent.xMinimum() + extent.xMaximum()) / 2
        center_y = (extent.yMinimum() + extent.yMaximum()) / 2
        side = extent.width()
        for band in bands:
            # Match the rendered filled-geography raster's antialias reach;
            # outline-stroke fringes remain outside the contact contract.
            raster_safe_band = band.adjusted(-fill_antialias_reach, -fill_antialias_reach,
                                             fill_antialias_reach, fill_antialias_reach)
            world = QgsRectangle(
                center_x + (raster_safe_band.left() / OUTPUT_SIZE - 0.5) * side,
                center_y + (0.5 - raster_safe_band.bottom() / OUTPUT_SIZE) * side,
                center_x + (raster_safe_band.right() / OUTPUT_SIZE - 0.5) * side,
                center_y + (0.5 - raster_safe_band.top() / OUTPUT_SIZE) * side,
            )
            if geometry.intersects(QgsGeometry.fromRect(world)):
                return True
        return False
