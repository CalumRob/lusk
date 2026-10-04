import sys
import json
from hashlib import sha256
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from hashlib import sha256

sys.path.insert(0, str(Path(__file__).parents[1]))
sys.path.insert(0, str(Path(__file__).parent))
from approval import approval_payload, record_human_approval, read_approval, require_approval
from runner import Binding, Foundation, MapSet, Recipe, run_production
from test_contract import FixtureAdapter
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
            def prepare_run(self, *args, **kwargs): pass
            def current_approval_members(self, recipe, binding, profiles, renderer):
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
