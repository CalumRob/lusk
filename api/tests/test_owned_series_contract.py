from pathlib import Path
import re

from api.main import ReadRepository, app

def test_owned_series_migration_is_additive_and_fresh_schema_matches():
    root = Path(__file__).resolve().parents[1]
    migration = (root / "migrations/011_owned_series_publications.sql").read_text()
    fresh = (root / "schema.sql").read_text()
    for token in (
        "series_provenance_revision", "series_dataset_publication",
        "series_dataset_descriptor", "series_dataset_observation",
        "series_observation_provenance",
    ):
        assert f"CREATE TABLE {token}" in migration
        assert f"CREATE TABLE {token}" in fresh
    assert "ALTER TABLE ordered_series" not in migration
    assert "DROP TABLE ordered_series" not in migration
    assert "DROP TABLE series_descriptor" not in migration
    assert "ON DELETE CASCADE" not in migration.split("CREATE TABLE series_provenance_revision", 1)[1].split("CREATE TABLE series_dataset_publication", 1)[0]
    # Provenance is a revisioned, immutable snapshot; readers can associate a
    # point with multiple revisions while owner-local publications have tokens.
    assert "UNIQUE(source_id, vintage_id, revision_hash)" in migration
    assert "PRIMARY KEY(dataset_id,indicator_id,territory_id,axis_value,provenance_revision_id)" in migration
    assert "reference_content_version" in migration and "published_at" in migration
    assert "comparison_point IS NOT NULL OR direction='none'" in migration
    # Existing ENAF API and legacy table publication remain available.
    executable = "\n".join(line for line in migration.splitlines() if not line.lstrip().startswith("--"))
    assert not re.search(r"(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?table_publication\b", executable, re.I)
    assert "series_descriptor" in fresh and "ordered_series" in fresh


def test_owned_reader_is_unit_scoped_snapshot_with_explicit_no_comparison():
    assert any(route.path == "/api/series-datasets/{dataset_id}/territories/{territory_type}/{territory_id}/{indicator_id}"
               for route in app.routes)
    class Cursor:
        def __init__(self, rows): self.rows = rows
        def fetchone(self): return self.rows[0] if self.rows else None
        def fetchall(self): return self.rows

    class Tx:
        def __enter__(self): return self
        def __exit__(self, *args): return False

    class Connection:
        def __init__(self): self.queries=[]
        def transaction(self): return Tx()
        def execute(self, sql, params=()):
            self.queries.append((sql,params))
            if sql.startswith("SET TRANSACTION"): return Cursor([])
            if "FROM series_dataset_publication" in sql:
                return Cursor([("ocsge_v1","ref1",1,"2026-09-30T00:00:00Z")])
            if "FROM table_publication" in sql: return Cursor([("ref1",)])
            if "FROM series_dataset_descriptor" in sql:
                assert params == ("ocsge_artif_etats","artif_par_habitant")
                return Cursor([("state_role",["M2","M3"],"may_be_missing",None,"État", "m²/hab","none",["commune"],"1")])
            if "FROM territory_reference" in sql: return Cursor([("Rennes","commune")])
            if "FROM series_dataset_observation" in sql:
                assert params[:3] == ("ocsge_artif_etats","artif_par_habitant","35238")
                return Cursor([("M2","2021-2025",0.0,"measured","rev-22-2021",
                    "ocsge_artificialisation_22_2021","2021","IGN","OCS-GE","2021",
                    "2021-01-01","2025-09-12","hash-a")])
            raise AssertionError(sql)
    class Connections:
        def __init__(self): self.connection_value=Connection()
        def connection(self):
            class Context:
                def __enter__(inner): return self.connection_value
                def __exit__(inner,*args): return False
            return Context()

    connections=Connections()
    response=ReadRepository(connections).read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant")
    assert response["comparison"] is None
    assert response["publication_id"] == "ocsge_v1"
    assert response["availability"] == "incomplete"
    assert response["points"][0]["value"] == 0.0
    assert response["points"][0]["provenance"][0]["source_id"] == "ocsge_artificialisation_22_2021"
    assert response["points"][1]["status"] == "missing"
    sql=" ".join(q for q,_ in connections.connection_value.queries)
    assert "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY" in sql
    assert "WHERE dataset_id=%s AND indicator_id=%s" in sql
