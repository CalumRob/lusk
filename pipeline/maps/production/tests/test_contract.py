import unittest
from tempfile import TemporaryDirectory
import struct
import zlib
import json
from hashlib import sha256

from pathlib import Path
import sys
from unittest.mock import patch
from qgis.PyQt.QtGui import QColor, QImage

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


class WebPFixtureAdapter(FixtureAdapter):
    def __init__(self):
        super().__init__()
        self.fail_validation = False
        self.fail_encoding = False
        self.prepared = 0
        self.render_calls = 0

    def output_contract(self, profile):
        from webp_encoding import WEBP_ENCODING_CONTRACT
        return {**WEBP_ENCODING_CONTRACT, "dimensions": list(profile.size),
            "alpha": "lossless" if profile.transparent_outside else "opaque-rgb"}

    def expected_output_path(self, feature, profile, output_dir):
        return Path(output_dir) / f"fixture-{profile.name}.webp"

    def prepare_run(self, *args, **kwargs):
        self.prepared += 1

    def render(self, recipe, feature, profile, output_dir):
        from webp_encoding import encode_qimage
        self.render_calls += 1
        if self.fail_encoding:
            raise RuntimeError("injected conversion failure")
        image = QImage(*profile.size, QImage.Format_RGBA8888)
        image.fill(QColor(36, 80, 120, 255))
        if profile.transparent_outside:
            image.setPixelColor(0, 0, QColor(0, 0, 0, 0))
        if self.fail_validation:
            stage = Path(output_dir) / ".broken.stage.webp"
            stage.write_bytes(b"bad WebP bytes")
            return stage
        stage = Path(output_dir) / f".fixture-{profile.name}.stage.webp"
        return encode_qimage(image, stage, preserve_alpha=profile.transparent_outside)

    def promote_output(self, staged, final):
        import os
        os.replace(staged, final)
        return final

    def discard_output(self, staged):
        Path(staged).unlink(missing_ok=True)


