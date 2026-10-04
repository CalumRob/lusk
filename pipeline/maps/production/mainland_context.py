"""Validated acquisition contract for the distinct official mainland context."""
from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

CONTEXT_EDITION = "2026-01-01"
CONTEXT_TYPE = "ADMINEXPRESS-COG.2026:commune"
CONTEXT_ENDPOINT = "https://data.geopf.fr/wfs/ows"
CONTEXT_CRS = "urn:ogc:def:crs:EPSG::2154"
CONTEXT_FIELDS = ("cleabs", "code_insee", "nom_officiel", "geometrie")
CONTEXT_CAPACITY = 5000  # capabilities CountDefault; never silently page beyond it


def _request(params, fetch):
    url = CONTEXT_ENDPOINT + "?" + urllib.parse.urlencode(params)
    return fetch(url)


def _http_fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "lusk-pipeline/production"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def _qgis_validate_generation(path, expected_count):
    """Validate promoted-source schema and actual QGIS topology before publish."""
    try:
        from qgis.core import QgsGeometry, QgsPointXY
    except ImportError as error:
        raise RuntimeError("QGIS is required to validate official context geometry before promotion") from error
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    if len(document.get("features", [])) != expected_count:
        raise ValueError("staged official context feature count disagrees with validated response")
    stable_ids = set()
    for feature in document["features"]:
        properties = feature["properties"]
        if not {"cleabs", "code_insee", "nom_officiel"}.issubset(properties):
            raise ValueError("staged official context schema lacks required fields")
        identifier = properties["cleabs"]
        if not identifier or identifier in stable_ids:
            raise ValueError("staged official context has missing or duplicate stable IDs")
        stable_ids.add(identifier)
        geojson_geometry = feature["geometry"]
        if geojson_geometry["type"] == "Polygon":
            geometry = QgsGeometry.fromPolygonXY([
                [QgsPointXY(position[0], position[1]) for position in ring]
                for ring in geojson_geometry["coordinates"]])
        elif geojson_geometry["type"] == "MultiPolygon":
            geometry = QgsGeometry.fromMultiPolygonXY([
                [[QgsPointXY(position[0], position[1]) for position in ring] for ring in polygon]
                for polygon in geojson_geometry["coordinates"]])
        else:
            raise ValueError("staged official context includes non-polygon geometry")
        if geometry.isNull() or geometry.isEmpty() or not geometry.isGeosValid():
            raise ValueError(f"staged official context feature {identifier} has invalid topology")


def load_context(cache_root, bbox):
    """Load only a locally cached, validated generation matching this exact frame."""
    bbox = list(map(float, bbox))
    identity = _context_identity(bbox)
    root = Path(cache_root) / identity
    pointer_path = root / "current.json"
    try:
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        generation = pointer["generation"]
        if (pointer.get("identity") != identity or not isinstance(generation, str)
                or Path(generation).name != generation):
            raise ValueError("generation pointer does not match requested frame")
        generation_dir = root / "generations" / generation
        manifest = json.loads((generation_dir / "manifest.json").read_text(encoding="utf-8"))
        data_path = generation_dir / "context.geojson"
        data = data_path.read_bytes()
        bbox_value = ",".join(format(float(value), ".12g") for value in bbox) + "," + CONTEXT_CRS
        request = manifest.get("request", {})
        if (manifest.get("schema") != 1 or manifest.get("identity") != identity
                or manifest.get("source") != CONTEXT_ENDPOINT or manifest.get("product") != CONTEXT_TYPE
                or manifest.get("edition") != CONTEXT_EDITION
                or manifest.get("crs") != CONTEXT_CRS or manifest.get("bbox") != bbox
                or request.get("service") != "WFS" or request.get("version") != "2.0.0"
                or request.get("typeNames") != CONTEXT_TYPE or request.get("bbox") != bbox_value
                or request.get("srsName") != CONTEXT_CRS or request.get("outputFormat") != "application/json"
                or manifest.get("topology_validated") is not True
                or hashlib.sha256(data).hexdigest() != manifest.get("sha256")):
            raise ValueError("cached generation provenance, coverage, CRS or content hash is invalid")
        document = json.loads(data)
        evidence = validate_response(document, expected=manifest.get("matched"), requested_bbox=bbox)
        if (manifest.get("matched") != manifest.get("returned")
                or manifest.get("returned") != manifest.get("unique_ids")
                or evidence["feature_count"] != manifest.get("returned")
                or len(set(evidence["ids"])) != manifest.get("unique_ids")):
            raise ValueError("cached generation completeness counts disagree")
        return data_path, manifest
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"No valid pre-acquired mainland context for requested inspection frame: {error}") from error


