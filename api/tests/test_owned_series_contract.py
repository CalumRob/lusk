from pathlib import Path
import json
import re
import pytest
from fastapi import HTTPException

from api.main import ReadRepository, _complete_owned_mean_curve, _theme_owned_series_indicator, app


def test_theme_owned_series_indicator_preserves_nullable_axis_metadata_and_point_coordinates():
    source = {"source_name": "Canonical source", "vintage": "2025"}
    categorical = _theme_owned_series_indicator(
        {"indicator_id": "subventions_annuelles", "label": "Aides", "unit": "€",
         "axis_values": ["2020", "2021"], "axis_numeric_values": None},
        {"axis": "2021", "value": 0, "status": "measured", "provenance": [source],
         "observation_period": "2021"},
    )
    assert categorical["dimensions"] == {"axis": "2021", "numeric_axis_value": None,
        "observation_period": "2021"}
    assert categorical["value"] == 0
    assert categorical["sources"] == [{**source, "name": "Canonical source"}]

    numeric = _theme_owned_series_indicator(
        {"indicator_id": "prix_m2", "label": "Prix", "unit": "€/m²",
         "axis_values": ["2024", "2025"], "axis_numeric_values": [2024, 2025]},
        {"axis": "2025", "value": 525, "status": "measured", "provenance": []},
    )
    assert numeric["dimensions"] == {"axis": "2025", "numeric_axis_value": 2025}


def test_raccordement_selected_mean_is_equal_weighted_and_requires_complete_zero_inclusive_curves():
    def row(member, axis, value, reason=None):
        parts=[None]*29
        parts[15]=member; parts[16]=value; parts[17]="measured"; parts[18]="rev"
        parts[27]=axis; parts[28]=reason
        return tuple(parts)
    members=["a","b","c"]
    rows=[row("a","t0000",.6),row("b","t0000",0,"no_modeled_endpoint_stops"),row("c","t0000",.3),
          row("a","t0005",.9),row("b","t0005",0,"no_modeled_endpoint_stops"),row("c","t0005",.6)]
    points, facts=_complete_owned_mean_curve(["t0000","t0005"],members,rows,
        territory_index=15,value_index=16,status_index=17,source_index=18,axis_index=27,reason_index=28)
    assert [point["value"] for point in points] == pytest.approx([.3,.5])
    assert len(facts)==6
    with pytest.raises(HTTPException, match="incomplete"):
        _complete_owned_mean_curve(["t0000","t0005"],members,rows[:-1],
            territory_index=15,value_index=16,status_index=17,source_index=18,axis_index=27,reason_index=28)
    no_lineage=row("b","t0000",0); no_lineage=list(no_lineage); no_lineage[18]=None
    with pytest.raises(HTTPException, match="provenance"):
        _complete_owned_mean_curve(["t0000"],members,[row("a","t0000",.6),tuple(no_lineage),row("c","t0000",.3)],
            territory_index=15,value_index=16,status_index=17,source_index=18,axis_index=27,reason_index=28)


def test_raccordement_mean_rejects_member_reason_that_changes_across_curve_axes():
    def row(axis, reason):
        parts=[None]*29
        parts[15]="a"; parts[16]=0; parts[17]="measured"; parts[18]="rev"
        parts[27]=axis; parts[28]=reason
        return tuple(parts)
    with pytest.raises(HTTPException, match="reason conflicts"):
        _complete_owned_mean_curve(["t0000","t0005"],["a"],
            [row("t0000","no_modeled_endpoint_stops"),row("t0005","endpoint_stops_but_no_permitted_first_boarding")],
            territory_index=15,value_index=16,status_index=17,source_index=18,axis_index=27,reason_index=28)

