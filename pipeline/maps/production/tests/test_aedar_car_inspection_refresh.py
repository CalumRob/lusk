"""Behavioral contract for affected AEDAR car inspection refreshes."""
import sys
from pathlib import Path
import unittest
from qgis.core import QgsRectangle

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aedar_car_inspection_refresh import select_affected_aedar_car_inspection_binding
from aedar_static import AedarStaticAdapter
from aedar_car_inspection_refresh import acquire_aedar_car_inspection_context
from runner import Binding, MapSet


def feature(code, *, changed, mode="car"):
    base = QgsRectangle(0.0, 0.0, 10.0, 10.0)
    return {
        "territory": {"kind": "commune", "code": code, "name": f"Commune {code}"},
        "mode": mode,
        "extent": base,
        "inspection_extent": QgsRectangle(0.0, 0.0, 12.0, 12.0) if changed else base,
    }


class AedarCarInspectionRefreshTests(unittest.TestCase):
    def test_context_is_acquired_for_the_union_of_selected_inspection_frames(self):
        rows = [feature("affected", changed=True)]
        calls = []

        def acquire(root, bbox):
            calls.append((Path(root), bbox))
            return Path(root) / "context.geojson", {"returned": 1}

        path, manifest = acquire_aedar_car_inspection_context(rows, "isolated-context", acquire=acquire)

        self.assertEqual(calls, [(Path("isolated-context"), (0.0, 0.0, 12.0, 12.0))])
        self.assertEqual(path, Path("isolated-context/context.geojson"))
        self.assertEqual(manifest, {"returned": 1})

    def test_selects_only_car_features_whose_live_inspection_frame_changed(self):
        binding = Binding("aedar", MapSet({"aedar-static-selected": (
            feature("affected", changed=True), feature("unchanged", changed=False),
        )}))

        selected = select_affected_aedar_car_inspection_binding(binding)

        rows = tuple(row for layer in selected.map_set.layers.values() for row in layer)
        self.assertEqual(selected.family, "aedar")
        self.assertEqual([(row["territory"]["code"], row["mode"]) for row in rows],
                         [("affected", "car")])

    def test_refuses_loss_features_and_an_unaffected_binding(self):
        loss = Binding("aedar", MapSet({"loss": (feature("x", changed=True, mode="walk"),)}))
        with self.assertRaisesRegex(ValueError, "car-diversity"):
            select_affected_aedar_car_inspection_binding(loss)

        unchanged = Binding("aedar", MapSet({"aedar-static-selected": (feature("x", changed=False),)}))
        with self.assertRaisesRegex(ValueError, "no affected AEDAR car"):
            select_affected_aedar_car_inspection_binding(unchanged)

    def test_rejects_duplicate_territory_car_features(self):
        duplicate = Binding("aedar", MapSet({"aedar-static-selected": (
            feature("x", changed=True), feature("x", changed=True),
        )}))
        with self.assertRaisesRegex(ValueError, "duplicate AEDAR car"):
            select_affected_aedar_car_inspection_binding(duplicate)

    def test_refresh_scope_requires_inspection_only_and_a_live_changed_frame(self):
        adapter = AedarStaticAdapter("unused", "facts", cache_dir="cache",
            expected_territories={("commune", "x")})
        affected = Binding("aedar", MapSet({"aedar-static-selected": (feature("x", changed=True),)}))
        selected = select_affected_aedar_car_inspection_binding(affected)
        self.assertEqual(set(selected.map_set.layers), {"aedar-static-car-inspection-refresh"})
        adapter.preflight_scope(None, selected, "inspection-refresh", ("inspection",))
        with self.assertRaisesRegex(ValueError, "inspection only"):
            adapter.preflight_scope(None, selected, "inspection-refresh", ("inspection", "inline"))
        unaffected = Binding("aedar", MapSet({"aedar-static-selected": (feature("x", changed=False),)}))
        with self.assertRaisesRegex(ValueError, "no affected AEDAR car"):
            adapter.preflight_scope(None, unaffected, "inspection-refresh", ("inspection",))


if __name__ == "__main__":
    unittest.main()
