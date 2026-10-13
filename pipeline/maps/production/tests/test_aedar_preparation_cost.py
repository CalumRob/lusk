"""Keep AEDAR fact preparation to one raw-source scan per mode."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import pyarrow as pa
import pyarrow.parquet as pq

PRODUCTION = Path(__file__).parents[1]
sys.path.insert(0, str(PRODUCTION))
import aedar_buildings  # noqa: E402
from aedar_maps import prepare_aedar_frame_facts  # noqa: E402


class AedarPreparationCostTests(unittest.TestCase):
    def test_one_sorted_table_builds_all_stats_from_one_scan_per_scenario(self):
        suffixes = {"car": "car", "transit": "transit_p1",
                    "transit_gain": "transit_gain_p1", "bike_lts2": "bike_lts2",
                    "bike_lts4": "bike_lts4", "walk": "walk"}
        filenames = {
            "car": "address-car-53-2026v1.parquet",
            "transit": "address-transit-53-2026v1.parquet",
            "transit_gain": "address-transit-gain-53-2026v1.parquet",
            "bike_lts2": "address-bike-lts2-53-2026v1.parquet",
            "bike_lts4": "address-bike-lts4-53-2026v1.parquet",
            "walk": "address-walk-53-2026v1.parquet",
        }
        accessible_types = {"car": ("T1", "T2"), "transit": ("T1",),
                            "transit_gain": ("T2",), "bike_lts2": ("T1",),
                            "bike_lts4": ("T1", "T2"), "walk": ()}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir, facts_dir = root / "raw", root / "facts"
            raw_dir.mkdir()
            spine_path = root / "spine.parquet"
            pq.write_table(pa.table({
                "address_id": ["A", "B"], "code_insee": ["35238", "35001"],
                "lon": [-1.68, -1.44], "lat": [48.11, 48.20],
            }), spine_path)
            source_paths = {}
            for mode, suffix in suffixes.items():
                path = raw_dir / filenames[mode]
                source_paths[str(path.resolve())] = mode
                types = ("T1", "T2", "T3")
                pq.write_table(pa.table({
                    "code_insee": ["35238"] * len(types),
                    "cle_interop_adr": ["A"] * len(types),
                    "lon": [-1.68] * len(types), "lat": [48.11] * len(types),
                    "TYPEQU": list(types),
                    **{f"count_{minute}_{suffix}": [
                        int(typequ in accessible_types[mode]) if minute == 15 else 0
                        for typequ in types]
                       for minute in (10, 15, 20)},
                }), path)

            scanned_modes = []
            original_scanner = aedar_buildings._filtered_scanner

            def observe_source_scans(dataset, columns, predicate, label):
                files = getattr(dataset, "files", ())
                if files:
                    resolved = str(Path(files[0]).resolve())
                    if resolved in source_paths:
                        scanned_modes.append(source_paths[resolved])
                return original_scanner(dataset, columns, predicate, label)

            with patch.object(aedar_buildings, "_filtered_scanner", side_effect=observe_source_scans):
                result_path = prepare_aedar_frame_facts(raw_dir, spine_path, facts_dir)

            self.assertCountEqual(scanned_modes, list(suffixes))
            self.assertEqual(result_path, facts_dir / "address-access-metrics.parquet")
            result = pq.read_table(result_path).to_pylist()
            self.assertEqual(len(result), 2)
            self.assertEqual([row["code_insee"] for row in result], ["35001", "35238"])
            self.assertEqual([row["cle_interop_adr"] for row in result], ["B", "A"])
            self.assertEqual(result[0]["diversity_car_15"], 0)
            row = result[1]
            self.assertEqual(row["diversity_car_15"], 2)
            self.assertEqual(row["diversity_transit_p1_15"], 1)
            self.assertEqual(row["diversity_transit_gain_p1_15"], 1)
            self.assertEqual(row["diversity_bike_lts2_15"], 1)
            self.assertEqual(row["diversity_bike_lts4_15"], 2)
            self.assertEqual(row["diversity_walk_15"], 0)
            self.assertEqual(row["loss_car_only_transit_p1_15"], 1)
            self.assertEqual(row["loss_car_only_transit_gain_p1_15"], 1)
            self.assertEqual(row["loss_car_only_bike_lts2_15"], 1)
            self.assertEqual(row["loss_car_only_bike_lts4_15"], 0)
            self.assertEqual(row["loss_car_only_walk_15"], 2)
            self.assertEqual(row["loss_bike_lts2_vs_lts4_15"], 1)


if __name__ == "__main__":
    unittest.main()
