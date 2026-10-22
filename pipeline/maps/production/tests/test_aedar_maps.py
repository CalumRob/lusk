"""CLI lifecycle contract for the isolated AEDAR production-map family."""
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import Mock, patch
import json
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from qgis.core import QgsRectangle

sys.path.insert(0, str(Path(__file__).parents[1]))
import aedar_maps  # noqa: E402
from aedar_maps import (AedarMapAdapter, MODES, TERRITORIES, _continuous_palette,
                        aedar_recipe, aedar_loss_recipe,
                        _equal_width_breaks, _inside_territory_mask,
                        _cap_scale_values, _feature_palette, _percentile_scale_cap,
                        _project_origins, _scale_endpoint_label)  # noqa: E402
from runner import Binding, MapSet  # noqa: E402
from pipeline.maps.production.tests.qgis_fixture import fixture_folder, qgis_application


class AedarScaleTests(unittest.TestCase):
    def test_exploration_covers_allineuc_redon_and_bretagne_for_all_three_modes(self):
        self.assertEqual(TERRITORIES, (
            ("commune", "22001"),
            ("epci", "243500741"),
            ("region", "53"),
        ))
        self.assertEqual(MODES, ("car", "transit", "bike_lts2"))

    def test_equal_width_breaks_are_mode_local_and_include_zero_in_the_first_range(self):
        self.assertEqual(_equal_width_breaks([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
                         (0.0, 2.0, 4.0, 6.0, 8.0, 10.0))

    def test_zero_only_data_still_produces_a_single_usable_scale(self):
        self.assertEqual(_equal_width_breaks([0, 0, 0]),
                         (0.0, 0.2, 0.4, 0.6, 0.8, 1.0))

    def test_continuous_ramp_preserves_bike_teal_endpoints_and_interpolates(self):
        ramp = _continuous_palette(("#A8C8CD", "#2E6171"), steps=3)
        self.assertEqual(ramp, ("#a8c8cd", "#6b949f", "#2e6171"))

    def test_car_diversity_is_unchanged_and_loss_maps_share_car_ramp_direction(self):
        palette = aedar_maps.MODE_PALETTES["car"]
        car = _feature_palette({"comparison": "car-only-typequ", "mode": "car"}, palette, 3)
        loss = _feature_palette({"comparison": "car-only-typequ", "mode": "walk"},
                                aedar_maps.MODE_PALETTES["walk"], 3)
        self.assertEqual(car, _continuous_palette(palette, 3))
        self.assertEqual(loss, _continuous_palette(palette, 3))

    def test_mode_title_colors_match_the_aedar_prototype_mode_tones(self):
        self.assertEqual(aedar_maps.MODE_TITLE_COLOURS["transit"], "#448FA6")
        self.assertEqual(aedar_maps.MODE_TITLE_COLOURS["bike_lts4"], "#2E6171")
        self.assertEqual(aedar_maps.MODE_TITLE_COLOURS["bike_lts2"], "#86A2A8")
        self.assertEqual(aedar_maps.MODE_TITLE_COLOURS["walk"], "#92BCC6")

    def test_loss_ramp_uses_nearest_rank_p95_and_saturates_values_above_it(self):
        values = list(range(1, 101))
        cap = _percentile_scale_cap(values)
        self.assertEqual(cap, 96.0)
        self.assertEqual(_cap_scale_values((1, 96, 97, 100), cap).tolist(),
                         [1.0, 96.0, 96.0, 96.0])
        self.assertEqual(_scale_endpoint_label({"scale_overflow": True}, cap), "96+")
        self.assertEqual(_scale_endpoint_label({"scale_overflow": False}, cap), "96")

    def test_territory_membership_uses_origin_commune_codes(self):
        self.assertEqual(
            _inside_territory_mask(["35238", "35001", "56001"], ("35238", "56001")).tolist(),
            [True, False, True],
        )

    def test_origin_projection_is_batch_based_and_preserves_coordinate_order(self):
        x, y = _project_origins([-1.68, -1.68], [48.11, 48.11])
        self.assertEqual(len(x), 2)
        self.assertAlmostEqual(float(x[0]), 351895.902, places=2)
        self.assertAlmostEqual(float(y[0]), 6789166.410, places=2)
        self.assertEqual(x[0], x[1])
        self.assertEqual(y[0], y[1])

    def test_map_binding_has_stepped_and_continuous_variants_for_every_pair(self):
        bases = [
            {"territory": {"kind": kind, "code": code, "name": code},
             "extent": None, "analytical_geometry": None}
            for kind, code in TERRITORIES
        ]
        representative = Binding("network", MapSet({"maps": tuple(bases)}))
        territory_codes = {("commune", "22001"): ("22001",),
                           ("epci", "243500741"): ("22001", "35001"),
                           ("region", "53"): ("22001", "35001", "56001")}

        with tempfile.TemporaryDirectory() as directory:
            facts_dir = Path(directory)
            spine_path = facts_dir / "spine.parquet"
            pq.write_table(pa.table({"code_insee": ["22001"]}), spine_path)
            pq.write_table(pa.table({
                "cle_interop_adr": ["A", "B", "C"],
                "code_insee": ["22001", "35001", "56001"],
                "lon": [-1.68, -1.44, -2.76],
                "lat": [48.11, 48.20, 47.66],
                "diversity_car_15": [0, 5, 10],
                "diversity_transit_p1_15": [0, 5, 10],
                "diversity_bike_lts2_15": [0, 5, 10],
            }), facts_dir / aedar_maps.ADDRESS_METRICS_FILENAME)

            with (patch("network.build_representative_map_set", return_value=representative),
                  patch.object(aedar_maps, "_territory_commune_codes", return_value=territory_codes)):
                binding = aedar_maps.build_aedar_map_set("raw", facts_dir, spine_path)

        features = binding.map_set.layers["aedar-address-variants"]
        self.assertEqual(len(features), 18)
        for kind, code in TERRITORIES:
            for mode in MODES:
                pair = [feature for feature in features
                        if feature["territory"]["kind"] == kind
                        and feature["territory"]["code"] == code
                        and feature.get("source_mode", feature["mode"]) == mode]
                self.assertEqual(len(pair), 2, (kind, code, mode))
                self.assertEqual({feature.get("scale_type", "stepped") for feature in pair},
                                 {"stepped", "continuous"})

    def test_loss_map_binding_uses_five_equal_width_bins_and_shared_territory_p95_caps(self):
        bases = [
            {"territory": {"kind": kind, "code": code, "name": code},
             "extent": None, "analytical_geometry": None}
            for kind, code in TERRITORIES
        ]
        representative = Binding("network", MapSet({"maps": tuple(bases)}))
        territory_codes = {
            ("commune", "22001"): ("22001",),
            ("epci", "243500741"): ("22001", "35001"),
            ("region", "53"): ("22001", "35001", "56001"),
        }

        with tempfile.TemporaryDirectory() as directory:
            facts_dir = Path(directory)
            spine_path = facts_dir / "spine.parquet"
            pq.write_table(pa.table({"code_insee": ["22001"]}), spine_path)
            pq.write_table(pa.table({
                "cle_interop_adr": ["A", "B", "C"],
                "code_insee": ["22001", "35001", "56001"],
                "lon": [-1.68, -1.44, -2.76],
                "lat": [48.11, 48.20, 47.66],
                "diversity_car_15": [0, 109, 218],
                "loss_car_only_transit_p1_15": [10, 25, 50],
                "loss_car_only_bike_lts2_15": [20, 35, 60],
                "loss_car_only_bike_lts4_15": [30, 45, 70],
                "loss_car_only_walk_15": [40, 55, 80],
            }), facts_dir / aedar_maps.ADDRESS_METRICS_FILENAME)

            with (patch("network.build_representative_map_set", return_value=representative),
                  patch.object(aedar_maps, "_territory_commune_codes", return_value=territory_codes)):
                binding = aedar_maps.build_aedar_loss_map_set("raw", facts_dir, spine_path)

        features = binding.map_set.layers["aedar-equipment-loss"]
        self.assertEqual(len(features), 15)
        self.assertTrue(all(feature["scale_type"] == "equal-width" for feature in features))
        self.assertTrue(all(feature["comparison"] == "car-only-typequ" for feature in features))
        for feature in features:
            territory = feature["territory"]["kind"]
            self.assertEqual(len(feature["scale_breaks"]), 6)
            widths = np.diff(feature["scale_breaks"])
            self.assertTrue(np.allclose(widths, widths[0]))
            if feature["mode"] == "car":
                self.assertEqual(feature["scale_breaks"][0], 0.0)
                self.assertEqual(feature["scale_breaks"][-1], 218.0)
            else:
                expected = {"commune": 40, "epci": 55, "region": 80}[territory]
                self.assertEqual(feature["scale_breaks"][0], 0.0)
                self.assertEqual(feature["scale_breaks"][-1], float(expected))
        for territory in ("commune", "epci", "region"):
            territory_losses = [feature for feature in features
                                if feature["territory"]["kind"] == territory
                                and feature["mode"] != "car"]
            self.assertEqual({feature["scale_breaks"] for feature in territory_losses},
                             {next(iter(territory_losses))["scale_breaks"]})
        by_mode = {feature["mode"]: feature for feature in features
                   if feature["territory"]["kind"] == "commune"}
        self.assertEqual(by_mode["car"]["title_prefix"] + by_mode["car"]["title_mode"],
                         "Diversité d’accès en voiture")
        self.assertEqual(by_mode["transit"]["title_prefix"] + by_mode["transit"]["title_mode"],
                         "Diversité perdue en transports")
        self.assertEqual(by_mode["bike_lts2"]["title_prefix"] + by_mode["bike_lts2"]["title_mode"],
                         "Diversité perdue à vélo (LTS 2)")
        self.assertIsNone(by_mode["car"]["helper"])
        self.assertEqual(by_mode["bike_lts2"]["helper"],
                         "Nombre de types d’équipements BPE accessibles en 15 minutes en voiture, mais pas à vélo.")
        self.assertEqual(by_mode["transit"]["helper"],
                         "Nombre de types d’équipements BPE accessibles en 15 minutes en voiture, mais pas en transports.")
        self.assertEqual(by_mode["bike_lts4"]["title_prefix"] + by_mode["bike_lts4"]["title_mode"],
                         "Diversité perdue à vélo (LTS 4)")
        self.assertEqual(by_mode["bike_lts4"]["helper"],
                         "Nombre de types d’équipements BPE accessibles en 15 minutes en voiture, mais pas à vélo.")
        self.assertEqual(by_mode["walk"]["title_prefix"] + by_mode["walk"]["title_mode"],
                         "Diversité perdue à pied")
        self.assertEqual(aedar_loss_recipe().name, "aedar-address-equipment-loss-exploration")

    def test_equal_width_loss_legend_labels_every_boundary_and_marks_the_p95_cap(self):
        feature = {"comparison": "car-only-typequ", "mode": "walk", "scale_overflow": True}
        self.assertEqual(aedar_maps._legend_tick_labels(feature, (0, 20, 40, 60, 80, 100)),
                         ((0, "0"), (1, "20"), (2, "40"), (3, "60"), (4, "80"), (5, "100+")))


class AedarMapCliTests(unittest.TestCase):
    def test_shared_ground_extent_comes_from_the_existing_map_binding(self):
        binding = Binding("aedar", MapSet({"maps": (
            {"extent": QgsRectangle(0, 0, 10, 10), "facts_path": "binding-fixture.parquet",
             "value_field": "diversity_car_15", "territory": {"kind": "commune", "code": "fixture"}},
            {"extent": QgsRectangle(-2, -3, 20, 30), "facts_path": "binding-fixture.parquet",
             "value_field": "diversity_car_15", "territory": {"kind": "commune", "code": "fixture"}},
        )}))
        adapter = AedarMapAdapter("raw")
        adapter._load_font = Mock()
        directory = fixture_folder(tempfile.mkdtemp(prefix="lusk-aedar-ground-binding-"))
        qgis_application()
        adapter.raw_dir = directory
        (adapter.raw_dir / "communes_limites.geojson").write_text(json.dumps({
            "type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "EPSG:2154"}},
            "features": [{"type": "Feature", "properties": {"code_insee": "22001"},
                          "geometry": {"type": "Polygon", "coordinates": [
                              [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]}}]}), encoding="utf-8")
        with (patch("network.build_representative_map_set",
                    side_effect=AssertionError("rebuilt representative geography")),
              patch("map_ground.prepare_shared_ground", return_value=object()) as prepare):
            adapter.prepare_run(aedar_recipe(), binding, ("inspection",), "output")

        self.assertEqual(prepare.call_args.args[2], QgsRectangle(-2, -3, 20, 30))

    def test_preflight_checks_each_unique_facts_file_without_loading_its_rows(self):
        features = [{"facts_path": "facts.parquet"} for _ in range(18)]
        binding = Binding("aedar", MapSet({"maps": features}))
        parquet = Mock()
        parquet.metadata.num_rows = 123
        with patch.object(aedar_maps.pq, "ParquetFile", return_value=parquet) as open_file:
            AedarMapAdapter("raw").preflight(None, binding)

        open_file.assert_called_once_with("facts.parquet")



if __name__ == "__main__":
    unittest.main()
