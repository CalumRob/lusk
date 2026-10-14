"""Real-child lifecycle contracts for family-neutral batch execution."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
from batch_execution import partition_territories, prepare_worker_layout, run_workers


class BatchExecutionTests(unittest.TestCase):
    def test_selected_aedar_batch_retains_four_worker_default_and_one_two_four_options(self):
        from run_aedar_static_maps import build_parser
        parser = build_parser()
        workers = next(action for action in parser._actions if action.dest == "workers")
        self.assertEqual(workers.default, 4)
        self.assertEqual(workers.choices, (1, 2, 4))

    def test_weighted_partition_is_deterministic_whole_territory_and_exact(self):
        territories = [{"key": str(index), "cost": cost} for index, cost in
                       enumerate((2, 100, 4, 80, 1, 40, 7))]
        first = partition_territories(territories, 4, lambda row: row["cost"])
        self.assertEqual(first, partition_territories(territories, 4, lambda row: row["cost"]))
        self.assertEqual(sorted(index for shard in first for index in shard), list(range(7)))
        self.assertTrue(all(shard == sorted(shard) for shard in first))

    def test_worker_layout_owns_mutable_shards_and_seeded_caches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed_cache, seed_source = root / "seed-cache", root / "seed-source"
            seed_cache.mkdir(); seed_source.mkdir()
            (seed_cache / "seed").write_text("cache")
            (seed_source / "seed").write_text("source")
            layout = prepare_worker_layout(root / "run", 2, seed_cache, seed_source)
            self.assertEqual(layout[0]["shard"], root / "run" / "shard-0")
            self.assertEqual((layout[0]["cache"] / "seed").read_text(), "cache")
            self.assertNotEqual(layout[0]["cache"], layout[1]["cache"])
            self.assertNotEqual(layout[0]["source"], layout[1]["source"])

    def test_real_processes_mirror_progress_and_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            writes = []

            def write_json(path, value):
                Path(path).write_text(json.dumps(value), encoding="utf-8")
                writes.append(Path(path).name)

            def log(path, message):
                with Path(path).open("a", encoding="utf-8") as stream:
                    stream.write(message + "\n")

            commands = [( [sys.executable, "-c", "print('[maps] 1/1 fixture')"],
                          dict(PYTHONUNBUFFERED="1")) for _ in range(2)]
            run_workers(commands, root, 2, write_json=write_json, log=log)
            self.assertIn("worker-0.log", [p.name for p in root.glob("worker-*.log")])
            self.assertIn("worker-1.progress.json", writes)
            self.assertEqual(json.loads((root / "progress.json").read_text())["expected_webps"], 2)

    def test_nonzero_child_fails_without_deleting_durable_worker_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sentinel = root / "durable-output.webp"
            sentinel.write_bytes(b"preserve")
            with self.assertRaisesRegex(RuntimeError, "preserved for resume"):
                run_workers([[sys.executable, "-c", "raise SystemExit(7)"]], root, 1,
                    write_json=lambda path, value: Path(path).write_text(json.dumps(value)),
                    log=lambda path, message: None)
            self.assertEqual(sentinel.read_bytes(), b"preserve")


if __name__ == "__main__":
    unittest.main()
