from pathlib import Path
import json
import re
import pytest
from fastapi import HTTPException

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
    assert "declared_detail" in migration and "state_role text" in migration
    assert "rank_epci integer" not in migration and "rank_department integer" not in migration
    # Existing ENAF API and legacy table publication remain available.
    executable = "\n".join(line for line in migration.splitlines() if not line.lstrip().startswith("--"))
    assert not re.search(r"(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?table_publication\b", executable, re.I)
    assert "series_descriptor" in fresh and "ordered_series" in fresh
    metadata = json.loads((root.parent / "pipeline/inst/extdata/theme-metadata/theme_milieux.json").read_text(encoding="utf-8"))
    page = metadata["indicator_pages"]["artif_par_habitant"]
    assert page["series_dataset_id"] == "ocsge_artif_etats"
    assert page["series_publication"] == "owned"
    assert page["comparison"]["detail"] in page["comparison"]["details"]


def test_owned_reader_is_unit_scoped_snapshot_with_canonical_facet_and_peers():
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
        def __init__(self): self.queries=[]; self.no_comparison=False
        def transaction(self): return Tx()
        def execute(self, sql, params=()):
            self.queries.append((sql,params))
            if sql.startswith("SET TRANSACTION"): return Cursor([])
            if "FROM series_dataset_publication" in sql:
                return Cursor([("ocsge_v1","ref1",1,"2026-09-30T00:00:00Z")])
            if "FROM table_publication" in sql: return Cursor([("ref1",)])
            if "FROM series_dataset_descriptor" in sql:
                assert params == ("ocsge_artif_etats","artif_par_habitant")
                return Cursor([("declared_detail",["M2","M3","2021","2025"],"may_be_missing",None if self.no_comparison else "2025","?tat", "m?/hab","none" if self.no_comparison else "low",["commune","epci","departement"],"1")])
            if "SELECT name,territory_type,department_id,epci_id" in sql:
                return Cursor([("Rennes","commune","35","243500139")])
            if "SELECT t.territory_id FROM territory_reference" in sql:
                department, epci = params[1], params[3]
                if epci: return Cursor([("35238",),("35239",)])
                if department: return Cursor([("35238",),("35239",),("35240",)])
                return Cursor([("35238",),("35239",),("35240",),("22001",),("35241",)])
            if "FROM series_dataset_observation" in sql:
                ids=params[2]
                values={"35238":50.0,"35239":50.0,"35240":70.0,"22001":10.0,"35241":None}
                result=[]
                for territory in ids:
                    val=values[territory]
                    for axis,role,value,status,source in (
                        ("2021","M2",0.0,"measured","ocsge_artificialisation_29_2021"),
                        ("2025","M3",val,"missing" if val is None else "measured","ocsge_artificialisation_29_2025"),
                    ):
                        result.append((territory,{"35238":"Rennes","35239":"Commune A","35240":"Commune B","22001":"Commune C","35241":"Commune D"}[territory],"commune",
                            axis,role,"2021-2025",value,status,
                            f"rev-{territory}-{axis}",source,axis,"IGN","OCS-GE",axis,"2021-01-01","2025-03-07",f"hash-{territory}-{axis}"))
                return Cursor(result)
            raise AssertionError(sql)
    class Connections:
        def __init__(self): self.connection_value=Connection()
        def connection(self):
            class Context:
                def __enter__(inner): return self.connection_value
                def __exit__(inner,*args): return False
            return Context()

    connections=Connections()
    repository=ReadRepository(connections)
    epci=repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
        "commune",None,"243500139")
    department=repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
        "commune","35",None)
    bretagne=repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
        "commune",None,None)
    assert epci["comparison_point"] == epci["comparison"]["point"] == "2025"
    with pytest.raises(HTTPException,match="descriptor comparison point"):
        repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
            "commune",None,"243500139","2021")
    assert epci["comparison"]["comparable_count"] == 2
    assert epci["comparison"]["rank"] == 1 and epci["comparison"]["ties"] == 2
    assert epci["comparison"]["median"] == 50.0
    assert department["comparison"]["comparable_count"] == 3
    assert department["comparison"]["median"] == 50.0
    assert bretagne["comparison"]["comparable_count"] == 4
    assert bretagne["comparison"]["rank"] == 2 and bretagne["comparison"]["ties"] == 2
    assert bretagne["comparison"]["median"] == 50.0
    assert epci["comparison"]["median"] != bretagne["comparison"]["median"] or epci["comparison"]["comparable_count"] != bretagne["comparison"]["comparable_count"]
    assert epci["publication_id"] == "ocsge_v1"
    assert epci["points"][0]["value"] == 0.0
    assert "rank_epci" not in epci["points"][0]
    facet=next(p for p in epci["scope_series"][0]["points"] if p["axis"]=="2025")
    assert facet["comparison_rank"] == 1 and facet["comparison_ties"] == 2
    assert epci["scope_series"][1]["points"][1]["value"] == 50.0
    missing=next(p for p in bretagne["scope_series"][-1]["points"] if p["axis"]=="2025")
    assert missing["status"] == "missing" and missing["comparison_rank"] is None
    connections.connection_value.no_comparison=True
    no_comparison=repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
        "commune","35",None)
    assert no_comparison["comparison"] is None
    assert all("comparison_rank" not in point for territory in no_comparison["scope_series"] for point in territory["points"])
    sql=" ".join(q for q,_ in connections.connection_value.queries)
    assert "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY" in sql
    assert "WHERE dataset_id=%s AND indicator_id=%s" in sql
