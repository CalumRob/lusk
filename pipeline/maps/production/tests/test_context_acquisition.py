"""Offline contract tests for dated, single-response mainland context acquisition."""
import json
import sys
import tempfile
import urllib.parse
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
from mainland_context import acquire_context, validate_response  # noqa: E402


def payload(features, matched=None, returned=None, bbox=(-10, 40, 10, 60)):
    return {"type": "FeatureCollection", "numberMatched": len(features) if matched is None else matched,
            "numberReturned": len(features) if returned is None else returned,
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::2154"}},
            "features": features, "bbox": list(bbox)}


def feature(identifier="COMMUNE_1", code="50615", geom=None):
    return {"type": "Feature", "id": identifier,
            "properties": {"cleabs": identifier, "code_insee": code, "nom_officiel": "Valognes"},
            "geometry": geom or {"type": "MultiPolygon", "coordinates": [[[[0, 0], [1, 0], [1, 1], [0, 0]]]]}}


class MainlandContextAcquisitionTests(unittest.TestCase):
    def test_acquisition_promotes_complete_generation_and_failed_refresh_preserves_it(self):
        with tempfile.TemporaryDirectory() as temp:
            good = payload([feature()], bbox=(-10, 40, 10, 60))
            def fetch(url):
                query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
                return b'<FeatureCollection numberMatched="1"/>' if query.get("resultType") == ["hits"] else json.dumps(good).encode()
            path, manifest = acquire_context(temp, (0, 45, 1, 50), fetch=fetch)
            old_bytes = path.read_bytes()
            def partial(url):
                query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
                return b'<FeatureCollection numberMatched="2"/>' if query.get("resultType") == ["hits"] else json.dumps(good).encode()
            with self.assertRaisesRegex(RuntimeError, "completeness"):
                acquire_context(temp, (0, 45, 1, 50), refresh=True, fetch=partial)
            self.assertEqual(path.read_bytes(), old_bytes)
            self.assertEqual(manifest["edition"], "2026")

    def test_rejects_partial_response_even_when_geometry_bbox_could_look_plausible(self):
        with self.assertRaisesRegex(ValueError, "counts"):
            validate_response(payload([feature()], matched=2, returned=1), expected=2,
                              requested_bbox=(0, 45, 1, 50))

    def test_rejects_duplicate_ids_and_null_geometry(self):
        with self.assertRaisesRegex(ValueError, "unique"):
            validate_response(payload([feature(), feature()]), expected=2, requested_bbox=(0, 45, 1, 50))
        with self.assertRaisesRegex(ValueError, "geometry"):
            validate_response(payload([feature(geom=None) | {"geometry": None}]), expected=1,
                              requested_bbox=(0, 45, 1, 50))

    def test_rejects_malformed_polygon_ring_before_cache_promotion(self):
        malformed = feature(geom={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1]]]})
        with self.assertRaisesRegex(ValueError, "geometry"):
            validate_response(payload([malformed]), expected=1, requested_bbox=(0, 45, 1, 50))

    def test_rejects_wrong_crs_and_non_covering_acquisition_bbox(self):
        wrong_crs = payload([feature()]); wrong_crs["crs"]["properties"]["name"] = "EPSG:4326"
        with self.assertRaisesRegex(ValueError, "CRS"):
            validate_response(wrong_crs, expected=1, requested_bbox=(0, 45, 1, 50))
        with self.assertRaisesRegex(ValueError, "coverage"):
            validate_response(payload([feature()], bbox=(0, 0, 1, 1)), expected=1,
                              requested_bbox=(0, 45, 1, 50))

    def test_accepts_complete_response_and_returns_canonical_content_hash(self):
        result = validate_response(payload([feature()]), expected=1, requested_bbox=(0, 45, 1, 50))
        self.assertEqual(result["feature_count"], 1)
        self.assertEqual(result["ids"], ["COMMUNE_1"])
        self.assertEqual(len(result["sha256"]), 64)


if __name__ == "__main__":
    unittest.main()
