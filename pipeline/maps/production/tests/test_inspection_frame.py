"""Public map-binding tests for the shared inspection-only frame."""
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))

from qgis.core import QgsProject
from pipeline.maps.production.tests.qgis_fixture import qgis_application, fixture_folder


class InspectionFrameBindingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        qgis_application()

    def _full_bindings(self):
        from aedar_car import build_aedar_car_map_set
        from network import build_full_map_set

        root = fixture_folder(tempfile.mkdtemp(prefix="lusk-inspection-frame-binding-"))
        raw = root / "pipeline" / "data" / "raw"
        raw.mkdir(parents=True)
        metadata = root / "pipeline" / "inst" / "extdata"
        metadata.mkdir(parents=True)
        (metadata / "epci_geo_api.json").write_text(json.dumps({"labels": [
            {"code": "epci-a", "nom": "EPCI A"}]}), encoding="utf-8")
        registry = root / "territoires.json"
        registry.write_text(json.dumps([{"territoire": "22", "type": "departement",
            "nom": "Côtes-d'Armor"}]), encoding="utf-8")

        circle = [[100 * math.cos(2 * math.pi * index / 96),
                   100 * math.sin(2 * math.pi * index / 96)]
                  for index in range(96)]
        circle.append(circle[0])
        records = [
            {"type": "Feature", "properties": {"code_insee": "22001",
                "nom_officiel": "Circle Commune", "code_insee_du_departement": "22",
                "code_insee_de_la_region": "53", "codes_siren_des_epci": "epci-a"},
             "geometry": {"type": "Polygon", "coordinates": [circle]}},
            {"type": "Feature", "properties": {"code_insee": "22002",
                "nom_officiel": "Flat Commune", "code_insee_du_departement": "22",
                "code_insee_de_la_region": "53", "codes_siren_des_epci": "epci-a"},
             "geometry": {"type": "Polygon", "coordinates": [[[1000, 0], [1200, 0],
                 [1200, 2], [1000, 2], [1000, 0]]]}},
        ]
        (raw / "communes_limites.geojson").write_text(json.dumps({
            "type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:2154"}},
            "features": records,
        }), encoding="utf-8")
        from network import _load_network_family_config
        family_config = _load_network_family_config()
        family_config["scope"]["analytical_departments"] = ["22"]
        network_binding = build_full_map_set(raw, QgsProject.instance(),
            family_config=family_config, territory_registry_path=registry)
        facts = root / "car-facts.parquet"
        facts.write_bytes(b"fixture binding input")
        car_binding = build_aedar_car_map_set(raw, facts, scope="full",
            family_config=family_config, territory_registry_path=registry)
        return network_binding, car_binding

    def test_full_network_and_car_bindings_share_inspection_frame_without_changing_analytical_extent(self):
        QgsProject.instance().clear()
        network, car = self._full_bindings()
        network_features = {
            (feature["territory"]["kind"], feature["territory"]["code"], feature["mode"]): feature
            for rows in network.map_set.layers.values() for feature in rows
        }
        car_features = {
            (feature["territory"]["kind"], feature["territory"]["code"], feature["mode"]): feature
            for rows in car.map_set.layers.values() for feature in rows
        }
        for key, car_feature in car_features.items():
            network_feature = network_features[key]
            self.assertEqual(car_feature["inspection_extent"], network_feature["inspection_extent"])
            self.assertEqual(car_feature["extent"], network_feature["extent"])

        circle = network_features[("commune", "22001", "car")]
        flat = network_features[("commune", "22002", "car")]
        self.assertGreater(circle["inspection_extent"].width(), circle["extent"].width())
        self.assertEqual(flat["inspection_extent"], flat["extent"])

        from inspection_frame import shared_ground_extent
        self.assertEqual(shared_ground_extent((circle,), ("inline",)), circle["extent"])
        self.assertEqual(shared_ground_extent((circle,), ("inspection", "inline")),
                         circle["inspection_extent"])

    def test_filled_contact_expands_but_outline_only_contact_does_not(self):
        from qgis.core import QgsGeometry, QgsRectangle
        from inspection_frame import InspectionFramePolicy, OUTPUT_SIZE
        from network import _load_network_family_config

        policy = InspectionFramePolicy(_load_network_family_config())
        extent = QgsRectangle(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

        def geometry_at_pixels(left, top, right, bottom):
            return QgsGeometry.fromRect(QgsRectangle(
                left, OUTPUT_SIZE - bottom, right, OUTPUT_SIZE - top))

        heading = policy.heading_bands[0]
        y = (heading.top() + heading.bottom()) / 2
        filled = geometry_at_pixels(
            heading.left() + 2, y - 2, heading.left() + 8, y + 2)
        self.assertNotEqual(policy.extent_for(filled, extent, "Filled fixture"), extent)

        # The production outline is wider than 2 px at this profile. This
        # polygon's fill stops one pixel before the band, while its outline
        # alone would cross the band; fill-only screening must leave the frame.
        outline_only = geometry_at_pixels(
            heading.left() - 12, y - 3, heading.left() - 1, y + 3)
        self.assertEqual(policy.extent_for(outline_only, extent, "Outline fixture"), extent)

    def test_subtitle_contact_uses_each_exact_name_width(self):
        from qgis.core import QgsGeometry, QgsRectangle
        from inspection_frame import InspectionFramePolicy, OUTPUT_SIZE
        from network import _load_network_family_config

        policy = InspectionFramePolicy(_load_network_family_config())
        extent = QgsRectangle(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
        short_name, long_name = "A", "A Very Long Territory Name"
        short_band = policy._subtitle_band(short_name)
        long_band = policy._subtitle_band(long_name)
        self.assertGreater(long_band.width(), short_band.width())

        x = (short_band.right() + long_band.right()) / 2
        y = (short_band.top() + short_band.bottom()) / 2
        geometry = QgsGeometry.fromRect(QgsRectangle(
            x, OUTPUT_SIZE - y - 2, x + 2, OUTPUT_SIZE - y + 2))
        self.assertEqual(policy.extent_for(geometry, extent, short_name), extent)
        self.assertNotEqual(policy.extent_for(geometry, extent, long_name), extent)

    def test_runner_invalidates_only_inspection_when_its_frame_changes(self):
        from qgis.core import QgsGeometry, QgsRectangle
        from runner import Binding, Foundation, MapSet, Recipe, run_production
        from pipeline.maps.production.tests.test_contract import png

        class ExtentAdapter:
            def __init__(self):
                self.rendered_extents = []

            def preflight(self, recipe, binding):
                pass

            def render_identity(self):
                return {"implementation": "extent-fixture-v1"}

            def input_identity(self):
                return {"source": "fixture"}

            def expected_output_path(self, feature, profile, output_dir):
                return output_dir / f"{profile.name}.png"

            def render(self, recipe, feature, profile, output_dir):
                path = self.expected_output_path(feature, profile, output_dir)
                path.parent.mkdir(parents=True, exist_ok=True)
                png(path, *profile.size, rgba=profile.transparent_outside,
                    transparent=profile.transparent_outside)
                extent = feature["extent"]
                self.rendered_extents.append((profile.name, extent.xMinimum(), extent.xMaximum()))
                return path

            def validate(self, path, feature, profile):
                pass

        extent = QgsRectangle(0, 0, 10, 10)
        feature = {"territory": {"kind": "commune", "code": "22001", "name": "Circle"},
            "mode": "car", "geometry": QgsGeometry.fromRect(extent),
            "analytical_geometry": QgsGeometry.fromRect(extent), "extent": extent,
            "inspection_extent": QgsRectangle(-5, -5, 15, 15)}
        binding = Binding("fixture", MapSet({"maps": (feature,)}))
        recipe = Recipe("extent-fixture", 1, Foundation(version="fixture-v1"),
                        "fixture", ("geometry", "territory", "mode", "analytical_geometry", "extent"))
        adapter = ExtentAdapter()
        output = fixture_folder(tempfile.mkdtemp(prefix="lusk-inspection-frame-runner-"))
        first = run_production(recipe, binding, "representative", ("inspection", "inline"),
                               adapter, output)
        changed = {**feature, "inspection_extent": QgsRectangle(-6, -6, 16, 16)}
        second = run_production(recipe, Binding("fixture", MapSet({"maps": (changed,)})),
                                "representative", ("inspection", "inline"), adapter, output)

        decisions = {row["profile"]: row["decision"] for row in second.outputs}
        self.assertEqual(decisions, {"inspection": "rendered", "inline": "reused-output"})
        self.assertEqual(adapter.rendered_extents[-1], ("inspection", -6.0, 16.0))
        self.assertEqual(adapter.rendered_extents[:2], [
            ("inspection", -5.0, 15.0), ("inline", 0.0, 10.0)])
