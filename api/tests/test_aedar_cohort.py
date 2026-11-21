"""One AEDAR Cellule read as a bounded whole-level cohort (#1078).

A cohort is one declared Cellule — equipment × horizon × mode × statistic on the
aggregate, or horizon × mode × kind on the summary — projected over every
published territory of a level in one bounded semantic read. Missing or
suppressed territories are absent, never zero. Both families read on their own
address; the deprecated ``measure`` alias is not a cohort address. Contract
tests only: stubbed snapshots, no serving database.
"""

from contextlib import contextmanager

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.aedar_models import AEDAR_SUMMARY_FAMILY, AEDAR_PER_CELL_FAMILY
from api.publication_outcomes import PublicationUnavailable
from api.resource_catalogue import default_resource_catalogue, validate_resource_item
from api.resource_requests import ResourceReadItem
from api.semantic_resource_reader import SemanticResourceReader

AGGREGATE = "aedar_territorial_aggregate"
SUMMARY = "aedar_territory_summary"
PER_CELL_COORDS = {
    "typequ": ["A104"], "horizon": ["15"], "mode": ["walk"], "statistic": ["share"]}
SUMMARY_COORDS = {"horizon": ["15"], "mode": ["car"], "kind": ["diversity"]}
PER_CELL_MEASURE = "count_15_walk_share"
SUMMARY_MEASURE = "meanDiversity"  # car × 15 × diversity resolves to the meanDiversity reading.
MEMBERS = [("22001", "commune", "Allineuc"),
           ("22002", "commune", "Rennes"),
           ("22003", "commune", "Redon")]
SUMMARY_PROVENANCE = ("aedar_bretagne", "2026-v1", "https://example.test",
                      "ODbL", "AEDAR", None, "2026-09-30")
PERCELL_COLUMNS = ("territory_id", "value", "n_addresses", "n_observed", "coverage_status",
                   "source_id", "vintage_id", "source_url", "licence", "attribution",
                   "reference_date", "publication_date")


def catalogue():
    return default_resource_catalogue.__wrapped__()


def reader():
    return SemanticResourceReader(
        indicator_facts_snapshot=lambda *a, **k: {}, indicator_comparison_preflight=lambda *a, **k: {},
        indicator_comparison_snapshot=lambda *a, **k: {}, owned_series_route=lambda *a, **k: None,
        owned_named_reference_snapshot=lambda *a, **k: {}, comparison_field_selection=lambda f: f,
        max_owned_series_provenance_per_point=8)


def item(resource_id, coordinates, *, target=None):
    return ResourceReadItem.model_validate({
        "resource": resource_id,
        "target": target or {"kind": "territory_cohort", "type": "commune"},
        "coordinates": coordinates, "intent": {"kind": "facts"}})


