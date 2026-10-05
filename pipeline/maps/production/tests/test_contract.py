import unittest
from tempfile import TemporaryDirectory
import struct
import zlib
import json
from hashlib import sha256

from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))

from runner import (  # noqa: E402
    Binding, Foundation, MapSet, Recipe, run_production, FamilyAdapter,
)


def png(path, width, height, rgba=False, transparent=False, opaque_sample=True):
    colour = 6 if rgba else 2
    pixel = bytes((20, 30, 40, 0 if transparent else 255)) if rgba else bytes((20,30,40))
    rows = []
    for _ in range(height):
        if transparent and opaque_sample:
            opaque = bytes((20, 30, 40, 255))
            rows.append(b"\0" + opaque + pixel * (width - 1))
        else:
            rows.append(b"\0" + pixel * width)
    raw = b"".join(rows)
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind+body)&0xffffffff)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB",width,height,8,colour,0,0,0)) + chunk(b"IDAT",zlib.compress(raw)) + chunk(b"IEND",b""))


class FixtureAdapter:
    def __init__(self, renderer_version="fixture-renderer-v1"):
        self.renderer_version = renderer_version

    def preflight(self, recipe, binding): pass
    def render_identity(self): return {"implementation": self.renderer_version}
    def input_identity(self):
        return {"sources": [{"name": "fixture-source", "version": "v1"}]}
    def render(self, recipe, feature, profile, output_dir):
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / f"fixture-{profile.name}.png"
        png(path, *profile.size, rgba=profile.transparent_outside,
            transparent=profile.transparent_outside)
        return path
    def expected_output_path(self, feature, profile, output_dir):
        return output_dir / f"fixture-{profile.name}.png"
    def validate(self, path, feature, profile): pass


