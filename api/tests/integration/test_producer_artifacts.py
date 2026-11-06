"""Unit checks for the test-only producer artifact reader; no API or database."""
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


def _digest(names: list[tuple[str, Path]]) -> str:
    rows = "".join(f"{name}={_md5(path)}{os.linesep}" for name, path in names)
    return hashlib.md5(rows.encode("utf-8")).hexdigest()


def _typed_fixture(root: Path, *, owner: str = "demographie") -> tuple[Path, Path, Path]:
    family, artifact_family = "typed-reading-serving", "typed-reading"
    table_fields, json_fields = artifacts._TYPED_ARTIFACT_CONTRACTS[(family, artifact_family)][owner]
    directory = root / family / owner
    directory.mkdir(parents=True)
    generation = directory / "generation-pending"
    generation.mkdir()
    files = [*(f"{field}.parquet" for field in table_fields),
             *(f"{field}.json" for field in json_fields)]
    for field in table_fields:
        pd.DataFrame({"territory_id": ["T1"], "field": [field]}).to_parquet(
            generation / f"{field}.parquet", index=False)
    for field in json_fields:
        (generation / f"{field}.json").write_text(json.dumps({"field": field}), encoding="utf-8")
    version = _digest([(name, generation / name) for name in files])
    generation.rename(directory / f"generation-{version}")
    generation = directory / f"generation-{version}"
    manifest = {
        "family": artifact_family,
        "owner": owner,
        "storage_version": version,
        "semantic_version": "semantic-fixture-v1",
        "table_fields": list(table_fields),
        "json_fields": list(json_fields),
        "projection_fields": [*table_fields, *json_fields],
        "table_schemas": {field: {} for field in table_fields},
        "json_schemas": {field: {} for field in json_fields},
        "row_names": {field: None for field in table_fields},
        "files": files,
        "hashes": {name: _md5(generation / name) for name in files},
    }
    (generation / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    pointer = {
        "family": artifact_family,
        "owner": owner,
        "generation": generation.name,
        "storage_version": version,
        "semantic_version": manifest["semantic_version"],
    }
    pointer_path = directory / "current.json"
    pointer_path.write_text(json.dumps(pointer), encoding="utf-8")
    return directory, generation, pointer_path


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
    version = _digest([(field, generation / name)
                       for field, name in artifacts._SCALAR_ARTIFACT_FILES.items()])
    generation.rename(directory / f"scalar-{version}")
    generation = directory / f"scalar-{version}"
    table_fields = [field for field in artifacts._SCALAR_ARTIFACT_FILES if field != "descriptors"]
    manifest = {
        "grain": "scalar",
        "version": version,
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


def test_reads_valid_fixed_typed_and_scalar_inventories(tmp_path):
    typed_root = tmp_path / "typed"
    _, _, _ = _typed_fixture(typed_root)
    typed = artifacts.read_typed_reading_artifact(typed_root, "demographie")
    assert list(typed) == ["facts", "descriptor"]
    assert typed["facts"].iloc[0]["territory_id"] == "T1"
    assert typed["descriptor"] == {"field": "descriptor"}

    scalar_root = tmp_path / "scalar"
    _scalar_fixture(scalar_root)
    scalar = artifacts.read_scalar_artifact(scalar_root, "economie")
    assert set(scalar) == set(artifacts._SCALAR_ARTIFACT_FILES)
    assert scalar["descriptors"] == []


@pytest.mark.parametrize("attack", [
    "../outside.json",
    "C:\\outside.json",
    "C:outside.json",
    "//server/share/outside.json",
    "\\\\server\\share\\outside.json",
    "descriptor/../outside.json",
    "descriptor\\..\\outside.json",
])
def test_typed_rejects_manifest_paths_before_opening_them(tmp_path, monkeypatch, attack):
    root = tmp_path / "typed"
    _, generation, _ = _typed_fixture(root)
    outside = tmp_path / "outside.json"
    outside.write_text('{"secret": true}', encoding="utf-8")
    manifest_path = generation / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"][-1] = attack
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    accessed = _track_reads(monkeypatch)

    with pytest.raises(ValueError, match="inventory"):
        artifacts.read_typed_reading_artifact(root, "demographie")

    assert outside.resolve() not in accessed
    assert all(path == outside.resolve() or path.is_relative_to(root.resolve()) for path in accessed)


@pytest.mark.parametrize("field_kind", ["table_fields", "json_fields"])
@pytest.mark.parametrize("attack", [
    "../outside",
    "C:\\outside",
    "C:outside",
    "//server/share/outside",
    "\\\\server\\share\\outside",
    "descriptor/../outside",
    "descriptor\\..\\outside",
])
def test_typed_rejects_pathlike_field_inventory_before_reads(
        tmp_path, monkeypatch, field_kind, attack):
    root = tmp_path / "typed"
    _, generation, _ = _typed_fixture(root)
    outside = tmp_path / "outside.json"
    outside.write_text('{"secret": true}', encoding="utf-8")
    manifest_path = generation / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest[field_kind] = [attack]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    accessed = _track_reads(monkeypatch)

    with pytest.raises(ValueError, match="inventory"):
        artifacts.read_typed_reading_artifact(root, "demographie")

    assert outside.resolve() not in accessed
    assert all(path.is_relative_to(root.resolve()) for path in accessed)


@pytest.mark.parametrize("field_kind", ["table", "json"])
def test_typed_rejects_self_consistent_traversal_inventory_before_external_read(
        tmp_path, monkeypatch, field_kind):
    root = tmp_path / "typed"
    owner_directory, generation, _ = _typed_fixture(root)
    field = "../outside"
    outside_name = "outside.parquet" if field_kind == "table" else "outside.json"
    outside = owner_directory / outside_name
    if field_kind == "table":
        pd.DataFrame({"secret": ["outside-generation"]}).to_parquet(outside, index=False)
    else:
        outside.write_text('{"secret": "outside-generation"}', encoding="utf-8")
    manifest_path = generation / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if field_kind == "table":
        manifest["table_fields"] = [field]
        manifest["projection_fields"] = [field, "descriptor"]
        manifest["table_schemas"] = {field: {}}
        manifest["row_names"] = {field: None}
        files = ["../outside.parquet", "descriptor.json"]
    else:
        manifest["json_fields"] = [field]
        manifest["projection_fields"] = ["facts", field]
        manifest["json_schemas"] = {field: {}}
        files = ["facts.parquet", "../outside.json"]
    manifest["files"] = files
    manifest["hashes"] = {
        files[0]: _md5(outside if field_kind == "table" else generation / files[0]),
        files[1]: _md5(outside if field_kind == "json" else generation / files[1]),
    }
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    accessed = _track_reads(monkeypatch)

    with pytest.raises(ValueError, match="inventory"):
        artifacts.read_typed_reading_artifact(root, "demographie")

    assert outside.resolve() not in accessed
    assert outside.parent == generation.parent


@pytest.mark.parametrize("change", ["missing", "extra", "duplicate"])
def test_typed_requires_exact_unique_file_inventory(tmp_path, change):
    root = tmp_path / "typed"
    _, generation, _ = _typed_fixture(root)
    manifest_path = generation / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if change == "missing":
        manifest["files"].pop()
    elif change == "extra":
        manifest["files"].append("extra.json")
    else:
        manifest["files"][-1] = manifest["files"][0]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="file inventory"):
        artifacts.read_typed_reading_artifact(root, "demographie")


def test_typed_rejects_unknown_owner_and_family_before_path_lookup(tmp_path):
    with pytest.raises(ValueError, match="Unknown"):
        artifacts.read_typed_reading_artifact(tmp_path, "../outside")
    with pytest.raises(ValueError, match="Unknown"):
        artifacts.read_typed_artifact(tmp_path, "scalar-serving", "typed-reading", "economie")
    with pytest.raises(ValueError, match="Unknown"):
        artifacts.read_scalar_artifact(tmp_path, "../outside")


@pytest.mark.parametrize("mismatch", ["pointer_semantic", "manifest_storage", "pointer_generation"])
def test_typed_rejects_pointer_manifest_and_generation_mismatch(tmp_path, mismatch):
    root = tmp_path / "typed"
    _, generation, pointer_path = _typed_fixture(root)
    pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    manifest_path = generation / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if mismatch == "pointer_semantic":
        pointer["semantic_version"] = "other-semantic-v2"
        pointer_path.write_text(json.dumps(pointer), encoding="utf-8")
    elif mismatch == "manifest_storage":
        manifest["storage_version"] = "0" * 32
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    else:
        pointer["generation"] = "../outside"
        pointer_path.write_text(json.dumps(pointer), encoding="utf-8")

    with pytest.raises(ValueError, match="version|pointer"):
        artifacts.read_typed_reading_artifact(root, "demographie")


def test_typed_rejects_content_version_not_derived_from_hashed_files(tmp_path):
    root = tmp_path / "typed"
    _, generation, _ = _typed_fixture(root)
    pd.DataFrame({"territory_id": ["T2"], "field": ["changed"]}).to_parquet(
        generation / "facts.parquet", index=False)
    manifest_path = generation / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["hashes"]["facts.parquet"] = _md5(generation / "facts.parquet")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="storage version"):
        artifacts.read_typed_reading_artifact(root, "demographie")


