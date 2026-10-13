"""Behavioral contract for the targeted network-inspection rerun selector."""
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from network_inspection_refresh import (
    select_affected_network_inspection_binding,
    select_refresh_spot_check_outputs,
    validate_isolated_output_dir,
)
from network import NetworkAdapter
from runner import Binding, MapSet


MODES = ("car", "walk", "bike")


def feature(code, mode, *, changed):
    base = (0.0, 0.0, 10.0, 10.0)
    return {
        "territory": {"kind": "epci", "code": code, "name": f"EPCI {code}"},
        "mode": mode,
        "geometry": object(),
        "analytical_geometry": object(),
        "extent": base,
        "inspection_extent": (0.0, 0.0, 12.0, 12.0) if changed else base,
    }


def binding(features):
    return Binding("network", MapSet({"network-outputs": tuple(features)}))


class NetworkInspectionRefreshTests(unittest.TestCase):
    def test_refresh_output_is_dedicated_or_outside_the_repository(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            dedicated = repo / "pipeline" / "maps" / "production" / "output" / "network-inspection-refresh"
            external = root / "staging" / "network-refresh"

            self.assertEqual(validate_isolated_output_dir(
                dedicated, repo_root=repo, dedicated_output_dir=dedicated), dedicated.resolve())
            self.assertEqual(validate_isolated_output_dir(
                external, repo_root=repo, dedicated_output_dir=dedicated), external.resolve())
            for unsafe in (repo, repo / "temporary-output", repo.parent):
                with self.subTest(path=unsafe), self.assertRaisesRegex(ValueError, "external isolated path"):
                    validate_isolated_output_dir(
                        unsafe, repo_root=repo, dedicated_output_dir=dedicated)

    def test_selects_all_modes_only_for_territories_with_a_changed_inspection_frame(self):
        features = [
            feature("affected", mode, changed=True) for mode in MODES
        ] + [
            feature("unchanged", mode, changed=False) for mode in MODES
        ]

        selected = select_affected_network_inspection_binding(binding(features))
        outputs = tuple(item for layer in selected.map_set.layers.values() for item in layer)

        self.assertEqual(
            {(item["territory"]["code"], item["mode"]) for item in outputs},
            {("affected", mode) for mode in MODES},
        )

    def test_refuses_a_partial_mode_set_for_an_affected_territory(self):
        features = [feature("affected", "car", changed=True)]

        with self.assertRaisesRegex(ValueError, "must include all network modes"):
            select_affected_network_inspection_binding(binding(features))

    def test_refuses_a_binding_with_no_framing_changes(self):
        features = [feature("unchanged", mode, changed=False) for mode in MODES]

        with self.assertRaisesRegex(ValueError, "contains no affected network inspection maps"):
            select_affected_network_inspection_binding(binding(features))

    def test_network_refresh_scope_requires_only_inspection_and_only_changed_frames(self):
        adapter = NetworkAdapter("unused")
        candidates = binding([feature("affected", mode, changed=True) for mode in MODES])

        adapter.preflight_scope(None, candidates, "inspection-refresh", ("inspection",))
        with self.assertRaisesRegex(ValueError, "inspection profile only"):
            adapter.preflight_scope(None, candidates, "inspection-refresh", ("inspection", "inline"))

        mixed = binding([feature("affected", mode, changed=True) for mode in MODES]
                        + [feature("unchanged", mode, changed=False) for mode in MODES])
        with self.assertRaisesRegex(ValueError, "only affected territories"):
            adapter.preflight_scope(None, mixed, "inspection-refresh", ("inspection",))

    def test_spot_check_covers_all_modes_of_the_largest_frame_change_per_territory_kind(self):
        candidates = []
        for kind, code, factor in (
            ("commune", "22100", 1.2),
            ("commune", "22101", 1.4),
            ("epci", "200000001", 1.1),
            ("departement", "22", 1.3),
        ):
            for mode in MODES:
                base = (0.0, 0.0, 10.0, 10.0)
                candidates.append({
                    "territory": {"kind": kind, "code": code, "name": f"{kind} {code}"},
                    "mode": mode,
                    "extent": base,
                    "inspection_extent": (0.0, 0.0, 10.0 * factor, 10.0 * factor),
                })
        outputs = [
            {
                "territory": item["territory"], "mode": item["mode"],
                "profile": "inspection", "path": f"{item['territory']['code']}-{item['mode']}.webp",
                "effective_identity": f"identity-{item['territory']['code']}-{item['mode']}",
                "output_sha256": f"{len(item['territory']['code']):064x}",
            }
            for item in candidates
        ]

        selected = select_refresh_spot_check_outputs(outputs, binding(candidates))

        self.assertEqual(len(selected), 9)
        selected_pairs = {(item["territory"]["kind"], item["territory"]["code"], item["mode"])
                          for item in selected}
        self.assertEqual(selected_pairs, {
            ("commune", "22101", mode) for mode in MODES
        } | {
            ("epci", "200000001", mode) for mode in MODES
        } | {
            ("departement", "22", mode) for mode in MODES
        })


if __name__ == "__main__":
    unittest.main()
