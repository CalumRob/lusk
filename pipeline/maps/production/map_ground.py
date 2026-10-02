"""Shared map-ground pipeline ported from the validated map builders.

This module owns the approved selected-CS ground, geographic context, outside
land treatment, network-free boundary layers, map-space raster masks and QGIS
layer rendering. It deliberately does not know about network families or plate
typography.
"""
from __future__ import annotations

import json
import re
from time import perf_counter
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from qgis.PyQt.QtCore import QSize, Qt
from qgis.PyQt.QtGui import QColor, QImage, QPainter, QPainterPath
from qgis.core import (
    Qgis,
    QgsCategorizedSymbolRenderer,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsFeature,
    QgsFeatureRequest,
    QgsFillSymbol,
    QgsGeometry,
    QgsLineSymbol,
    QgsMapRendererSequentialJob,
    QgsMapSettings,
    QgsProject,
    QgsRectangle,
    QgsRendererCategory,
    QgsRuleBasedRenderer,
    QgsSingleSymbolRenderer,
    QgsVectorLayer,
    QgsWkbTypes,
)


MAP_CRS = QgsCoordinateReferenceSystem("EPSG:2154")
PAPER = "#F8FBFB"
BOUNDARY = "#57726F"
BOUNDARY_LINE = "#52605E"
OUTSIDE_MASK = "#8A908C"
OUTSIDE_MASK_OPACITY = 0.42
BOUNDARY_WIDTH_MM = "0.45"
FRONTIER_WIDTH_MM = "0.35"
MAP_FRAME_MARGIN_RATIO = 0.08
TEXTURE_OPACITY = 0.50
GREEN_OPACITY = 0.45
INLINE_SHADOW_BLUR_RADIUS_PX = 6
INLINE_SHADOW_SIGMA_PX = 3.0
INLINE_SHADOW_OFFSET_Y_PX = 2
INLINE_SHADOW_OPACITY = 0.25
# Bump when the corresponding algorithms change (profile-specific cache contract).
SHARED_GROUND_RENDER_VERSION = 1
INLINE_MASK_RENDER_VERSION = 1
TEXTURE_FILENAME = "qgis-hub-paper-texture-cc0.jpg"
CONTEXT_DEPARTMENTS = (
    "14", "22", "29", "35", "44", "49", "50", "53", "56", "61", "72", "79", "85"
)
OCSGE_YEAR_PATTERN = re.compile(r"(?:^|_)artif_(\d{4})_(\d{2})\.gpkg$")


@dataclass(frozen=True)
class PreparedGround:
    """Map-ready shared layers for one territory and one render size."""

    ground: QImage
    boundaries: QImage
    territory_border: QImage
    outside_land: QgsGeometry
    land_mask: np.ndarray
    extent: QgsRectangle


@dataclass(frozen=True)
class SharedGround:
    """One-run official land context and OCS-GE providers shared by all maps."""

    context_layer: QgsVectorLayer
    context_geometry: QgsGeometry
    ocsge_layers: tuple[QgsVectorLayer, ...]
    texture: QImage
    _frontiers: dict[bytes, QgsGeometry] = field(default_factory=dict, repr=False, compare=False)

    def frontier_for(self, region: QgsGeometry) -> QgsGeometry:
        """Reuse exact, context-dependent frontier geometry within this run."""
        key = bytes(region.asWkb())
        if key not in self._frontiers:
            started = perf_counter()
            print("[maps] preparing shared land frontier geometry", flush=True)
            self._frontiers[key] = _frontier_geometry(region, self.context_geometry)
            print(f"[maps] shared land frontier prepared once: {perf_counter()-started:.1f}s", flush=True)
        return QgsGeometry(self._frontiers[key])


def _palette_data(palette_file: str | Path | None = None) -> dict:
    path = Path(palette_file) if palette_file else Path(__file__).with_name("network-palette.json")
    return json.loads(path.read_text(encoding="utf-8"))


def _class_expression(classes: list[str]) -> str:
    quoted = ", ".join("'" + code.replace("'", "''") + "'" for code in classes)
    return f'"code_cs" IN ({quoted})'