def test_typed_accepts_r_storage_version_from_other_host_newline(tmp_path):
    root = tmp_path / "typed"
    _, generation, pointer_path = _typed_fixture(root)
    manifest_path = generation / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    named_hashes = [(name, manifest["hashes"][name]) for name in manifest["files"]]
    alternate_version = next(iter(artifacts._artifact_version_candidates(named_hashes)
                                   - {pointer["storage_version"]}))
    renamed = generation.with_name(f"generation-{alternate_version}")
    generation.rename(renamed)
    manifest["storage_version"] = alternate_version
    (renamed / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    pointer["storage_version"] = alternate_version
    pointer["generation"] = renamed.name
    pointer_path.write_text(json.dumps(pointer), encoding="utf-8")

    assert artifacts.read_typed_reading_artifact(root, "demographie")["descriptor"] == {
        "field": "descriptor"}


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


@pytest.mark.parametrize("escape", ["file", "generation"])
def test_typed_rejects_symlink_escape_before_external_reads(tmp_path, monkeypatch, escape):
    root = tmp_path / "typed"
    owner, generation, _ = _typed_fixture(root)
    outside = tmp_path / "outside"
    outside.mkdir()
    if escape == "file":
        outside_file = outside / "facts.parquet"
        shutil.copyfile(generation / "facts.parquet", outside_file)
        (generation / "facts.parquet").unlink()
        link = generation / "facts.parquet"
        target_is_directory = False
    else:
        outside_file = outside / generation.name
        shutil.copytree(generation, outside_file)
        shutil.rmtree(generation)
        link = generation
        target_is_directory = True
    try:
        link.symlink_to(outside_file, target_is_directory=target_is_directory)
    except (OSError, NotImplementedError) as error:
        pytest.skip(f"symlink creation is unavailable: {error}")
    accessed = _track_reads(monkeypatch)

    with pytest.raises(ValueError, match="escapes"):
        artifacts.read_typed_reading_artifact(root, "demographie")

    assert outside_file.resolve() not in accessed
    assert all(path == outside_file.resolve() or path.is_relative_to(root.resolve()) for path in accessed)


def test_python_inventories_and_versions_match_r_producer_contracts(tmp_path):
    rscript = shutil.which("Rscript")
    if not rscript:
        pytest.skip("Rscript is unavailable for the producer-contract compatibility check")

    file_a = tmp_path / "a.parquet"
    file_b = tmp_path / "b.json"
    file_a.write_bytes(b"first transport fixture\n")
    file_b.write_bytes(b"second transport fixture\n")
    script = tmp_path / "read-producer-contracts.R"
    script.write_text(
        """source('R/publish_typed_artifact.R')
source('R/publish_typed_reading_artifact.R')
source('R/publish_series.R')
source('R/publish_scalar_artifact.R')
source('R/publish_retained_scalar_snapshot.R')
as_contract <- function(x) list(table_fields=as.list(x$table_fields),
  json_fields=as.list(x$json_fields))
typed <- lapply(typed_reading_artifact_contracts(), as_contract)
series_owners <- c('conso_enaf_annuel','artif_par_habitant','prix_m2','raccordement_courbe')
series <- stats::setNames(lapply(series_owners, function(owner)
  as_contract(owned_series_artifact_fields(owner))), series_owners)
typed_paths <- c(Sys.getenv('LUSK_TEST_HASH_A'), Sys.getenv('LUSK_TEST_HASH_B'))
names(typed_paths) <- c('facts.parquet','descriptor.json')
scalar_paths <- c(Sys.getenv('LUSK_TEST_HASH_A'), Sys.getenv('LUSK_TEST_HASH_B'))
names(scalar_paths) <- c('facts','descriptors')
result <- list(typed=typed, series=series,
  scalar_owners=as.list(retained_scalar_artifact_owners('inst/extdata/theme-metadata')),
  scalar_files=as.list(scalar_artifact_files),
  typed_hash=typed_artifact_hash(typed_paths),
  scalar_hash=scalar_artifact_digest(scalar_paths))
cat(jsonlite::toJSON(result, auto_unbox=TRUE, null='null'))
""",
        encoding="utf-8",
    )
    environment = os.environ.copy()
    environment["LUSK_TEST_HASH_A"] = str(file_a)
    environment["LUSK_TEST_HASH_B"] = str(file_b)
    completed = subprocess.run(
        [rscript, "--vanilla", str(script)], cwd=PIPELINE, env=environment,
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    actual = json.loads(completed.stdout)

    typed_expected = {
        owner: {"table_fields": list(fields[0]), "json_fields": list(fields[1])}
        for (directory, family), owners in artifacts._TYPED_ARTIFACT_CONTRACTS.items()
        if directory == "typed-reading-serving"
        for owner, fields in owners.items()
    }
    series_expected = {
        owner: {"table_fields": list(fields[0]), "json_fields": list(fields[1])}
        for (directory, family), owners in artifacts._TYPED_ARTIFACT_CONTRACTS.items()
        if directory == "series-serving"
        for owner, fields in owners.items()
    }
    assert actual["typed"] == typed_expected
    assert actual["series"] == series_expected
    assert set(actual["scalar_owners"]) == artifacts._SCALAR_ARTIFACT_OWNERS
    assert actual["scalar_files"] == artifacts._SCALAR_ARTIFACT_FILES
    assert actual["typed_hash"] == artifacts._artifact_version([
        ("facts.parquet", _md5(file_a)), ("descriptor.json", _md5(file_b))])
    assert actual["scalar_hash"] == artifacts._artifact_version([
        ("facts", _md5(file_a)), ("descriptors", _md5(file_b))])
