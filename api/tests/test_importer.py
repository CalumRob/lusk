import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from api.importer import ImportError, import_publication, load_publication


def artifacts(tmp_path: Path, *, values=None):
    metadata = tmp_path / "theme_mobilite.json"
    keys = [f"share_{service}_{mode}" for service in ("food", "health") for mode in "tbc"]
    theme = {
        "theme": "mobilite",
        "subgroups": [{"key": "access", "indicators": keys + ["iso_food"]}],
        "sources": {key: "accessibility" for key in keys},
        "indicator_labels": {key: key for key in keys},
        "indicator_directions": {},
    }
    metadata.write_text(json.dumps(theme), encoding="utf-8")
    territories = [{"territoire": "22001", "nom": "Exemple", "departement": "22", "epci": "200000001",
                    "classe_densite_code": "5", "classe_densite_libelle_public": "Bourg"}]
    vintages = [{"id": "accessibility", "source": "Exemple source", "version": "2026-01",
                 "date_reference": "2026-01-01", "date_publication": "2026-02-01", "licence": "odbl"}]
    values = values or {"food_t": .2, "food_b": .7, "food_c": .95, "health_t": None, "health_b": .4, "health_c": .9}
    rows = []
    for service in ("food", "health"):
        for mode in "tbc":
            key = f"share_{service}_{mode}"
            rows.append({"territoire": "22001", "type": "commune", "theme": "mobilite", "key": key,
                         "detail": None, "value": values[f"{service}_{mode}"], "unit": "%",
                         "vintage_source": "Exemple source", "vintage_version": "2026-01",
                         "vintage_date_reference": "2026-01-01", "vintage_date_publication": "2026-02-01"})
    for name, data in (("territoires.parquet", territories), ("indicateurs_mobilite.parquet", rows),
                       ("vintages.parquet", vintages)):
        pq.write_table(pa.Table.from_pylist(data), tmp_path / name)
    return tmp_path, metadata


def test_loader_maps_metadata_to_service_rows_and_keeps_null(tmp_path):
    root, metadata = artifacts(tmp_path)
    publication = load_publication(root, metadata)
    assert {(r.service, r.mode, r.share) for r in publication.rows} == {
        ("food", "walk_transit", .2), ("food", "bike", .7), ("food", "car", .95),
        ("health", "walk_transit", None), ("health", "bike", .4), ("health", "car", .9),
    }
    assert publication.rows[0].source_id == "accessibility"
    assert publication.rows[0].territory_type == "commune"


def test_digest_covers_all_parquet_and_metadata_bytes(tmp_path):
    root, metadata = artifacts(tmp_path)
    original = load_publication(root, metadata).publication_id
    theme = json.loads(metadata.read_text(encoding="utf-8"))
    theme["indicator_directions"]["share_food_t"] = "low"
    metadata.write_text(json.dumps(theme), encoding="utf-8")
    changed = load_publication(root, metadata)
    assert changed.publication_id != original
    assert next(r for r in changed.rows if r.service == "food" and r.mode == "walk_transit").effective_direction == "low"


@pytest.mark.parametrize("subgroup", [{"key": " ", "indicators": []}, {"indicators": []}])
def test_loader_rejects_invalid_subgroup_metadata(tmp_path, subgroup):
    root, metadata = artifacts(tmp_path)
    theme = json.loads(metadata.read_text(encoding="utf-8"))
    theme["subgroups"] = [subgroup]
    metadata.write_text(json.dumps(theme), encoding="utf-8")
    with pytest.raises(ImportError, match="subgroup"):
        load_publication(root, metadata)


def test_loader_rejects_incomplete_triptych(tmp_path):
    root, metadata = artifacts(tmp_path)
    pq.write_table(pq.read_table(root / "indicateurs_mobilite.parquet").slice(0, 5), root / "indicateurs_mobilite.parquet")
    with pytest.raises(ImportError, match="triptych"):
        load_publication(root, metadata)


def test_invalid_publication_fails_before_database_transaction(tmp_path):
    root, metadata = artifacts(tmp_path)
    pq.write_table(pq.read_table(root / "indicateurs_mobilite.parquet").slice(0, 5), root / "indicateurs_mobilite.parquet")

    class UntouchedDatabase:
        def transaction(self):
            raise AssertionError("invalid source data must not reach the database")

    with pytest.raises(ImportError, match="triptych"):
        import_publication(UntouchedDatabase(), root, metadata)


@pytest.mark.parametrize("bad", [-0.01, 1.01, float("nan")])
def test_loader_rejects_invalid_shares(tmp_path, bad):
    root, metadata = artifacts(tmp_path, values={"food_t": bad, "food_b": .7, "food_c": .95,
                                                  "health_t": None, "health_b": .4, "health_c": .9})
    with pytest.raises(ImportError, match="0..1"):
        load_publication(root, metadata)
