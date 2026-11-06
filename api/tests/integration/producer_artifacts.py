"""Read current producer-owned serving generations for publisher/API smokes."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd


def _md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def records(table: pd.DataFrame | list[dict]) -> list[dict]:
    """Return JSON-like records while preserving nulls and source dates."""
    result = []
    rows = table.to_dict(orient="records") if isinstance(table, pd.DataFrame) else table
    for row in rows:
        normalized = {}
        for key, value in row.items():
            missing = pd.isna(value)
            if isinstance(missing, bool) or getattr(missing, "ndim", None) == 0:
                if bool(missing):
                    normalized[key] = None
                    continue
            if value is None:
                normalized[key] = None
            elif hasattr(value, "isoformat"):
                normalized[key] = value.isoformat()
            elif hasattr(value, "item"):
                normalized[key] = value.item()
            else:
                normalized[key] = value
        result.append(normalized)
    return result


def read_typed_artifact(root: Path, directory_family: str, artifact_family: str, owner: str) -> dict:
    """Read and validate one current ``write_typed_artifact`` generation."""
    directory = root / directory_family / owner
    pointer = json.loads((directory / "current.json").read_text(encoding="utf-8"))
    assert pointer["family"] == artifact_family and pointer["owner"] == owner
    generation = (directory / pointer["generation"]).resolve()
    assert generation.parent == directory.resolve()
    manifest = json.loads((generation / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["family"] == artifact_family and manifest["owner"] == owner
    assert pointer["storage_version"] == manifest["storage_version"]
    assert pointer["semantic_version"] == manifest["semantic_version"]
    files = manifest["files"]
    expected_files = {
        *[f"{field}.parquet" for field in manifest.get("table_fields", [])],
        *[f"{field}.json" for field in manifest.get("json_fields", [])],
    }
    assert set(files) == expected_files
    assert set(manifest["hashes"]) == expected_files
    for name, expected_hash in manifest["hashes"].items():
        path = generation / name
        assert path.is_file() and _md5(path) == expected_hash
    projection = {
        field: pd.read_parquet(generation / f"{field}.parquet")
        for field in manifest["table_fields"]
    }
    projection.update({
        field: json.loads((generation / f"{field}.json").read_text(encoding="utf-8"))
        for field in manifest["json_fields"]
    })
    return projection


def read_typed_reading_artifact(root: Path, owner: str) -> dict:
    """Read the current owner-scoped selected-reading producer artifact."""
    return read_typed_artifact(root, "typed-reading-serving", "typed-reading", owner)


def read_owned_series_artifact(root: Path, owner: str) -> dict:
    """Read the current owner-scoped owned-series producer artifact."""
    return read_typed_artifact(root, "series-serving", "owned-series", owner)


def read_scalar_artifact(root: Path, owner: str) -> dict:
    """Read one current owner-scoped scalar generation and check its file hashes."""
    directory = root / "scalar-serving" / owner
    pointer = json.loads((directory / "scalar-current.json").read_text(encoding="utf-8"))
    assert pointer["grain"] == "scalar"
    assert pointer["generation"] == f"scalar-{pointer['version']}"
    generation = (directory / pointer["generation"]).resolve()
    assert generation.parent == directory.resolve()
    manifest = json.loads((generation / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["grain"] == "scalar" and manifest["version"] == pointer["version"]
    assert set(manifest["files"]) == set(manifest["hashes"])
    projection = {}
    for field, name in manifest["files"].items():
        path = generation / name
        assert path.is_file() and _md5(path) == manifest["hashes"][field]
        if field == "descriptors":
            projection[field] = json.loads(path.read_text(encoding="utf-8"))
        else:
            projection[field] = pd.read_parquet(path)
    return projection
