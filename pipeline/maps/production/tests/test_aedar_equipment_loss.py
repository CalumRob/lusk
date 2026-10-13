"""Contract for address-level BPE types reachable by car but not another mode."""
from pathlib import Path
import sys
import tempfile
import unittest

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parents[1]))
from aedar_buildings import (derive_lost_equipment_type_facts,
                             prepare_accessible_equipment_type_keys)  # noqa: E402


class LostEquipmentTypeFactsTests(unittest.TestCase):
    def test_counts_car_only_types_without_cancelling_mode_only_types(self):
        car = pa.table({
            "code_insee": ["35238"] * 4,
            "cle_interop_adr": ["A", "A", "A", "B"],
            "TYPEQU": ["T1", "T2", "T3", "T4"],
            "count_15_car": [2, 0, 1, 0],
        })
        bike = pa.table({
            "code_insee": ["35238"] * 4,
            "cle_interop_adr": ["A", "A", "A", "B"],
            "TYPEQU": ["T1", "T2", "T3", "T5"],
            "count_15_bike_lts2": [1, 4, 0, 1],
        })
        spine = pa.table({
            "code_insee": ["35238"] * 3,
            "cle_interop_adr": ["A", "B", "C"],
            "lon": [-1.68, -1.44, -1.50],
            "lat": [48.11, 48.20, 48.15],
        })

        result = derive_lost_equipment_type_facts(car, bike, spine,
                                                   mode_count_field="count_15_bike_lts2")

        self.assertEqual(result["cle_interop_adr"].to_pylist(), ["A", "B", "C"])
        # A loses only T3. T2's bike-only access cannot cancel that loss;
        # B's bike-only T5 does not create a car-side loss.
        self.assertEqual(result["lost_diversity_15"].to_pylist(), [1, 0, 0])
        self.assertEqual(result["code_insee"].to_pylist(), ["35238"] * 3)

    def test_source_preparation_filters_to_the_requested_communes(self):
        car = pa.table({
            "code_insee": ["35238", "35001"],
            "cle_interop_adr": ["A", "OUTSIDE"],
            "TYPEQU": ["T1", "T2"],
            "count_15_car": [1, 1],
        })
        bike = pa.table({
            "code_insee": ["35238", "35001"],
            "cle_interop_adr": ["A", "OUTSIDE"],
            "TYPEQU": ["T1", "T2"],
            "count_15_bike_lts2": [3, 1],
        })
        with tempfile.TemporaryDirectory() as directory:
            car_path, bike_path = Path(directory) / "car.parquet", Path(directory) / "bike.parquet"
            pq.write_table(car, car_path)
            pq.write_table(bike, bike_path)

            result = prepare_accessible_equipment_type_keys(
                bike_path, code_insee=("35238",), mode="bike_lts2")

        self.assertEqual(result.to_pylist(), [
            {"code_insee": "35238", "cle_interop_adr": "A", "TYPEQU": "T1"}
        ])


if __name__ == "__main__":
    unittest.main()