class ContractTests(unittest.TestCase):
    def test_subset_run_preserves_omitted_cached_output_records(self):
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        features = [{"geometry": "polygon", "territory": {"kind": "test", "code": code}, "mode": "test"}
                    for code in ("1", "2")]
        with TemporaryDirectory() as directory:
            full = run_production(recipe, Binding("fixture", MapSet({"shape": features})),
                "representative", ["inline"], FixtureAdapter(), directory)
            subset = run_production(recipe, Binding("fixture", MapSet({"shape": features[:1]})),
                "representative", ["inline"], FixtureAdapter(), directory)
            saved = json.loads((Path(directory) / ".production-manifest.json").read_text())
        self.assertEqual(len(full.outputs), 2)
        self.assertEqual(len(subset.outputs), 1)
        self.assertEqual(len(saved["outputs"]), 2)

    def test_public_run_groups_all_modes_profiles_by_territory_and_releases_on_failure(self):
        class LifecycleAdapter(FixtureAdapter):
            def __init__(self):
                super().__init__()
                self.events = []
                self.rendered = []
            def begin_production_scope(self, scope, output_dir): self.events.append(("scope-begin", scope))
            def end_production_scope(self, scope, output_dir, *, success):
                self.events.append(("scope-end", scope, success))
            def begin_territory(self, feature, profiles, output_dir):
                self.events.append(("territory-begin", feature["territory"]["code"], tuple(profiles)))
            def observe_territory_state(self, feature): pass
            def end_territory(self, feature, output_dir, *, success):
                self.events.append(("territory-end", feature["territory"]["code"], success))
            def expected_output_path(self, feature, profile, output_dir):
                return output_dir / f"{feature['territory']['code']}-{feature['mode']}-{profile.name}.png"
            def render(self, recipe, feature, profile, output_dir):
                key = f"{feature['territory']['code']}/{feature['mode']}/{profile.name}"
                self.rendered.append(key)
                if key == "1/walk/inline":
                    raise RuntimeError("one output failed")
                output_dir.mkdir(parents=True, exist_ok=True)
                path = self.expected_output_path(feature, profile, output_dir)
                png(path, *profile.size, rgba=profile.transparent_outside,
                    transparent=profile.transparent_outside)
                return path

        territories = [(code, mode) for mode in ("car", "walk", "bike") for code in ("1", "2")]
        features = [{"geometry": "polygon", "territory": {"kind": "fixture", "code": code,
            "name": f"Territory {code}"}, "mode": mode} for code, mode in territories]
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        adapter = LifecycleAdapter()
        with TemporaryDirectory() as directory:
            result = run_production(recipe, Binding("fixture", MapSet({"outputs": features})),
                "representative", ("inspection", "inline"), adapter, directory)
        self.assertEqual(len(result.qa["expected_outputs"]), 12)
        self.assertEqual(len(result.qa["failures"]), 1)
        begins = [event for event in adapter.events if event[0] == "territory-begin"]
        ends = [event for event in adapter.events if event[0] == "territory-end"]
        self.assertEqual([event[1] for event in begins], ["1", "2"])
        self.assertEqual([event[1:] for event in ends], [("1", False), ("2", True)])
        self.assertEqual(adapter.events[-1], ("scope-end", "representative", False))

    def test_public_interruption_resumes_from_durable_verified_output_without_rerender(self):
        class Interrupted(BaseException): pass
        class InterruptOnce(FixtureAdapter):
            def __init__(self):
                super().__init__(); self.calls = []; self.interrupt = True; self.releases = 0
            def begin_production_scope(self, scope, output_dir): pass
            def begin_territory(self, feature, profiles, output_dir): pass
            def end_territory(self, feature, output_dir, *, success): self.releases += 1
            def end_production_scope(self, scope, output_dir, *, success): self.releases += 1
            def expected_output_path(self, feature, profile, output_dir):
                return output_dir / f"{profile.name}.png"
            def render(self, recipe, feature, profile, output_dir):
                self.calls.append(profile.name)
                if profile.name == "inline" and self.interrupt:
                    self.interrupt = False
                    raise Interrupted()
                output_dir.mkdir(parents=True, exist_ok=True)
                path = self.expected_output_path(feature, profile, output_dir)
                png(path, *profile.size, rgba=profile.transparent_outside,
                    transparent=profile.transparent_outside)
                return path

        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        feature = {"geometry": "polygon", "territory": {"kind": "fixture", "code": "1",
            "name": "One"}, "mode": "car"}
        adapter = InterruptOnce()
        with TemporaryDirectory() as directory:
            with self.assertRaises(Interrupted):
                run_production(recipe, Binding("fixture", MapSet({"outputs": [feature]})),
                    "representative", ("inspection", "inline"), adapter, directory)
            checkpoints = list(Path(directory).glob(".production-checkpoint-*.jsonl"))
            self.assertEqual(len(checkpoints), 1)
            records = [json.loads(row)["payload"] for row in checkpoints[0].read_text().splitlines()]
            header = records[0]
            success = [row for row in records if row.get("kind") == "output-success"]
            self.assertEqual(len(header["expected_outputs"]), 2)
            self.assertEqual(len(success), 1)
            self.assertEqual(len(success[0]["effective_identity"]), 64)
            self.assertTrue(Path(success[0]["path"]).is_file())
            self.assertEqual(sha256(Path(success[0]["path"]).read_bytes()).hexdigest(),
                             success[0]["output_sha256"])
            adapter.calls.clear()
            resumed = run_production(recipe, Binding("fixture", MapSet({"outputs": [feature]})),
                "representative", ("inspection", "inline"), adapter, directory)
        self.assertEqual([output["decision"] for output in resumed.outputs], ["reused-output", "rendered"])
        self.assertEqual(adapter.calls, ["inline"])
        self.assertGreaterEqual(adapter.releases, 4)

    def test_changed_effective_identity_rerenders_only_changed_territory(self):
        class Counting(FixtureAdapter):
            def __init__(self): super().__init__(); self.calls = []
            def expected_output_path(self, feature, profile, output_dir):
                return output_dir / f"{feature['territory']['code']}-{profile.name}.png"
            def render(self, recipe, feature, profile, output_dir):
                self.calls.append(str(feature["territory"]["code"]))
                output_dir.mkdir(parents=True, exist_ok=True)
                path = self.expected_output_path(feature, profile, output_dir)
                png(path, *profile.size, rgba=profile.transparent_outside,
                    transparent=profile.transparent_outside)
                return path

        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        def feature(code, geom):
            return {"geometry": geom, "territory": {"kind": "fixture", "code": code,
                "name": f"Territory {code}"}, "mode": "test"}
        first_binding = Binding("fixture", MapSet({"outputs": [feature("1", "g1"), feature("2", "g2")] }))
        changed_binding = Binding("fixture", MapSet({"outputs": [feature("1", "g1"), feature("2", "g2-edited")] }))
        adapter = Counting()
        with TemporaryDirectory() as directory:
            initial = run_production(recipe, first_binding, "representative", ("inline",), adapter, directory)
            original_hash = initial.outputs[0]["output_sha256"]
            adapter.calls.clear()
            retry = run_production(recipe, changed_binding, "representative", ("inline",), adapter, directory)
        self.assertEqual([item["decision"] for item in retry.outputs], ["reused-output", "rendered"])
        self.assertEqual(adapter.calls, ["2"])
        self.assertEqual(retry.outputs[0]["output_sha256"], original_hash)

    def test_checkpoint_write_failure_stops_run_and_calls_lifecycle_cleanup(self):
        from checkpoint import OutputCheckpoint
        class Lifecycle(FixtureAdapter):
            def __init__(self): super().__init__(); self.events = []
            def begin_production_scope(self, scope, output_dir): self.events.append("scope-begin")
            def end_production_scope(self, scope, output_dir, *, success): self.events.append(("scope-end", success))
            def begin_territory(self, feature, profiles, output_dir): self.events.append("territory-begin")
            def end_territory(self, feature, output_dir, *, success): self.events.append(("territory-end", success))

        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        feature = {"geometry": "g1", "territory": {"kind": "fixture", "code": "1", "name": "One"},
            "mode": "test"}
        adapter = Lifecycle()
        with TemporaryDirectory() as directory:
            with patch.object(OutputCheckpoint, "record_success", side_effect=OSError("disk full")):
                with self.assertRaisesRegex(OSError, "disk full"):
                    run_production(recipe, Binding("fixture", MapSet({"outputs": [feature]})),
                        "representative", ("inline",), adapter, directory)
            self.assertFalse((Path(directory) / ".production-manifest.json").exists())
            self.assertEqual(adapter.events[-2:], [("territory-end", False), ("scope-end", False)])
            journal = next(Path(directory).glob(".production-checkpoint-*.jsonl"))
            records = [json.loads(line)["payload"] for line in journal.read_text().splitlines()]
            self.assertEqual(len(records[0]["expected_outputs"]), 1)
            self.assertFalse(any(row.get("kind") == "output-success" for row in records))

    def test_public_run_reuses_verified_output_across_runs_and_repairs_corruption(self):
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        feature = {"geometry": "polygon", "territory": {"kind": "test", "code": "1"}, "mode": "test"}
        binding = Binding("fixture", MapSet({"shape": [feature]}))
        with TemporaryDirectory() as directory:
            adapter = FixtureAdapter()
            cold = run_production(recipe, binding, "representative", ["inline"], adapter, directory)
            warm = run_production(recipe, binding, "representative", ["inline"], adapter, directory)
            self.assertEqual(cold.outputs[0]["decision"], "rendered")
            self.assertEqual(warm.outputs[0]["decision"], "reused-output")
            Path(warm.outputs[0]["path"]).write_bytes(b"corrupt")
            repaired = run_production(recipe, binding, "representative", ["inline"], adapter, directory)
            self.assertEqual(repaired.outputs[0]["decision"], "rendered")
            refreshed = run_production(recipe, binding, "representative", ["inline"], adapter, directory, refresh=True)
            self.assertEqual(refreshed.outputs[0]["decision"], "rendered")
            self.assertEqual(refreshed.outputs[0]["output_sha256"], cold.outputs[0]["output_sha256"])
            cache_path = Path(directory) / ".production-manifest.json"
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
            cache["outputs"]["test/1/test/inline"]["path"] = 123
            cache_path.write_text(json.dumps(cache), encoding="utf-8")
            malformed = run_production(recipe, binding, "representative", ["inline"], adapter, directory)
            self.assertEqual(malformed.outputs[0]["decision"], "reused-output")
            decoy = Path(directory) / "decoy.png"
            png(decoy, 900, 900, rgba=True, transparent=True)
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
            cache["outputs"]["test/1/test/inline"]["path"] = str(decoy)
            cache_path.write_text(json.dumps(cache), encoding="utf-8")
            wrong_path = run_production(recipe, binding, "representative", ["inline"], adapter, directory)
            # A corrupted legacy manifest cannot displace a valid checksummed
            # checkpoint row, whose path and bytes are reverified by the runner.
            self.assertEqual(wrong_path.outputs[0]["decision"], "reused-output")

    def test_run_report_exposes_adapter_preparation_stage(self):
        class PreparingAdapter(FixtureAdapter):
            def prepare_run(self, recipe, binding, profiles, output_dir, *, refresh=False):
                self.refresh_seen = refresh

            def stage_report(self):
                return [{"stage": "fixture-stage", "profile": "inline", "decision": "built", "seconds": 0.0}]

        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        feature = {
            "geometry": "polygon",
            "territory": {"kind": "test", "code": "1"},
            "mode": "test",
        }
        binding = Binding("fixture", MapSet({"shape": [feature]}))
        adapter = PreparingAdapter()

        with TemporaryDirectory() as directory:
            result = run_production(recipe, binding, "representative", ["inline"], adapter, directory)

        self.assertIn({"stage": "fixture-stage", "profile": "inline", "decision": "built", "seconds": 0.0},
                      result.qa["stage_report"])
        self.assertEqual(next(item["decision"] for item in result.qa["stage_report"]
            if item["stage"] == "adapter-preparation-total"), "completed")

    def test_shared_frame_and_geography_contracts_invalidate_profile_outputs(self):
        from dataclasses import replace
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        feature = {"geometry": "polygon", "territory": {"kind": "test", "code": "1"}, "mode": "test"}
        binding = Binding("fixture", MapSet({"shape": [feature]}))
        with TemporaryDirectory() as directory:
            first = run_production(recipe, binding, "representative", ["inline"], FixtureAdapter(), directory)
            changed_foundation = replace(recipe.foundation,
                framing={"margin": 0.15}, geography={"extent_rule": "shared-v2"})
            changed = run_production(replace(recipe, foundation=changed_foundation), binding,
                "representative", ["inline"], FixtureAdapter(), directory)
        self.assertEqual(first.outputs[0]["decision"], "rendered")
        self.assertEqual(changed.outputs[0]["decision"], "rendered")
        self.assertNotEqual(first.outputs[0]["effective_identity"], changed.outputs[0]["effective_identity"])

    def test_run_manifest_hashes_geometry_bytes_without_stringifying_geometry(self):
        class Geometry:
            def asWkb(self):
                return b"fixed geometry bytes"

            def __str__(self):
                raise AssertionError("geometry hashing must not stringify full geometry")

        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        feature = {
            "geometry": Geometry(),
            "territory": {"kind": "test", "code": "1"},
            "mode": "test",
        }
        binding = Binding("fixture", MapSet({"shape": [feature]}))

        with TemporaryDirectory() as directory:
            result = run_production(recipe, binding, "representative", ["inline"],
                                    FixtureAdapter(), directory)

        self.assertRegex(result.outputs[0]["input_sha256"], r"^[0-9a-f]{64}$")

    def test_run_manifest_identifies_renderer_configuration_and_rendered_artifact(self):
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        feature = {
            "geometry": "polygon",
            "territory": {"kind": "test", "code": "1"},
            "mode": "test",
        }
        binding = Binding("fixture", MapSet({"shape": [feature]}))

        with TemporaryDirectory() as directory:
            first = run_production(recipe, binding, "representative", ["inline"],
                                   FixtureAdapter(), directory)
            second = run_production(recipe, binding, "representative", ["inline"],
                                    FixtureAdapter("fixture-renderer-v2"), directory)
            artifact = Path(second.outputs[0]["path"])
            artifact_hash = sha256(artifact.read_bytes()).hexdigest()

        first_identity = first.manifest["render_identity"]
        second_identity = second.manifest["render_identity"]
        self.assertRegex(first_identity, r"^[0-9a-f]{64}$")
        self.assertNotEqual(first_identity, second_identity)
        self.assertEqual(first.outputs[0]["output_sha256"], second.outputs[0]["output_sha256"])
        self.assertEqual(second.outputs[0]["render_identity"], second_identity)
        self.assertEqual(second.outputs[0]["output_sha256"], artifact_hash)
        self.assertEqual(
            second.manifest["renderer_identity"],
            {"implementation": "fixture-renderer-v2"},
        )
        self.assertEqual(
            second.manifest["authoritative_inputs"],
            {"sources": [{"name": "fixture-source", "version": "v1"}]},
        )
        self.assertIn("transparent-and-opaque-alpha-samples", second.qa["checks"])
        self.assertNotIn("transparent-outside-and-opaque-inside-mask", second.qa["checks"])

    def test_network_family_config_drives_all_mode_marks_and_plate_runs(self):
        production = Path(__file__).parents[1]
        config = json.loads((production / "network-family.json").read_text(encoding="utf-8"))
        self.assertEqual(config["family"], "network")
        self.assertEqual(set(config["inspection"]), {"car", "walk", "bike"})
        self.assertEqual(
            set(config["marks"]),
            {"car", "walk", "bike-protected", "bike-shared"},
        )
        for mode, style in config["inspection"].items():
            self.assertTrue(style["title_runs"], mode)
            for run in style["title_runs"]:
                if "mark" in run:
                    self.assertIn(run["mark"], config["marks"])
                self.assertGreaterEqual(run["opacity"], 0)
                self.assertLessEqual(run["opacity"], 1)

    def test_preflights_distinct_family_inputs_before_any_render(self):
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        binding = Binding("fixture", MapSet({"shape": [{"geometry": "polygon", "territory": {"kind":"test", "code":"1"}, "mode":"test"}]}))
        with TemporaryDirectory() as directory:
            result = run_production(recipe, binding, "representative", ["inline"],
                                    FixtureAdapter(), directory)
        self.assertEqual(result.qa["status"], "passed")
        self.assertEqual(result.manifest["outputs"][0]["profile"], "inline")

    def test_missing_map_ready_field_fails_preflight(self):
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture",
                        required_fields=("outline",))
        binding = Binding("fixture", MapSet({"shape": [{"geometry": "polygon", "territory": {"kind":"test", "code":"1"}, "mode":"test"}]}))
        with self.assertRaisesRegex(ValueError, "outline"):
            run_production(recipe, binding, "representative", ["inline"], FixtureAdapter(), ".")

    def test_profiles_have_stable_dimensions(self):
        from runner import PROFILES
        self.assertEqual(PROFILES["inspection"].size, (3200, 3200))
        self.assertEqual(PROFILES["inline"].size, (900, 900))

    def test_inline_png_requires_transparent_and_opaque_alpha_samples(self):
        from runner import PROFILES, _png_contract
        with TemporaryDirectory() as directory:
            path = Path(directory) / "all-transparent.png"
            png(path, 900, 900, rgba=True, transparent=True, opaque_sample=False)
            with self.assertRaisesRegex(ValueError, "opaque alpha samples"):
                _png_contract(path, PROFILES["inline"])

    def test_invalid_profile_artifact_fails_qa(self):
        class Invalid(FixtureAdapter):
            def render(self, recipe, feature, profile, output_dir):
                output_dir.mkdir(parents=True, exist_ok=True)
                path = output_dir / "bad.png"
                path.write_bytes(b"not a png")
                return path
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        binding = Binding("fixture", MapSet({"shape": [{"geometry": "polygon", "territory": {"kind":"test", "code":"1"}, "mode":"test"}]}))
        with TemporaryDirectory() as directory:
            result = run_production(recipe, binding, "representative", ["inline"], Invalid(), directory)
        self.assertEqual(result.qa["status"], "incomplete")
        self.assertIn("not a PNG", result.qa["failures"][0]["error"])
        self.assertEqual(len(result.manifest["expected_outputs"]), 1)

    def test_wrong_sized_png_is_a_batch_failure_not_a_pass(self):
        class WrongSize(FixtureAdapter):
            def render(self, recipe, feature, profile, output_dir):
                output_dir.mkdir(parents=True, exist_ok=True)
                path = output_dir / "wrong-size.png"
                png(path, 800, 900, rgba=True, transparent=True)
                return path
        recipe = Recipe("fixture", 1, Foundation("v1"), "fixture")
        binding = Binding("fixture", MapSet({"fixture": [{"geometry": "poly",
            "territory": {"kind": "fixture", "code": "1"}, "mode": "car"}]}))
        with TemporaryDirectory() as directory:
            result = run_production(recipe, binding, "representative", ["inline"],
                                    WrongSize(), directory)
        self.assertEqual(result.qa["status"], "incomplete")
        self.assertIn("dimensions", result.qa["failures"][0]["error"])


if __name__ == "__main__":
    unittest.main()
