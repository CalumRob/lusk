"""Validation feedback loop for the disposable Rennes network render.

Run with the QGIS Python launcher. This deliberately compares the generated
project's filtered layers with source-level contract classifications inside the
actual map extent; it is not application code.
"""

from __future__ import annotations

from collections import Counter
import re
from pathlib import Path

from qgis.core import (
    QgsApplication,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsFeatureRequest,
    QgsGeometry,
    QgsProject,
    QgsRectangle,
    QgsVectorLayer,
)

from build_rennes_sharing_map import (
    CAR_HIGHWAYS,
    COMMUNES,
    GEOVELO,
    MAP_MARGIN_M,
    OSM,
    PROTECTED_CYCLING,
    SHARED_CYCLING,
    CRS,
    WALK_EXPLICIT_ROADS,
    WALK_FOOT_VALUES,
    WALK_HIGHWAYS,
    WALK_SIDEWALK_VALUES,
)


ROOT = Path(__file__).resolve().parents[2]
PROJECT_PATH = ROOT / "pipeline" / "maps" / "rennes-sharing.qgz"
EXPECTED_NETWORK_LINE_WIDTH_MM = "0.36"
RESTRICTION_MARKERS = (
    '"foot"=>"no"',
    '"foot"=>"private"',
    '"access"=>"no"',
    '"access"=>"private"',
    '"access"=>"customers"',
    '"access"=>"restricted"',
)
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


def is_car_contract_way(highway: str, other_tags: str) -> bool:
    if highway not in CAR_HIGHWAYS:
        return False
    excluded = (
        *CAR_ACCESS_EXCLUSION_MARKERS,
        *CAR_SERVICE_EXCLUSION_MARKERS,
        *CAR_BUS_ONLY_MARKERS,
    )
    return not any(marker in other_tags for marker in excluded)


def numeric_maxspeed(other_tags: str) -> float | None:
    match = re.search(r'"maxspeed"=>"([^"]+)"', other_tags)
    if match is None:
        return None
    number = re.match(r"\s*(\d+(?:\.\d+)?)", match.group(1))
    return float(number.group(1)) if number else None


def extent_for(layer: QgsVectorLayer, extent: QgsRectangle, project: QgsProject):
    return QgsCoordinateTransform(
        CRS, layer.crs(), project.transformContext()
    ).transformBoundingBox(extent)


def source_geometry_length(feature, layer, project):
    geometry = QgsGeometry(feature.geometry())
    geometry.transform(
        QgsCoordinateTransform(layer.crs(), CRS, project.transformContext())
    )
    return geometry.length()


