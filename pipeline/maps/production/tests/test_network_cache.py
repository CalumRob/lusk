"""Filesystem-only tests for the independent prepared-network cache seam."""
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1]))

from network_sources import FamilyPreparation, prepare_network_sources  # noqa: E402


def family(signature, filenames, calls, name):
    def build(directory):
        calls[name] += 1
        for key, filename in filenames.items():
            (directory / filename).write_bytes(f"{name}:{key}:{calls[name]}".encode())

    return FamilyPreparation(signature, filenames, build)


class PreparedNetworkCacheTests(unittest.TestCase):
    def test_refresh_forces_a_new_generation_and_reports_builds(self):
        with tempfile.TemporaryDirectory() as temp:
            calls = {"osm": 0}
            preparation = family({"effective": "fixture-v1"}, {"car": "car.fgb"}, calls, "osm")
            cache = Path(temp) / "cache"
            prepare_network_sources(cache, {"osm": preparation})
            report = []
            prepare_network_sources(cache, {"osm": preparation}, force=True, report=report)
            self.assertEqual(calls["osm"], 2)
            self.assertEqual(len(report), 1)
            self.assertEqual(report[0]["decision"], "built")

    def test_second_prepare_reuses_each_family_artifact_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            cache_root = Path(temp) / "network-sources"
            calls = {"osm": 0, "geovelo": 0}
            preparations = {
                "osm": family({"source_mtime_ns": 101, "rules": 1},
                              {"car": "car.fgb", "walk": "walk.fgb"}, calls, "osm"),
                "geovelo": family({"source_mtime_ns": 202, "classification": 1},
                                  {"protected": "protected.fgb", "shared": "shared.fgb"}, calls, "geovelo"),
            }

            first = prepare_network_sources(cache_root, preparations)
            second = prepare_network_sources(cache_root, preparations)

            self.assertEqual(calls, {"osm": 1, "geovelo": 1})
            self.assertEqual(first, second)
            self.assertEqual(set(first), {"osm", "geovelo"})
            self.assertTrue(all(path.is_file() for artifacts in second.values()
                                for path in artifacts.values()))

    def test_geovelo_change_rebuilds_only_geovelo_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            cache_root = Path(temp) / "network-sources"
            calls = {"osm": 0, "geovelo": 0}
            osm = family({"source_mtime_ns": 101, "rules": 1},
                         {"car": "car.fgb", "walk": "walk.fgb"}, calls, "osm")
            geovelo_v1 = family({"source_mtime_ns": 202, "classification": 1},
                                {"protected": "protected.fgb", "shared": "shared.fgb"}, calls, "geovelo")

            first = prepare_network_sources(cache_root, {"osm": osm, "geovelo": geovelo_v1})
            geovelo_v2 = family({"source_mtime_ns": 203, "classification": 1},
                                {"protected": "protected.fgb", "shared": "shared.fgb"}, calls, "geovelo")
            second = prepare_network_sources(cache_root, {"osm": osm, "geovelo": geovelo_v2})

            self.assertEqual(calls, {"osm": 1, "geovelo": 2})
            self.assertEqual(first["osm"], second["osm"])
            self.assertNotEqual(first["geovelo"], second["geovelo"])

    def test_interrupted_family_build_never_replaces_a_complete_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            cache_root = Path(temp) / "network-sources"
            calls = {"osm": 0, "geovelo": 0}
            osm = family({"source_mtime_ns": 101},
                         {"car": "car.fgb", "walk": "walk.fgb"}, calls, "osm")
            geovelo_v1 = family({"source_mtime_ns": 202},
                                {"protected": "protected.fgb", "shared": "shared.fgb"}, calls, "geovelo")
            original = prepare_network_sources(cache_root, {"osm": osm, "geovelo": geovelo_v1})

            def interrupted_build(directory):
                calls["geovelo"] += 1
                (directory / "protected.fgb").write_bytes(b"partial protected layer")
                raise OSError("simulated interrupted Geovelo export")

            geovelo_v2 = FamilyPreparation(
                {"source_mtime_ns": 203},
                {"protected": "protected.fgb", "shared": "shared.fgb"},
                interrupted_build,
            )
            with self.assertRaisesRegex(RuntimeError, "previous generation remains untouched"):
                prepare_network_sources(cache_root, {"osm": osm, "geovelo": geovelo_v2})

            restored = prepare_network_sources(cache_root, {"osm": osm, "geovelo": geovelo_v1})

            self.assertEqual(restored, original)
            self.assertEqual(calls, {"osm": 1, "geovelo": 2})

    def test_cache_hit_revalidates_artifact_before_reusing_it(self):
        with tempfile.TemporaryDirectory() as temp:
            cache_root = Path(temp) / "network-sources"
            calls = {"osm": 0}
            validations = {"osm": 0}
            preparation = family(
                {"source_mtime_ns": 101},
                {"car": "car.fgb", "walk": "walk.fgb"},
                calls,
                "osm",
            )

            def validate(paths):
                validations["osm"] += 1
                self.assertTrue(all(path.stat().st_size for path in paths.values()))

            preparation = FamilyPreparation(
                preparation.signature,
                preparation.artifacts,
                preparation.build,
                validate,
            )
            initial = prepare_network_sources(cache_root, {"osm": preparation})
            initial["osm"]["car"].write_bytes(b"tampered-size")

            rebuilt = prepare_network_sources(cache_root, {"osm": preparation})

            self.assertEqual(calls["osm"], 2)
            self.assertEqual(validations["osm"], 2)
            self.assertNotEqual(initial["osm"], rebuilt["osm"])


if __name__ == "__main__":
    unittest.main()
