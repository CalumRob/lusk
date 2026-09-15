"""Build the first disposable QGIS visual for Rennes public-space sharing.

This is intentionally an asset-builder, not application code. It creates a
fresh QGIS project and exports one composite PNG from the authoritative raw
layers. The visual contract is recorded in README.md.
"""

from __future__ import annotations

import csv
import time
from pathlib import Path

from qgis.PyQt.QtCore import QSize, Qt
from qgis.PyQt.QtGui import QColor
from qgis.core import (
    QgsApplication,
    QgsCategorizedSymbolRenderer,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsFeature,
    QgsFillSymbol,
    QgsGeometry,
    QgsLayoutItemMap,
    QgsLayoutPoint,
    QgsLayoutSize,
    QgsLineSymbol,
    QgsPrintLayout,
    QgsProject,
    QgsRectangle,
    QgsRendererCategory,
    QgsRuleBasedRenderer,
    QgsSingleSymbolRenderer,
    QgsUnitTypes,
    QgsVectorLayer,
    QgsLayoutExporter,
)


ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "pipeline"
RAW = PIPELINE / "data" / "raw"
MAPS = PIPELINE / "maps"
LUSK_HERO = Path(r"E:\lusk-hero")

OCSGE = (
    RAW
    / "extracted"
    / "ocsge"
    / "OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D035_2023-01-01"
    / "artif_2023_35.gpkg"
)
OSM = RAW / "bretagne-latest.gpkg"
GEOVELO = RAW / "france-20260807.parquet"
COMMUNES = RAW / "communes_limites.geojson"
CS_COLOURS = LUSK_HERO / "visual-class-map-paper.csv"
PROJECT_PATH = MAPS / "rennes-sharing.qgz"
PNG_PATH = MAPS / "rennes-sharing-v1.png"
VARIANT_PNG_PATHS = {
    "car": MAPS / "rennes-sharing-car-v1.png",
    "walking": MAPS / "rennes-sharing-walking-v1.png",
    "bike": MAPS / "rennes-sharing-bike-v1.png",
}

CRS = QgsCoordinateReferenceSystem("EPSG:2154")
PAPER = "#F8FBFB"
BOUNDARY = "#57726F"
MODE_COLOURS = {
    "t": "#448FA6",  # semantic walk + transit
    "b": "#2E6171",  # semantic bike
    "c": "#A94562",  # semantic car
}
BIKE_SHARED_COLOUR = "#8C4C9E"
NETWORK_BBOX_MARGIN_M = 5000
MAP_MARGIN_M = 250
NETWORK_LINE_WIDTH_MM = "0.36"
NETWORK_OPACITY = 0.70
OUTSIDE_MASK_COLOUR = "#8A908C"
OUTSIDE_MASK_OPACITY = 0.34
OCSGE_OPACITY = 0.20