def test_owned_series_reader_serves_prix_m2_year_axis_and_point_vintage():
    class Cursor:
        def __init__(self, rows): self.rows = rows
        def fetchone(self): return self.rows[0] if self.rows else None
        def fetchall(self): return self.rows
    class Transaction:
        def __enter__(self): return self
        def __exit__(self, *args): return False
    class Connection:
        def transaction(self): return Transaction()
        def execute(self, sql, params=()):
            if sql.startswith("SET TRANSACTION"): return Cursor([])
            if "FROM series_dataset_publication" in sql: return Cursor([("prix-v1", "ref-v1", 2, "2026-10-01T00:00:00Z")])
            if "FROM table_publication" in sql: return Cursor([("ref-v1",)])
            if "FROM series_dataset_descriptor" in sql:
                assert params == ("dvf_prix_m2", "prix_m2")
                return Cursor([("year", ["2021", "2022", "2023", "2024", "2025"], "may_be_missing", "2025",
                    "Médiane prix au m²", "€/m²", "low", ["commune", "epci", "departement"], "1")])
            if "SELECT name,territory_type,department_id,epci_id" in sql: return Cursor([("Commune A1", "commune", "22", "epci-a")])
            if "SELECT t.territory_id FROM territory_reference" in sql: return Cursor([("22001",)])
            if "SELECT territory_id FROM territory_reference WHERE territory_type='commune'" in sql:
                return Cursor([("22001",)])
            if "SELECT territory_id,territory_type,density_class_code FROM territory_reference WHERE territory_id" in sql:
                return Cursor([("22001","commune","d1")])
            if "SELECT territory_id,territory_type,department_id,epci_id,density_class_code FROM territory_reference" in sql:
                return Cursor([("22001","commune","22","epci-a","d1")])
            if "FROM series_dataset_observation" in sql:
                return Cursor([
                    ("22001", "Commune A1", "commune", "2024", None, "2024", None, "missing",
                     "rev-2025", "dvf_2025_dep22", "2025", "Étalab", "DVF", "2025", "2025-12-31", "2026-05-18", "hash-2025"),
                    ("22001", "Commune A1", "commune", "2025", None, "2025", 525.0, "measured",
                     "rev-2025", "dvf_2025_dep22", "2025", "Étalab", "DVF", "2025", "2025-12-31", "2026-05-18", "hash-2025"),
                ])
            raise AssertionError(sql)
    class Connections:
        def connection(self):
            class Context:
                def __enter__(self): return Connection()
                def __exit__(self, *args): return False
            return Context()

    read = ReadRepository(Connections()).read_owned_series(
        "dvf_prix_m2", "commune", "22001", "prix_m2", "commune", "22", None)
    assert read["dataset_id"] == "dvf_prix_m2"
    assert [point["axis"] for point in read["points"]] == ["2024", "2025"]
    assert [(point["value"], point["status"]) for point in read["points"]] == [(None, "missing"), (525.0, "measured")]
    assert all(point["observation_period"] == point["axis"] for point in read["points"])
    assert all(point["provenance"][0]["version"] == "2025" for point in read["points"])
    assert read["comparison"]["point"] == "2025"


