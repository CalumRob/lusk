import json
import sys
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

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
        "indicator_directions": {key: "high" for key in keys},
        "comparison_scopes": {"bretagne": {"kind": "communes-bretagne", "label": "communes bretonnes"}},
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


def building_artifacts(tmp_path: Path):
    root, metadata = artifacts(tmp_path)
    theme = json.loads(metadata.read_text(encoding="utf-8"))
    theme["building_comparison"] = {"statistic": "mean", "direction": "high"}
    metadata.write_text(json.dumps(theme), encoding="utf-8")
    territories_path = root / "territoires.parquet"
    territories = pq.read_table(territories_path).to_pylist()
    territories.append({**territories[0], "territoire": "22002"})
    pq.write_table(pa.Table.from_pylist(territories), territories_path)
    facts_path = root / "indicateurs_mobilite.parquet"
    facts = pq.read_table(facts_path).to_pylist()
    pq.write_table(pa.Table.from_pylist(facts + [{**row, "territoire": "22002"} for row in facts]), facts_path)
    vintages_path = root / "vintages.parquet"
    vintages = pq.read_table(vintages_path).to_pylist()
    vintages.append({**vintages[0], "id": "snapshot", "source": "Building source"})
    pq.write_table(pa.Table.from_pylist(vintages), vintages_path)
    common = dict(type="commune", availability="complete", source_id="snapshot",
                  source="Building source", version="2026-01", date_reference="2026-01-01",
                  date_publication="2026-02-01")
    ramp = [dict(common, territoire=code, total_buildings=count, mode=mode,
                 quantile=position / 10, accessible_types=position + offset)
            for code, count, offset in (("22001", 2, 0), ("22002", 6, 10))
            for mode in "cbt" for position in range(11)]
    grid = [dict(common, territoire=code, total_buildings=count, mode="t",
                 breadth_bucket=breadth, depth_bucket=depth,
                 building_count=count if breadth == "0" and depth == "0" else 0)
            for code, count in (("22001", 2), ("22002", 6))
            for breadth in ("0", "1-9", "10-24", "25-39", "40-53")
            for depth in ("0", "1-9", "10-49", "50-199", "200-499", "500+")]
    pq.write_table(pa.Table.from_pylist(ramp), root / "rampe_acces_batiments.parquet")
    pq.write_table(pa.Table.from_pylist(grid), root / "distribution_acces_batiments.parquet")
    return root, metadata


def test_joint_building_publisher_validates_both_grains_and_fingerprints_mean_direction(tmp_path):
    root, metadata = building_artifacts(tmp_path)
    publication = load_publication(root, metadata)
    assert len(publication.building_ramp) == 66
    assert len(publication.building_grid) == 60
    assert publication.building_direction == "high"
    ramp_path = root / "rampe_acces_batiments.parquet"
    ramp = pq.read_table(ramp_path).to_pylist()
    ramp[-1]["accessible_types"] = 20.5
    pq.write_table(pa.Table.from_pylist(ramp), ramp_path)
    assert load_publication(root, metadata).publication_id != publication.publication_id
    theme = json.loads(metadata.read_text(encoding="utf-8"))
    theme["building_comparison"]["direction"] = "low"
    metadata.write_text(json.dumps(theme), encoding="utf-8")
    assert load_publication(root, metadata).publication_id != publication.publication_id


def test_joint_building_publisher_rejects_partial_artifacts_before_database_transaction(tmp_path):
    root, metadata = building_artifacts(tmp_path)
    path = root / "rampe_acces_batiments.parquet"
    pq.write_table(pq.read_table(path).slice(0, 65), path)

    class UntouchedDatabase:
        def transaction(self):
            raise AssertionError("partial building curves must not reach the database")

    with pytest.raises(ImportError, match="Incomplete canonical building-access"):
        import_publication(UntouchedDatabase(), root, metadata)


