"""Read current producer-owned serving generations for publisher/API smokes."""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from pathlib import PurePosixPath, PureWindowsPath

import pandas as pd


def _md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# These are transport inventories, not domain facts. They mirror the existing
# owner contracts in pipeline/R/publish_typed_reading_artifact.R and
# publish_series.R; the unit test below checks that those producer contracts
# have not drifted. Keep file names fixed rather than trusting manifest paths.
_TYPED_ARTIFACT_CONTRACTS = {
    ("typed-reading-serving", "typed-reading"): {
        "economie": (("facts", "source"), ()),
        "demographie": (("facts",), ("descriptor",)),
        "habitat": (("facts", "vintage"), ()),
        "milieux": (("facts", "source_bindings", "population_revisions"), ()),
    },
    ("series-serving", "owned-series"): {
        "conso_enaf_annuel": (("points", "provenance", "point_provenance"),
                              ("dataset_id", "descriptor")),
        "artif_par_habitant": (("points", "provenance", "point_provenance"),
                               ("dataset_id", "descriptor", "excluded")),
        "prix_m2": (("points", "provenance", "point_provenance"),
                    ("dataset_id", "descriptor")),
        "raccordement_courbe": (("points", "provenance", "point_provenance",
                                 "named_reference", "named_reference_descriptors",
                                 "named_reference_provenance", "vintage"),
                                ("dataset_id", "descriptor", "dataset_name", "excluded")),
    },
}

_SCALAR_ARTIFACT_OWNERS = frozenset({"demographie", "economie", "habitat", "mobilite"})
_SCALAR_ARTIFACT_FILES = {
    "facts": "facts.parquet",
    "descriptors": "descriptors.json",
    "provenance": "provenance.parquet",
    "datasets": "datasets.parquet",
    "vintages": "vintages.parquet",
    "eligible_territories": "eligible_territories.parquet",
}
_MD5_RE = re.compile(r"^[a-f0-9]{32}$")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _safe_flat_name(value: object) -> bool:
    return (isinstance(value, str) and bool(value) and value not in {".", ".."} and
            "\x00" not in value and "/" not in value and "\\" not in value and
            ":" not in value and not PurePosixPath(value).is_absolute() and
            not PureWindowsPath(value).is_absolute())


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        _require(key not in result, f"Duplicate JSON field: {key}")
        result[key] = value
    return result


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_unique_object)


def _read_json_object(path: Path) -> dict:
    value = _read_json(path)
    _require(isinstance(value, dict), f"Expected a JSON object: {path.name}")
    return value


def _owner_directory(root: Path, family_directory: str, owner: str) -> Path:
    _require(_safe_flat_name(family_directory) and _safe_flat_name(owner),
             "Artifact family and owner must be flat names")
    root = Path(root).resolve(strict=True)
    family = (root / family_directory).resolve(strict=True)
    _require(family.parent == root and family.name == family_directory and family.is_dir(),
             "Artifact family directory escapes its root")
    directory = (family / owner).resolve(strict=True)
    _require(directory.parent == family and directory.name == owner and directory.is_dir(),
             "Artifact owner directory escapes its family")
    return directory


def _resolve_flat_file(directory: Path, name: str) -> Path:
    _require(_safe_flat_name(name), "Artifact file name is not a flat path")
    directory = directory.resolve(strict=True)
    path = (directory / name).resolve(strict=True)
    _require(path.parent == directory and path.name == name and path.is_file(),
             f"Artifact file escapes its generation: {name}")
    return path


def _resolve_generation(directory: Path, name: str) -> Path:
    _require(_safe_flat_name(name), "Artifact generation name is not a flat path")
    directory = directory.resolve(strict=True)
    generation = (directory / name).resolve(strict=True)
    _require(generation.parent == directory and generation.name == name and generation.is_dir(),
             "Artifact generation escapes its owner directory")
    return generation


