import unittest
from dataclasses import replace
from tempfile import TemporaryDirectory
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1]))

from runner import (FullBatchAdmission, delegate_full_batch,
                    verify_full_batch_shard, full_batch_admission,
                    Recipe, Foundation, Binding, MapSet)


class NetworkBatchAdmissionTests(unittest.TestCase):
    def admission(self):
        return FullBatchAdmission("recipe", "renderer", "sources", "inventory",
            "profiles", "matrix", "approval",
            tuple(("commune", str(i), ("bike", "car", "walk")) for i in range(8)))

    def test_delegation_requires_exact_nonoverlapping_inventory_cover(self):
        from batch_execution import partition_territories
        admission = self.admission()
        partitions = partition_territories(list(admission.members), 4, lambda _: 1)
        delegated = delegate_full_batch(admission, partitions, 4)
        self.assertEqual(sorted(m for shard in delegated for m in shard.members), list(admission.members))
        with self.assertRaisesRegex(ValueError, "exactly once"):
            delegate_full_batch(admission, [[0, 1], [1, 2], [3], [4, 5, 6, 7]], 4)
        with self.assertRaisesRegex(ValueError, "cannot be empty"):
            delegate_full_batch(admission, [[0, 1, 2], [3, 4], [5, 6, 7], []], 4)

    def test_delegation_refuses_changed_admission_or_extra_members(self):
        admission = self.admission()
        delegated = delegate_full_batch(admission, [[0, 1], [2, 3], [4, 5], [6, 7]], 4)
        self.assertEqual(verify_full_batch_shard(delegated[0], delegated[0].admission),
                         delegated[0].members)
        for field in ("approval_identity", "renderer_identity", "input_identity",
                      "inventory_identity", "artifact_matrix_identity", "profiles_identity"):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "does not match"):
                verify_full_batch_shard(delegated[0], replace(admission, **{field: "changed"}))
        forged = replace(delegated[0], members=delegated[0].members + (("commune", "x", ("car",)),))
        with self.assertRaisesRegex(ValueError, "does not match|exact planned"):
            verify_full_batch_shard(forged, admission)

    def test_worker_count_and_indexes_are_validated(self):
        with self.assertRaisesRegex(ValueError, "worker count"):
            delegate_full_batch(self.admission(), [[0]], 3)
        with self.assertRaisesRegex(ValueError, "invalid or duplicate"):
            delegate_full_batch(self.admission(), [[0, 0], [1], [2], [3, 4, 5, 6, 7]], 4)

    def test_direct_admission_runs_full_inventory_preflight_before_any_output(self):
        class RejectPartial:
            def render_identity(self): return {"renderer": "fixture"}
            def preflight(self, recipe, binding): pass
            def preflight_scope(self, recipe, binding, scope, profiles):
                if scope == "full": raise ValueError("partial full inventory")

        recipe = Recipe("net", 1, Foundation("v1"), "network")
        feature = {"geometry": "owned", "territory": {"kind": "commune", "code": "1"}, "mode": "car"}
        binding = Binding("network", MapSet({"commune": [feature]}))
        with TemporaryDirectory() as folder:
            output = Path(folder) / "output"
            with self.assertRaisesRegex(ValueError, "partial full inventory"):
                full_batch_admission(recipe, binding, ("inspection", "inline"),
                    RejectPartial(), {"human_approved": True}, output)
            self.assertFalse(output.exists())

    def test_assignment_is_by_whole_territory_and_tampering_fails(self):
        admission = self.admission()
        delegated = delegate_full_batch(admission, [[0, 1], [2, 3], [4, 5], [6, 7]], 4)
        # A territory entry contains its complete mode set; there is no index
        # representing a single mode that could be separated across workers.
        self.assertEqual(delegated[0].members[0][2], ("bike", "car", "walk"))
        altered = replace(delegated[0], worker_index=1)
        with self.assertRaisesRegex(ValueError, "exact planned worker assignment"):
            verify_full_batch_shard(altered, delegated[0].admission)
        invalid = replace(delegated[0], worker_index=4)
        with self.assertRaisesRegex(ValueError, "index/count"):
            verify_full_batch_shard(invalid, delegated[0].admission)
        tampered = replace(delegated[0], admission=replace(
            delegated[0].admission, assignments=((),) * 4))
        with self.assertRaisesRegex(ValueError, "exactly cover"):
            verify_full_batch_shard(tampered, replace(admission, worker_count=4,
                assignments=delegated[0].admission.assignments))

    def test_signed_plan_tampering_and_operator_worker_default(self):
        from runner import write_signed_batch_plan, read_signed_batch_plan
        from run_full_network import build_parser
        admission = self.admission()
        shards = delegate_full_batch(admission, [[0, 1], [2, 3], [4, 5], [6, 7]], 4)
        with TemporaryDirectory() as folder:
            path, key = Path(folder) / "plan", b"fixture-only-plan-key"
            write_signed_batch_plan(path, admission, shards, key)
            self.assertEqual(read_signed_batch_plan(path, key)[1], shards)
            path.write_bytes(path.read_bytes()[:-1] + bytes([path.read_bytes()[-1] ^ 1]))
            with self.assertRaisesRegex(ValueError, "signature is invalid"):
                read_signed_batch_plan(path, key)
        self.assertEqual(build_parser().parse_args(["--approval", "fixture.json"]).workers, 4)


if __name__ == "__main__":
    unittest.main()
