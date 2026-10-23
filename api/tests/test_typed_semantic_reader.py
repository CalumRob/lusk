from api.resource_catalogue import default_resource_catalogue, validate_resource_item
from api.resource_requests import ResourceReadItem
from api.semantic_resource_reader import SemanticResourceReader
from api.typed_reading_snapshots import validate_milieux_source_bindings
from fastapi import HTTPException


class _Connection:
    def __init__(self):
        self.calls = []
        self.missing_source = False

    def execute(self, sql, params=()):
        self.calls.append((sql, params))
        if "FROM table_publication p LEFT JOIN table_publication t" in sql:
            return _Result(("reading-v1", "reference-v1", "reference-v1"))
        if sql.startswith("SELECT territory_type FROM territory_reference"):
            return _Result(("commune",))
        if "FROM table_publication WHERE table_name=%s" in sql:
            table = params[0]
            if table == "territory_reference":
                return _Result(("reference-v1",))
            if table == "economy_typed_reading":
                return _Result(("reading-v1", 1, "reference-v1"))
            if table == "economy_activity_evidence":
                return _Result(("evidence-v1", "reference-v1", 2))
        if "FROM table_publication WHERE table_name='territory_reference'" in sql:
            return _Result(("reference-v1",))
        if "FROM (SELECT 1 FROM economy_typed_reading LIMIT %s)" in sql:
            return _Result((1,))
        if "FROM (SELECT 1 FROM economy_activity_evidence LIMIT %s)" in sql:
            return _Result((2,))
        if sql.startswith("SELECT count(*) FROM economy_typed_reading WHERE"):
            return _Result((1,))
        if sql.startswith("SELECT count(*) FROM economy_activity_evidence WHERE"):
            return _Result((2,))
        if sql.startswith("SELECT content_version FROM table_publication"):
            return _Result(("reading-v1",))
        if "FROM economy_typed_reading r" in sql:
            source_name = None if self.missing_source else "SIRENE snapshot"
            source_version = None if self.missing_source else "2026"
            return _Result(("sante-et-taille", "ce-que-la-commune-abrite", "reason",
                            "measured", "sirene_snapshot", "v1", source_name, source_version, None, None))
        if "FROM economy_activity_evidence r" in sql:
            return _Result(("22001", "commune", "sante-et-taille", 1, "A", "Label",
                            1.5, 4, 0.25, "agriculture_source", "v2", "Agriculture source",
                            "producer-2025", None, "2025-03-04"))
        raise AssertionError(f"Unexpected SQL: {sql}")


class _Result:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row

    def fetchall(self):
        return [self.row]


def test_typed_reading_preflight_counts_facts_and_ranked_evidence():
    catalogue = default_resource_catalogue()
    item = ResourceReadItem.model_validate({
        "resource": "economie_selected_reading",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "coordinates": {"groupe": ["sante-et-taille"]},
        "intent": {"kind": "facts"},
    })
    resource = validate_resource_item(item, catalogue)
    connection = _Connection()

    assert SemanticResourceReader._typed_reading_preflight(connection, item, resource) == 6
    validation_queries = [sql for sql, _ in connection.calls
                          if "FROM (SELECT 1 FROM" in sql]
    assert len(validation_queries) == 2
    assert all("LIMIT %s" in sql for sql in validation_queries)
    target_count = next(call for call in connection.calls
                        if "groupe=ANY(%s::text[])" in call[0])
    assert target_count[1] == ["22001", "commune", ["sante-et-taille"]]


def test_typed_reading_preflight_charges_and_bounds_integrity_validation():
    catalogue = default_resource_catalogue()
    item = ResourceReadItem.model_validate({
        "resource": "economie_selected_reading",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "intent": {"kind": "facts"},
    })
    resource = validate_resource_item(item, catalogue)
    connection = _Connection()

    try:
        SemanticResourceReader._typed_reading_preflight(
            connection, item, resource, work_budget=0)
    except HTTPException as exc:
        assert exc.status_code == 413
    else:
        raise AssertionError("typed-reading integrity work must respect the remaining request budget")
    assert not any("FROM (SELECT 1 FROM" in sql for sql, _ in connection.calls)