def test_owned_series_reader_rejects_consistent_published_superset(monkeypatch):
    from api import main

    class Cursor:
        def __init__(self, rows=()): self.rows=list(rows)
        def fetchone(self): return self.rows[0] if self.rows else None
        def fetchall(self): return self.rows
    class Transaction:
        def __enter__(self): return self
        def __exit__(self, *args): return False
    class Connection:
        def transaction(self): return Transaction()
        def execute(self, sql, params=()):
            if sql.startswith("SET TRANSACTION"): return Cursor()
            if "FROM series_dataset_publication" in sql: return Cursor([("v1", "ref", 1, "now")])
            if "FROM table_publication" in sql: return Cursor([("ref",)])
            if "FROM series_dataset_descriptor" in sql:
                return Cursor([("year", ["2024"], "may_be_missing", "2024", "Series", "u", "high",
                    ["commune"], "1", "median", "default_group")])
            if "SELECT name,territory_type,department_id,epci_id" in sql:
                return Cursor([("A", "commune", "22", "e")])
            if "SELECT t.territory_id FROM territory_reference" in sql:
                return Cursor([("a",), ("b",)])
            if "FROM series_dataset_observation" in sql:
                return Cursor([("a", "A", "commune", "2024", None, "2024", 1, "measured",
                    "rev", "s", "v", "source", "dataset", "1", None, None, "hash", None)])
            if "FROM ordered_series_comparison_publication" in sql:
                return Cursor([("comparison-v1", "v1", "ref", 1, 3)])
            if "FROM ordered_series_comparison_group" in sql:
                return Cursor([("2024", "median", 1, 3, 3, 0)])
            if "FROM ordered_series_comparison_territory" in sql:
                return Cursor([("2024", member, 1, "measured", 1, 1, 3)
                    for member in ("a", "b", "extra")])
            raise AssertionError(sql)
    class Connections:
        def connection(self):
            class Context:
                def __enter__(self): return Connection()
                def __exit__(self, *args): return False
            return Context()

    monkeypatch.setattr(main, "_comparison_cohort", lambda *args: ("commune", ("a", "b"),
        {"kind": "density_class", "density_class_code": "d1"}))
    monkeypatch.setattr(main, "_fixed_scalar_comparison_context", lambda *args: ("density_class", "d1", "commune"))
    with pytest.raises(HTTPException) as error:
        ReadRepository(Connections()).read_owned_series("dataset", "commune", "a", "indicator",
            "commune", None, None)
    assert error.value.status_code == 503

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
    for table, columns in {
        "ordered_series_comparison_publication": ("ordered_series_content_version", "reference_content_version", "content_version"),
        "ordered_series_comparison_group": ("axis_value", "statistic", "group_value", "member_count", "eligible_count", "missing_count"),
        "ordered_series_comparison_territory": ("axis_value", "territory_id", "value", "status", "rank", "tie_count", "rank_size"),
    }.items():
        statement=fresh.split(f"CREATE TABLE {table}",1)[1].split(";",1)[0]
        assert all(re.search(rf"\b{column}\b",statement) for column in columns)
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
        def __init__(self): self.queries=[]; self.no_comparison=False; self.missing_marker=False; self.stale_source=False; self.stale_reference=False; self.incomplete_comparison=False
        def transaction(self): return Tx()
        def execute(self, sql, params=()):
            self.queries.append((sql,params))
            if sql.startswith("SET TRANSACTION"): return Cursor([])
            if "FROM series_dataset_publication" in sql:
                return Cursor([("ocsge_v1","ref1",1,"2026-09-30T00:00:00Z")])
            if "FROM ordered_series_comparison_publication" in sql:
                return Cursor([] if self.missing_marker else [("cmp-v1","wrong-source" if self.stale_source else "ocsge_v1",
                    "wrong-reference" if self.stale_reference else "ref1",8,10)])
            if "FROM ordered_series_comparison_group" in sql:
                context=params[2]; ids={"density_class":["35238","35239","35240","22001","35241"],
                    "epci":["35238","35239"],"bretagne":["35238","35239","35240","22001","35241"]}[context]
                rows=[("M2","median",0.0,len(ids),len(ids),0),
                    ("M3","median",50.0,len(ids),len(ids)-int(context in ("density_class","bretagne")),
                        int(context in ("density_class","bretagne")))]
                return Cursor(rows[:1] if self.incomplete_comparison else rows)
            if "FROM ordered_series_comparison_territory" in sql:
                context=params[2]
                ids={"density_class":["35238","35239","35240","22001","35241"],
                    "epci":["35238","35239"],"bretagne":["35238","35239","35240","22001","35241"]}[context]
                values={"35238":50.0,"35239":50.0,"35240":70.0,"22001":10.0,"35241":None}
                rows=[]
                for axis in ("M2","M3"):
                    eligible=[0.0]*len(ids) if axis=="M2" else [values[i] for i in ids if values[i] is not None]
                    for peer in ids:
                        value=0.0 if axis=="M2" else values[peer]
                        rank=1+sum(v>value for v in eligible) if value is not None else None
                        ties=eligible.count(value) if value is not None else None
                        rows.append((axis,peer,value,"missing" if value is None else "measured",rank,ties,len(eligible) if value is not None else None))
                return Cursor(rows)
            if "SELECT territory_id FROM territory_reference WHERE territory_type='region'" in sql:
                return Cursor([("53",)])
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
            if "SELECT territory_id FROM territory_reference WHERE territory_type='commune'" in sql:
                department, _, epci, _ = params[:4]
                if epci: return Cursor([("35238",),("35239",)])
                if department: return Cursor([("35238",),("35239",),("35240",)])
                return Cursor([("35238",),("35239",),("35240",),("22001",),("35241",)])
            if "SELECT territory_id,territory_type,density_class_code FROM territory_reference WHERE territory_id" in sql:
                return Cursor([("35238","commune","d1")])
            if "SELECT territory_id,epci_id,density_class_code" in sql and "territory_type='commune'" in sql:
                return Cursor([(i,"243500139" if i in ("35238","35239") else "other","d1")
                    for i in ("35238","35239","35240","22001","35241")])
            if "SELECT territory_id,territory_type,department_id,epci_id,density_class_code FROM territory_reference" in sql:
                return Cursor([(i,"commune","35" if i.startswith("35") else "22",
                    "243500139" if i in ("35238","35239") else "other","d1")
                    for i in ("35238","35239","35240","22001","35241")])
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
    connections.connection_value.queries.clear()
    repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
        "commune","35",None)
    assert not any("ordered_series_comparison_" in q for q,_ in connections.connection_value.queries)
    connections.connection_value.queries.clear()
    density=repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
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
    assert density["comparison"]["comparable_count"] == 4
    assert density["comparison"]["rank"] == 2 and density["comparison"]["ties"] == 2
    assert density["comparison"]["median"] == 50.0
    assert epci["comparison"]["median"] != density["comparison"]["median"] or epci["comparison"]["comparable_count"] != density["comparison"]["comparable_count"]
    assert epci["publication_id"] == "ocsge_v1"
    assert epci["points"][0]["value"] == 0.0
    assert "rank_epci" not in epci["points"][0]
    facet=next(p for p in epci["scope_series"][0]["points"] if p["axis"]=="2025")
    assert facet["comparison_rank"] == 1 and facet["comparison_ties"] == 2
    assert epci["scope_series"][1]["points"][1]["value"] == 50.0
    missing=next(p for p in density["scope_series"][-1]["points"] if p["axis"]=="2025")
    assert missing["status"] == "missing" and missing["comparison_rank"] is None
    connections.connection_value.no_comparison=True
    no_comparison=repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
        "commune","35",None)
    assert no_comparison["comparison"] is None
    assert all("comparison_rank" not in point for territory in no_comparison["scope_series"] for point in territory["points"])
    sql=" ".join(q for q,_ in connections.connection_value.queries)
    assert "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY" in sql
    assert "WHERE dataset_id=%s AND indicator_id=%s" in sql
    assert any("FROM ordered_series_comparison_publication" in q for q,_ in connections.connection_value.queries)
    assert any("FROM ordered_series_comparison_territory" in q for q,_ in connections.connection_value.queries)
    # Department-filtered explicit selections were exercised above without querying fixed tables.
    connections.connection_value.queries.clear(); connections.connection_value.no_comparison=False
    connections.connection_value.stale_source=True
    with pytest.raises(HTTPException,match="missing or stale"):
        repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
            "commune",None,"243500139")
    connections.connection_value.stale_source=False; connections.connection_value.stale_reference=False
    connections.connection_value.incomplete_comparison=True
    with pytest.raises(HTTPException,match="incomplete"):
        repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
            "commune",None,"243500139")
    connections.connection_value.incomplete_comparison=False; connections.connection_value.no_comparison=False
    connections.connection_value.missing_marker=True
    with pytest.raises(HTTPException,match="missing or stale"):
        repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
            "commune",None,"243500139")
    connections.connection_value.stale_source=False; connections.connection_value.stale_reference=True
    with pytest.raises(HTTPException,match="missing or stale"):
        repository.read_owned_series("ocsge_artif_etats","commune","35238","artif_par_habitant",
            "commune",None,"243500139")
