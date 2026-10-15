"""Comparison reads batch distinct provenance instead of repeating per observation."""

import pytest
from fastapi import HTTPException

from api import main


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class RecordingConnection:
    def __init__(self, *results):
        self.results = list(results)
        self.calls = []

    def execute(self, query, params=None):
        self.calls.append((query, params))
        return Result(self.results.pop(0))


def test_scalar_comparison_reads_values_and_distinct_peer_sources_in_batches():
    observations = [("indicator", "29001", "commune", 1.25, "measured")]
    sources = [
        ("indicator", "source-a", "v2", "Source A", "2026", None, None),
        ("indicator", "source-b", "v1", "Source B", "2025", None, None),
    ]
    connection = RecordingConnection(observations, sources)

    result, source_map = main._selected_scalar_comparison_inputs(
        connection,
        theme_id="mobilite",
        indicator_id=None,
        cohort_type="commune",
        members=("29001", "29002"),
        territory_id="29001",
        territory_type="commune",
    )

    assert result == observations
    assert source_map == {
        "indicator": [
            {"source_id": "source-a", "name": "Source A", "vintage_id": "v2",
             "version": "2026", "reference_date": None, "publication_date": None},
            {"source_id": "source-b", "name": "Source B", "vintage_id": "v1",
             "version": "2025", "reference_date": None, "publication_date": None},
        ]
    }
    assert len(connection.calls) == 2
    values_query, values_params = connection.calls[0]
    sources_query, sources_params = connection.calls[1]
    assert "FROM scalar_observation o JOIN scalar_descriptor d" in values_query
    assert "scalar_observation_source" not in values_query
    assert "SELECT DISTINCT os.indicator_id,os.source_id,os.vintage_id" in sources_query
    assert "scalar_observation_source os" in sources_query
    assert "os.territory_id=ANY(%s)" in sources_query
    assert values_params == (
        "mobilite", None, None, "commune", ["29001", "29002"], "29001", "commune"
    )
    assert sources_params == ("mobilite", None, None, ["29001", "29002"], "commune")


def test_profile_comparison_sources_are_distinct_and_batched_by_profile():
    external_sources = [
        ("external_profile", "source-a", "v2", "Source A", "2026", None, None),
    ]
    detail_sources = [
        ("detail_profile", "source-b", "v1", "Source B", "2025", None, None),
        ("detail_profile", "source-c", "v3", "Source C", "2024", None, None),
    ]
    connection = RecordingConnection(external_sources, detail_sources)

    external, details = main._selected_profile_comparison_sources(
        connection,
        external=("external_profile",),
        details=("detail_profile",),
        cohort_type="commune",
        members=("29001", "29002"),
    )

    assert external == {
        "external_profile": [
            {"source_id": "source-a", "name": "Source A", "vintage_id": "v2",
             "version": "2026", "reference_date": None, "publication_date": None}
        ]
    }
    assert details == {
        "detail_profile": [
            {"source_id": "source-b", "name": "Source B", "vintage_id": "v1",
             "version": "2025", "reference_date": None, "publication_date": None},
            {"source_id": "source-c", "name": "Source C", "vintage_id": "v3",
             "version": "2024", "reference_date": None, "publication_date": None},
        ]
    }
    assert len(connection.calls) == 2
    external_query, external_params = connection.calls[0]
    detail_query, detail_params = connection.calls[1]
    assert "SELECT DISTINCT p.indicator_id,os.source_id,os.vintage_id" in external_query
    assert "scalar_observation_source os" in external_query
    assert "SELECT DISTINCT p.indicator_id,os.source_id,os.vintage_id" in detail_query
    assert "profile_observation_source os" in detail_query
    assert "p.comparison_detail" in detail_query
    assert external_params == (["external_profile"], "commune", ["29001", "29002"])
    assert detail_params == (["detail_profile"], "commune", ["29001", "29002"])


def test_published_comparison_lineage_reads_only_the_resolved_group_and_facet():
    class Connection:
        def __init__(self):
            self.calls = []

        def execute(self, query, params=None):
            self.calls.append((query, params))
            return Result([
                ("population", "census", "2020", "Census", "2020", None, None, "comparison-v1"),
                ("population", "census", "2021", "Census", "2021", None, None, "comparison-v1"),
            ])

    connection = Connection()
    result = main._published_comparison_sources(
        connection, family="scalar", context="density_class", group_id="A",
        cohort_type="commune", facets={"population"}, content_version="comparison-v1",
        expected_counts={"population": 2},
    )

    assert result == {
        "population": [
            {"source_id": "census", "name": "Census", "vintage_id": "2020",
             "version": "2020", "reference_date": None, "publication_date": None},
            {"source_id": "census", "name": "Census", "vintage_id": "2021",
             "version": "2021", "reference_date": None, "publication_date": None},
        ]
    }
    assert len(connection.calls) == 1
    query, params = connection.calls[0]
    assert "FROM comparison_source_lineage" in query
    assert "JOIN source_vintage" in query and "JOIN source_dataset" in query
    assert "scalar_observation" not in query
    assert "profile_observation" not in query
    assert params == ("scalar", "density_class", "A", "commune", ["population"])


@pytest.mark.parametrize("rows,expected_count,message", [
    ([], 0, None),
    ([], 1, "incomplete"),
    ([("population", "survey", "2024", "Survey", "2024", None, None, "old")], 1, "stale"),
    ([("population", "survey", "2024", "Survey", "2024", None, None, "v1")], 2, "incomplete"),
])
def test_published_lineage_checks_published_count_version_and_legitimate_empty(rows, expected_count, message):
    class Connection:
        def execute(self, query, params=None):
            assert "comparison_source_lineage" in query
            return Result(rows)

    kwargs = dict(family="scalar", context="density_class", group_id="A",
        cohort_type="commune", facets={"population"}, content_version="v1",
        expected_counts={"population": expected_count})
    if message:
        with pytest.raises(HTTPException, match=message):
            main._published_comparison_sources(Connection(), **kwargs)
    else:
            assert main._published_comparison_sources(Connection(), **kwargs) == {}


def test_pre_lineage_publication_count_is_not_treated_as_a_legitimate_empty_lineage():
    class Connection:
        def execute(self, *_args, **_kwargs):
            return Result([])

    with pytest.raises(HTTPException, match="incomplete"):
        main._published_comparison_sources(Connection(), family="scalar",
            context="density_class", group_id="A", cohort_type="commune",
            facets={"population"}, content_version="comparison-v1",
            expected_counts={"population": None})


def test_missing_lineage_relation_fails_closed_as_unavailable():
    class MissingRelation:
        def execute(self, *_args, **_kwargs):
            error = RuntimeError("relation does not exist")
            error.sqlstate = "42P01"
            raise error

    with pytest.raises(HTTPException) as error:
        main._published_comparison_sources(MissingRelation(), family="scalar",
            context="density_class", group_id="A", cohort_type="commune",
            facets={"population"}, content_version="v1", expected_counts={"population": 0})
    assert error.value.status_code == 503