class _TruncatedIntegrityConnection(_Connection):
    def __init__(self, *, primary_count, side_count):
        super().__init__()
        self.primary_count = primary_count
        self.side_count = side_count

    def execute(self, sql, params=()):
        if "FROM (SELECT 1 FROM economy_typed_reading LIMIT %s)" in sql:
            return _Result((self.primary_count,))
        if "FROM (SELECT 1 FROM economy_activity_evidence LIMIT %s)" in sql:
            return _Result((self.side_count,))
        return super().execute(sql, params)


def test_typed_reading_integrity_rejects_truncated_primary_or_side_rows():
    from api.cohort_reads import validate_typed_reading_integrity

    resource = default_resource_catalogue().resources_by_id["economie_selected_reading"]
    for connection in (
        _TruncatedIntegrityConnection(primary_count=0, side_count=2),
        _TruncatedIntegrityConnection(primary_count=1, side_count=1),
    ):
        try:
            validate_typed_reading_integrity(
                connection, resource, ("reading-v1", 1, "reference-v1"),
                [("evidence-v1", "reference-v1", 2)], 10)
        except HTTPException as exc:
            assert exc.status_code == 503
        else:
            raise AssertionError("truncated typed-reading publication rows must fail closed")


def test_typed_reading_read_keeps_ranked_evidence_separate_from_facts():
    catalogue = default_resource_catalogue()
    item = ResourceReadItem.model_validate({
        "resource": "economie_selected_reading",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "coordinates": {"groupe": ["sante-et-taille"]},
        "intent": {"kind": "facts"},
    })
    resource = validate_resource_item(item, catalogue)
    result = SemanticResourceReader._typed_reading_read(_Connection(), item, resource)

    assert result["facts"] == [{
        "groupe": "sante-et-taille", "story_key": "ce-que-la-commune-abrite",
        "salience_reason": "reason", "status": "measured", "source_id": "sirene_snapshot",
        "vintage_id": "v1", "source": {"source_id": "sirene_snapshot",
            "name": "SIRENE snapshot", "vintage_id": "v1", "version": "2026",
            "reference_date": None, "publication_date": None},
    }]
    assert result["ranked_activities"][0]["rank"] == 1
    assert result["ranked_activities"][0]["activity_code"] == "A"
    assert result["ranked_activities"][0]["source"] == {
        "source_id": "agriculture_source", "name": "Agriculture source", "vintage_id": "v2",
        "version": "producer-2025", "reference_date": None, "publication_date": "2025-03-04",
    }
    assert "lq" not in result["facts"][0]


def test_typed_reading_fails_closed_when_required_fact_source_clock_is_missing():
    catalogue = default_resource_catalogue()
    item = ResourceReadItem.model_validate({
        "resource": "economie_selected_reading",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "intent": {"kind": "facts"},
    })
    resource = validate_resource_item(item, catalogue)
    connection = _Connection()
    connection.missing_source = True
    try:
        SemanticResourceReader._typed_reading_read(connection, item, resource)
    except HTTPException as exc:
        assert exc.status_code == 503
    else:
        raise AssertionError("typed readings must fail closed without the source clock")


class _AbsenceConnection:
    def __init__(self, declared):
        self.declared = declared

    def execute(self, sql, params=()):
        if "FROM table_publication p LEFT JOIN table_publication t" in sql:
            return _Result(("reading-v1", "reference-v1", "reference-v1"))
        if sql.startswith("SELECT 1 FROM milieux_typed_reading WHERE"):
            return _Result(None)
        if "FROM milieux_typed_reading r" in sql:
            return _Rows([])
        if "FROM milieux_reading_absence r" in sql:
            return _Rows([("35004", "commune", "source_record_absent", "consoenaf",
                           "v2025/2025-01-01", "a" * 64, "CONSOENAF", "2025", None, None)]
                          if self.declared else [])
        if "FROM milieux_reading_source r" in sql:
            return _Rows([])
        raise AssertionError(f"Unexpected SQL: {sql}")


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


