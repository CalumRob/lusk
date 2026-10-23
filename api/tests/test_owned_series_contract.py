from pathlib import Path
import json
import re
import pytest
from fastapi import HTTPException

from api.main import get_semantic_resource_reader
from api.resource_catalogue import default_resource_catalogue
from api.resource_requests import ResourceReadItem
from api import snapshot_reads
from api.snapshot_reads import _complete_owned_mean_curve
from api.main import app


def test_retired_theme_series_route_is_not_reintroduced():
    paths = app.openapi()["paths"]
    assert not any(path.startswith("/api/themes/") or path.startswith("/api/series-datasets/")
                   for path in paths)


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

def test_owned_series_snapshot_preserves_axis_lineage_references_and_optional_projection():
    class Cursor:
        def __init__(self, rows=()): self.rows = list(rows)
        def fetchone(self): return self.rows[0] if self.rows else None
        def fetchall(self): return self.rows

    class Connection:
        def __init__(self, *, reference_version="ref-v8", territory_type="commune"):
            self.calls = []
            self.reference_version = reference_version
            self.territory_type = territory_type
        def execute(self, sql, params=()):
            sql = " ".join(sql.split())
            self.calls.append((sql, params))
            if "to_regclass('observed_collection_descriptor')" in sql:
                return Cursor([(None,)])
            if "SELECT to_regclass" in sql:
                return Cursor([(True,)])
            if "SELECT 1 FROM scalar_descriptor" in sql or "SELECT 1 FROM profile_descriptor" in sql or "SELECT 1 FROM series_descriptor" in sql:
                return Cursor([])
            if "to_regclass('series_dataset_descriptor')" in sql:
                return Cursor([(True,)])
            if "FROM series_dataset_descriptor WHERE indicator_id=%s LIMIT 1" in sql:
                return Cursor([(1,)])
            if "column_name='active_read_route'" in sql:
                return Cursor([(True,)])
            if "WHERE indicator_id=%s AND active_read_route" in sql:
                return Cursor([("dvf_prix_m2", "theme", "prix_m2")])
            if "to_regclass('series_named_reference_descriptor')" in sql:
                return Cursor([(True,)])
            if "WHERE d.reference_indicator_id=%s AND d.active_read_route" in sql:
                return Cursor([])
            if "WHERE reference_indicator_id=%s LIMIT 1" in sql:
                return Cursor([])
            if "FROM series_dataset_publication p CROSS JOIN table_publication" in sql:
                return Cursor([("series-v2", self.reference_version, 6,
                                "2026-10-01T00:00:00Z", "ref-v8")])
            if "WHERE p.table_name='scalar_observation'" in sql:
                return Cursor([("scalar-v4", "ref-v8", "ref-v8")])
            if "FROM scalar_descriptor WHERE indicator_id=%s" in sql:
                return Cursor([("prix_m2", "habitat", "Pooled price", "€/m²", "low", "prix_m2",
                    ["commune"], "transactions", "sparse", "scalar-descriptor-v2")])
            if "SELECT territory_type FROM territory_reference WHERE territory_id=%s" in sql:
                return Cursor([(self.territory_type,)])
            if "SELECT count(*) FROM scalar_observation" in sql:
                return Cursor([(1,)])
            if "SELECT count(*) FROM scalar_observation_source" in sql:
                return Cursor([(1,)])
            if "FROM scalar_observation o" in sql:
                sources = [{"source_id": "scalar-source", "name": "Scalar source",
                    "vintage_id": "scalar-vintage", "version": "2026",
                    "reference_date": "2026-01-01", "publication_date": "2026-02-01"}]
                if "o.value" in sql:
                    return Cursor([("measured", 987.0, 12, 20, sources)])
                return Cursor([("measured", sources)])
            if "FROM series_dataset_descriptor WHERE" in sql:
                return Cursor([("year", ["2024", "2025", "2026"], [2024, 2025, 2026],
                    "may_be_missing", "Transactions", "€/m²", "low", "descriptor-v3",
                    ["commune"], "2025", "theme", "year", "unavailable", "median", "default_group")])
            if "FROM territory_reference WHERE territory_id=%s" in sql:
                return Cursor([("Commune X", self.territory_type)])
            if "FROM series_dataset_observation o LEFT JOIN" in sql:
                return Cursor([
                    ("2025", "2025", 0.0, "measured", None, "rev-a", "source-a", "v1",
                     "Source A", "dataset-a", "2025", "2025-01-01", "2025-02-01", "hash-a", None),
                    ("2025", "2025", 0.0, "measured", None, "rev-b", "source-b", "v2",
                     "Source B", "dataset-b", "2025", "2025-03-01", "2025-04-01", "hash-b", None),
                    ("2024", "2024", 4.5, "measured", None, "rev-c", "source-c", "v3",
                     "Source C", "dataset-c", "2024", "2024-01-01", "2024-02-01", "hash-c", None),
                ])
            if "FROM series_named_reference_descriptor d LEFT JOIN" in sql:
                return Cursor([
                    ("national_median", "National median", "benchmark", "median", "2024", "2024",
                     8.0, "measured", None, "ref-r1", "reference-source", "r1", "Reference", "Official",
                     "2026", "2026-01-01", "2026-02-01", "ref-hash-1", True),
                    ("national_median", "National median", "benchmark", "median", "2025", "2025",
                     9.0, "measured", None, "ref-r2", "reference-source", "r2", "Reference", "Official",
                     "2026", "2026-01-01", "2026-02-01", "ref-hash-2", True),
                    ("national_median", "National median", "benchmark", "median", "2026", "2026",
                     10.0, "measured", None, "ref-r3", "reference-source", "r3", "Reference", "Official",
                     "2026", "2026-01-01", "2026-02-01", "ref-hash-3", True),
                ])
            if "SELECT (SELECT count(*) FROM series_dataset_observation" in sql:
                return Cursor([(6,)])
            if "FROM series_context_parent_policy" in sql:
                return Cursor([])
            if "to_regclass('series_context_parent_policy')" in sql:
                return Cursor([(None,)])
            raise AssertionError(sql)

    connection = Connection()
    item = ResourceReadItem.model_validate({
        "resource": "prix_m2",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "intent": {"kind": "facts"},
    })
    reader = get_semantic_resource_reader()
    catalogue = default_resource_catalogue()
    reader.preflight(connection, item, catalogue)
    response = reader.read(connection, item, catalogue)
    read = {**response, "territory": {"id": "22001", "type": "commune", "name": "Commune X"},
            "named_references": response.get("named_references", [])}
    assert read["publication_id"] == "series-v2"
    assert read["scalar_facet"]["observation"]["value"] == 987.0
    assert read["scalar_facet"]["content_version"] == "scalar-v4"
    assert read["reference_content_version"] == "ref-v8"
    assert read["axis_values"] == ["2024", "2025", "2026"]
    assert [point["axis"] for point in read["points"]] == ["2024", "2025", "2026"]
    assert [point["value"] for point in read["points"]] == [4.5, 0.0, None]
    assert read["points"][1]["provenance"] == [
        {"revision_id": "rev-a", "source_id": "source-a", "vintage_id": "v1",
         "source_name": "Source A", "dataset_name": "dataset-a", "version": "2025",
         "reference_date": "2025-01-01", "publication_date": "2025-02-01", "revision_hash": "hash-a"},
        {"revision_id": "rev-b", "source_id": "source-b", "vintage_id": "v2",
         "source_name": "Source B", "dataset_name": "dataset-b", "version": "2025",
         "reference_date": "2025-03-01", "publication_date": "2025-04-01", "revision_hash": "hash-b"},
    ]
    assert read["named_references"][0]["statistic"] == "median"
    assert [point["value"] for point in read["named_references"][0]["points"]] == [8.0, 9.0, 10.0]
    assert read["points"][2]["status"] == "missing"
    projected_item = ResourceReadItem.model_validate({
        "resource": "prix_m2",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["status"], "intent": {"kind": "facts"},
    })
    projected = reader.read(connection, projected_item, catalogue)
    assert all("value" not in point for point in projected["points"])
    assert "value" not in projected["scalar_facet"]["observation"]
    assert [point["axis"] for point in projected["points"]] == ["2024", "2025", "2026"]
    with pytest.raises(HTTPException, match="stale or unavailable"):
        reader.read(Connection(reference_version="ref-v7"), item, catalogue)
    with pytest.raises(HTTPException, match="type does not match"):
        reader.read(Connection(territory_type="epci"), item, catalogue)