def _artifact_version(named_hashes: list[tuple[str, str]]) -> str:
    """Match the R transport digest: MD5 of ordered `name=MD5(file)` lines."""
    payload = "".join(f"{name}={digest}{os.linesep}" for name, digest in named_hashes)
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


def _artifact_version_candidates(named_hashes: list[tuple[str, str]]) -> set[str]:
    # R's writeLines uses the host text newline. Artifacts can be copied between
    # Windows and Unix hosts, so accept either exact producer serialization.
    return {
        hashlib.md5("".join(f"{name}={digest}{newline}" for name, digest in named_hashes)
                    .encode("utf-8")).hexdigest()
        for newline in ("\n", "\r\n")
    }


def _validate_typed_manifest(manifest: dict, family: str, owner: str,
                             table_fields: tuple[str, ...],
                             json_fields: tuple[str, ...]) -> list[str]:
    _require(set(manifest) == {"family", "owner", "storage_version", "semantic_version",
                              "table_fields", "json_fields", "projection_fields",
                              "table_schemas", "json_schemas", "row_names", "files", "hashes"},
             "Typed artifact manifest contains unknown fields")
    expected_files = [*(f"{field}.parquet" for field in table_fields),
                      *(f"{field}.json" for field in json_fields)]
    _require(all(_safe_flat_name(field) for field in (*table_fields, *json_fields)) and
             all(_safe_flat_name(name) for name in expected_files),
             "Producer inventory contains a non-flat artifact name")
    _require(manifest.get("family") == family and manifest.get("owner") == owner,
             "Typed artifact manifest owner/family mismatch")
    _require(manifest.get("table_fields") == list(table_fields),
             "Typed artifact table inventory mismatch")
    _require(manifest.get("json_fields") == list(json_fields),
             "Typed artifact JSON inventory mismatch")
    _require(manifest.get("files") == expected_files,
             "Typed artifact file inventory mismatch")
    hashes = manifest.get("hashes")
    _require(isinstance(hashes, dict) and set(hashes) == set(expected_files) and
             all(isinstance(value, str) and _MD5_RE.fullmatch(value) for value in hashes.values()),
             "Typed artifact checksum inventory mismatch")
    projection_fields = manifest.get("projection_fields")
    _require(isinstance(projection_fields, list) and
             all(isinstance(field, str) for field in projection_fields) and
             set(projection_fields) == set((*table_fields, *json_fields)) and
             len(projection_fields) == len(set(projection_fields)),
             "Typed artifact projection inventory mismatch")
    return expected_files