def test_joint_refresh_replaces_building_facts_and_access_under_one_publication(tmp_path):
    root, metadata = building_artifacts(tmp_path)

    class Cursor:
        def __init__(self): self.calls = []
        def execute(self, sql, params=None): self.calls.append((sql, params))
        def executemany(self, sql, params): self.calls.append((sql, list(params)))
        def fetchone(self): return None
        def __enter__(self): return self
        def __exit__(self, *_): return False

    class Connection:
        def __init__(self): self.cur = Cursor()
        def transaction(self): return self.cur
        def cursor(self): return self.cur

    connection = Connection()
    publication = import_publication(connection, root, metadata)
    calls = connection.cur.calls
    def index(fragment):
        return next(i for i, (sql, _) in enumerate(calls) if fragment in sql)
    assert index("DELETE FROM building_ramp") < index("INSERT INTO territory_reference")
    assert index("DELETE FROM building_grid") < index("INSERT INTO territory_reference")
    assert index("INSERT INTO territory_reference") < index("INSERT INTO building_ramp")
    markers = [(sql, params) for sql, params in calls if "INSERT INTO dataset_publication" in sql]
    assert len(markers) == 2
    assert all(params[0] == publication.publication_id for _, params in markers)
    assert any("building_access" in sql for sql, _ in markers)


def test_loader_maps_metadata_to_service_rows_and_keeps_null(tmp_path):
    root, metadata = artifacts(tmp_path)
    publication = load_publication(root, metadata)
    assert {(r.service, r.mode, r.share) for r in publication.rows} == {
        ("food", "walk_transit", .2), ("food", "bike", .7), ("food", "car", .95),
        ("health", "walk_transit", None), ("health", "bike", .4), ("health", "car", .9),
    }
    assert publication.rows[0].source_id == "accessibility"
    assert publication.rows[0].territory_type == "commune"


def test_fingerprint_tracks_served_direction(tmp_path):
    root, metadata = artifacts(tmp_path)
    original = load_publication(root, metadata).publication_id
    theme = json.loads(metadata.read_text(encoding="utf-8"))
    theme["indicator_directions"]["share_food_t"] = "low"
    metadata.write_text(json.dumps(theme), encoding="utf-8")
    changed = load_publication(root, metadata)
    assert changed.publication_id != original
    assert next(r for r in changed.rows if r.service == "food" and r.mode == "walk_transit").effective_direction == "low"


def test_fingerprint_ignores_other_pipeline_datasets_and_parquet_encoding(tmp_path):
    root, metadata = artifacts(tmp_path)
    original = load_publication(root, metadata).publication_id
    path = root / "indicateurs_mobilite.parquet"
    other_indicator = {**pq.read_table(path).to_pylist()[0], "key": "iso_food", "value": 0.9}
    pq.write_table(pa.Table.from_pylist(pq.read_table(path).to_pylist() + [other_indicator]), path,
                   compression="zstd")
    vintages = root / "vintages.parquet"
    pq.write_table(pa.Table.from_pylist(pq.read_table(vintages).to_pylist() + [{
        "id": "unrelated", "source": "Other", "version": "new",
        "date_reference": "2026-02-01", "date_publication": "2026-03-01", "licence": "other",
    }]), vintages)
    assert load_publication(root, metadata).publication_id == original


def test_fingerprint_changes_when_served_share_changes(tmp_path):
    root, metadata = artifacts(tmp_path)
    original = load_publication(root, metadata).publication_id
    path = root / "indicateurs_mobilite.parquet"
    rows = pq.read_table(path).to_pylist()
    next(row for row in rows if row["key"] == "share_food_t")["value"] = 0.4
    pq.write_table(pa.Table.from_pylist(rows), path)
    assert load_publication(root, metadata).publication_id != original


def test_fingerprint_tracks_served_source_vintage(tmp_path):
    root, metadata = artifacts(tmp_path)
    original = load_publication(root, metadata).publication_id
    facts = root / "indicateurs_mobilite.parquet"
    rows = pq.read_table(facts).to_pylist()
    for row in rows:
        row["vintage_version"] = "2026-02"
    pq.write_table(pa.Table.from_pylist(rows), facts)
    vintages = root / "vintages.parquet"
    versions = pq.read_table(vintages).to_pylist()
    versions[0]["version"] = "2026-02"
    pq.write_table(pa.Table.from_pylist(versions), vintages)

    updated = load_publication(root, metadata)
    assert updated.publication_id != original
    assert {row.source_version for row in updated.rows} == {"2026-02"}