CAR_HIGHWAYS = (
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "service",
    "living_street",
)
# These are way-level restrictions. Lane-level bus tags are deliberately not
# included: a road may contain a bus lane while remaining usable by cars.
CAR_ACCESS_EXCLUSION_MARKERS = tuple(
    f'"{key}"=>"{value}"'
    for key, values in {
        "access": ("no", "private", "customers", "restricted", "permit", "emergency", "psv"),
        "vehicle": ("no", "private", "customers", "restricted", "permit", "emergency", "service"),
        "motor_vehicle": ("no", "private", "customers", "restricted", "permit", "emergency", "agricultural", "delivery", "forestry"),
        "motorcar": ("no", "private", "customers", "restricted", "permit", "emergency"),
    }.items()
    for value in values
)
CAR_SERVICE_EXCLUSION_MARKERS = tuple(
    f'"service"=>"{value}"'
    for value in (
        "parking_aisle",
        "driveway",
        "drive-through",
        "emergency_access",
        "bus",
        "voie_de_bus",
    )
)
CAR_BUS_ONLY_MARKERS = (
    '"access"=>"psv"',
    '"busway"=>"designated"',
    '"busway"=>"track"',
)
WALK_SPEED_MAX_KMH = 30
WALK_ACCESS_EXCLUSION_MARKERS = (
    '"foot"=>"no"',
    '"foot"=>"private"',
    '"access"=>"no"',
    '"access"=>"private"',
    '"access"=>"customers"',
    '"access"=>"restricted"',
)
WALK_HIGHWAYS = (
    "footway",
    "pedestrian",
    "steps",
    "path",
    "living_street",
    "residential",
)
WALK_EXPLICIT_ROADS = (
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "service",
)
WALK_SIDEWALK_VALUES = ("both", "left", "right", "separate", "yes", "sep")
WALK_FOOT_VALUES = ("yes", "designated", "permissive")
PROTECTED_CYCLING = (
    "PISTE CYCLABLE",
    "DOUBLE SENS CYCLABLE PISTE",
    "VOIE VERTE",
    "CHAUSSEE A VOIE CENTRALE BANALISEE",
    "AMENAGEMENT MIXTE PIETON VELO HORS VOIE VERTE",
)
SHARED_CYCLING = (
    "BANDE CYCLABLE",
    "DOUBLE SENS CYCLABLE BANDE",
    "DOUBLE SENS CYCLABLE NON MATERIALISE",
    "VELO RUE",
    "COULOIR BUS+VELO",
    "AUTRE",
    "ACCOTEMENT REVETU HORS CVCB",
    "GOULOTTE",
    "RAMPE",
)


def sql_values(values: tuple[str, ...]) -> str:
    return ", ".join("'" + value.replace("'", "''") + "'" for value in values)


def car_filter_sql() -> str:
    """Return the prototype contract for generally available car ways."""
    exclusions = (
        *CAR_ACCESS_EXCLUSION_MARKERS,
        *CAR_SERVICE_EXCLUSION_MARKERS,
        *CAR_BUS_ONLY_MARKERS,
    )
    clauses = [
        f'("other_tags" IS NULL OR "other_tags" NOT LIKE \'%{marker}%\')'
        for marker in exclusions
    ]
    return (
        f'"highway" IN ({sql_values(CAR_HIGHWAYS)}) AND '
        + " AND ".join(clauses)
    )


def maxspeed_filter_sql(max_kmh: int) -> str:
    """Return a source filter for a numeric OSM maxspeed at or below a limit."""
    markers = tuple(
        f'"maxspeed"=>"{speed}"' for speed in range(max_kmh + 1)
    )
    return "(" + " OR ".join(
        f'"other_tags" LIKE \'%{marker}%\'' for marker in markers
    ) + ")"


def walking_filter_sql(include_speed: bool = False) -> str:
    dedicated_filter = f'"highway" IN ({sql_values(WALK_HIGHWAYS)})'
    sidewalk_evidence = " OR ".join(
        f'"other_tags" LIKE \'%"{key}"=>"{value}"%\''
        for key in ("sidewalk", "sidewalk:left", "sidewalk:right")
        for value in WALK_SIDEWALK_VALUES
    )
    foot_evidence = " OR ".join(
        f'"other_tags" LIKE \'%"foot"=>"{value}"%\''
        for value in WALK_FOOT_VALUES
    )
    explicit_filter = (
        f'("highway" IN ({sql_values(WALK_EXPLICIT_ROADS)}) AND '
        f"({sidewalk_evidence} OR {foot_evidence}))"
    )
    filter_sql = f"({dedicated_filter} OR {explicit_filter})"
    if include_speed:
        speed_filter = (
            f'("highway" IN ({sql_values(WALK_EXPLICIT_ROADS)}) AND '
            f'({maxspeed_filter_sql(WALK_SPEED_MAX_KMH)}) AND '
            f"({car_filter_sql()}))"
        )
        filter_sql = f"({filter_sql} OR {speed_filter})"
    return filter_sql + " AND (" + " AND ".join(
        f'("other_tags" IS NULL OR "other_tags" NOT LIKE \'%{value}%\')'
        for value in WALK_ACCESS_EXCLUSION_MARKERS
    ) + ")"


