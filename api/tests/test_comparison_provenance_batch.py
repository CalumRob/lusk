"""Comparison reads batch distinct provenance instead of repeating per observation."""

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