def test_missing_pipeline_direction_is_not_guessed(tmp_path):
    root, metadata = artifacts(tmp_path)
    theme = json.loads(metadata.read_text(encoding="utf-8"))
    del theme["indicator_directions"]["share_food_t"]
    metadata.write_text(json.dumps(theme), encoding="utf-8")
    with pytest.raises(ImportError, match="pipeline direction"):
        load_publication(root, metadata)


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


def test_database_guard_uses_current_service_registry_for_full_cross_product():
    schema = (Path(__file__).resolve().parents[1] / "schema.sql").read_text(encoding="utf-8")
    assert "CROSS JOIN service_registry" in schema
    assert "HAVING count(a.mode) <> 3" in schema
    assert "('food'" not in schema and "('health'" not in schema
    importer = Path(__file__).resolve().parents[1].joinpath("importer.py").read_text(encoding="utf-8")
    assert "INSERT INTO service_registry" in importer


def test_importer_publishes_changed_comparison_label_to_current_table(tmp_path):
    root, metadata = artifacts(tmp_path)
    theme = json.loads(metadata.read_text(encoding="utf-8"))
    theme["comparison_scopes"]["bretagne"]["label"] = "label publié pour cette version"
    metadata.write_text(json.dumps(theme), encoding="utf-8")

    class Cursor:
        def __init__(self):
            self.calls = []
        def execute(self, query, params=None):
            self.calls.append((query, params))
        def executemany(self, query, params):
            self.calls.append((query, list(params)))
        def fetchone(self):
            return None
        def __enter__(self):
            return self
        def __exit__(self, *_):
            return False

    class Connection:
        def __init__(self):
            self.cur = Cursor()
        class Transaction:
            def __enter__(self):
                return None
            def __exit__(self, *_):
                return False
        def transaction(self):
            return self.Transaction()
        def cursor(self):
            return self.cur

    connection = Connection()
    publication = import_publication(connection, root, metadata)
    metadata_insert = next(params for query, params in connection.cur.calls
                           if "INSERT INTO dataset_publication" in query)
    assert metadata_insert == (publication.publication_id, len(publication.rows),
                               "communes-bretagne", "label publié pour cette version")


@pytest.mark.parametrize("new_id", [None, "22002"])
def test_reference_refresh_upserts_identities_and_only_prunes_stale_ids(tmp_path, new_id):
    root, metadata = artifacts(tmp_path)
    if new_id:
        territory_file = root / "territoires.parquet"
        territories = pq.read_table(territory_file).to_pylist()
        territories[0]["territoire"] = new_id
        pq.write_table(pa.Table.from_pylist(territories), territory_file)
        facts_file = root / "indicateurs_mobilite.parquet"
        facts = pq.read_table(facts_file).to_pylist()
        for row in facts:
            row["territoire"] = new_id
        pq.write_table(pa.Table.from_pylist(facts), facts_file)

    class Cursor:
        def __init__(self):
            self.calls = []
        def execute(self, query, params=None):
            self.calls.append((query, params))
        def executemany(self, query, params):
            self.calls.append((query, list(params)))
        def fetchone(self):
            return None
        def __enter__(self):
            return self
        def __exit__(self, *_):
            return False

    class Connection:
        def __init__(self):
            self.cur = Cursor()
        class Transaction:
            def __enter__(self):
                return None
            def __exit__(self, *_):
                return False
        def transaction(self):
            return self.Transaction()
        def cursor(self):
            return self.cur

    connection = Connection()
    import_publication(connection, root, metadata)
    reference_upsert = next((query, params) for query, params in connection.cur.calls
                            if "INSERT INTO territory_reference" in query)
    query, rows = reference_upsert
    assert "ON CONFLICT (territory_id) DO UPDATE" in query
    assert rows[0][0] == (new_id or "22001")
    stale_delete = next((query, params) for query, params in connection.cur.calls
                        if "DELETE FROM territory_reference" in query)
    assert "territory_id = ANY(%s)" in stale_delete[0]
    assert stale_delete[1] == ([new_id or "22001"],)
    assert not any(query.strip() == "DELETE FROM territory_reference"
                   for query, _ in connection.cur.calls)