def palette_rules(palette_file: str | Path | None = None) -> tuple[tuple[str, str, str, float], ...]:
    """Bind the prototype's class rules to the tracked, used-class palette."""
    classes = _palette_data(palette_file)["classes"]
    groups = (
        ("woodland", "CS2.1.1"),
        ("only-where-US6.3", "CS2.2 · US6.3"),
        ("neutral-water", "Water"),
    )
    rules = []
    for treatment, label in groups:
        selected = [(code, spec) for code, spec in classes.items() if spec["treatment"] == treatment]
        if not selected:
            raise RuntimeError(f"Approved OCS-GE palette has no {treatment} class")
        colours = {spec["approved_colour"] for _, spec in selected}
        opacities = {float(spec.get("opacity", 1.0)) for _, spec in selected}
        if len(colours) != 1 or len(opacities) != 1:
            raise RuntimeError(f"Palette treatment {treatment} has inconsistent style values")
        expression = _class_expression([code for code, _ in selected])
        if treatment == "only-where-US6.3":
            expression = f"({expression} AND \"code_us\" = 'US6.3')"
        rules.append((expression, label, colours.pop(), opacities.pop()))
    return tuple(rules)


def sea_colour(palette_file: str | Path | None = None) -> str:
    for spec in _palette_data(palette_file)["classes"].values():
        if spec["treatment"] == "neutral-water":
            return spec["approved_colour"]
    raise RuntimeError("Approved OCS-GE palette has no neutral-water treatment")


def inspection_ground_renderer(palette_file: str | Path | None = None) -> QgsRuleBasedRenderer:
    """Render only selected woodland/grass and neutral water classes."""
    root = QgsRuleBasedRenderer.Rule(None)
    for expression, label, colour, opacity in palette_rules(palette_file):
        rule = QgsRuleBasedRenderer.Rule(
            QgsFillSymbol.createSimple({"color": colour, "outline_style": "no"})
        )
        rule.setFilterExpression(expression)
        rule.setLabel(label)
        rule.setDescription(label)
        rule.symbol().setOpacity(opacity)
        root.appendChild(rule)
    return QgsRuleBasedRenderer(root)


def pixels(image: QImage) -> np.ndarray:
    pointer = image.bits()
    pointer.setsize(image.sizeInBytes())
    return np.frombuffer(pointer, dtype=np.uint8).reshape(
        image.height(), image.bytesPerLine() // 4, 4
    )[:, : image.width(), :]


def render_layers(
    project: QgsProject,
    extent: QgsRectangle,
    layers: list[QgsVectorLayer],
    background: QColor,
    size: int,
) -> QImage:
    """Render selected QGIS layers at the prototype's physical output DPI."""
    started = perf_counter()
    settings = QgsMapSettings()
    settings.setDestinationCrs(MAP_CRS)
    settings.setExtent(extent)
    settings.setOutputSize(QSize(size, size))
    settings.setOutputDpi(96 * size / 1600)
    settings.setBackgroundColor(background)
    settings.setFlag(QgsMapSettings.Antialiasing, True)
    settings.setLayers(layers)
    job = QgsMapRendererSequentialJob(settings)
    job.start()
    job.waitForFinished()
    image = job.renderedImage().convertToFormat(QImage.Format_RGBA8888)
    if image.isNull():
        raise RuntimeError("QGIS did not render the requested map-ground layers")
    layer_names = ", ".join(layer.name() for layer in layers)
    print(
        f"[maps] QGIS raster {size}² {layer_names}: {perf_counter()-started:.1f}s",
        flush=True,
    )
    return image