def valid_layer(source: str, name: str, provider: str = "ogr") -> QgsVectorLayer:
    layer = QgsVectorLayer(source, name, provider)
    if not layer.isValid():
        raise RuntimeError(f"Could not load layer: {name} ({source})")
    return layer


def load_cs_colours() -> dict[str, tuple[str, str]]:
    with CS_COLOURS.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = csv.DictReader(handle)
        return {
            row["code_cs"]: (row["color_hex"], row["material_name"])
            for row in rows
        }


def fill_symbol(colour: str) -> QgsFillSymbol:
    symbol = QgsFillSymbol.createSimple({"color": colour})
    symbol_layer = symbol.symbolLayer(0)
    symbol_layer.setStrokeStyle(Qt.PenStyle.NoPen)
    return symbol


def line_symbol(
    colour: str,
    opacity: float = 0.9,
) -> QgsLineSymbol:
    symbol = QgsLineSymbol.createSimple(
        {
            "color": colour,
            "width": NETWORK_LINE_WIDTH_MM,
            "capstyle": "round",
            "joinstyle": "round",
        }
    )
    symbol.setOpacity(opacity)
    return symbol


def add_ocsge(project: QgsProject) -> QgsVectorLayer:
    layer = valid_layer(f"{OCSGE}|layername=artif_2023_35", "OCS-GE · sols (CS)")
    colours = load_cs_colours()
    categories = []
    for code, (colour, label) in colours.items():
        categories.append(QgsRendererCategory(code, fill_symbol(colour), label))
    layer.setRenderer(QgsCategorizedSymbolRenderer("code_cs", categories))
    layer.setOpacity(OCSGE_OPACITY)
    project.addMapLayer(layer)
    return layer


def add_osm_mode(
    project: QgsProject,
    mode: str,
    label: str,
    highways: tuple[str, ...],
    include_speed: bool = False,
) -> QgsVectorLayer:
    layer = valid_layer(f"{OSM}|layername=lines", label)
    if mode == "t":
        filter_sql = walking_filter_sql(include_speed=include_speed)
    elif mode == "c":
        filter_sql = car_filter_sql()
    else:
        filter_sql = f'"highway" IN ({sql_values(highways)})'
    layer.setSubsetString(filter_sql)
    layer.setRenderer(QgsSingleSymbolRenderer(line_symbol(MODE_COLOURS[mode], opacity=NETWORK_OPACITY)))
    project.addMapLayer(layer)
    return layer


def add_cycling_family(
    project: QgsProject,
    family: str,
) -> QgsVectorLayer:
    label = "protégé" if family == "protected" else "partagé"
    layer = valid_layer(str(GEOVELO), f"Géovélo · vélo · {label}")
    layer.setSubsetString('("ame_d" <> \'AUCUN\' OR "ame_g" <> \'AUCUN\')')

    family_values = PROTECTED_CYCLING if family == "protected" else SHARED_CYCLING
    # The pipeline's winner-side rule: use the d-side when it carries an
    # amenity, otherwise use the g-side. Keep this as explicit boolean SQL
    # rather than CASE/IN; the GeoParquet provider evaluates this form
    # consistently for both render filters and focused exports.
    family_filter = (
        f'("ame_d" IN ({sql_values(family_values)}) OR '
        f'("ame_d" = \'AUCUN\' AND "ame_g" IN ({sql_values(family_values)})))'
    )
    layer.setSubsetString(
        f'("ame_d" <> \'AUCUN\' OR "ame_g" <> \'AUCUN\') AND {family_filter}'
    )
    layer.setRenderer(
        QgsSingleSymbolRenderer(
            line_symbol(
                MODE_COLOURS["b"] if family == "protected" else BIKE_SHARED_COLOUR,
                opacity=NETWORK_OPACITY,
            )
        )
    )
    project.addMapLayer(layer)
    return layer