class ContractTests(unittest.TestCase):
    def test_webp_canonical_output_is_promoted_qaed_and_legacy_png_is_not_reused(self):
        from webp_encoding import validate_webp
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        feature = {"geometry": "polygon", "territory": {"kind": "test", "code": "1"}, "mode": "test"}
        with TemporaryDirectory() as directory:
            legacy = run_production(recipe, Binding("fixture", MapSet({"shape": [feature]})),
                "representative", ["inline"], FixtureAdapter(), directory)
            legacy_path = Path(legacy.outputs[0]["path"])
            adapter = WebPFixtureAdapter()
            current = run_production(recipe, Binding("fixture", MapSet({"shape": [feature]})),
                "representative", ["inline"], adapter, directory)
            final = Path(current.outputs[0]["path"])
            self.assertEqual(current.outputs[0]["decision"], "rendered")
            self.assertTrue(final.is_file() and final.suffix == ".webp")
            self.assertFalse(list(Path(directory).glob("*.stage.webp")))
            self.assertEqual(validate_webp(final, __import__("runner").PROFILES["inline"]).size,
                (900, 900))
            self.assertEqual(current.outputs[0]["artifact_contract"]["quality"], 80)
            self.assertEqual(current.manifest["artifact_contracts"]["inline"]["method"], 4)
            expected = current.manifest["expected_outputs"][0]
            self.assertEqual(expected["artifact_contract"]["format"], "webp")
            self.assertTrue(expected["path"].endswith(".webp"))
            self.assertTrue(legacy_path.is_file(), "historical PNG cache products remain untouched")

    def test_encoding_contract_change_invalidates_effective_output_identity(self):
        from webp_encoding import WEBP_ENCODING_CONTRACT
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        binding = Binding("fixture", MapSet({"shape": [{"geometry": "polygon",
            "territory": {"kind": "test", "code": "1"}, "mode": "test"}]}))
        adapter = WebPFixtureAdapter()
        with TemporaryDirectory() as directory:
            first = run_production(recipe, binding, "representative", ["inline"], adapter, directory)
            with patch.dict(WEBP_ENCODING_CONTRACT, {"quality": 79}):
                second = run_production(recipe, binding, "representative", ["inline"], adapter, directory)
        self.assertEqual(second.outputs[0]["decision"], "rendered")
        self.assertNotEqual(first.outputs[0]["effective_identity"], second.outputs[0]["effective_identity"])

    def test_failed_webp_qa_keeps_prior_canonical_output_and_cleans_stage(self):
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        feature = {"geometry": "polygon", "territory": {"kind": "test", "code": "1"}, "mode": "test"}
        binding = Binding("fixture", MapSet({"shape": [feature]}))
        adapter = WebPFixtureAdapter()
        with TemporaryDirectory() as directory:
            first = run_production(recipe, binding, "representative", ["inline"], adapter, directory)
            final = Path(first.outputs[0]["path"])
            previous_bytes = final.read_bytes()
            adapter.fail_validation = True
            failed = run_production(recipe, binding, "representative", ["inline"], adapter,
                directory, refresh=True)
            self.assertEqual(failed.qa["status"], "incomplete")
            self.assertEqual(final.read_bytes(), previous_bytes)
            self.assertEqual(list(Path(directory).glob(".*.stage.webp")), [])
            checkpoint = next(Path(directory).glob(".production-checkpoint-*.jsonl"))
            records = [json.loads(line)["payload"] for line in checkpoint.read_text().splitlines()]
            self.assertTrue(any(row.get("kind") == "output-failure" for row in records))

    def test_encoder_exception_before_return_cannot_delete_previous_final(self):
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        binding = Binding("fixture", MapSet({"shape": [{"geometry": "polygon",
            "territory": {"kind": "test", "code": "1"}, "mode": "test"}]}))
        adapter = WebPFixtureAdapter()
        with TemporaryDirectory() as directory:
            first = run_production(recipe, binding, "representative", ["inline"], adapter, directory)
            final = Path(first.outputs[0]["path"])
            previous = final.read_bytes()
            adapter.fail_encoding = True
            interrupted = run_production(recipe, binding, "representative", ["inline"], adapter,
                directory, refresh=True)
            self.assertEqual(interrupted.qa["status"], "incomplete")
            self.assertEqual(final.read_bytes(), previous)
            self.assertFalse(list(Path(directory).glob(".*.stage.webp")))

    def test_crash_after_atomic_promotion_recovers_durable_pending_candidate(self):
        from checkpoint import OutputCheckpoint
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        binding = Binding("fixture", MapSet({"shape": [{"geometry": "polygon",
            "territory": {"kind": "test", "code": "1"}, "mode": "test"}]}))
        adapter = WebPFixtureAdapter()
        with TemporaryDirectory() as directory:
            with patch.object(OutputCheckpoint, "record_success", side_effect=OSError("power cut after promotion")):
                with self.assertRaisesRegex(OSError, "power cut"):
                    run_production(recipe, binding, "representative", ["inline"], adapter, directory)
            final = adapter.expected_output_path(binding.map_set.layers["shape"][0],
                __import__("runner").PROFILES["inline"], Path(directory))
            self.assertTrue(final.is_file())
            first_render_count = adapter.render_calls
            resumed = run_production(recipe, binding, "representative", ["inline"], adapter, directory)
            self.assertEqual(resumed.outputs[0]["decision"], "reused-output")
            self.assertEqual(adapter.render_calls, first_render_count)

    def test_missing_pipeline_pillow_fails_before_output_or_shared_preparation(self):
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        feature = {"geometry": "polygon", "territory": {"kind": "test", "code": "1"}, "mode": "test"}
        adapter = WebPFixtureAdapter()
        with TemporaryDirectory() as directory:
            with patch("webp_encoding._pillow", side_effect=RuntimeError("missing pinned encoder")):
                with self.assertRaisesRegex(RuntimeError, "missing pinned encoder"):
                    run_production(recipe, Binding("fixture", MapSet({"shape": [feature]})),
                        "representative", ["inline"], adapter, directory)
            self.assertEqual(adapter.prepared, 0)
            self.assertFalse(Path(directory, ".production-manifest.json").exists())

    def test_full_run_spools_diagnostics_per_territory_but_returns_same_qa_fields(self):
        from qgis.core import QgsGeometry, QgsRectangle
        recipe = Recipe("fixture", 1, Foundation("shared-v1"), "fixture")
        geometry = QgsGeometry.fromWkt("POLYGON ((0 0,10 0,10 10,0 10,0 0))")
        feature = {"geometry": geometry, "extent": QgsRectangle(geometry.boundingBox()),
            "territory": {"kind": "test", "code": "spool", "name": "Spool"}, "mode": "test"}

        class DiagnosticAdapter(WebPFixtureAdapter):
            def __init__(self):
                super().__init__()
                self.events = []
                self.prepare_current_approval_members = lambda *args: []

            def prepare_run(self, *args, **kwargs):
                self.prepared += 1
                self.events.append({"stage": "shared-preparation", "decision": "validated"})

            def render(self, *args, **kwargs):
                self.events.append({"stage": "territory-render", "decision": "completed"})
                return super().render(*args, **kwargs)

            def begin_territory(self, *args, **kwargs):
                self.events.append({"stage": "territory-begin", "decision": "started"})

            def end_territory(self, *args, **kwargs):
                self.events.append({"stage": "territory-release", "decision": "released"})

            def drain_stage_report(self):
                events = list(self.events)
                self.events.clear()
                return events

            def stage_report(self):
                return list(self.events)

        adapter = DiagnosticAdapter()
        binding = Binding("fixture", MapSet({"shape": [feature]}))
        with TemporaryDirectory() as directory, \
             patch("approval.validate_approval_claim"), patch("approval.require_approval"):
            result = run_production(recipe, binding, "full", ["inspection", "inline"],
                adapter, directory, approval={"human_approved": True})
        events = result.qa["stage_report"]
        self.assertEqual(result.qa["status"], "passed")
        self.assertEqual(result.qa["artifact_count"], 2)
        self.assertEqual([row["stage"] for row in events if row["stage"].startswith("shared-")],
            ["shared-preparation"])
        self.assertTrue(any(row["stage"] == "territory-release" for row in events))
        for stage in ("profile-input-identity", "profile-render-contract",
                      "effective-identity-digest", "output-cache-verification"):
            self.assertEqual(sum(row["stage"] == stage for row in events), 2, stage)
        self.assertEqual(adapter.events, [], "streamed rows are not retained by the adapter")

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
        from inspection_plate import OUTPUT_SIZE
        self.assertEqual(PROFILES["inspection"].size, (2400, 2400))
        self.assertEqual(PROFILES["inspection"].size, (OUTPUT_SIZE, OUTPUT_SIZE))
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