def test_milieux_semantic_read_preserves_declared_sparse_source_absence():
    catalogue = default_resource_catalogue()
    item = ResourceReadItem.model_validate({
        "resource": "milieux_selected_reading",
        "target": {"kind": "territory", "type": "commune", "id": "35004"},
        "fields": ["source_absences"],
        "intent": {"kind": "facts"},
    })
    resource = validate_resource_item(item, catalogue)
    data = SemanticResourceReader._typed_reading_read(_AbsenceConnection(True), item, resource)

    assert data["facts"] == []
    assert data["source_absences"][0]["source_snapshot_sha256"] == "a" * 64
    assert data["source_absences"][0]["source"] == {
        "source_id": "consoenaf", "name": "CONSOENAF", "vintage_id": "v2025/2025-01-01",
        "version": "2025", "reference_date": None, "publication_date": None,
    }


def test_milieux_semantic_read_fails_closed_without_fact_or_absence_evidence():
    catalogue = default_resource_catalogue()
    item = ResourceReadItem.model_validate({
        "resource": "milieux_selected_reading",
        "target": {"kind": "territory", "type": "commune", "id": "35006"},
        "fields": ["source_absences"],
        "intent": {"kind": "facts"},
    })
    resource = validate_resource_item(item, catalogue)

    try:
        SemanticResourceReader._typed_reading_read(_AbsenceConnection(False), item, resource)
    except HTTPException as exc:
        assert exc.status_code == 503
    else:
        raise AssertionError("undeclared Milieux source absence must fail closed")


class _StaleAbsenceConnection:
    def execute(self, sql, params=()):
        if sql.startswith("SELECT territory_type FROM territory_reference"):
            return _Result(("commune",))
        if "FROM table_publication WHERE table_name=%s" in sql:
            if params[0] == "milieux_typed_reading":
                return _Result(("reading-v2", 4, "reference-v1"))
            if params[0] == "milieux_reading_absence":
                return _Result(("reading-v1", "reference-v1", 1))
        if "table_name='territory_reference'" in sql:
            return _Result(("reference-v1",))
        if "FROM (SELECT 1 FROM milieux_typed_reading LIMIT %s)" in sql:
            return _Result((4,))
        if sql.startswith("SELECT count(*) FROM milieux_typed_reading WHERE"):
            return _Result((1,))
        raise AssertionError(f"Unexpected SQL: {sql}")


def test_milieux_preflight_rejects_stale_absence_publication():
    catalogue = default_resource_catalogue()
    item = ResourceReadItem.model_validate({
        "resource": "milieux_selected_reading",
        "target": {"kind": "territory", "type": "commune", "id": "35004"},
        "intent": {"kind": "facts"},
    })
    resource = validate_resource_item(item, catalogue)

    try:
        SemanticResourceReader._typed_reading_preflight(_StaleAbsenceConnection(), item, resource)
    except HTTPException as exc:
        assert exc.status_code == 503
    else:
        raise AssertionError("stale source-absence evidence must fail closed")


def test_milieux_source_binding_uses_its_exact_published_revision_and_null_dates():
    class PublicationConnection:
        def __init__(self):
            self.calls = []

        def execute(self, sql, params=()):
            self.calls.append((sql, params))
            assert "FROM series_dataset_publication" in sql
            return _Rows([("milieux-states", "dataset-v1", "reference-v1")])

    binding = {
        "field_key": "artif_m2_par_habitant", "source_id": "land-source", "vintage_id": "land-v1",
        "source_name": "Land source", "source_version": "2025", "reference_date": None,
        "publication_date": "2025-02-01", "population_revision_id": None,
        "provenance_revision_id": "land-revision-v1", "dataset_id": "milieux-states",
        "dataset_content_version": "dataset-v1", "state_role": "M2", "axis_value": "2021",
        "observation_period": "2021", "series_source_id": "land-source",
        "series_vintage_id": "land-v1", "series_source_name": "Land source",
        "series_source_version": "2025", "series_reference_date": None,
        "series_publication_date": "2025-02-01", "observed_state_role": "M2",
        "observed_period": "2021", "registered_revisions": ["land-revision-v1"],
    }
    connection = PublicationConnection()
    validate_milieux_source_bindings(connection, [binding], "reference-v1")
    assert connection.calls[0][1] == (["milieux-states"],)

    stale = {**binding, "registered_revisions": []}
    try:
        validate_milieux_source_bindings(connection, [stale], "reference-v1")
    except HTTPException as exc:
        assert exc.status_code == 503
    else:
        raise AssertionError("an unregistered Milieux provenance revision must fail closed")
