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

CONTEXT_EDITION = "2026"
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


def acquire_context(cache_root, bbox, *, refresh=False, fetch=_http_fetch):
    """Fetch dated hits + one complete frame response, stage and promote atomically."""
    bbox_value = ",".join(format(float(value), ".12g") for value in bbox) + "," + CONTEXT_CRS
    identity_seed = json.dumps({"edition": CONTEXT_EDITION, "type": CONTEXT_TYPE,
        "bbox": list(map(float, bbox)), "crs": CONTEXT_CRS}, sort_keys=True, separators=(",", ":"))
    identity = hashlib.sha256(identity_seed.encode()).hexdigest()
    root = Path(cache_root) / identity
    pointer_path = root / "current.json"
    if not refresh and pointer_path.is_file():
        try:
            pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
            generation = pointer["generation"]
            if not isinstance(generation, str) or Path(generation).name != generation:
                raise ValueError("invalid context generation pointer")
            generation_dir = root / "generations" / generation
            manifest = json.loads((generation_dir / "manifest.json").read_text(encoding="utf-8"))
            data_path = generation_dir / "context.geojson"
            data = data_path.read_bytes()
            doc = json.loads(data)
            validate_response(doc, expected=manifest["matched"], requested_bbox=bbox)
            if (pointer.get("identity") == identity and manifest.get("identity") == identity
                    and hashlib.sha256(data).hexdigest() == manifest.get("sha256")):
                return data_path, manifest
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
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
    staging = Path(tempfile.mkdtemp(prefix=".context-stage-", dir=root))
    try:
        (staging / "context.geojson").write_bytes(response)
        manifest = {"schema": 1, "identity": identity, "source": CONTEXT_ENDPOINT,
            "product": CONTEXT_TYPE, "edition": CONTEXT_EDITION, "bbox": list(map(float, bbox)),
            "crs": CONTEXT_CRS, "matched": matched, "returned": evidence["feature_count"],
            "unique_ids": len(evidence["ids"]), "service_sha256": evidence["sha256"],
            "service_timestamp": service_timestamp,
            "request": {"service": "WFS", "version": "2.0.0", "bbox": bbox_value,
                        "typeNames": CONTEXT_TYPE, "count": CONTEXT_CAPACITY,
                        "outputFormat": "application/json", "srsName": CONTEXT_CRS},
            "sha256": hashlib.sha256(response).hexdigest()}
        (staging / "manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
        generation_id = hashlib.sha256(response + os.urandom(16)).hexdigest()[:32]
        generation_dir = root / "generations" / generation_id
        os.replace(staging, generation_dir)
        pointer_tmp = root / (".current-" + generation_id + ".tmp")
        pointer_tmp.write_text(json.dumps({"identity": identity, "generation": generation_id}), encoding="utf-8")
        os.replace(pointer_tmp, pointer_path)
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
        stable_id = props.get("cleabs") or item.get("id")
        if not isinstance(stable_id, str) or not stable_id.strip():
            raise ValueError("Context feature has no stable unique ID")
        if not isinstance(props.get("code_insee"), str) or not props["code_insee"]:
            raise ValueError("Context feature is missing code_insee")
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
