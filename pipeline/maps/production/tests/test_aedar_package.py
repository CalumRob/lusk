"""The existing upload-manifest boundary for an AEDAR candidate export."""
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from package_aedar_maps import package_export
from webp_encoding import WEBP_ENCODING_CONTRACT, _pillow
import upload_maps


def write_json(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


class AedarPackageTests(unittest.TestCase):
    def fixture(self, root):
        source = root / "export"
        source.mkdir()
        shard = source / "shard-0"
        shard.mkdir()
        territory = {"kind": "commune", "code": "35238", "name": "Rennes"}
        missing = {"kind": "commune", "code": "29083", "name": "Île-de-Sein"}
        config = json.loads(Path(__file__).resolve().parents[1].joinpath(
            "aedar-static-family.json").read_text(encoding="utf-8"))
        Image = _pillow()
        files = {}
        for profile, spec in config["profiles"].items():
            image = Image.new("RGB", tuple(spec["size"]), (113, 108, 162))
            if spec["transparent_outside"]:
                image = image.convert("RGBA")
                image.putpixel((0, 0), (113, 108, 162, 0))
            probe = root / f"{profile}.webp"
            image.save(probe, "WEBP", quality=80, method=4, exact=True)
            files[profile] = probe.read_bytes()
        outputs = []
        for mode in config["modes"]:
            for profile, spec in config["profiles"].items():
                path = shard / f"35238-{mode}-{profile}.webp"
                path.write_bytes(files[profile])
                outputs.append({"territory": territory, "family": "aedar", "mode": mode,
                    "profile": profile, "profile_size": spec["size"], "path": str(path),
                    "bytes": path.stat().st_size, "output_sha256": hashlib.sha256(files[profile]).hexdigest(),
                    "effective_identity": "e" * 64,
                    "artifact_contract": {**WEBP_ENCODING_CONTRACT, "dimensions": spec["size"],
                        "alpha": "lossless" if spec["transparent_outside"] else "opaque-rgb"}})
        write_json(source / "worker-0.manifest.json", {"family": "aedar", "outputs": outputs})
        write_json(source / "worker-0.qa.json", {"status": "passed", "failures": [],
            "artifact_count": 10, "expected_artifact_count": 10,
            "human_spot_check": {"status": "pending"}, "production_status": "awaiting-human-spot-check"})
        write_json(source / "full-plan.json", {"territory_count": 1, "expected_webps": 10,
            "territories": [{"territory": territory}], "shards": [[0]],
            "skipped_no_address_facts": [missing], "q80": WEBP_ENCODING_CONTRACT})
        write_json(source / "complete.json", {"status": "passed", "qa": "passed", "territories": 1,
            "artifacts": 10, "skipped": [missing], "production_approval": "not claimed"})
        return source, outputs

    def test_packages_existing_bytes_into_the_usual_flat_upload_selection(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source, originals = self.fixture(root)
            destination = root / "publish"
            package_export(source, destination)
            manifest = json.loads((destination / "upload-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["prefix"], "maps/aedar/v1/")
            self.assertEqual(manifest["bucket"], "lusk")
            self.assertEqual(len(manifest["outputs"]), 10)
            item = next(row for row in manifest["outputs"] if row["filename"] == "35238-car-inline.webp")
            self.assertEqual(item["key"], "maps/aedar/v1/35238-car-inline.webp")
            self.assertEqual(item["public_url"],
                "https://images.calumrobertson.fr/maps/aedar/v1/35238-car-inline.webp")
            for original in originals:
                self.assertEqual((destination / Path(original["path"]).name).read_bytes(),
                                 Path(original["path"]).read_bytes())
            qa = json.loads((destination / "full-qa.json").read_text(encoding="utf-8"))
            self.assertEqual(qa["status"], "passed")
            self.assertEqual(qa["human_spot_check"]["status"], "pending")
            self.assertEqual(manifest["missing_territories"][0]["code"], "29083")

    def test_existing_upload_helper_uses_aedar_keys_and_rejects_network_prefix(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source, _ = self.fixture(root)
            destination = root / "publish"
            package_export(source, destination)
            original_output = upload_maps.OUT
            try:
                upload_maps.configure_output(destination)
                _, items = upload_maps.load_plan(None)
                self.assertEqual(len(items), 10)
                self.assertIn("maps/aedar/v1/35238-car-inline.webp", [item["key"] for item in items])
                self.assertFalse(upload_maps.upload_is_approved()[0])
                with self.assertRaisesRegex(ValueError, "AEDAR.*prefix"):
                    upload_maps.load_plan("maps/v1/")
                manifest, _ = upload_maps.load_plan(None)
                with self.assertRaisesRegex(ValueError, "AEDAR.*bound QA"):
                    upload_maps.plan_qa_path(manifest, root / "unrelated-approved-qa.json")
            finally:
                upload_maps.configure_output(original_output)

    def test_changed_source_bytes_cannot_create_an_upload_selection(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source, originals = self.fixture(root)
            Path(originals[0]["path"]).write_bytes(b"changed")
            destination = root / "publish"
            with self.assertRaisesRegex(ValueError, "Source artifact changed"):
                package_export(source, destination)
            self.assertFalse((destination / "upload-manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
