"""Unit checks for retained producer artifact readers; no API or database."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pandas as pd
import pytest

import producer_artifacts as artifacts

ROOT = Path(__file__).resolve().parents[3]
PIPELINE = ROOT / "pipeline"


def _md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def _scalar_fixture(root: Path, *, owner: str = "economie") -> tuple[Path, Path, Path]:
    directory = root / "scalar-serving" / owner
    directory.mkdir(parents=True)
    generation = directory / "scalar-pending"
    generation.mkdir()
    for field, name in artifacts._SCALAR_ARTIFACT_FILES.items():
        if field == "descriptors":
            (generation / name).write_text("[]", encoding="utf-8")
        else:
            pd.DataFrame({"field": [field]}).to_parquet(generation / name, index=False)
    version = artifacts._artifact_version([
        (field, _md5(generation / name))
        for field, name in artifacts._SCALAR_ARTIFACT_FILES.items()])
    generation.rename(directory / f"scalar-{version}")
    generation = directory / f"scalar-{version}"
    table_fields = [field for field in artifacts._SCALAR_ARTIFACT_FILES if field != "descriptors"]
    manifest = {
        "grain": "scalar", "version": version,
        "files": artifacts._SCALAR_ARTIFACT_FILES,
        "hashes": {field: _md5(generation / name)
                   for field, name in artifacts._SCALAR_ARTIFACT_FILES.items()},
        "descriptor_list_columns": [],
        "table_schemas": {field: {} for field in table_fields},
    }
    (generation / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    pointer = {"grain": "scalar", "version": version, "generation": generation.name}
    pointer_path = directory / "scalar-current.json"
    pointer_path.write_text(json.dumps(pointer), encoding="utf-8")
    return directory, generation, pointer_path


def _track_reads(monkeypatch):
    accessed: list[Path] = []
    original_read_text = Path.read_text
    original_md5 = artifacts._md5
    original_read_parquet = pd.read_parquet

    def read_text(path, *args, **kwargs):
        accessed.append(path.resolve())
        return original_read_text(path, *args, **kwargs)

    def md5(path):
        accessed.append(path.resolve())
        return original_md5(path)

    def read_parquet(path, *args, **kwargs):
        accessed.append(Path(path).resolve())
        return original_read_parquet(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_text)
    monkeypatch.setattr(artifacts, "_md5", md5)
    monkeypatch.setattr(pd, "read_parquet", read_parquet)
    return accessed


def test_reads_valid_scalar_inventory(tmp_path):
    root = tmp_path / "scalar"
    _scalar_fixture(root)
    scalar = artifacts.read_scalar_artifact(root, "economie")
    assert set(scalar) == set(artifacts._SCALAR_ARTIFACT_FILES)
    assert scalar["descriptors"] == []


def test_scalar_rejects_unlisted_path_before_opening_it(tmp_path, monkeypatch):
    root = tmp_path / "scalar"
    _, generation, _ = _scalar_fixture(root)
    outside = tmp_path / "outside.parquet"
    pd.DataFrame({"secret": [1]}).to_parquet(outside, index=False)
    manifest_path = generation / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"]["facts"] = str(outside)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    accessed = _track_reads(monkeypatch)
    with pytest.raises(ValueError, match="file inventory"):
        artifacts.read_scalar_artifact(root, "economie")
    assert outside.resolve() not in accessed
    assert all(path == outside.resolve() or path.is_relative_to(root.resolve()) for path in accessed)


def test_scalar_rejects_version_directory_mismatch(tmp_path):
    root = tmp_path / "scalar"
    _, _, pointer_path = _scalar_fixture(root)
    pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    pointer["generation"] = "scalar-" + "0" * 32
    pointer_path.write_text(json.dumps(pointer), encoding="utf-8")
    with pytest.raises(ValueError, match="pointer"):
        artifacts.read_scalar_artifact(root, "economie")


def test_retired_typed_reading_transport_is_not_registered(tmp_path):
    with pytest.raises(ValueError, match="Unknown"):
        artifacts.read_typed_artifact(tmp_path, "typed-reading-serving", "typed-reading", "demographie")
    with pytest.raises(ValueError, match="Unknown"):
        artifacts.read_scalar_artifact(tmp_path, "../outside")


def test_python_inventories_and_versions_match_r_producer_contracts(tmp_path):
    rscript = shutil.which("Rscript")
    if not rscript:
        pytest.skip("Rscript is unavailable for the producer-contract compatibility check")
    file_a = tmp_path / "a.parquet"
    file_b = tmp_path / "b.json"
    file_a.write_bytes(b"first transport fixture\n")
    file_b.write_bytes(b"second transport fixture\n")
    script = tmp_path / "read-producer-contracts.R"
    script.write_text("""source('R/publish_typed_artifact.R')
source('R/publish_series.R')
source('R/publish_scalar_artifact.R')
source('R/publish_retained_scalar_snapshot.R')
as_contract <- function(x) list(table_fields=as.list(x$table_fields),
  json_fields=as.list(x$json_fields))
series_owners <- c('conso_enaf_annuel','artif_par_habitant','prix_m2','raccordement_courbe')
series <- stats::setNames(lapply(series_owners, function(owner)
  as_contract(owned_series_artifact_fields(owner))), series_owners)
scalar_paths <- c(Sys.getenv('LUSK_TEST_HASH_A'), Sys.getenv('LUSK_TEST_HASH_B'))
names(scalar_paths) <- c('facts','descriptors')
result <- list(series=series,
  scalar_owners=as.list(retained_scalar_artifact_owners('inst/extdata/theme-metadata')),
  scalar_files=as.list(scalar_artifact_files),
  scalar_hash=scalar_artifact_digest(scalar_paths))
cat(jsonlite::toJSON(result, auto_unbox=TRUE, null='null'))
""", encoding="utf-8")
    environment = os.environ.copy()
    environment["LUSK_TEST_HASH_A"] = str(file_a)
    environment["LUSK_TEST_HASH_B"] = str(file_b)
    completed = subprocess.run(
        [rscript, "--vanilla", str(script)], cwd=PIPELINE, env=environment,
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    actual = json.loads(completed.stdout)
    series_expected = {
        owner: {"table_fields": list(fields[0]), "json_fields": list(fields[1])}
        for (directory, family), owners in artifacts._TYPED_ARTIFACT_CONTRACTS.items()
        if directory == "series-serving"
        for owner, fields in owners.items()
    }
    assert actual["series"] == series_expected
    assert set(actual["scalar_owners"]) == artifacts._SCALAR_ARTIFACT_OWNERS
    assert actual["scalar_files"] == artifacts._SCALAR_ARTIFACT_FILES
    assert actual["scalar_hash"] == artifacts._artifact_version([
        ("facts", _md5(file_a)), ("descriptors", _md5(file_b))])
