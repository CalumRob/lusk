from api.resource_catalogue import default_resource_catalogue, validate_resource_item
from api.resource_requests import ResourceReadItem
from api.semantic_resource_reader import SemanticResourceReader
from fastapi import HTTPException


class _Connection:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((sql, params))
        if sql.startswith("SELECT territory_type FROM territory_reference"):
            return _Result(("commune",))
        if "FROM table_publication WHERE table_name=%s" in sql:
            table = params[0]
            if table == "territory_reference":
                return _Result(("reference-v1",))
            if table == "economy_typed_reading":
                return _Result(("reading-v1", 1, "reference-v1"))
            if table == "economy_activity_evidence":
                return _Result(("evidence-v1", "reference-v1"))
        if "FROM table_publication WHERE table_name='territory_reference'" in sql:
            return _Result(("reference-v1",))
        if sql.startswith("SELECT count(*) FROM economy_typed_reading"):
            return _Result((1,))
        if sql.startswith("SELECT count(*) FROM economy_activity_evidence"):
            return _Result((2,))
        if sql.startswith("SELECT content_version FROM table_publication"):
            return _Result(("reading-v1",))
        if "FROM economy_typed_reading WHERE" in sql:
            return _Result(("sante-et-taille", "ce-que-la-commune-abrite", "reason",
                            "measured", "sirene_snapshot", "v1"))
        if "FROM economy_activity_evidence WHERE" in sql:
            return _Result(("22001", "commune", "sante-et-taille", 1, "A", "Label",
                            1.5, 4, 0.25, "sirene_snapshot", "v1"))
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

    assert SemanticResourceReader._typed_reading_preflight(connection, item, resource) == 3
    assert "groupe=ANY(%s::text[])" in connection.calls[3][0]
    assert connection.calls[3][1] == ["22001", "commune", ["sante-et-taille"]]


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
        "vintage_id": "v1",
    }]
    assert result["ranked_activities"][0]["rank"] == 1
    assert result["ranked_activities"][0]["activity_code"] == "A"
    assert "lq" not in result["facts"][0]


class _AbsenceConnection:
    def __init__(self, declared):
        self.declared = declared

    def execute(self, sql, params=()):
        if "SELECT content_version FROM table_publication" in sql:
            return _Result(("reading-v1",))
        if "FROM milieux_typed_reading WHERE" in sql:
            return _Rows([])
        if "FROM milieux_reading_absence WHERE" in sql:
            return _Rows([("35004", "commune", "source_record_absent", "consoenaf",
                           "v2025/2025-01-01", "a" * 64)] if self.declared else [])
        if "FROM milieux_reading_source WHERE" in sql:
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
                return _Result(("reading-v1", "reference-v1"))
        if "table_name='territory_reference'" in sql:
            return _Result(("reference-v1",))
        if sql.startswith("SELECT count(*) FROM milieux_typed_reading"):
            return _Result((0,))
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
