"""Real-child lifecycle contracts for family-neutral batch execution."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
from batch_execution import run_workers


class BatchExecutionTests(unittest.TestCase):
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