def add_boundary(
    project: QgsProject,
) -> tuple[QgsVectorLayer, QgsRectangle, QgsRectangle, QgsGeometry]:
    layer = valid_layer(str(COMMUNES), "Rennes · limite communale")
    layer.setSubsetString('"code_insee" = \'35238\'')
    symbol = QgsFillSymbol.createSimple(
        {"color": "#00000000", "outline_color": "#000000", "outline_width": "1.1"}
    )
    layer.setRenderer(QgsSingleSymbolRenderer(symbol))
    project.addMapLayer(layer)

    feature = next(layer.getFeatures(), None)
    if feature is None:
        raise RuntimeError("Rennes (35238) was not found in communes_limites.geojson")
    geometry = feature.geometry()
    transform = QgsCoordinateTransform(layer.crs(), CRS, project.transformContext())
    geometry.transform(transform)
    boundary_extent = geometry.boundingBox()
    network_extent = QgsRectangle(boundary_extent)
    network_extent.grow(NETWORK_BBOX_MARGIN_M)
    map_extent = QgsRectangle(boundary_extent)
    map_extent.grow(MAP_MARGIN_M)
    return layer, map_extent, network_extent, geometry


def add_outside_mask(
    project: QgsProject,
    extent: QgsRectangle,
    boundary_geometry: QgsGeometry,
) -> QgsVectorLayer:
    """Darken the context outside the selected commune."""
    layer = QgsVectorLayer(
        "MultiPolygon?crs=EPSG:2154", "Contexte · hors Rennes", "memory"
    )
    geometry = QgsGeometry.fromRect(extent).difference(boundary_geometry)
    feature = QgsFeature(layer.fields())
    feature.setGeometry(geometry)
    layer.dataProvider().addFeature(feature)
    layer.updateExtents()
    symbol = QgsFillSymbol.createSimple(
        {"color": OUTSIDE_MASK_COLOUR, "outline_style": "no"}
    )
    symbol.setOpacity(OUTSIDE_MASK_OPACITY)
    layer.setRenderer(QgsSingleSymbolRenderer(symbol))
    project.addMapLayer(layer)
    return layer


def make_layout(
    project: QgsProject,
    extent: QgsRectangle,
    layers: list[QgsVectorLayer],
    layout_name: str,
) -> QgsPrintLayout:
    width_m = extent.width()
    height_m = extent.height()
    aspect = width_m / height_m
    long_edge_mm = 240.0
    if aspect >= 1:
        page_width = long_edge_mm
        page_height = long_edge_mm / aspect
    else:
        page_height = long_edge_mm
        page_width = long_edge_mm * aspect

    layout = QgsPrintLayout(project)
    layout.initializeDefaults()
    layout.setName(layout_name)
    page = layout.pageCollection().pages()[0]
    page.setPageSize(QgsLayoutSize(page_width, page_height, QgsUnitTypes.LayoutMillimeters))

    map_item = QgsLayoutItemMap(layout)
    map_item.setBackgroundColor(QColor(PAPER))
    map_item.setBackgroundEnabled(True)
    map_item.setFrameEnabled(False)
    map_item.setLayers(layers)
    map_item.setKeepLayerSet(True)
    layout.addLayoutItem(map_item)
    map_item.attemptMove(QgsLayoutPoint(0, 0))
    map_item.attemptResize(QgsLayoutSize(page_width, page_height))
    map_item.setExtent(extent)

    return layout