def paper_texture(ground: QImage, texture: QImage, geometry: QgsGeometry, extent: QgsRectangle) -> None:
    """Apply the accepted grayscale QGIS Hub grain through the territory clip."""
    edge = min(texture.width(), texture.height())
    scaled = texture.copy(
        (texture.width() - edge) // 2,
        (texture.height() - edge) // 2,
        edge,
        edge,
    ).scaled(ground.size(), Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    gray = scaled.convertToFormat(QImage.Format_Grayscale8).convertToFormat(
        QImage.Format_RGBA8888
    )
    painter = QPainter(ground)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setClipPath(geometry_pixel_path(geometry, extent, ground.width(), ground.height()))
    painter.setCompositionMode(QPainter.CompositionMode_Multiply)
    painter.setOpacity(TEXTURE_OPACITY)
    painter.drawImage(0, 0, gray)
    painter.end()


def geometry_pixel_path(
    geometry: QgsGeometry,
    extent: QgsRectangle,
    width_px: int,
    height_px: int,
) -> QPainterPath:
    """Port of the builder's hole-aware EPSG:2154-to-pixel path conversion."""
    geometry = QgsGeometry(geometry)
    path = QPainterPath()
    path.setFillRule(Qt.OddEvenFill)

    def pixel_x(x: float) -> float:
        return (x - extent.xMinimum()) / extent.width() * width_px

    def pixel_y(y: float) -> float:
        return (extent.yMaximum() - y) / extent.height() * height_px

    if geometry.type() == Qgis.GeometryType.Unknown:
        for part in geometry.asGeometryCollection():
            path.addPath(geometry_pixel_path(part, extent, width_px, height_px))
        return path
    if geometry.type() != Qgis.GeometryType.Polygon:
        return path

    geometry.convertToMultiType()
    for polygon in geometry.asMultiPolygon():
        for ring in polygon:
            if not ring:
                continue
            path.moveTo(pixel_x(ring[0].x()), pixel_y(ring[0].y()))
            for point in ring[1:]:
                path.lineTo(pixel_x(point.x()), pixel_y(point.y()))
            path.closeSubpath()
    return path


def geometry_mask(geometry: QgsGeometry, extent: QgsRectangle, size: int) -> np.ndarray:
    mask = QImage(size, size, QImage.Format_RGBA8888)
    mask.fill(Qt.transparent)
    painter = QPainter(mask)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setPen(Qt.NoPen)
    painter.setBrush(QColor("white"))
    painter.drawPath(geometry_pixel_path(geometry, extent, size, size))
    painter.end()
    return pixels(mask)[:, :, 3].astype(np.float32) / 255.0


def desaturate_outside_image(
    image: QImage,
    outside_geometry: QgsGeometry,
    extent: QgsRectangle,
    width_px: int,
    height_px: int,
) -> QImage:
    """Apply the prototype's contextual grayscale pass to outside land only."""
    if image.isNull():
        raise RuntimeError("Could not read map image for contextual desaturation")
    grayscale = image.convertToFormat(QImage.Format_Grayscale8).convertToFormat(
        QImage.Format_ARGB32
    )
    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setClipPath(geometry_pixel_path(outside_geometry, extent, width_px, height_px))
    painter.drawImage(0, 0, grayscale)
    painter.end()
    return image


def make_memory_layer(
    name: str,
    fill: bool,
    outline_colour: str | None = BOUNDARY_LINE,
    outline_width: str = BOUNDARY_WIDTH_MM,
    outline_style: str = "solid",
) -> QgsVectorLayer:
    layer = QgsVectorLayer("MultiPolygon?crs=EPSG:2154", name, "memory")
    if fill:
        symbol = QgsFillSymbol.createSimple({"color": OUTSIDE_MASK, "outline_style": "no"})
        symbol.setOpacity(OUTSIDE_MASK_OPACITY)
    else:
        parameters = {"color": "#00000000"}
        if outline_colour is None:
            parameters["outline_style"] = "no"
        else:
            parameters.update(
                {
                    "outline_color": outline_colour,
                    "outline_width": outline_width,
                    "outline_style": outline_style,
                }
            )
        symbol = QgsFillSymbol.createSimple(parameters)
    layer.setRenderer(QgsSingleSymbolRenderer(symbol))
    return layer


def make_frontier_layer() -> QgsVectorLayer:
    layer = QgsVectorLayer("MultiLineString?crs=EPSG:2154", "Bretagne · frontière terrestre", "memory")
    symbol = QgsLineSymbol.createSimple(
        {
            "color": BOUNDARY_LINE,
            "width": FRONTIER_WIDTH_MM,
            "line_style": "dash",
            "capstyle": "round",
            "joinstyle": "round",
        }
    )
    layer.setRenderer(QgsSingleSymbolRenderer(symbol))
    return layer


def replace_memory_geometry(layer: QgsVectorLayer, geometry: QgsGeometry, allow_empty: bool = False) -> None:
    geometry = QgsGeometry(geometry)
    provider = layer.dataProvider()
    provider.deleteFeatures([feature.id() for feature in layer.getFeatures()])
    if geometry.isEmpty():
        if allow_empty:
            layer.updateExtents()
            return
        raise RuntimeError(f"Cannot render an empty geometry in {layer.name()}")
    geometry.convertToMultiType()
    feature = QgsFeature(layer.fields())
    feature.setGeometry(geometry)
    if not provider.addFeature(feature):
        raise RuntimeError(f"Could not update memory layer {layer.name()}")
    layer.updateExtents()


def discover_ocsge_sources(raw_dir: Path) -> list[tuple[str, Path, str]]:
    """Select each Breton department's latest non-corrective OCS-GE state."""
    candidates: dict[str, list[tuple[int, Path, str]]] = {}
    for path in (raw_dir / "extracted" / "ocsge").rglob("*.gpkg"):
        if "_PATCHCORRECTIF_" in str(path):
            continue
        match = OCSGE_YEAR_PATTERN.search(path.name)
        if match is None:
            continue
        year, department = match.groups()
        candidates.setdefault(department, []).append((int(year), path, path.stem))
    missing = {"22", "29", "35", "56"} - set(candidates)
    if missing:
        raise RuntimeError("Missing OCS-GE sources for departments: " + ", ".join(sorted(missing)))
    return [
        (department, path, layer_name)
        for department in ("22", "29", "35", "56")
        for _, path, layer_name in [max(candidates[department], key=lambda item: item[0])]
    ]


def add_ocsge_layers(project: QgsProject, raw_dir: Path) -> list[QgsVectorLayer]:
    layers = []
    palette_file = Path(__file__).with_name("network-palette.json")
    renderer = inspection_ground_renderer(palette_file)
    for department, path, layer_name in discover_ocsge_sources(raw_dir):
        layer = QgsVectorLayer(f"{path}|layername={layer_name}", f"OCS-GE · {department}", "ogr")
        if not layer.isValid():
            raise RuntimeError(f"Could not load OCS-GE ground {department}: {path}")
        layer.setRenderer(renderer.clone())
        layer.setOpacity(1.0)
        project.addMapLayer(layer)
        layers.append(layer)
    return layers


def add_context_land(
    project: QgsProject,
    bbox: QgsRectangle,
    communes: QgsVectorLayer,
) -> tuple[QgsVectorLayer, QgsGeometry]:
    """Build the official commune context from the local Admin Express source."""
    department_field = "code_insee_du_departement"
    if department_field not in {field.name() for field in communes.fields()}:
        raise ValueError(f"Local commune source is missing {department_field!r}")
    source_to_map = QgsCoordinateTransform(communes.crs(), MAP_CRS, project.transformContext())
    map_to_source = QgsCoordinateTransform(MAP_CRS, communes.crs(), project.transformContext())
    bbox_geometry = QgsGeometry.fromRect(bbox)
    geometries = []
    department_values = ", ".join(
        "'" + department.replace("'", "''") + "'" for department in CONTEXT_DEPARTMENTS
    )
    request = QgsFeatureRequest().setFilterExpression(
        f'"{department_field}" IN ({department_values})'
    )
    request.setFilterRect(map_to_source.transformBoundingBox(bbox))
    for feature in communes.getFeatures(request):
        geometry = QgsGeometry(feature.geometry())
        geometry.transform(source_to_map)
        if geometry.intersects(bbox_geometry):
            geometries.append(geometry)
    if not geometries:
        raise RuntimeError("Could not build land context for the selected map extent")
    land_geometry = QgsGeometry.unaryUnion(geometries)
    if land_geometry.isEmpty():
        raise RuntimeError("Land context geometry is empty")
    layer = QgsVectorLayer("MultiPolygon?crs=EPSG:2154", "Contexte · terres", "memory")
    feature = QgsFeature(layer.fields())
    feature.setGeometry(land_geometry)
    if not layer.dataProvider().addFeature(feature):
        raise RuntimeError("Could not add the land context geometry")
    layer.updateExtents()
    layer.setRenderer(
        QgsSingleSymbolRenderer(QgsFillSymbol.createSimple({"color": PAPER, "outline_style": "no"}))
    )
    project.addMapLayer(layer)
    return layer, land_geometry


def prepare_shared_ground(
    project: QgsProject,
    raw_dir: str | Path,
    combined_extent: QgsRectangle,
    assets_dir: str | Path,
    include_ocsge: bool = True,
) -> SharedGround:
    """Load local commune context and OCS-GE sources once for a production run."""
    project.setCrs(MAP_CRS)
    started = perf_counter()
    commune_path = Path(raw_dir) / "communes_limites.geojson"
    communes = QgsVectorLayer(str(commune_path), "Admin Express COG · context source", "ogr")
    if not communes.isValid():
        raise RuntimeError(f"Could not load official commune context: {commune_path}")
    context_layer, context_geometry = add_context_land(project, combined_extent, communes)
    print(f"[maps] shared local land context prepared once: {perf_counter()-started:.1f}s", flush=True)
    started = perf_counter()
    ocsge_layers = tuple(add_ocsge_layers(project, Path(raw_dir))) if include_ocsge else ()
    print(f"[maps] opened {len(ocsge_layers)} OCS-GE layers once: {perf_counter()-started:.1f}s", flush=True)
    texture_path = Path(assets_dir) / "texture" / TEXTURE_FILENAME
    texture = QImage(str(texture_path))
    if texture.isNull():
        raise RuntimeError(f"Could not load approved paper texture: {texture_path}")
    return SharedGround(context_layer, context_geometry, ocsge_layers, texture)


def _polygon_only(geometry: QgsGeometry) -> QgsGeometry:
    polygon = QgsGeometry(geometry)
    if polygon.wkbType() == QgsWkbTypes.GeometryCollection:
        if not polygon.convertGeometryCollectionToSubclass(QgsWkbTypes.PolygonGeometry):
            raise RuntimeError("Could not extract outside-land polygons")
    if not polygon.isEmpty() and not polygon.isMultipart():
        polygon.convertToMultiType()
    return polygon


def _frontier_geometry(region: QgsGeometry, land: QgsGeometry) -> QgsGeometry:
    outside_land = land.difference(region)
    if outside_land.isEmpty():
        return QgsGeometry()
    outside_land.convertToMultiType()
    rings = [ring for part in outside_land.asMultiPolygon() for ring in part if len(ring) >= 2]
    outside_boundary = QgsGeometry.fromMultiPolylineXY(rings) if rings else QgsGeometry()
    return outside_boundary.intersection(region.buffer(25, 8))


def prepare_ground(
    project: QgsProject,
    feature: dict,
    size: int,
    shared: SharedGround,
    include_ocsge: bool = True,
) -> PreparedGround:
    """Render the original ground/context/border passes at this profile's size."""
    extent = QgsRectangle(feature["extent"])
    geometry = QgsGeometry(feature["analytical_geometry"])
    if geometry.isEmpty() or extent.isEmpty():
        raise ValueError("Map-ready feature has empty analytical geometry or extent")
    context_land_layer, context_geometry = shared.context_layer, shared.context_geometry
    territory_kind = feature["territory"]["kind"]
    territory_geometry = QgsGeometry(feature.get("geometry", geometry))
    territory_extends_beyond_analytical_perimeter = not territory_geometry.isGeosEqual(geometry)
    boundary = make_memory_layer("Territoire · limite", fill=False)
    outside_mask = make_memory_layer("Contexte · hors territoire", fill=True)
    outside_ground = make_memory_layer("Contexte · papier hors territoire", fill=True)
    outside_ground.renderer().symbol().setColor(QColor(PAPER))
    outside_ground.renderer().symbol().setOpacity(1.0)
    frontier = make_frontier_layer()

    if territory_kind != "region":
        replace_memory_geometry(boundary, territory_geometry, allow_empty=True)
    region_geometry = feature.get("region_geometry")
    if region_geometry is not None:
        replace_memory_geometry(frontier, shared.frontier_for(region_geometry), allow_empty=True)

    outside = QgsGeometry.fromRect(extent).difference(geometry)
    outside_land = outside.intersection(context_geometry)
    outside_polygon = _polygon_only(outside_land)
    replace_memory_geometry(outside_ground, outside_polygon, allow_empty=True)
    replace_memory_geometry(outside_mask, outside_polygon, allow_empty=True)

    temporary_layers = (boundary, outside_mask, outside_ground, frontier)
    for layer in temporary_layers:
        project.addMapLayer(layer)
    try:
        ground = render_layers(
            project,
            extent,
            [outside_ground, *(shared.ocsge_layers if include_ocsge else ()), context_land_layer],
            QColor(sea_colour()),
            size,
        )
        paper_texture(ground, shared.texture, geometry, extent)

        boundaries = render_layers(
            project, extent, [frontier, boundary, outside_mask], QColor(0, 0, 0, 0), size
        )
        if territory_kind == "region":
            border_layers = [frontier]
        elif territory_extends_beyond_analytical_perimeter:
            border_layers = [frontier, boundary]
        else:
            border_layers = [boundary]
        territory_border = render_layers(
            project, extent, border_layers, QColor(0, 0, 0, 0), size
        )
        land_mask = geometry_mask(context_geometry, extent, size)
        return PreparedGround(ground, boundaries, territory_border, outside_land, land_mask, extent)
    finally:
        for layer in temporary_layers:
            if project.mapLayer(layer.id()) is not None:
                project.removeMapLayer(layer.id())


def apply_inline_mask(
    ground: QImage,
    border: QImage,
    analytical_geometry: QgsGeometry,
    extent: QgsRectangle,
) -> QImage:
    """Clip a separately rendered inline map to its analytical polygon."""
    from qgis.PyQt.QtGui import QPainter

    size = ground.width()
    mask = QImage(size, size, QImage.Format_RGBA8888)
    mask.fill(Qt.transparent)
    painter = QPainter(mask)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setPen(Qt.NoPen)
    painter.setBrush(QColor("white"))
    painter.drawPath(geometry_pixel_path(analytical_geometry, extent, size, size))
    painter.end()
    result = ground.copy().convertToFormat(QImage.Format_RGBA8888)
    painter = QPainter(result)
    painter.setCompositionMode(QPainter.CompositionMode_DestinationIn)
    painter.drawImage(0, 0, mask)
    painter.setCompositionMode(QPainter.CompositionMode_SourceOver)
    painter.drawImage(0, 0, border)
    painter.end()
    # Reapply the analytic mask after adding the border so no antialiased stroke
    # can leak beyond the approved inline cutout.
    painter = QPainter(result)
    painter.setCompositionMode(QPainter.CompositionMode_DestinationIn)
    painter.drawImage(0, 0, mask)
    painter.end()
    return result


def apply_inline_shadow(image: QImage) -> QImage:
    """Add the approved low-opacity paper-cutout shadow without filling its exterior."""
    rgba = image.convertToFormat(QImage.Format_RGBA8888)
    alpha = pixels(rgba)[:, :, 3].astype(np.float32) / 255.0
    radius = INLINE_SHADOW_BLUR_RADIUS_PX
    offsets = np.arange(-radius, radius + 1)
    kernel = np.exp(-(offsets ** 2) / (2 * INLINE_SHADOW_SIGMA_PX ** 2))
    kernel /= kernel.sum()
    blurred = np.apply_along_axis(lambda line: np.convolve(line, kernel, mode="same"), 1, alpha)
    blurred = np.apply_along_axis(lambda line: np.convolve(line, kernel, mode="same"), 0, blurred)
    shifted = np.zeros_like(blurred)
    offset = INLINE_SHADOW_OFFSET_Y_PX
    shifted[offset:] = blurred[:-offset]

    result = QImage(rgba.size(), QImage.Format_RGBA8888)
    result.fill(Qt.transparent)
    pixels(result)[:, :, 3] = np.rint(shifted * INLINE_SHADOW_OPACITY * 255).astype(np.uint8)
    painter = QPainter(result)
    painter.drawImage(0, 0, rgba)
    painter.end()
    return result