def _context_identity(bbox):
    seed = json.dumps({"edition": CONTEXT_EDITION, "type": CONTEXT_TYPE,
        "bbox": list(map(float, bbox)), "crs": CONTEXT_CRS}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(seed.encode()).hexdigest()


def acquire_context(cache_root, bbox, *, refresh=False, fetch=_http_fetch, validate_layer=_qgis_validate_generation):
    """Fetch dated hits + one complete frame response, stage and promote atomically."""
    bbox_value = ",".join(format(float(value), ".12g") for value in bbox) + "," + CONTEXT_CRS
    identity = _context_identity(bbox)
    root = Path(cache_root) / identity
    pointer_path = root / "current.json"
    if not refresh and pointer_path.is_file():
        try:
            return load_context(cache_root, bbox)
        except RuntimeError:
            pass
    params = {"service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": CONTEXT_TYPE, "bbox": bbox_value, "resultType": "hits"}
    hit_bytes = _request(params, fetch)
    try:
        hit_root = ET.fromstring(hit_bytes)
        matched = int(hit_root.attrib["numberMatched"])
        service_timestamp = hit_root.attrib.get("timeStamp")
    except (ET.ParseError, KeyError, ValueError) as error:
        raise RuntimeError("Official context hits response is malformed or lacks numberMatched") from error
    if matched < 0 or matched > CONTEXT_CAPACITY:
        raise RuntimeError(f"Official context query matched {matched}; single-response capacity is {CONTEXT_CAPACITY}")
    params.pop("resultType")
    params.update({"count": str(CONTEXT_CAPACITY), "outputFormat": "application/json",
        "srsName": CONTEXT_CRS})
    response = _request(params, fetch)
    try:
        document = json.loads(response)
        evidence = validate_response(document, expected=matched, requested_bbox=bbox)
    except (ValueError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Official context response failed completeness validation: {error}") from error
    if matched == 0:
        raise RuntimeError("Official context acquisition returned no communes for requested frame")
    (root / "generations").mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".context-stage-", dir=root / "generations"))
    try:
        staged_data = staging / "context.geojson"
        staged_data.write_bytes(response)
        validate_layer(staged_data, evidence["feature_count"])
        manifest = {"schema": 1, "identity": identity, "source": CONTEXT_ENDPOINT,
            "product": CONTEXT_TYPE, "edition": CONTEXT_EDITION, "bbox": list(map(float, bbox)),
            "crs": CONTEXT_CRS, "matched": matched, "returned": evidence["feature_count"],
            "unique_ids": len(evidence["ids"]), "service_sha256": evidence["sha256"],
            "service_timestamp": service_timestamp,
            "request": {"service": "WFS", "version": "2.0.0", "bbox": bbox_value,
                        "typeNames": CONTEXT_TYPE, "count": CONTEXT_CAPACITY,
                        "outputFormat": "application/json", "srsName": CONTEXT_CRS},
            "sha256": hashlib.sha256(response).hexdigest(), "topology_validated": True}
        (staging / "manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
        generation_id = hashlib.sha256(response + os.urandom(16)).hexdigest()[:32]
        generation_dir = root / "generations" / generation_id
        os.replace(staging, generation_dir)
        pointer_tmp = root / (".current-" + generation_id + ".tmp")
        pointer_tmp.write_text(json.dumps({"identity": identity, "generation": generation_id}), encoding="utf-8")
        os.replace(pointer_tmp, pointer_path)
    except Exception as error:
        raise RuntimeError("Context generation validation/promotion failed; current pointer was not replaced") from error
    finally:
        if staging.exists():
            import shutil
            shutil.rmtree(staging, ignore_errors=True)
    return generation_dir / "context.geojson", manifest


def validate_response(document, *, expected, requested_bbox):
    """Fail closed unless one GeoServer response proves complete frame query."""
    if not isinstance(document, dict) or document.get("type") != "FeatureCollection":
        raise ValueError("Context response is not a GeoJSON FeatureCollection")
    matched, returned = document.get("numberMatched"), document.get("numberReturned")
    features = document.get("features")
    if (not isinstance(expected, int) or isinstance(expected, bool) or expected < 0
            or matched != expected or returned != expected or not isinstance(features, list)
            or len(features) != expected):
        raise ValueError("Context response counts do not agree (hits/returned/feature array)")
    crs_document = document.get("crs")
    crs = (crs_document.get("properties", {}).get("name")
           if isinstance(crs_document, dict) else None)
    if crs not in (CONTEXT_CRS, "EPSG:2154", "urn:ogc:def:crs:EPSG::2154"):
        raise ValueError(f"Context response has missing or unexpected CRS: {crs!r}")
    # GeoServer's WFS response omits collection bbox; coverage is certified by
    # the exact explicit EPSG:2154 query bbox recorded in the cache identity.
    # If the service does include a bbox, ensure it does not contradict it.
    bbox = document.get("bbox")
    if bbox is not None:
        if not isinstance(bbox, list) or len(bbox) != 4 or not all(isinstance(x, (int, float)) for x in bbox):
            raise ValueError("Context response has malformed acquisition coverage bbox")
        if (bbox[0] > requested_bbox[0] or bbox[1] > requested_bbox[1]
                or bbox[2] < requested_bbox[2] or bbox[3] < requested_bbox[3]):
            raise ValueError("Context acquisition coverage does not cover requested frame")
    ids = []
    for item in features:
        if not isinstance(item, dict) or item.get("type") != "Feature":
            raise ValueError("Malformed context feature")
        props = item.get("properties") or {}
        stable_id = props.get("cleabs")
        if not isinstance(stable_id, str) or not stable_id.strip():
            raise ValueError("Context feature is missing required cleabs stable ID")
        if not isinstance(props.get("code_insee"), str) or not props["code_insee"]:
            raise ValueError("Context feature is missing code_insee")
        if not isinstance(props.get("nom_officiel"), str) or not props["nom_officiel"]:
            raise ValueError("Context feature is missing nom_officiel")
        geometry = item.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") not in ("Polygon", "MultiPolygon"):
            raise ValueError("Context feature has missing or non-polygon geometry")
        coords = geometry.get("coordinates")
        if not _valid_polygon_coordinates(geometry["type"], coords):
            raise ValueError("Context feature has empty geometry")
        ids.append(stable_id)
    if len(set(ids)) != len(ids):
        raise ValueError("Context response contains non-unique stable IDs")
    canonical = json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return {"feature_count": len(features), "ids": ids, "sha256": hashlib.sha256(canonical).hexdigest()}


def _valid_polygon_coordinates(kind, coordinates):
    if not isinstance(coordinates, list) or not coordinates:
        return False
    polygons = [coordinates] if kind == "Polygon" else coordinates
    if kind == "MultiPolygon" and not all(isinstance(polygon, list) for polygon in polygons):
        return False
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            return False
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4:
                return False
            points = []
            for position in ring:
                if (not isinstance(position, list) or len(position) < 2
                        or not all(isinstance(value, (int, float)) and math.isfinite(value)
                                   for value in position[:2])):
                    return False
                points.append(position[:2])
            if points[0] != points[-1]:
                return False
    return True