def export_layout(
    layout: QgsPrintLayout,
    extent: QgsRectangle,
    output_path: Path,
) -> tuple[int, int]:
    settings = QgsLayoutExporter.ImageExportSettings()
    if extent.width() >= extent.height():
        width_px = 1600
        height_px = round(1600 * extent.height() / extent.width())
    else:
        height_px = 1600
        width_px = round(1600 * extent.width() / extent.height())
    settings.imageSize = QSize(width_px, height_px)
    if output_path.exists():
        output_path.unlink()
    result = QgsLayoutExporter(layout).exportToImage(str(output_path), settings)
    if result != QgsLayoutExporter.Success:
        raise RuntimeError(f"PNG export failed with result {result}")
    return width_px, height_px


def main() -> None:
    if not CS_COLOURS.exists():
        raise FileNotFoundError(f"CS colour mapping not found: {CS_COLOURS}")

    app = QgsApplication([], False)
    app.initQgis()
    try:
        project = QgsProject.instance()
        project.clear()
        project.setCrs(CRS)
        project.setTitle("Rennes · partage de l’espace public · visual prototype")
        project.writeEntry("lusk", "visual_scope", "throwaway QGIS asset; no app integration")
        project.writeEntry("lusk", "cs_colour_source", str(CS_COLOURS))
        project.writeEntry(
            "lusk",
            "network_bbox_rule",
            f"Rennes 35238 boundary plus {NETWORK_BBOX_MARGIN_M} m",
        )
        project.writeEntry(
            "lusk",
            "map_extent_rule",
            f"Rennes 35238 boundary plus {MAP_MARGIN_M} m",
        )

        boundary, map_extent, network_extent, boundary_geometry = add_boundary(project)
        ocsge = add_ocsge(project)
        car = add_osm_mode(
            project,
            "c",
            "OSM · voiture (c)",
            CAR_HIGHWAYS,
        )
        walk = add_osm_mode(
            project,
            "t",
            "OSM · marche (t)",
            WALK_HIGHWAYS,
            include_speed=True,
        )
        protected_cycling = add_cycling_family(project, "protected")
        shared_cycling = add_cycling_family(project, "shared")
        outside_mask = add_outside_mask(project, map_extent, boundary_geometry)

        # Explicit z-order: tonal ground, complete normal network layers, the
        # outside mask above the complete stack, then the black commune outline.
        variants = {
            "composite": (
                [
                    ocsge,
                    car,
                    walk,
                    protected_cycling,
                    shared_cycling,
                    outside_mask,
                    boundary,
                ],
                PNG_PATH,
            ),
            "car": ([ocsge, car, outside_mask, boundary], VARIANT_PNG_PATHS["car"]),
            "walking": ([ocsge, walk, outside_mask, boundary], VARIANT_PNG_PATHS["walking"]),
            "bike": (
                [ocsge, protected_cycling, shared_cycling, outside_mask, boundary],
                VARIANT_PNG_PATHS["bike"],
            ),
        }
        layouts = []
        for variant_name, (layers, output_path) in variants.items():
            layout = make_layout(
                project,
                map_extent,
                layers,
                f"Rennes · partage de l’espace public · {variant_name} · v1",
            )
            project.layoutManager().addLayout(layout)
            layouts.append((variant_name, layout, output_path))
        if not project.write(str(PROJECT_PATH)):
            raise RuntimeError(f"Could not write QGIS project: {PROJECT_PATH}")

        print(f"QGIS project: {PROJECT_PATH}")
        build_started = time.perf_counter()
        for variant_name, layout, output_path in layouts:
            export_started = time.perf_counter()
            width_px, height_px = export_layout(layout, map_extent, output_path)
            print(
                f"PNG {variant_name}: {output_path} ({width_px}x{height_px}) "
                f"[{time.perf_counter() - export_started:.1f}s]"
            )
        print(f"Network BBOX EPSG:2154: {network_extent.toString()}")
        print(f"Map extent EPSG:2154: {map_extent.toString()}")
        print(f"Total export time: {time.perf_counter() - build_started:.1f}s")
    finally:
        app.exitQgis()


if __name__ == "__main__":
    main()