def _checked_hashes(directory: Path, names: list[str], hashes: dict[str, str],
                    version_names: list[str]) -> tuple[dict[str, Path], set[str]]:
    # Resolve and confine every producer-inventoried file before hashing any of
    # them; no manifest-supplied path is ever joined to the generation.
    paths = {name: _resolve_flat_file(directory, name) for name in names}
    actual_hashes = {}
    for name in names:
        actual_hashes[name] = _md5(paths[name])
        _require(actual_hashes[name] == hashes[name], f"Artifact checksum mismatch: {name}")
    named_hashes = [(version_name, actual_hashes[file_name])
                    for version_name, file_name in zip(version_names, names)]
    return paths, _artifact_version_candidates(named_hashes)


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
    _require(isinstance(directory_family, str) and isinstance(artifact_family, str) and
             isinstance(owner, str), "Typed artifact family and owner must be strings")
    contract = _TYPED_ARTIFACT_CONTRACTS.get((directory_family, artifact_family), {}).get(owner)
    _require(contract is not None, "Unknown typed artifact family or owner")
    table_fields, json_fields = contract
    directory = _owner_directory(root, directory_family, owner)
    pointer = _read_json_object(_resolve_flat_file(directory, "current.json"))
    storage_version = pointer.get("storage_version")
    semantic_version = pointer.get("semantic_version")
    _require(set(pointer) == {"family", "owner", "generation", "storage_version", "semantic_version"} and
             pointer.get("family") == artifact_family and pointer.get("owner") == owner and
             isinstance(storage_version, str) and _MD5_RE.fullmatch(storage_version) and
             isinstance(semantic_version, str) and bool(semantic_version) and
             pointer.get("generation") == f"generation-{storage_version}",
             "Typed artifact pointer is invalid")
    generation_name = f"generation-{storage_version}"
    generation = _resolve_generation(directory, generation_name)
    manifest = _read_json_object(_resolve_flat_file(generation, "manifest.json"))
    files = _validate_typed_manifest(manifest, artifact_family, owner, table_fields, json_fields)
    _require(manifest.get("storage_version") == storage_version and
             manifest.get("semantic_version") == semantic_version,
             "Typed artifact pointer/manifest version mismatch")
    hashes = manifest["hashes"]
    _require({entry.name for entry in generation.iterdir()} == {"manifest.json", *files},
             "Typed artifact generation contains unlisted files")
    checked, computed_versions = _checked_hashes(generation, files, hashes, files)
    _require(storage_version in computed_versions,
             "Typed artifact storage version does not match its file inventory")
    projection = {
        field: pd.read_parquet(checked[f"{field}.parquet"])
        for field in table_fields
    }
    projection.update({
        field: _read_json(checked[f"{field}.json"])
        for field in json_fields
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
    _require(isinstance(owner, str) and owner in _SCALAR_ARTIFACT_OWNERS,
             "Unknown scalar artifact owner")
    directory = _owner_directory(root, "scalar-serving", owner)
    pointer = _read_json_object(_resolve_flat_file(directory, "scalar-current.json"))
    version = pointer.get("version")
    _require(set(pointer) == {"grain", "version", "generation"} and
             pointer.get("grain") == "scalar" and isinstance(version, str) and
             _MD5_RE.fullmatch(version) and pointer.get("generation") == f"scalar-{version}",
             "Scalar artifact pointer is invalid")
    generation_name = f"scalar-{version}"
    generation = _resolve_generation(directory, generation_name)
    manifest = _read_json_object(_resolve_flat_file(generation, "manifest.json"))
    _require(set(manifest) == {"grain", "version", "files", "hashes",
                              "descriptor_list_columns", "table_schemas"} and
             manifest.get("grain") == "scalar" and manifest.get("version") == version and
             manifest.get("files") == _SCALAR_ARTIFACT_FILES,
             "Scalar artifact manifest owner/version/file inventory mismatch")
    hashes = manifest.get("hashes")
    _require(isinstance(hashes, dict) and set(hashes) == set(_SCALAR_ARTIFACT_FILES) and
             all(isinstance(value, str) and _MD5_RE.fullmatch(value) for value in hashes.values()),
             "Scalar artifact checksum inventory mismatch")
    table_fields = tuple(field for field in _SCALAR_ARTIFACT_FILES if field != "descriptors")
    table_schemas = manifest.get("table_schemas")
    _require(isinstance(table_schemas, dict) and set(table_schemas) == set(table_fields),
             "Scalar artifact table schema inventory mismatch")
    names = list(_SCALAR_ARTIFACT_FILES.values())
    version_names = list(_SCALAR_ARTIFACT_FILES)
    _require({entry.name for entry in generation.iterdir()} == {"manifest.json", *names},
             "Scalar artifact generation contains unlisted files")
    checked, computed_versions = _checked_hashes(
        generation, names,
        {name: hashes[field] for field, name in _SCALAR_ARTIFACT_FILES.items()},
        version_names)
    _require(version in computed_versions,
             "Scalar artifact version does not match its file inventory")
    paths = {field: checked[name] for field, name in _SCALAR_ARTIFACT_FILES.items()}
    projection = {}
    for field, path in paths.items():
        if field == "descriptors":
            projection[field] = json.loads(path.read_text(encoding="utf-8"),
                                           object_pairs_hook=_unique_object)
        else:
            projection[field] = pd.read_parquet(path)
    return projection
