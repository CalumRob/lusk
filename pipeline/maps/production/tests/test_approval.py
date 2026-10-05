import sys
import json
import sys
from hashlib import sha256
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from hashlib import sha256
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
sys.path.insert(0, str(Path(__file__).parent))
from approval import approval_payload, record_human_approval, read_approval, require_approval
from runner import Binding, Foundation, MapSet, Recipe, run_production
from test_contract import FixtureAdapter, png
from record_spot_check import record_spot_check


class HumanApprovalTests(unittest.TestCase):
    def setUp(self):
        self.artifact_dir = TemporaryDirectory()
        outputs = []
        for index, (kind, code, mode, profile, identity) in enumerate([
            (kind, code, mode, profile,
             sha256(f"{kind}/{code}/{mode}/{profile}".encode()).hexdigest())
            for kind, code in (("commune", "35238"), ("region", "53"),
                               ("epci", "243500741"))
            for mode in ("car", "walk", "bike")
            for profile in ("inspection", "inline")]):
            path = Path(self.artifact_dir.name) / f"{index}.png"
            path.write_bytes(f"fixture {index}".encode())
            outputs.append({"territory": {"kind": kind, "code": code}, "mode": mode,
                "profile": profile, "effective_identity": identity, "path": str(path),
                "output_sha256": sha256(path.read_bytes()).hexdigest()})
        self.manifest = {
            "scope": "representative", "approval_pairs_complete": True,
            "recipe": "network", "recipe_version": 2, "foundation_version": "v2",
            "renderer_identity": {"renderer": "fixture"},
            "approval_members": [(kind, code, mode, profile,
                sha256(f"{kind}/{code}/{mode}/{profile}".encode()).hexdigest())
                for kind, code in (("commune", "35238"), ("region", "53"),
                                   ("epci", "243500741"))
                for mode in ("car", "walk", "bike")
                for profile in ("inspection", "inline")],
            "outputs": outputs,
        }

    def tearDown(self):
        self.artifact_dir.cleanup()

    @property
    def qa(self):
        return {"status": "passed", "artifact_count": 18,
            "expected_artifact_count": 18, "profile_counts": {"inspection": 9, "inline": 9},
            "failures": []}

    def test_requires_complete_paired_representative_artifacts(self):
        incomplete = {**self.manifest,
            "approval_members": [item for item in self.manifest["approval_members"]
                                 if item[:4] != ("commune", "35238", "car", "inline")]}
        with self.assertRaisesRegex(ValueError, "missing an export profile"):
            approval_payload(incomplete)
        with self.assertRaisesRegex(ValueError, "exact current"):
            approval_payload({**self.manifest,
                "approval_members": self.manifest["approval_members"][:2]})
        duplicated = {**self.manifest,
            "approval_members": [*self.manifest["approval_members"], self.manifest["approval_members"][0]]}
        with self.assertRaisesRegex(ValueError, "duplicate"):
            approval_payload(duplicated)

    def test_requires_explicit_human_outcome_and_rejects_stale_identity(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "approval.json"
            record_human_approval(self.manifest, self.qa, "reviewer", "Approved after visual review", path)
            approval = read_approval(path)
            require_approval(self.manifest, approval)
            stale = {**approval, "foundation_version": "old"}
            with self.assertRaisesRegex(ValueError, "stale or incomplete"):
                require_approval(self.manifest, stale)
            stale_recipe = {**approval, "recipe_version": 99}
            with self.assertRaisesRegex(ValueError, "stale or incomplete"):
                require_approval(self.manifest, stale_recipe)
            changed_profile_members = list(approval["approval_members"])
            changed_profile_members[0] = (*changed_profile_members[0][:4], sha256(b"new-profile-input").hexdigest())
            stale_profile = {**approval, "approval_members": changed_profile_members}
            with self.assertRaisesRegex(ValueError, "stale or incomplete"):
                require_approval(self.manifest, stale_profile)
            rejected = {**approval, "visual_outcome": "rejected"}
            with self.assertRaisesRegex(ValueError, "affirmative human"):
                require_approval(self.manifest, rejected)
            with self.assertRaisesRegex(ValueError, "requires explicit human"):
                require_approval(self.manifest, None)

    def test_json_loaded_member_arrays_round_trip_through_human_recording(self):
        # Real CLI manifests have arrays; API-built manifests often have tuples.
        json_manifest = json.loads(json.dumps(self.manifest))
        with TemporaryDirectory() as folder:
            path = Path(folder) / "approval.json"
            record_human_approval(json_manifest, self.qa, "reviewer", "approved", path)
            loaded = read_approval(path)
        require_approval(json_manifest, loaded)
        self.assertEqual(len(loaded["approval_members"]), 18)

    def test_public_operator_entrypoints_read_json_and_route_full_gate(self):
        import run_full_network
        import record_network_approval

        recipe = Recipe("fixture", 1, Foundation("v1"), "fixture")
        renderer = {"implementation": "fixture-renderer-v1"}
        reviewed = {**json.loads(json.dumps(self.manifest)), "recipe": recipe.name,
            "recipe_version": recipe.version, "foundation_version": recipe.foundation.version,
            "renderer_identity": renderer}
        with TemporaryDirectory() as folder:
            folder = Path(folder)
            manifest_path, qa_path = folder / "manifest.json", folder / "qa.json"
            approval_path, output = folder / "approval.json", folder / "output"
            manifest_path.write_text(json.dumps(reviewed), encoding="utf-8")
            qa_path.write_text(json.dumps(self.qa), encoding="utf-8")
            with patch.object(sys, "argv", ["record_network_approval.py", "--manifest", str(manifest_path),
                    "--qa", str(qa_path), "--reviewer", "reviewer", "--outcome", "approved",
                    "--output", str(approval_path)]):
                record_network_approval.main()

            feature = {"geometry": "fixture", "territory": {"kind": "commune", "code": "35238", "name": "Rennes"},
                "mode": "car"}
            binding = Binding("fixture", MapSet({"fixture": [feature]}))

            class OperatorAdapter(FixtureAdapter):
                def __init__(self, current_members=None):
                    super().__init__(); self.current_members = current_members or reviewed["approval_members"]
                    self.current_checks = 0; self.full_prepares = 0
                def render_identity(self): return renderer
                def prepare_current_approval_members(self, recipe_arg, binding_arg, profiles, renderer_arg, output_dir_arg):
                    self.current_checks += 1
                    return self.current_members
                def prepare_run(self, *args, **kwargs): self.full_prepares += 1
                def expected_output_path(self, feature_arg, profile, output_dir):
                    return output_dir / f"{feature_arg['territory']['code']}-{feature_arg['mode']}-{profile.name}.png"
                def render(self, recipe_arg, feature_arg, profile, output_dir):
                    path = self.expected_output_path(feature_arg, profile, output_dir)
                    output_dir.mkdir(parents=True, exist_ok=True)
                    png(path, *profile.size, rgba=profile.transparent_outside,
                        transparent=profile.transparent_outside)
                    return path

            captured = {}
            root = folder / "checkout"
            root.mkdir()
            with (patch.object(run_full_network, "ROOT", root),
                  patch.object(run_full_network, "QgsApplication") as app_class,
                  patch.object(run_full_network, "build_full_map_set", return_value=binding) as build,
                  patch.object(run_full_network, "network_recipe", return_value=recipe),
                  patch.object(run_full_network, "NetworkAdapter", return_value=OperatorAdapter()),
                  patch.object(sys, "argv", ["run_full_network.py", "--approval", str(approval_path)])):
                run_full_network.main()
                app = app_class.return_value
                app.initQgis.assert_called_once()
                app.exitQgis.assert_called_once()
                captured["raw"] = build.call_args.args[0]
            self.assertEqual(captured["raw"], root / "pipeline" / "data" / "raw")
            self.assertTrue((root / "pipeline" / "maps" / "production" / "output" / "full-manifest.json").is_file())

            # The same actual entrypoint rejects malformed cohort claims before
            # the bounded current-member seam, then rejects a well-formed stale
            # cohort after that seam and before full preparation/output creation.
            bad_root = folder / "bad-checkout"
            bad_output = bad_root / "pipeline" / "maps" / "production" / "output"
            partial = json.loads(approval_path.read_text(encoding="utf-8"))
            partial["approval_members"] = partial["approval_members"][:-1]
            partial_path = folder / "partial-approval.json"
            partial_path.write_text(json.dumps(partial), encoding="utf-8")
            partial_adapter = OperatorAdapter()
            with (patch.object(run_full_network, "ROOT", bad_root),
                  patch.object(run_full_network, "QgsApplication") as app_class,
                  patch.object(run_full_network, "build_full_map_set", return_value=binding),
                  patch.object(run_full_network, "network_recipe", return_value=recipe),
                  patch.object(run_full_network, "NetworkAdapter", return_value=partial_adapter),
                  patch.object(sys, "argv", ["run_full_network.py", "--approval", str(partial_path)])):
                with self.assertRaisesRegex(ValueError, "missing an export profile"):
                    run_full_network.main()
            self.assertEqual(partial_adapter.current_checks, 0)
            self.assertEqual(partial_adapter.full_prepares, 0)
            self.assertFalse(bad_output.exists())

            nonaffirmative = json.loads(approval_path.read_text(encoding="utf-8"))
            nonaffirmative["human_approved"] = False
            nonaffirmative_path = folder / "nonaffirmative-approval.json"
            nonaffirmative_path.write_text(json.dumps(nonaffirmative), encoding="utf-8")
            nonaffirmative_adapter = OperatorAdapter()
            with (patch.object(run_full_network, "ROOT", bad_root),
                  patch.object(run_full_network, "QgsApplication") as app_class,
                  patch.object(run_full_network, "build_full_map_set", return_value=binding),
                  patch.object(run_full_network, "network_recipe", return_value=recipe),
                  patch.object(run_full_network, "NetworkAdapter", return_value=nonaffirmative_adapter),
                  patch.object(sys, "argv", ["run_full_network.py", "--approval", str(nonaffirmative_path)])):
                with self.assertRaisesRegex(ValueError, "human_approved=true"):
                    run_full_network.main()
            self.assertEqual(nonaffirmative_adapter.current_checks, 0)
            self.assertEqual(nonaffirmative_adapter.full_prepares, 0)
            self.assertFalse(bad_output.exists())

            changed_manifest = json.loads(json.dumps(reviewed))
            changed_members = changed_manifest["approval_members"]
            changed_members[0][4] = sha256(b"different rendered content").hexdigest()
            for item in changed_manifest["outputs"]:
                if (item["territory"]["kind"], item["territory"]["code"], item["mode"], item["profile"]) == tuple(changed_members[0][:4]):
                    item["effective_identity"] = changed_members[0][4]
                    break
            from approval import approval_payload
            stale_claim = approval_payload(changed_manifest)
            stale_claim.update({"human_approved": True, "reviewer": "fixture reviewer",
                                "visual_outcome": "approved"})
            stale_path = folder / "stale-approval.json"
            stale_path.write_text(json.dumps(stale_claim), encoding="utf-8")
            stale_adapter = OperatorAdapter()
            with (patch.object(run_full_network, "ROOT", bad_root),
                  patch.object(run_full_network, "QgsApplication") as app_class,
                  patch.object(run_full_network, "build_full_map_set", return_value=binding),
                  patch.object(run_full_network, "network_recipe", return_value=recipe),
                  patch.object(run_full_network, "NetworkAdapter", return_value=stale_adapter),
                  patch.object(sys, "argv", ["run_full_network.py", "--approval", str(stale_path)])):
                with self.assertRaisesRegex(ValueError, "stale or incomplete"):
                    run_full_network.main()
            self.assertEqual(stale_adapter.current_checks, 1)
            self.assertEqual(stale_adapter.full_prepares, 0)
            self.assertFalse(bad_output.exists())

    def test_full_run_entrypoint_root_resolves_checkout_not_parent(self):
        import run_full_network
        expected = Path(run_full_network.__file__).resolve().parents[3]
        self.assertEqual(run_full_network.ROOT, expected)

    def test_public_full_run_without_approval_fails_before_prepare_or_render(self):
        class Adapter:
            def __init__(self):
                self.work = []
            def preflight(self, recipe, binding): pass
            def render_identity(self): return {"v": 1}
            def input_identity(self): return {"source": "fixture"}
            def prepare_run(self, *args, **kwargs): self.work.append("prepare")
            def render(self, *args, **kwargs): self.work.append("render")
            def validate(self, *args, **kwargs): pass

        recipe = Recipe("fixture", 1, Foundation("v1"), "fixture")
        binding = Binding("fixture", MapSet({"fixture": [{"geometry": "poly",
            "territory": {"kind": "fixture", "code": "1"}, "mode": "car"}]}))
        adapter = Adapter()
        with TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, "requires explicit human approval"):
                run_production(recipe, binding, "full", ("inline",), adapter, folder)
            self.assertEqual(adapter.work, [])
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_public_run_continues_failures_and_retry_reuses_verified_success(self):
        class Intermittent(FixtureAdapter):
            fail = True
            def render(self, recipe, feature, profile, output_dir):
                if feature["territory"]["code"] == "2" and self.fail:
                    raise RuntimeError("fixture render fault")
                return super().render(recipe, feature, profile, output_dir)

        recipe = Recipe("fixture", 1, Foundation("v1"), "fixture")
        binding = Binding("fixture", MapSet({"fixture": [
            {"geometry": "poly", "territory": {"kind": "fixture", "code": code}, "mode": "car"}
            for code in ("1", "2")]}))
        adapter = Intermittent()
        with TemporaryDirectory() as folder:
            first = run_production(recipe, binding, "representative", ("inline",), adapter, folder)
            self.assertEqual(first.qa["status"], "incomplete")
            self.assertEqual(len(first.outputs), 1)
            self.assertEqual(len(first.qa["failures"]), 1)
            persisted = json.loads((Path(folder) / ".production-manifest.json").read_text())
            self.assertEqual(len(persisted["expected_outputs"]), 2)
            self.assertEqual(len(persisted["failures"]), 1)
            adapter.fail = False
            retry = run_production(recipe, binding, "representative", ("inline",), adapter, folder)
        self.assertEqual(retry.qa["status"], "passed")
        self.assertEqual(retry.qa["production_status"], "awaiting-human-spot-check")
        self.assertEqual(retry.qa["human_spot_check"]["status"], "pending")
        self.assertEqual(sorted(item["decision"] for item in retry.outputs), ["rendered", "reused-output"])

    def test_stale_review_identity_blocks_public_full_run_before_any_render(self):
        class Adapter(FixtureAdapter):
            def __init__(self):
                super().__init__()
                self.rendered = False
                self.preparations = []
            def prepare_run(self, recipe, binding, profiles, output_dir, *, refresh=False):
                self.preparations.append("full")
            def prepare_current_approval_members(self, recipe, binding, profiles, renderer, output_dir):
                self.preparations.append("representative")
                return [(kind, code, mode, profile,
                    sha256(f"current/{kind}/{code}/{mode}/{profile}".encode()).hexdigest())
                    for kind, code in (("commune", "35238"), ("region", "53"),
                                       ("epci", "243500741"))
                    for mode in ("car", "walk", "bike") for profile in sorted(profiles)]
            def render(self, *args, **kwargs):
                self.rendered = True
                return super().render(*args, **kwargs)

        recipe = Recipe("fixture", 1, Foundation("v1"), "fixture")
        binding = Binding("fixture", MapSet({"fixture": [{"geometry": "poly",
            "territory": {"kind": "commune", "code": "1"}, "mode": "car"}]}))
        approval_manifest = {**self.manifest, "recipe": "fixture", "recipe_version": 1,
            "foundation_version": "v1", "renderer_identity": {"implementation": "fixture-renderer-v1"}}
        with TemporaryDirectory() as folder:
            approval_path = Path(folder) / "approval.json"
            record_human_approval(approval_manifest, self.qa, "reviewer", "approved", approval_path)
            adapter = Adapter()
            with self.assertRaisesRegex(ValueError, "stale or incomplete"):
                run_production(recipe, binding, "full", ("inspection", "inline"),
                    adapter, Path(folder) / "out", approval=read_approval(approval_path))
            self.assertFalse(adapter.rendered)
            self.assertEqual(adapter.preparations, ["representative"])
            self.assertFalse((Path(folder) / "out").exists())

            adapter.preparations.clear()
            recipe_stale = {**read_approval(approval_path), "recipe_version": 99}
            with self.assertRaisesRegex(ValueError, "recipe or renderer is stale"):
                run_production(recipe, binding, "full", ("inspection", "inline"),
                    adapter, Path(folder) / "other-out", approval=recipe_stale)
            self.assertEqual(adapter.preparations, [])

    def test_visual_spot_check_records_affirmative_or_rejected_human_outcome(self):
        artifact = Path(self.manifest["outputs"][0]["path"])
        qa = {"status": "passed", "production_status": "awaiting-human-spot-check",
            "human_spot_check": {"status": "pending", "outcome": None,
                "review_set": [{"path": str(artifact),
                    "output_sha256": sha256(artifact.read_bytes()).hexdigest(),
                    "territory": {"kind": "epci", "code": "243500741"},
                    "mode": "car", "profile": "inline", "effective_identity": "identity"}]}}
        approved = record_spot_check(qa, "reviewer", "approved")
        rejected = record_spot_check(qa, "reviewer", "rejected")
        self.assertEqual(approved["production_status"], "complete")
        self.assertEqual(approved["human_spot_check"]["status"], "approved")
        self.assertEqual(rejected["production_status"], "incomplete-human-review")
        self.assertEqual(rejected["human_spot_check"]["status"], "rejected")


if __name__ == "__main__":
    unittest.main()
