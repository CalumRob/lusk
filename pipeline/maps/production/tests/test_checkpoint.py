import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
from checkpoint import OutputCheckpoint  # noqa: E402


class OutputCheckpointTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.expected = [{"key": "commune/1/car/inline", "territory": {"kind": "commune", "code": "1"},
            "mode": "car", "profile": "inline"}]

    def tearDown(self):
        self.directory.cleanup()

    def checkpoint(self):
        return OutputCheckpoint(self.root, "contract-identity", self.expected)

    def test_success_record_survives_restart_and_expected_matrix_is_retained(self):
        current = self.checkpoint()
        current.record_success({"key": self.expected[0]["key"], "path": str(self.root / "map.png"),
            "effective_identity": "a" * 64, "output_sha256": "b" * 64})
        restarted = self.checkpoint()
        self.assertEqual(restarted.expected_outputs, self.expected)
        self.assertEqual(restarted.success_records[-1]["output_sha256"], "b" * 64)

    def test_torn_and_corrupt_tail_is_discarded_without_losing_valid_prefix(self):
        current = self.checkpoint()
        current.record_success({"key": self.expected[0]["key"], "path": str(self.root / "map.png"),
            "effective_identity": "a" * 64, "output_sha256": "b" * 64})
        with current.path.open("ab") as stream:
            stream.write(b'{"payload":')
        recovered = self.checkpoint()
        self.assertEqual(len(recovered.success_records), 1)
        self.assertTrue(recovered.path.read_bytes().endswith(b"\n"))
        recovered.record_failure({"key": self.expected[0]["key"], "error": "next attempt failed"})
        restarted = self.checkpoint()
        self.assertEqual(len(restarted.success_records), 1)
        self.assertEqual(len(restarted.failure_records), 1)

    def test_header_mismatch_fails_closed_without_replacing_checkpoint(self):
        current = self.checkpoint()
        before = current.path.read_bytes()
        with self.assertRaisesRegex(ValueError, "contract/header does not match"):
            OutputCheckpoint(self.root, "contract-identity", [{"key": "different-output"}])
        self.assertEqual(current.path.read_bytes(), before)

    def test_corrupt_middle_entry_truncates_untrusted_suffix_but_keeps_prefix(self):
        current = self.checkpoint()
        current.record_success({"key": "first", "path": "first.png", "effective_identity": "a" * 64,
            "output_sha256": "b" * 64})
        raw = current.path.read_bytes()
        lines = raw.splitlines(keepends=True)
        current.path.write_bytes(b"".join(lines[:3]) + b'{"payload":{},"sha256":"bad"}\n' + lines[-1])
        recovered = self.checkpoint()
        self.assertEqual([row["key"] for row in recovered.success_records], ["first"])
        # Reopening appends one fresh attempt marker after truncating the
        # corrupt suffix, while preserving header, prior attempt and success.
        self.assertEqual(len(recovered.path.read_bytes().splitlines()), 4)

    def test_checkpoint_io_failure_is_propagated(self):
        current = self.checkpoint()
        with patch.object(current, "_append_record", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                current.record_success({"key": "one"})


if __name__ == "__main__":
    unittest.main()
