"""Supported AEDAR CLI and retired-launcher contracts."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parents[1]))  # mirror direct QGIS script import context
from pipeline.maps.production import run_aedar_static_maps as selected
from pipeline.maps.production import aedar_map_plan, aedar_static
from pipeline.maps.production.tests.qgis_fixture import qgis_application


PRODUCTION = Path(__file__).parents[1]


class AedarCliContractTests(unittest.TestCase):
    def test_superseded_launchers_are_absent_and_unimported(self):
        for module in ("run_aedar_maps.py", "run_aedar_loss_maps.py",
                       "run_aedar_car_maps.py", "record_aedar_car_approval.py"):
            self.assertFalse((PRODUCTION / module).exists(), module)

    def test_supported_parser_exposes_documented_input_workers_and_safe_modes(self):
        parser = selected.build_parser()
        args = parser.parse_args(["--raw-dir", "raw", "--facts-path", "facts.parquet",
            "--output-dir", "out", "--workers", "2", "--plan-only", "--context-cache-root", "context"])
        self.assertEqual(args.workers, 2)
        self.assertTrue(args.plan_only)
        self.assertEqual(args.context_cache_root, Path("context"))
        self.assertEqual(parser.get_default("workers"), 4)

    def test_supported_cli_help_exposes_the_canonical_options(self):
        with self.assertRaises(SystemExit) as result:
            selected.main(["--help"])
        self.assertEqual(result.exception.code, 0)
        help_text = selected.build_parser().format_help()
        for option in ("--raw-dir", "--facts-path", "--output-dir", "--workers",
                       "--plan-only", "--check-only", "--acquire-context"):
            self.assertIn(option, help_text)

    def _main_inputs(self, root):
        raw = root / "raw"
        raw.mkdir()
        facts = root / "facts.parquet"
        facts.touch()
        config = root / "family.json"
        config.write_text("{}", encoding="utf-8")
        registry = root / "territories.json"
        registry.write_text("[]", encoding="utf-8")
        return ["--raw-dir", str(raw), "--facts-path", str(facts),
                "--family-config", str(config), "--territory-registry", str(registry),
                "--output-dir", str(root / "out"), "--plan-only"]

    def test_supported_entrypoint_exits_qgis_after_successful_plan(self):
        qgis_application()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            args = self._main_inputs(root)
            app = Mock()
            with (patch.dict("sys.modules", {"aedar_static": aedar_static,
                                               "aedar_map_plan": aedar_map_plan}),
                  patch.object(selected, "_qgis_app", return_value=app),
                  patch.object(selected, "signatures", return_value={"fixture": "sha"}),
                  patch.object(aedar_static, "AddressFacts", return_value=object()),
                  patch.object(aedar_map_plan, "build_aedar_static_map_set", return_value=(object(), {
                      "territories": [{"territory": {"kind": "commune", "code": "test"}}],
                      "skipped_no_address_facts": []})),
                  patch.object(aedar_map_plan, "encode_plan", return_value={"input_signatures": {},
                      "territory_count": 1, "expected_webps": 10, "shards": [[]]})):
                self.assertEqual(selected.main(args), 0)
            app.exitQgis.assert_called_once_with()

    def test_supported_entrypoint_exits_qgis_after_plan_failure(self):
        qgis_application()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            args = self._main_inputs(root)
            app = Mock()
            with (patch.dict("sys.modules", {"aedar_static": aedar_static,
                                               "aedar_map_plan": aedar_map_plan}),
                  patch.object(selected, "_qgis_app", return_value=app),
                  patch.object(selected, "signatures", return_value={"fixture": "sha"}),
                  patch.object(aedar_static, "AddressFacts", side_effect=RuntimeError("fixture failure"))):
                with self.assertRaisesRegex(RuntimeError, "fixture failure"):
                    selected.main(args)
            app.exitQgis.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
