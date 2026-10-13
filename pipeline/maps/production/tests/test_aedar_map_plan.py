"""Focused map-plan contracts using indexed facts rather than full-frame scans."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1]))
from aedar_map_plan import binding_for, family_config, partition


class IndexedFacts:
    def __init__(self):
        self.metrics = {
            "diversity_car_15": np.array([100, 218, 0]),
            "loss_car_only_transit_p1_15": np.array([1, 2, 3]),
            "loss_car_only_bike_lts2_15": np.array([4, 5, 6]),
            "loss_car_only_bike_lts4_15": np.array([7, 8, 9]),
            "loss_car_only_walk_15": np.array([10, 11, 12]),
        }
        self.car_mean = 106.0

    def positions(self, codes):
        return [0, 1]


class AedarMapPlanTests(unittest.TestCase):
    def test_binding_uses_config_modes_and_fact_index_for_pooled_loss_bounds(self):
        config = family_config()
        base = {"territory": {"kind": "region", "code": "53", "name": "Bretagne"},
                "territory_codes": ("22001",), "geometry": object()}
        binding = binding_for([base], IndexedFacts(), "facts.parquet", config)
        features = binding.map_set.layers["aedar-static-selected"]
        self.assertEqual({row["mode"] for row in features}, set(config["modes"]))
        by_mode = {row["mode"]: row for row in features}
        transit = by_mode["transit"]
        self.assertEqual(transit["_scale"]["min"], 1.0)
        self.assertEqual(transit["_scale"]["max"], 11.0)
        self.assertEqual(by_mode["car"]["regional_mean"], 106.0)
        self.assertEqual(by_mode["car"]["_scale"]["max"], config["car_bounds"][1])

    def test_degenerate_pooled_loss_range_fails_instead_of_inventing_a_bound(self):
        facts = IndexedFacts()
        for field in family_config()["modes"].values():
            if field["measure"] == "equipment_loss":
                facts.metrics[field["value_field"]] = np.array([5, 5, 7])
        # The membership index selects only the equal first two values.
        with self.assertRaisesRegex(ValueError, "no varying pooled loss range"):
            binding_for([{"territory": {"kind": "commune", "code": "22001", "name": "Test"},
                          "territory_codes": ("22001",)}], facts, "facts.parquet")

    def test_partition_keeps_whole_territories_and_covers_every_plan_index(self):
        plan = {"territories": [{"addresses": count} for count in (1, 100, 10, 50, 4, 80, 20)]}
        shards = partition(plan, 4)
        self.assertEqual(sorted(index for shard in shards for index in shard), list(range(7)))
        self.assertTrue(all(shard == sorted(shard) for shard in shards))
        self.assertEqual(len(shards), 4)


if __name__ == "__main__":
    unittest.main()