def main() -> None:
    app = QgsApplication([], False)
    app.initQgis()
    try:
        project = QgsProject.instance()
        if not project.read(str(PROJECT_PATH)):
            raise RuntimeError(f"Could not read {PROJECT_PATH}")
        print("Project loaded", flush=True)

        communes = QgsVectorLayer(str(COMMUNES), "communes", "ogr")
        print("Communes loaded", flush=True)
        communes.setSubsetString('"code_insee" = \'35238\'')
        boundary = next(communes.getFeatures(), None)
        if boundary is None:
            raise RuntimeError("Rennes boundary missing")
        boundary_geometry = QgsGeometry(boundary.geometry())
        boundary_geometry.transform(
            QgsCoordinateTransform(
                communes.crs(), CRS, project.transformContext()
            )
        )
        extent = boundary_geometry.boundingBox()
        extent.grow(MAP_MARGIN_M)

        print(f"Map extent: {extent.toString()}", flush=True)

        osm = QgsVectorLayer(f"{OSM}|layername=lines", "OSM raw", "ogr")
        print("OSM loaded", flush=True)
        osm_request = QgsFeatureRequest().setFilterRect(extent_for(osm, extent, project))
        highway_counts = Counter()
        walk_unrestricted = 0
        walk_contract = 0
        walk_lengths = {"unrestricted": 0.0, "contract": 0.0}
        explicit_walk_count = 0
        explicit_walk_length = 0.0
        explicit_tag_values = Counter()
        empty_highway_tags = Counter()
        broad_walk_count = 0
        broad_walk_length = 0.0
        car_tag_values = Counter()
        car_service_values = Counter()
        car_deny_values = Counter()
        car_bus_values = Counter()
        osm_id_counts = Counter()
        car_osm_id_counts = Counter()
        car_oneway_values = Counter()
        car_contract_count = 0
        car_contract_length = 0.0
        maxspeed_values = Counter()
        maxspeed_tagged_count = 0
        speed_candidate_counts = Counter()
        speed_candidate_lengths = Counter()
        speed_extra_counts = Counter()
        speed_extra_lengths = Counter()
        speed_extra_highways = {threshold: Counter() for threshold in (20, 30, 50)}
        walk_contract_ids = set()
        walk_speed_ids = set()
        car_contract_ids = set()
        fields = [field.name() for field in osm.fields()]
        for feature in osm.getFeatures(osm_request):
            highway = str(feature["highway"] or "")
            osm_id = str(feature["osm_id"] or "")
            osm_id_counts[osm_id] += 1
            highway_counts[highway] += 1
            other_tags = str(feature["other_tags"] or "")
            if highway in CAR_HIGHWAYS:
                car_osm_id_counts[osm_id] += 1
                if is_car_contract_way(highway, other_tags):
                    car_contract_count += 1
                    car_contract_length += source_geometry_length(feature, osm, project)
                    car_contract_ids.add(osm_id)
                for key, value in re.findall(r'"([^"]+)"=>"([^"]*)"', other_tags):
                    if key in {
                        "access",
                        "access:conditional",
                        "access:lanes",
                        "busway",
                        "bus:lanes",
                        "highway",
                        "lanes:bus",
                        "motor_vehicle",
                        "motor_vehicle:conditional",
                        "motorcar",
                        "oneway",
                        "oneway:conditional",
                        "psv:lanes",
                        "service",
                        "vehicle",
                        "vehicle:lanes",
                    }:
                        car_tag_values[(key, value)] += 1
                    if key == "service":
                        car_service_values[value] += 1
                    if key == "oneway":
                        car_oneway_values[value] += 1
                    if key in {"access", "vehicle", "motor_vehicle", "motorcar"}:
                        if value in {"no", "private", "customers", "restricted"}:
                            car_deny_values[(key, value)] += 1
                    if key in {"busway", "bus:lanes", "lanes:bus", "psv:lanes"}:
                        car_bus_values[(key, value)] += 1
            if not highway:
                match = re.search(r'"highway"=>"([^"]+)"', other_tags)
                if match:
                    empty_highway_tags[match.group(1)] += 1
            restricted = any(marker in other_tags for marker in RESTRICTION_MARKERS)
            explicit_walk = bool(
                re.search(
                    r'"(?:sidewalk|sidewalk:left|sidewalk:right)"=>"(?:'
                    + "|".join(WALK_SIDEWALK_VALUES)
                    + r')"',
                    other_tags,
                )
                or re.search(
                    r'"foot"=>"(?:'
                    + "|".join(WALK_FOOT_VALUES)
                    + r')"',
                    other_tags,
                )
            )
            if highway in CAR_HIGHWAYS:
                for key, value in re.findall(r'"(maxspeed|maxspeed:forward|maxspeed:backward)"=>"([^"]*)"', other_tags):
                    maxspeed_values[(key, value)] += 1
                speed = numeric_maxspeed(other_tags)
                if speed is not None:
                    maxspeed_tagged_count += 1
                    if (
                        is_car_contract_way(highway, other_tags)
                        and highway in WALK_EXPLICIT_ROADS
                    ):
                        is_current_walk_way = (
                            highway in WALK_HIGHWAYS
                            or (highway in WALK_EXPLICIT_ROADS and explicit_walk)
                        ) and not restricted
                        for threshold in (20, 30, 50):
                            if speed <= threshold:
                                speed_candidate_counts[threshold] += 1
                                speed_candidate_lengths[threshold] += source_geometry_length(feature, osm, project)
                                if threshold == 30 and not restricted:
                                    walk_speed_ids.add(osm_id)
                                if not is_current_walk_way and not restricted:
                                    speed_extra_counts[threshold] += 1
                                    speed_extra_lengths[threshold] += source_geometry_length(feature, osm, project)
                                    speed_extra_highways[threshold][highway] += 1
            for key, value in re.findall(
                r'"(sidewalk|sidewalk:left|sidewalk:right|foot)"=>"([^"]+)"',
                other_tags,
            ):
                explicit_tag_values[(key, value)] += 1
            is_dedicated_walk = highway in WALK_HIGHWAYS
            is_explicit_walk_road = highway in WALK_EXPLICIT_ROADS and explicit_walk
            if (is_dedicated_walk or is_explicit_walk_road) and not restricted:
                walk_contract_ids.add(osm_id)
            if is_explicit_walk_road and not restricted:
                explicit_walk_count += 1
                explicit_walk_length += source_geometry_length(feature, osm, project)
            if not is_dedicated_walk:
                if highway in {
                    "residential",
                    "service",
                    "living_street",
                    "unclassified",
                    "tertiary",
                    "tertiary_link",
                    "secondary",
                    "secondary_link",
                    "primary",
                    "primary_link",
                } and not restricted:
                    broad_walk_count += 1
                    broad_walk_length += source_geometry_length(feature, osm, project)
            if is_dedicated_walk:
                walk_unrestricted += 1
                walk_lengths["unrestricted"] += source_geometry_length(feature, osm, project)
            if (is_dedicated_walk or is_explicit_walk_road) and not restricted:
                walk_contract += 1
                walk_lengths["contract"] += source_geometry_length(feature, osm, project)

        print(f"OSM fields: {fields}", flush=True)
        print(f"OSM highway counts: {highway_counts.most_common()}", flush=True)
        print(
            "OSM way identities: "
            f"{sum(osm_id_counts.values())} rows / {len(osm_id_counts)} unique osm_id / "
            f"{sum(count > 1 for count in osm_id_counts.values())} duplicated ids",
            flush=True,
        )
        print(
            "Car way identities: "
            f"{sum(car_osm_id_counts.values())} rows / {len(car_osm_id_counts)} unique osm_id / "
            f"{sum(count > 1 for count in car_osm_id_counts.values())} duplicated ids",
            flush=True,
        )
        print(f"Car oneway values: {car_oneway_values.most_common()}", flush=True)
        print(
            "Car prototype contract: "
            f"{car_contract_count} features / {car_contract_length / 1000:.1f} km",
            flush=True,
        )
        print(f"Car-relevant tag values: {car_tag_values.most_common()}", flush=True)
        print(f"Car service values: {car_service_values.most_common()}", flush=True)
        print(f"Car explicit-denial values: {car_deny_values.most_common()}", flush=True)
        print(f"Car bus-lane values: {car_bus_values.most_common()}", flush=True)
        print(f"Car maxspeed values: {maxspeed_values.most_common()}", flush=True)
        print(
            "Car ways with numeric maxspeed: "
            f"{maxspeed_tagged_count}; speed candidates after car exclusions: "
            + ", ".join(
                f"≤{threshold}={speed_candidate_counts[threshold]} features / "
                f"{speed_candidate_lengths[threshold] / 1000:.1f} km"
                for threshold in (20, 30, 50)
            ),
            flush=True,
        )
        print(
            "New walking candidates from speed after current walking filter: "
            + ", ".join(
                f"≤{threshold}={speed_extra_counts[threshold]} features / "
                f"{speed_extra_lengths[threshold] / 1000:.1f} km / "
                f"highways={speed_extra_highways[threshold].most_common()}"
                for threshold in (20, 30, 50)
            ),
            flush=True,
        )
        print(f"Empty highway field but highway tag in other_tags: {empty_highway_tags}", flush=True)
        print(
            "Walking source contract: "
            f"{walk_contract}/{walk_unrestricted} features, "
            f"{walk_lengths['contract'] / 1000:.1f}/{walk_lengths['unrestricted'] / 1000:.1f} km",
            flush=True,
        )
        print(
            "Broad public-road candidate (not canonical): "
            f"{broad_walk_count} features / {broad_walk_length / 1000:.1f} km",
            flush=True,
        )
        print(
            "Roads with explicit sidewalk/foot evidence: "
            f"{explicit_walk_count} features / {explicit_walk_length / 1000:.1f} km",
            flush=True,
        )
        print(f"Explicit sidewalk/foot tag values: {explicit_tag_values}", flush=True)
        print(
            "Walking restriction markers: "
            + ", ".join(RESTRICTION_MARKERS),
            flush=True,
        )

        geovelo = QgsVectorLayer(str(GEOVELO), "Geovelo raw", "ogr")
        print("Geovelo loaded", flush=True)
        geovelo_request = QgsFeatureRequest().setFilterRect(
            extent_for(geovelo, extent, project)
        )
        cycling_counts = Counter()
        cycling_lengths = Counter()
        side_counts = Counter()
        for feature in geovelo.getFeatures(geovelo_request):
            ame_d = str(feature["ame_d"] or "")
            ame_g = str(feature["ame_g"] or "")
            side_counts[(ame_d, ame_g)] += 1
            winner = ame_d if ame_d != "AUCUN" else ame_g
            if winner in PROTECTED_CYCLING:
                family = "protected"
            elif winner in SHARED_CYCLING:
                family = "shared"
            else:
                continue
            cycling_counts[family] += 1
            cycling_lengths[family] += source_geometry_length(feature, geovelo, project)

        print(f"Geovelo side pairs: {side_counts.most_common()}", flush=True)
        print(
            "Cycling source contract: "
            + ", ".join(
                f"{family}={cycling_counts[family]} features / "
                f"{cycling_lengths[family] / 1000:.1f} km"
                for family in ("protected", "shared")
            ),
            flush=True,
        )

        print("Generated project layer counts and renderer styles:", flush=True)
        project_counts = {}
        project_properties = {}
        project_ids = {}
        for layer in project.mapLayers().values():
            if not any(
                marker in layer.name()
                for marker in ("OSM", "Géovélo")
            ):
                continue
            request = QgsFeatureRequest().setFilterRect(
                extent_for(layer, extent, project)
            )
            count = sum(1 for _ in layer.getFeatures(request))
            symbol = layer.renderer().symbol() if layer.renderer() else None
            symbol_layer = symbol.symbolLayer(0) if symbol else None
            pen_style = (
                symbol_layer.penStyle().name
                if symbol_layer is not None and hasattr(symbol_layer.penStyle(), "name")
                else str(symbol_layer.penStyle()) if symbol_layer is not None else "none"
            )
            properties = symbol_layer.properties() if symbol_layer is not None else {}
            project_counts[layer.name()] = count
            project_properties[layer.name()] = properties
            if layer.name().startswith("OSM"):
                project_ids[layer.name()] = {
                    str(feature["osm_id"] or "") for feature in layer.getFeatures(request)
                }
            print(
                f"  {layer.name()}: {count} features, "
                f"opacity={layer.opacity():.2f}, pen={pen_style}, "
                f"properties={properties}"
                , flush=True
            )

        walk_canonical_count = walk_contract + speed_extra_counts[30]
        expected_counts = {
            "Géovélo · vélo · protégé": cycling_counts["protected"],
            "Géovélo · vélo · partagé": cycling_counts["shared"],
            "OSM · marche (t)": walk_canonical_count,
            "OSM · voiture (c)": car_contract_count,
        }
        for layer_name, expected in expected_counts.items():
            actual = project_counts.get(layer_name)
            if actual != expected:
                raise AssertionError(
                    f"{layer_name}: expected {expected}, got {actual}"
                )
        walk_speed_ids.update(walk_contract_ids)
        expected_ids = {
            "OSM · marche (t)": walk_speed_ids,
            "OSM · voiture (c)": car_contract_ids,
        }
        for layer_name, expected in expected_ids.items():
            actual = project_ids.get(layer_name, set())
            if actual != expected:
                print(
                    f"{layer_name} id mismatch: missing={len(expected - actual)}, "
                    f"unexpected={len(actual - expected)}, "
                    f"missing_sample={sorted(expected - actual)[:5]}, "
                    f"unexpected_sample={sorted(actual - expected)[:5]}",
                    flush=True,
                )
                raise AssertionError(f"{layer_name}: source/project ids differ")
        protected_properties = project_properties["Géovélo · vélo · protégé"]
        shared_properties = project_properties["Géovélo · vélo · partagé"]
        if shared_properties.get("line_color") == protected_properties.get("line_color"):
            raise AssertionError(
                "Protected/shared cycling still use one color"
            )
        for layer_name, properties in project_properties.items():
            if layer_name.startswith(("OSM", "Géovélo")) and properties.get(
                "line_width"
            ) != EXPECTED_NETWORK_LINE_WIDTH_MM:
                raise AssertionError(
                    f"{layer_name}: expected width "
                    f"{EXPECTED_NETWORK_LINE_WIDTH_MM}, got {properties.get('line_width')}"
                )
    finally:
        app.exitQgis()


if __name__ == "__main__":
    main()