class _Rows:
    def __init__(self, columns, rows):
        self.description = [type("Column", (), {"name": name})() for name in columns]
        self._rows = list(rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows


class _Conn:
    """Route the exact cohort SQL to fixture rows, like the AEDAR contract stubs."""

    def __init__(self, *, ref_version="ref-v1", marker_ref=None, ref_count=3, members=None,
                 summary_marker="present", aggregate_marker="present",
                 summary_rows=None, percell_rows=None, fact_counts=None, called=None):
        self.ref_version = ref_version
        self.marker_ref = ref_version if marker_ref is None else marker_ref
        self.ref_count = ref_count
        self.members = MEMBERS if members is None else members
        self.summary_marker = summary_marker
        self.aggregate_marker = aggregate_marker
        self.summary_rows = summary_rows if summary_rows is not None else []
        self.percell_rows = percell_rows if percell_rows is not None else []
        self.fact_counts = fact_counts or {}
        self.called = called if called is not None else []
        self.queries = []

    def execute(self, sql, params=None):
        self.queries.append(sql)
        s = sql
        if s.startswith("SET TRANSACTION"):
            return None
        if "SELECT to_regclass(%s)" in s:
            return _Rows([], [(True,)])
        if "SELECT content_version,row_count FROM table_publication" in s and "territory_reference" in s:
            return _Rows([], [(self.ref_version, self.ref_count)])
        if "SELECT territory_id,territory_type,name FROM territory_reference" in s:
            limit = params[-1]
            return _Rows([], list(self.members[:limit]))
        if "SELECT content_version FROM table_publication WHERE table_name='territory_reference'" in s:
            return _Rows([], [(self.ref_version,)])
        if "s.table_name='aedar_territory_summary'" in s:
            if self.summary_marker == "absent":
                return _Rows([], [])
            # (content, rows, ref, aedar_source, aggregate content, aggregate ref, reference)
            return _Rows([], [("summary-v1", 40, self.marker_ref, "aed-v1",
                               "aed-v1", self.marker_ref, self.marker_ref)])
        if "p.table_name='aedar_territorial_aggregate'" in s and "p.content_version" in s:
            if self.aggregate_marker == "absent":
                return _Rows([], [])
            return _Rows([], [("aed-v1", 235, self.ref_version, self.ref_version)])
        if "bounded_rows" in s and "count(*)" in s:
            if "aedar_territory_summary" in s:
                return _Rows([], [(self.fact_counts.get("summary", len(self.summary_rows)),)])
            if "aedar_territorial_aggregate" in s:
                return _Rows([], [(self.fact_counts.get("percell", len(self.percell_rows)),)])
            return _Rows([], [(0,)])
        if "FROM aedar_territory_summary WHERE" in s:
            self.called.append(("summary", tuple(params)))
            return _Rows([], list(self.summary_rows))
        if "FROM aedar_territorial_aggregate" in s and "measures->>" in s:
            self.called.append(("percell", tuple(params)))
            return _Rows(PERCELL_COLUMNS, list(self.percell_rows))
        return _Rows([], [])

    @contextmanager
    def transaction(self):
        yield self


def _summary_row(territory_id, value=0.42, status="available"):
    return (territory_id, SUMMARY_MEASURE, value, status, 235, 1200, 235, "covered",
            *SUMMARY_PROVENANCE)


def _percell_row(territory_id, value=0.31):
    return (territory_id, value, 1200, 235, "covered", *SUMMARY_PROVENANCE)


def _preflight(conn, request_item, *, work_budget=200_000, snapshot_state=None):
    return reader().preflight(conn, request_item, catalogue(), work_budget=work_budget,
                              snapshot_state=snapshot_state)


def _read(conn, request_item, *, snapshot_state=None):
    return reader().read(conn, request_item, catalogue(), snapshot_state=snapshot_state)


# --- Admission: a cohort is declared, family-separated, and never an alias. ---

def test_aedar_resources_declare_the_cohort_target():
    for resource_id in (AGGREGATE, SUMMARY):
        assert "territory_cohort" in catalogue().resources_by_id[resource_id].target_kinds
        validate_resource_item(item(resource_id, PER_CELL_COORDS if resource_id == AGGREGATE
                                    else SUMMARY_COORDS), catalogue())


@pytest.mark.parametrize("resource_id,coordinates", [
    (AGGREGATE, SUMMARY_COORDS),   # summary coordinates never satisfy the aggregate cohort
    (SUMMARY, PER_CELL_COORDS),    # per-cell coordinates never satisfy the summary cohort
])
def test_families_cannot_satisfy_each_others_cohort(resource_id, coordinates):
    with pytest.raises(ValueError):
        validate_resource_item(item(resource_id, coordinates), catalogue())


def test_measure_alias_is_not_a_cohort_address():
    with pytest.raises(ValueError, match="measure is not an AEDAR Cellule address"):
        validate_resource_item(item(AGGREGATE, {"measure": [PER_CELL_MEASURE]}), catalogue())
    with pytest.raises(ValueError, match="measure is not an AEDAR Cellule address"):
        validate_resource_item(item(SUMMARY, {"measure": [SUMMARY_MEASURE]}), catalogue())


def test_cohort_requires_one_complete_cellule_not_a_typequ_only_read():
    with pytest.raises(ValueError):
        validate_resource_item(item(AGGREGATE, {"typequ": ["A104"]}), catalogue())


def test_single_cellule_guard_has_one_definition():
    """The cohort-address rule is defined once, never copied into three callers."""
    import inspect
    from api import aedar_models, cohort_reads, resource_catalogue, semantic_resource_reader

    needle = "an AEDAR cohort requires one declared Cellule"
    sources = [inspect.getsource(module) for module in (
        aedar_models, cohort_reads, resource_catalogue, semantic_resource_reader)]
    assert sum(source.count(needle) for source in sources) == 1
    for source in sources[1:]:
        assert "aedar_cohort_cellule" in source


def test_comparison_intents_still_require_a_territory_target():
    request_item = ResourceReadItem.model_validate({
        "resource": SUMMARY, "target": {"kind": "territory_cohort", "type": "commune"},
        "coordinates": SUMMARY_COORDS, "intent": {"kind": "fixed_comparison", "context": "epci"}})
    with pytest.raises(ValueError, match="cohort targets are facts-only"):
        validate_resource_item(request_item, catalogue())


# --- Reading: both families project one Cellule over the whole level. ---

def test_summary_cohort_reads_each_territory_and_absent_is_not_zero():
    conn = _Conn(summary_rows=[_summary_row("22001", 0.42), _summary_row("22002", 0.75)])
    data = _read(conn, item(SUMMARY, SUMMARY_COORDS))
    assert data["shape"] == "aedar_summary_cohort"
    assert data["family"] == AEDAR_SUMMARY_FAMILY
    assert data["cohort"]["member_count"] == 3
    values = {entry["territory"]["id"]: entry["value"] for entry in data["values"]}
    assert values == {"22001": 0.42, "22002": 0.75}
    assert "22003" not in values  # missing territory is absent, never 0
    assert all(entry["value"] > 0 for entry in data["values"])


def test_per_cell_cohort_reads_each_territory():
    conn = _Conn(percell_rows=[_percell_row("22001", 0.11), _percell_row("22003", 0.29)])
    data = _read(conn, item(AGGREGATE, PER_CELL_COORDS))
    assert data["shape"] == "aedar_per_cell_cohort"
    assert data["family"] == AEDAR_PER_CELL_FAMILY
    values = {entry["territory"]["id"]: entry["value"] for entry in data["values"]}
    assert values == {"22001": 0.11, "22003": 0.29}
    assert "22002" not in values


def test_summary_reads_all_members_in_one_set_wise_read_never_one_point():
    called = []
    conn = _Conn(summary_rows=[_summary_row("22001"), _summary_row("22002"), _summary_row("22003")],
                 called=called)
    _read(conn, item(SUMMARY, SUMMARY_COORDS))
    summary_calls = [params for name, params in called if name == "summary"]
    assert len(summary_calls) == 1
    territory_type, territory_ids, measures = summary_calls[0]
    assert territory_type == "commune"
    assert set(territory_ids) == {"22001", "22002", "22003"}
    assert measures == [SUMMARY_MEASURE]


# --- Bounds: one shared work budget, oversized cohorts fail whole. ---

def test_work_charges_members_and_bounded_facts():
    conn = _Conn(summary_rows=[_summary_row("22001"), _summary_row("22002"),
                               _summary_row("22003")])
    work = _preflight(conn, item(SUMMARY, SUMMARY_COORDS))
    assert work == len(MEMBERS) + 3 + 1


def test_oversized_cohort_fails_whole():
    conn = _Conn(members=MEMBERS + [("22004", "commune", "D")])
    with pytest.raises(HTTPException) as error:
        _preflight(conn, item(SUMMARY, SUMMARY_COORDS), work_budget=3)
    assert error.value.status_code == 413


def test_oversized_fact_set_fails_whole_before_any_read():
    conn = _Conn(summary_rows=[_summary_row("22001")], fact_counts={"summary": 999})
    with pytest.raises(HTTPException) as error:
        _preflight(conn, item(SUMMARY, SUMMARY_COORDS), work_budget=10)
    # Bounded count LIMIT is remaining+1 (8 here); 999 > remaining fails whole.
    assert error.value.status_code == 413
    assert not any("FROM aedar_territory_summary WHERE" in query for query in conn.queries)


# --- Publication outcomes and snapshot consistency. ---

def test_absent_summary_publication_is_a_typed_aedar_outcome():
    conn = _Conn(summary_marker="absent")
    with pytest.raises(PublicationUnavailable) as error:
        _preflight(conn, item(SUMMARY, SUMMARY_COORDS))
    assert error.value.family == "aedar"
    assert error.value.reason == "publication_absent"


def test_reference_version_mismatch_fails_the_whole_request():
    # The cohort resolves against ref-v1 while the AEDAR publication declares
    # ref-v2: a hard snapshot inconsistency, not a typed absence.
    conn = _Conn(ref_version="ref-v1", marker_ref="ref-v2")
    with pytest.raises(HTTPException) as error:
        _preflight(conn, item(SUMMARY, SUMMARY_COORDS))
    assert error.value.status_code == 503


def test_two_aedar_cohorts_in_one_batch_share_one_pin():
    """A second AEDAR cohort with a different publication version fails whole."""
    state = {}
    _preflight(_Conn(), item(SUMMARY, SUMMARY_COORDS), snapshot_state=state)
    assert "aedar_cohort_pin" in state
    conn = _Conn()
    conn.ref_version = "ref-v1"
    conn.summary_marker = "present"
    # A different summary content version under the same snapshot is a hard fault.
    original = conn.execute
    def shifted(sql, params=None):
        if "s.table_name='aedar_territory_summary'" in sql:
            return _Rows([], [("summary-v2", 40, "ref-v1", "aed-v1", "aed-v1",
                               "ref-v1", "ref-v1")])
        return original(sql, params)
    conn.execute = shifted
    with pytest.raises(HTTPException) as error:
        _preflight(conn, item(SUMMARY, SUMMARY_COORDS), snapshot_state=state)
    assert error.value.status_code == 503


def test_both_families_pin_independently_in_one_batch():
    """The summary and aggregate own distinct content clocks; neither fails the other."""
    state = {}
    _preflight(_Conn(), item(SUMMARY, SUMMARY_COORDS), snapshot_state=state)
    _preflight(_Conn(), item(AGGREGATE, PER_CELL_COORDS), snapshot_state=state)
    assert set(state["aedar_cohort_pin"]) == {AEDAR_SUMMARY_FAMILY, AEDAR_PER_CELL_FAMILY}


def test_suppressed_summary_reading_is_absent_not_zero():
    suppressed = ("22001", SUMMARY_MEASURE, None, "unavailable", None, 1200, 0,
                  "covered", *SUMMARY_PROVENANCE)
    conn = _Conn(summary_rows=[suppressed, _summary_row("22002", 0.75)])
    data = _read(conn, item(SUMMARY, SUMMARY_COORDS))
    values = {entry["territory"]["id"]: entry["value"] for entry in data["values"]}
    assert values == {"22002": 0.75}


# --- The batch surface: typed outcome, no partial envelope. ---

class _Pool:
    def __init__(self, conn):
        self.conn = conn

    @contextmanager
    def connection(self):
        yield self.conn


def _http_batch(monkeypatch, conn, request_item, *, contract="semantic-read-batch-v2"):
    from api import main
    monkeypatch.setattr(main, "pool", lambda: _Pool(conn))
    return TestClient(main.app).post("/api/resources/read-batch", json={
        "contract": contract, "items": [{"id": "cohort-1", **request_item.model_dump()}]})


def test_v2_batch_reports_typed_outcome_for_absent_aedar_publication(monkeypatch):
    response = _http_batch(monkeypatch, _Conn(summary_marker="absent"),
                           item(SUMMARY, SUMMARY_COORDS))
    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert result["status"] == "publication_unavailable"
    assert result["family"] == "aedar"
    assert result["reason"] == "publication_absent"


def test_v2_batch_returns_the_cohort_payload(monkeypatch):
    conn = _Conn(summary_rows=[_summary_row("22001"), _summary_row("22002"),
                               _summary_row("22003")])
    response = _http_batch(monkeypatch, conn, item(SUMMARY, SUMMARY_COORDS))
    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert result["status"] == "available"
    assert result["data"]["shape"] == "aedar_summary_cohort"
    assert len(result["data"]["values"]) == 3


def test_cohort_response_byte_ceiling_fails_whole(monkeypatch):
    """The shared response-byte ceiling applies to a whole-level cohort read."""
    from api import main, resource_execution
    monkeypatch.setattr(resource_execution, "MAX_RESPONSE_BYTES", 200)

    class BigCohortReader:
        def admit(self, *a, **k):
            return 1

        def preflight(self, *a, **k):
            return 1

        def read(self, *a, **k):
            return {"shape": "aedar_summary_cohort",
                    "values": [{"value": "x" * 500}]}

    previous = main.app.dependency_overrides.get(main.get_semantic_resource_reader)
    monkeypatch.setattr(main, "pool", lambda: _Pool(_Conn()))
    main.app.dependency_overrides[main.get_semantic_resource_reader] = lambda: BigCohortReader()
    try:
        response = TestClient(main.app).post("/api/resources/read-batch", json={
            "items": [{"id": "cohort-1", **item(SUMMARY, SUMMARY_COORDS).model_dump()}]})
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_semantic_resource_reader, None)
        else:
            main.app.dependency_overrides[main.get_semantic_resource_reader] = previous
    assert response.status_code == 413