def test_owned_series_selected_comparison_uses_median_and_independent_publication_lineage(monkeypatch):
    members = ("22001", "22002", "22003", "22004")
    route = ("dvf_prix_m2", "theme", False, "prix_m2", None)

    class Cursor:
        def __init__(self, rows=()): self.rows = list(rows)
        def fetchone(self): return self.rows[0] if self.rows else None
        def fetchall(self): return self.rows

    class Connection:
        def __init__(self): self.calls = []
        def execute(self, sql, params=()):
            sql = " ".join(sql.split())
            self.calls.append((sql, params))
            if "FROM series_dataset_publication p LEFT JOIN table_publication" in sql:
                return Cursor([("dvf_prix_m2", "owner-v17", "reference-v9", "reference-v9")])
            if "FROM series_dataset_descriptor d WHERE" in sql:
                return Cursor([("dvf_prix_m2", "prix_m2", "theme", "2025", "Price", "€/m²",
                    "low", ["commune"], "descriptor-v4", ["2024", "2025"], "median",
                    "default_group", ["commune"], "year")])
            if "FROM series_dataset_descriptor d LEFT JOIN" in sql:
                return Cursor([
                    ("dvf_prix_m2", "prix_m2", "22001", 10.0, "measured", "rev-1", "2025", None),
                    ("dvf_prix_m2", "prix_m2", "22002", 20.0, "measured", "rev-2", "2025", None),
                    ("dvf_prix_m2", "prix_m2", "22003", 30.0, "measured", "rev-3", "2025", None),
                    ("dvf_prix_m2", "prix_m2", "22004", 40.0, "measured", "rev-4", "2025", None),
                ])
            if "FROM series_provenance_revision WHERE provenance_revision_id=ANY" in sql:
                return Cursor([(f"rev-{i}", f"source-{i}", f"v{i}", f"Source {i}", "DVF",
                    f"202{i}", "2025-01-01", "2025-02-01", f"hash-{i}") for i in range(1, 5)])
            raise AssertionError(sql)

    monkeypatch.setattr(snapshot_reads, "_comparison_cohort",
        lambda *_args, **_kwargs: ("commune", members, {"kind": "selected", "ids": members}))
    monkeypatch.setattr(snapshot_reads, "_fixed_scalar_comparison_context", lambda *_args, **_kwargs: None)
    result, markers, cohort_type, selected_members, _scope = snapshot_reads._owned_series_comparison_results(
        Connection(), [route], "commune", "22001", None)
    comparison = result[0]
    assert cohort_type == "commune" and selected_members == members
    assert markers["dvf_prix_m2"][1:3] == ("owner-v17", "reference-v9")
    assert comparison["statistic"] == "median"
    assert comparison["median"] == 25.0
    assert comparison["rank"] == 1
    assert comparison["eligible_count"] == 4
    assert {source["source_id"] for source in comparison["comparison_sources"]} == {
        "source-1", "source-2", "source-3", "source-4"}
    assert [source["vintage_id"] for source in comparison["comparison_sources"]] == [
        "v1", "v2", "v3", "v4"]





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
