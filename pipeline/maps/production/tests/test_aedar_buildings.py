"""Contract tests for compacting one AEDAR mode into address-level map facts."""
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parents[1]))
from aedar_buildings import prepare_aedar_building_facts  # noqa: E402


class AedarBuildingPreparationTests(unittest.TestCase):
    def write_fixture(self, path, mode, rows):
        suffix = {"car": "car", "bike_lts2": "bike_lts2", "transit": "transit_p1"}[mode]
        values = {
            "code_insee": [row[0] for row in rows],
            "cle_interop_adr": [row[1] for row in rows],
            "lon": [row[2] for row in rows],
            "lat": [row[3] for row in rows],
            "TYPEQU": [row[4] for row in rows],
        }
        for minutes in (10, 15, 20):
            position = {10: 5, 15: 6, 20: 7}[minutes]
            values[f"count_{minutes}_{suffix}"] = [row[position] for row in rows]
        pq.write_table(pa.table(values), path, row_group_size=2)

    def test_address_spine_is_filtered_and_sparse_rows_become_zero_facts(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "address-car.parquet"
            spine = root / "address-origins.parquet"
            output = root / "rennes-car.parquet"
            self.write_fixture(source, "car", [
                ("35238", "adr-1", -1.68, 48.11, "A104", 2, 3, 4),
                ("35238", "adr-1", -1.68, 48.11, "B201", 0, 1, 2),
                ("35238", "adr-3", -1.70, 48.12, "A104", 0, 0, 5),
                ("22001", "outside", -2.9, 48.4, "A104", 99, 99, 99),
            ])
            pq.write_table(pa.table({
                "address_id": ["adr-1", "adr-2", "adr-3", "outside"],
                "code_insee": ["35238", "35238", "35238", "22001"],
                "lon": [-1.68, -1.69, -1.70, -2.9],
                "lat": [48.11, 48.115, 48.12, 48.4],
            }), spine, row_group_size=2)

            result = prepare_aedar_building_facts(
                source, spine, code_insee=("35238",), mode="car")
            pq.write_table(result, output)
            restored = pq.read_table(output).to_pylist()

            self.assertEqual([row["cle_interop_adr"] for row in restored],
                             ["adr-1", "adr-2", "adr-3"])
            self.assertEqual(restored[0]["diversity_10"], 1)
            self.assertEqual(restored[0]["count_10"], 2)
            self.assertEqual(restored[0]["diversity_15"], 2)
            self.assertEqual(restored[0]["count_15"], 4)
            self.assertEqual(restored[0]["diversity_20"], 2)
            self.assertEqual(restored[0]["count_20"], 6)
            self.assertEqual([restored[1][f"diversity_{m}"] for m in (10, 15, 20)], [0, 0, 0])
            self.assertEqual([restored[1][f"count_{m}"] for m in (10, 15, 20)], [0, 0, 0])
            self.assertEqual(result.column_names, [
                "code_insee", "cle_interop_adr", "lon", "lat",
                "diversity_10", "count_10", "diversity_15", "count_15",
                "diversity_20", "count_20",
            ])

    def test_transit_uses_the_owner_selected_optimistic_p1_columns(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "address-transit.parquet"
            spine = root / "address-origins.parquet"
            self.write_fixture(source, "transit", [
                ("35238", "adr-1", -1.68, 48.11, "A104", 3, 5, 8),
            ])
            pq.write_table(pa.table({
                "address_id": ["adr-1"], "code_insee": ["35238"],
                "lon": [-1.68], "lat": [48.11],
            }), spine)

            result = prepare_aedar_building_facts(
                source, spine, code_insee=("35238",), mode="transit")

            self.assertEqual(result.to_pylist()[0]["count_10"], 3)
            self.assertEqual(result.schema.metadata[b"transit_scenario"], b"p1")

    def test_source_coordinates_must_match_the_authoritative_origin_spine(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "address-car.parquet"
            spine = root / "address-origins.parquet"
            self.write_fixture(source, "car", [
                ("35238", "adr-1", -1.68, 48.11, "A104", 2, 3, 4),
            ])
            pq.write_table(pa.table({
                "address_id": ["adr-1"], "code_insee": ["35238"],
                "lon": [-1.69], "lat": [48.11],
            }), spine)

            with self.assertRaisesRegex(ValueError, "coordinates disagree"):
                prepare_aedar_building_facts(
                    source, spine, code_insee=("35238",), mode="car")


if __name__ == "__main__":
    unittest.main()