def test_independent_reference_foreign_key_aborts_before_mutation(tmp_path):
    root, metadata = artifacts(tmp_path)

    class Cursor:
        def __init__(self):
            self.calls = []
        def execute(self, query, params=None):
            self.calls.append(query)
        def executemany(self, query, params):
            self.calls.append(query)
        def fetchone(self):
            if any("pg_constraint" in query for query in self.calls):
                return (True,)
            return None
        def __enter__(self):
            return self
        def __exit__(self, *_):
            return False

    class Connection:
        def __init__(self):
            self.cur = Cursor()
        class Transaction:
            def __enter__(self):
                return None
            def __exit__(self, *_):
                return False
        def transaction(self):
            return self.Transaction()
        def cursor(self):
            return self.cur

    connection = Connection()
    with pytest.raises(ImportError, match="independently published facts"):
        import_publication(connection, root, metadata)
    assert not any("DELETE FROM essential_service_access" in query
                   for query in connection.cur.calls)


def test_invalid_publication_fails_before_database_transaction(tmp_path):
    root, metadata = artifacts(tmp_path)
    pq.write_table(pq.read_table(root / "indicateurs_mobilite.parquet").slice(0, 5), root / "indicateurs_mobilite.parquet")

    class UntouchedDatabase:
        def transaction(self):
            raise AssertionError("invalid source data must not reach the database")

    with pytest.raises(ImportError, match="triptych"):
        import_publication(UntouchedDatabase(), root, metadata)


def test_cli_uses_operator_pgpass_without_prompt_or_password_argument(tmp_path, monkeypatch, capsys):
    import psycopg
    import api.importer as importer

    passfile = tmp_path / "pgpass.conf"
    passfile.write_text("test:5432:lusk:publisher:secret", encoding="utf-8")
    monkeypatch.setenv("PGPASSFILE", str(passfile))
    monkeypatch.delenv("PUBLISH_DATABASE_URL", raising=False)
    monkeypatch.setattr(sys, "argv", ["api.importer", str(tmp_path), "--host", "test",
                                  "--database", "lusk", "--user", "publisher"])
    monkeypatch.setattr(importer.getpass, "getpass", lambda *_: pytest.fail("must not prompt"))
    monkeypatch.setattr(importer, "import_publication", lambda *_: SimpleNamespace(
        publication_id="dataset-snapshot", rows=(1, 2), changed=False))
    options = {}
    def connect(**kwargs):
        options.update(kwargs)
        return nullcontext(object())
    monkeypatch.setattr(psycopg, "connect", connect)

    importer.main()
    assert options == {"host": "test", "dbname": "lusk", "user": "publisher",
                       "passfile": str(passfile), "autocommit": True}
    assert "2 access observations unchanged" in capsys.readouterr().out


def test_cli_refuses_repository_pgpass(tmp_path, monkeypatch):
    import api.importer as importer

    inside_repo = Path(importer.__file__).resolve().parents[1] / "api" / "pgpass.conf"
    real_is_file = Path.is_file
    monkeypatch.setattr(Path, "is_file", lambda path: path == inside_repo or real_is_file(path))
    monkeypatch.setenv("PGPASSFILE", str(inside_repo))
    monkeypatch.delenv("PUBLISH_DATABASE_URL", raising=False)
    monkeypatch.setattr(sys, "argv", ["api.importer", str(tmp_path), "--host", "test",
                                  "--database", "lusk", "--user", "publisher"])
    with pytest.raises(SystemExit) as error:
        importer.main()
    assert error.value.code == 2


@pytest.mark.parametrize("bad", [-0.01, 1.01, float("nan")])
def test_loader_rejects_invalid_shares(tmp_path, bad):
    root, metadata = artifacts(tmp_path, values={"food_t": bad, "food_b": .7, "food_c": .95,
                                                  "health_t": None, "health_b": .4, "health_c": .9})
    with pytest.raises(ImportError, match="0..1"):
        load_publication(root, metadata)
