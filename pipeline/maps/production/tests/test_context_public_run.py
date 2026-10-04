"""Public runner exercises offline, frame-matched context preflight and reuse."""
import json
import struct
import sys
import tempfile
import unittest
import urllib.parse
import zlib
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

from qgis.core import QgsApplication, QgsGeometry, QgsPointXY, QgsProject, QgsRectangle

sys.path.insert(0, str(Path(__file__).parents[1]))
from mainland_context import acquire_context, load_context  # noqa: E402
from map_ground import prepare_shared_ground  # noqa: E402
from runner import Binding, Foundation, MapSet, Recipe, run_production  # noqa: E402


def fixture_response(bbox, xshift=0, far_shift=0):
    x0, y0, x1, y1 = bbox
    # Deliberately partial land occupancy: sea remains outside the polygon and
    # is not a completeness failure; the acquisition query itself covers frame.
    ring = [[x0 + 100 + xshift, y0 + 100], [x0 + 500 + xshift, y0 + 100],
            [x0 + 500 + xshift, y0 + 500], [x0 + 100 + xshift, y0 + 100]]
    far = [[x0 + 5000 + far_shift, y0 + 100], [x0 + 5500 + far_shift, y0 + 100],
           [x0 + 5500 + far_shift, y0 + 500], [x0 + 5000 + far_shift, y0 + 100]]
    return {"type": "FeatureCollection", "numberMatched": 1, "numberReturned": 1,
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::2154"}},
        "features": [{"type": "Feature", "properties": {"cleabs": "COMMUNE_FIXTURE",
            "code_insee": "50615", "nom_officiel": "Fixture"},
            "geometry": {"type": "MultiPolygon", "coordinates": [[ring], [far]]}}]}


def png(path, width, height):
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xffffffff)
    raw = b"".join(b"\0" + bytes((25, 35, 45)) * width for _ in range(height))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
                    + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


class OfflineContextAdapter:
    def __init__(self, cache, bbox):
        self.cache, self.bbox = Path(cache), bbox
        self.render_calls = 0
        self.visible_sha = None

    def preflight(self, recipe, binding):
        pass

    def render_identity(self):
        return {"renderer": "offline-context-fixture"}

    def input_identity(self):
        return {"sources": [{"name": "fixture-indicator", "edition": "test"}]}

    def prepare_run(self, recipe, binding, profiles, output_dir, *, refresh=False):
        # Production adapter's loader path: no HTTP is permitted here.
        path, manifest = load_context(self.cache, self.bbox)
        document = json.loads(path.read_text(encoding="utf-8"))
        polygons = []
        for feature in document["features"]:
            polygons.append(QgsGeometry.fromMultiPolygonXY([
                [[QgsPointXY(*position[:2]) for position in ring] for ring in polygon]
                for polygon in feature["geometry"]["coordinates"]]))
        geometry = QgsGeometry.unaryUnion(polygons)
        clipped = geometry.intersection(QgsGeometry.fromRect(QgsRectangle(*self.bbox)))
        self.visible_sha = sha256(bytes(clipped.asWkb())).hexdigest()

    def profile_identity(self, profile, feature, recipe):
        return {"visible_context": self.visible_sha}

    def render(self, recipe, feature, profile, output_dir):
        self.render_calls += 1
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / f"context-{profile.name}.png"
        png(path, *profile.size)
        return path

    def expected_output_path(self, feature, profile, output_dir):
        return Path(output_dir) / f"context-{profile.name}.png"

    def validate(self, path, feature, profile):
        pass


class PublicContextRunTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QgsApplication([], False)
        cls.app.initQgis()

    @classmethod
    def tearDownClass(cls):
        cls.app.exitQgis()

    def _acquire_fixture(self, cache, bbox, response, refresh=False):
        def fetch(url):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            return b'<FeatureCollection numberMatched="1" timeStamp="fixture-edition"/>' if query.get("resultType") == ["hits"] else json.dumps(response).encode()
        return acquire_context(cache, bbox, fetch=fetch, refresh=refresh)

    def _run(self, adapter, output, bbox):
        x0, y0, x1, y1 = bbox
        polygon = QgsGeometry.fromWkt(f"POLYGON (({x0} {y0},{x1} {y0},{x1} {y1},{x0} {y1},{x0} {y0}))")
        feature = {"geometry": polygon, "territory": {"kind": "commune", "code": "fixture", "name": "Fixture"}, "mode": "car"}
        recipe = Recipe("fixture", 1, Foundation("ctx-v1"), "fixture")
        return run_production(recipe, Binding("fixture", MapSet({"frame": [feature]})),
                              "representative", ["inspection"], adapter, output)

    def test_public_run_rejects_missing_frame_coverage_without_rendering(self):
        with tempfile.TemporaryDirectory() as temp:
            cache, output = Path(temp) / "context", Path(temp) / "output"
            wide = (0.0, 0.0, 2000.0, 2000.0)
            narrow = (0.0, 0.0, 1000.0, 1000.0)
            self._acquire_fixture(cache, narrow, fixture_response(narrow))
            adapter = OfflineContextAdapter(cache, wide)
            with patch("mainland_context._http_fetch", side_effect=AssertionError("renderer attempted HTTP")):
                with self.assertRaisesRegex(RuntimeError, "No valid pre-acquired mainland context"):
                    self._run(adapter, output, wide)
            self.assertEqual(adapter.render_calls, 0)

    def test_public_run_reuses_unchanged_context_and_invalidates_visible_edit_only(self):
        with tempfile.TemporaryDirectory() as temp:
            cache, output = Path(temp) / "context", Path(temp) / "output"
            bbox = (0.0, 0.0, 2000.0, 2000.0)
            adapter = OfflineContextAdapter(cache, bbox)
            recipe_response = fixture_response(bbox)
            self._acquire_fixture(cache, bbox, recipe_response)
            first = self._run(adapter, output, bbox)
            warm = self._run(adapter, output, bbox)
            self.assertEqual(first.outputs[0]["decision"], "rendered")
            self.assertEqual(warm.outputs[0]["decision"], "reused-output")
            # Out-of-frame feature changes are excluded by the scoped frame query;
            # a byte-identical visible ground therefore keeps its output reusable.
            self.assertEqual(first.outputs[0]["effective_identity"], warm.outputs[0]["effective_identity"])
            out_of_scope_change = fixture_response(bbox, far_shift=250, xshift=0)
            self._acquire_fixture(cache, bbox, out_of_scope_change, refresh=True)
            outside = self._run(adapter, output, bbox)
            self.assertEqual(outside.outputs[0]["decision"], "reused-output")
            changed = fixture_response(bbox, xshift=100, far_shift=250)
            self._acquire_fixture(cache, bbox, changed, refresh=True)
            edited = self._run(adapter, output, bbox)
            self.assertEqual(edited.outputs[0]["decision"], "rendered")
            self.assertNotEqual(first.outputs[0]["effective_identity"], edited.outputs[0]["effective_identity"])

    def test_invalid_topology_and_missing_schema_never_replace_validated_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp) / "context"
            bbox = (0.0, 0.0, 2000.0, 2000.0)
            current_path, _ = self._acquire_fixture(cache, bbox, fixture_response(bbox))
            pointer_path = current_path.parent.parent.parent / "current.json"
            pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
            bad_topology = fixture_response(bbox)
            bad_topology["features"][0]["geometry"]["coordinates"][0][0] = [
                [100, 100], [500, 500], [500, 100], [100, 500], [100, 100]]
            missing_schema = fixture_response(bbox)
            del missing_schema["features"][0]["properties"]["nom_officiel"]
            for invalid in (bad_topology, missing_schema):
                with self.assertRaises(RuntimeError):
                    self._acquire_fixture(cache, bbox, invalid, refresh=True)
                self.assertEqual(json.loads(pointer_path.read_text(encoding="utf-8")), pointer)
            self.assertTrue(current_path.is_file())

    def test_inline_only_epsg4326_source_keeps_original_transform_without_official_fetch(self):
        repo = Path(__file__).resolve().parents[4]
        with tempfile.TemporaryDirectory() as temp:
            project = QgsProject.instance()
            project.clear()
            with patch("mainland_context._http_fetch", side_effect=AssertionError("inline asked for official context")):
                shared = prepare_shared_ground(project, repo / "pipeline/data/raw",
                    QgsRectangle(300000, 6780000, 350000, 6830000),
                    repo / "pipeline/maps/production/assets", include_ocsge=False,
                    cache_root=Path(temp) / ".stage-cache" / "context-land")
            self.assertFalse(shared.context_geometry.isEmpty())
            project.clear()

    def test_inspection_shared_ground_fails_offline_when_preacquisition_is_missing(self):
        repo = Path(__file__).resolve().parents[4]
        with tempfile.TemporaryDirectory() as temp:
            with patch("mainland_context._http_fetch", side_effect=AssertionError("shared ground attempted HTTP")):
                with self.assertRaisesRegex(RuntimeError, "No valid pre-acquired mainland context"):
                    prepare_shared_ground(QgsProject.instance(), repo / "pipeline/data/raw",
                        QgsRectangle(300000, 6780000, 350000, 6830000),
                        repo / "pipeline/maps/production/assets", include_ocsge=True,
                        cache_root=Path(temp) / ".stage-cache" / "context-land")


if __name__ == "__main__":
    unittest.main()
