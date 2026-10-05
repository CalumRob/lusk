"""Tests for bounded, fsynced production diagnostic-report spooling."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))

from stage_report import StageReportSpool  # noqa: E402


class StageReportSpoolTests(unittest.TestCase):
    def test_stage_channels_round_trip_independently_and_keep_append_order(self):
        spool = StageReportSpool()
        try:
            adapter = [{"stage": "shared", "decision": "reused"}]
            identity = [{"stage": "input", "territory": "x/1"},
                {"stage": "output", "territory": "x/1"}]
            spool.append("adapter", adapter)
            spool.append("identity", identity[:1])
            spool.append("identity", identity[1:])
            self.assertEqual(spool.read("adapter"), adapter)
            self.assertEqual(spool.read("identity"), identity)
        finally:
            spool.close()

    def test_each_batch_flushes_and_fsyncs_its_temporary_stream(self):
        spool = StageReportSpool()
        try:
            with patch("stage_report.os.fsync", wraps=__import__("os").fsync) as sync:
                spool.append("adapter", [{"territory": "x/1"}])
                spool.append("identity", [{"territory": "x/1"}])
                self.assertEqual(sync.call_count, 2)
        finally:
            spool.close()

    def test_unknown_channel_fails_before_writing(self):
        spool = StageReportSpool()
        try:
            with self.assertRaisesRegex(ValueError, "unknown stage-report channel"):
                spool.append("geometry", [{"reference": "not-allowed"}])
        finally:
            spool.close()


if __name__ == "__main__":
    unittest.main()
