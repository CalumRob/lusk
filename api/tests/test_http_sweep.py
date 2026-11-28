"""Fast HTTP proofs for the operator sweep; no database or network is used."""

from contextlib import contextmanager
import json
from pathlib import Path
import threading
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from api import main
from api.publication_outcomes import PublicationUnavailable
from api.resource_catalogue import IndicatorResource, ResourceCatalogue
from api.scripts import http_sweep


class Cursor:
    def __init__(self, rows=(), row=None):
        self.rows = list(rows)
        self.row = row

    def fetchone(self):
        return self.row if self.row is not None else (self.rows[0] if self.rows else None)

    def fetchall(self):
        return self.rows


class FakeConnection:
    """One read-only connection shared by the real repository and route executor."""

    def __init__(self, *, unavailable=()):
        self.unavailable = set(unavailable)
        self.statements = []
        self.littoral = {"c-alpha": "C", "c-beta": "NC", "c-gamma": "C"}
        self.territories = [
            ("commune", "c-alpha", "Arc"),
            ("commune", "c-beta", "Belle"),
            ("commune", "c-gamma", "Côte"),
            ("epci", "e-one", "Établissement"),
            ("departement", "d-one", "Département"),
            ("region", "r-one", "Région"),
        ]

    @contextmanager
    def transaction(self):
        yield

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split())
        self.statements.append(normalized)
        if normalized.startswith("SET TRANSACTION"):
            assert "READ ONLY" in normalized
            return Cursor()
        if "FROM table_publication" in normalized:
            return Cursor(row=("reference-v1", 6))
        if "FROM territory_reference" in normalized:
            return Cursor(rows=self.territories)
        if "FROM fixture_publications" in normalized:
            resource_id = params[0]
            if resource_id in self.unavailable:
                return Cursor()
            return Cursor(row=(resource_id + "-v1",))
        raise AssertionError(f"Unexpected SQL: {normalized}")


class Connections:
    def __init__(self, connection):
        self.current = connection

    @contextmanager
    def connection(self):
        yield self.current


class FakeReader:
    """Exercise the real single/batch HTTP adapters and v2 outcome executor."""

    def preflight(self, conn, item, catalogue, *, work_budget, snapshot_state=None):
        row = conn.execute(
            "SELECT content_version FROM fixture_publications WHERE resource_id=%s",
            (item.resource,),
        ).fetchone()
        if row is None:
            raise PublicationUnavailable("scalar", "Fixture publication is absent")
        return 1

    def read(self, conn, item, catalogue, *, snapshot_state=None):
        version = item.resource + "-v1"
        data = {
            "content_version": version,
            "reference_content_version": "reference-v1",
            "descriptor_version": "descriptor-" + version,
        }
        if item.intent.kind == "fixed_comparison" and item.intent.context == "littoral":
            code = conn.littoral.get(item.target.id)
            if code is None:
                raise HTTPException(503, "Fixture littoral classification is unavailable")
            data["comparison"] = {
                "comparison_context": "littoral",
                "group_id": code,
                "territory_type": "commune",
            }
        return {"resource": item.resource, "target": item.target.model_dump(), **data}


def _resource(resource_id, *, context_values=(), resource_kind="indicator",
              target_kinds=("territory",), target_ids=(), intents=None):
    return IndicatorResource(
        resource_id=resource_id,
        theme_id="fixture",
        indicator_id=resource_id,
        label=resource_id,
        unit="count",
        direction="high",
        allowed_levels=("commune", "epci", "departement", "region"),
        sources=("fixture-source",),
        shapes=("scalar",),
        axes=("point",),
        axis_values=(("point", ("p",)),),
        target_kinds=tuple(target_kinds),
        target_ids=tuple(target_ids),
        dynamic_axes=(),
        fields=("value",),
        intents=tuple(intents or ("facts", "fixed_comparison", "selected_comparison")),
        resource_kind=resource_kind,
        context_values=tuple(context_values),
        cellule={
            "coordinates": [{"name": "point", "values": [{"value": "p", "label": "P"}]}],
            "valid_combinations": [{"point": "p"}],
            "default_point": {"point": "p"},
        },
    )


@contextmanager
def sweep_client(*, unavailable=()):
    connection = FakeConnection(unavailable=unavailable)
    catalogue = ResourceCatalogue(
        declarations=(),
        resources=(
            _resource("alpha"),
            _resource(
                "classifier", context_values=("density_class", "littoral", "same_level", "bretagne"),
                resource_kind="fixture_littoral"),
            _resource("reference", target_kinds=("named_reference",),
                      target_ids=("declared-reference",), intents=("facts",)),
        ),
        excluded=(),
    )

    class Repository(main.ReadRepository):
        def resource_catalogue(self, grammar):
            return catalogue

    overrides = {
        main.get_repository: lambda: Repository(Connections(connection)),
        main.get_resource_catalogue: lambda: catalogue,
        main.get_semantic_resource_reader: FakeReader,
    }
    main.app.dependency_overrides.update(overrides)
    try:
        with TestClient(main.app) as client:
            yield client, connection
    finally:
        for dependency in overrides:
            main.app.dependency_overrides.pop(dependency, None)


class ClientTransport:
    def __init__(self, client):
        self.client = client
        self.calls = []
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def request(self, method, path, body=None, *, timeout):
        with self.lock:
            self.calls.append((method, path, body, timeout))
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            response = self.client.request(method, path, json=body)
            return SimpleNamespace(status=response.status_code, body=response.content, error=None)
        finally:
            with self.lock:
                self.active -= 1


def _run(client, **kwargs):
    transport = ClientTransport(client)
    report = http_sweep.run_sweep(
        transport,
        concurrency=kwargs.pop("concurrency", 3),
        timeout=kwargs.pop("timeout", 7),
        search_query_limit=kwargs.pop("search_query_limit", 26),
        max_littoral_probes=kwargs.pop("max_littoral_probes", 8),
        **kwargs,
    )
    return report, transport


def test_every_planned_item_satisfies_the_current_producer_grammar():
    from api.resource_catalogue import validate_resource_item
    from api.resource_requests import ResourceBatchItem
    from api.tests.resource_catalogue_fixtures import default_resource_catalogue

    catalogue = default_resource_catalogue.__wrapped__()
    resources = catalogue.discovery_payload()["resources"]
    candidates = [
        {"type": level, "id": f"{level}-{index}", "name": level}
        for level in ("commune", "epci", "departement", "region")
        for index in range(3)
    ]
    targets = {level: {"type": level, "id": f"{level}-0"}
               for level in ("commune", "epci", "departement", "region")}
    targets["commune:C"] = {"type": "commune", "id": "commune-0", "selection": "littoral:C"}
    targets["commune:NC"] = {"type": "commune", "id": "commune-1", "selection": "littoral:NC"}

    plan = http_sweep._plan_reads(resources, candidates, targets)
    assert plan
    for spec in plan:
        item = {key: value for key, value in spec.items() if key != "level"}
        validate_resource_item(ResourceBatchItem.model_validate(item), catalogue)


def test_discovery_drives_targets_matrix_both_routes_and_bounded_concurrency():
    with sweep_client() as (client, connection):
        report, transport = _run(client, concurrency=2)

    assert report["contract"] == "lusk-http-sweep-v1"
    assert {resource["resource_id"] for resource in report["discovered_resources"]} == {
        "alpha", "classifier", "reference"}
    assert report["errors"] == []
    assert report["targets"]["commune:C"]["id"] == "c-alpha"
    assert report["targets"]["commune:NC"]["id"] == "c-beta"
    assert report["targets"]["epci"]["id"] == "e-one"
    assert report["targets"]["departement"]["id"] == "d-one"
    assert report["targets"]["region"]["id"] == "r-one"
    assert report["targets"]["commune:C"]["classification_evidence"]["group_id"] == "C"
    assert report["targets"]["commune:NC"]["classification_evidence"]["group_id"] == "NC"

    rows = report["results"]
    alpha = [row for row in rows if row["resource"] == "alpha" and row["purpose"] == "sweep"]
    assert {(row["level"], row["intent"]) for row in alpha} == {
        (level, intent)
        for level in ("commune", "epci", "departement", "region")
        for intent in ("facts", "fixed_comparison", "selected_comparison")
    }
    assert len([row for row in alpha if row["level"] == "commune"]) == 6
    assert all(row["http_status"] == 200 for row in rows)
    assert all(row["outcome"] == "available" for row in rows)
    assert all(row["identifiers"]["content_version"] for row in rows)
    assert {row["route"] for row in rows} == {
        "/api/resources/read", "/api/resources/read-batch",
    }
    assert len([row for row in rows if row["purpose"] == "single_route_check"]) == 3
    reference = next(row for row in rows if row["resource"] == "reference")
    assert reference["target"] == {"kind": "named_reference", "id": "declared-reference"}
    assert reference["level"] == "named_reference"
    assert transport.max_active <= 2
    assert {call[3] for call in transport.calls} == {7}
    assert any("READ ONLY" in statement for statement in connection.statements)
    assert connection.littoral["c-alpha"] == "C"


def test_typed_unavailable_is_accepted_and_single_route_check_is_not_guessed():
    with sweep_client(unavailable=("alpha",)) as (client, _connection):
        report, _transport = _run(client)

    alpha = [row for row in report["results"] if row["resource"] == "alpha"]
    assert alpha
    assert all(row["outcome"] == "typed_unavailable" for row in alpha)
    assert all(row["http_status"] == 200 for row in alpha)
    assert all(row["reason"] == "publication_absent" for row in alpha)
    assert all(row["typed_status"] == "publication_unavailable" for row in alpha)
    assert all(row["family"] == "scalar" for row in alpha)
    assert all(row["identifiers"] == {} for row in alpha)
    assert http_sweep.report_exit_code(report) == 0
    assert report["errors"] == []
    summary = report["summary"]
    assert summary["typed_unavailable"] == len(alpha)
    assert summary["requests"] == sum(
        summary[key] for key in ("http_200", "typed_unavailable", "other"))


def test_non_200_is_reported_as_other_and_exits_nonzero():
    class FailingTransport:
        def __init__(self, client):
            self.client = client

        def request(self, method, path, body=None, *, timeout):
            if path == "/api/resources/read-batch" and body["items"][0]["resource"] == "alpha":
                return SimpleNamespace(status=503, body=b'{"detail":"hard failure"}', error=None)
            response = self.client.request(method, path, json=body)
            return SimpleNamespace(status=response.status_code, body=response.content, error=None)

    with sweep_client() as (client, _connection):
        report = http_sweep.run_sweep(
            FailingTransport(client), concurrency=2, timeout=7,
            search_query_limit=26, max_littoral_probes=8)

    failed = [row for row in report["results"]
              if row["resource"] == "alpha" and row["outcome"] == "http_error"]
    assert failed
    assert all(row["http_status"] == 503 for row in failed)
    assert http_sweep.report_exit_code(report) == 1
    assert report["errors"] == [
        {"id": row["id"], "reason": row["error"]} for row in report["results"]
        if row["outcome"] not in {"available", "typed_unavailable"}
    ]


def test_malformed_typed_outcome_is_not_accepted():
    class MalformedTransport:
        def __init__(self, client):
            self.client = client

        def request(self, method, path, body=None, *, timeout):
            response = self.client.request(method, path, json=body)
            raw = response.content
            if path == "/api/resources/read-batch" and body["items"][0]["resource"] == "alpha":
                payload = response.json()
                payload["results"][0] = {
                    "id": payload["results"][0]["id"], "resource": "alpha",
                    "status": "publication_unavailable", "reason": "invented", "family": "scalar",
                }
                raw = json.dumps(payload).encode("utf-8")
            return SimpleNamespace(status=response.status_code, body=raw, error=None)

    with sweep_client() as (client, _connection):
        report = http_sweep.run_sweep(
            MalformedTransport(client), concurrency=2, timeout=7,
            search_query_limit=26, max_littoral_probes=8)

    malformed = [row for row in report["results"] if row["resource"] == "alpha"]
    assert malformed
    assert all(row["http_status"] == 200 for row in malformed)
    assert all(row["outcome"] == "invalid_response" for row in malformed)
    assert http_sweep.report_exit_code(report) == 1


def test_missing_littoral_evidence_fails_instead_of_inventing_targets():
    class NoLittoralReader(FakeReader):
        def read(self, conn, item, catalogue, *, snapshot_state=None):
            if item.intent.kind == "fixed_comparison" and item.intent.context == "littoral":
                raise PublicationUnavailable("scalar", "Fixture publication is absent")
            return super().read(conn, item, catalogue, snapshot_state=snapshot_state)

    with sweep_client() as (client, _connection):
        original = main.app.dependency_overrides[main.get_semantic_resource_reader]
        main.app.dependency_overrides[main.get_semantic_resource_reader] = NoLittoralReader
        try:
            report, _transport = _run(client)
        finally:
            main.app.dependency_overrides[main.get_semantic_resource_reader] = original

    assert report["results"] == []
    assert report["errors"][0]["reason"] == (
        "No API-exposed littoral comparison identified both C and NC commune targets")
    assert http_sweep.report_exit_code(report) == 1


def test_compare_reports_status_version_added_and_removed_changes():
    with sweep_client() as (client, _connection):
        before, _transport = _run(client)
        after, _transport = _run(client)

    first = next(row for row in after["results"] if row["purpose"] == "sweep")
    first["http_status"] = 503
    first["outcome"] = "http_error"
    first["identifiers"]["content_version"] = "changed-version"
    second = next(row for row in after["results"] if row["id"] != first["id"])
    after["results"].remove(second)
    added = dict(second, id="added-row", key="added-key")
    after["results"].append(added)

    comparison = http_sweep.compare_reports(before, after)
    by_key = {change["key"]: change for change in comparison["changes"]}
    assert by_key[first["key"]]["changes"] == ["status_changed", "version_changed"]
    assert by_key[second["key"]]["kind"] == "removed"
    assert by_key[added["key"]]["kind"] == "added"
    assert comparison["summary"]["unchanged"] == len(before["results"]) - 2


def test_compare_cli_exit_codes_and_summary_line(tmp_path, capsys):
    before = tmp_path / "before.json"
    after = tmp_path / "after.json"
    before.write_text(json.dumps({"contract": "lusk-http-sweep-v1", "results": []}), encoding="utf-8")
    after.write_text(json.dumps({"contract": "lusk-http-sweep-v1", "results": []}), encoding="utf-8")

    assert http_sweep.main(["--compare", str(before), str(after)]) == 0
    assert "COMPARE: 0 changes" in capsys.readouterr().err
    payload = json.loads(after.read_text(encoding="utf-8"))
    payload["results"] = [{"key": "new", "http_status": 500, "outcome": "http_error"}]
    after.write_text(json.dumps(payload), encoding="utf-8")
    assert http_sweep.main(["--compare", str(before), str(after)]) == 1


def test_sweep_cli_writes_json_and_prints_exact_summary(tmp_path, capsys, monkeypatch):
    output = tmp_path / "sweep.json"
    with sweep_client() as (client, _connection):
        monkeypatch.setattr(http_sweep, "UrllibClient", lambda *_args, **_kwargs: ClientTransport(client))
        exit_code = http_sweep.main([
            "http://testserver", "--output", str(output), "--concurrency", "2",
            "--timeout", "7", "--search-query-limit", "26", "--max-littoral-probes", "8",
        ])

    captured = capsys.readouterr()
    assert exit_code == 0
    assert captured.err.startswith("SWEEP: ")
    assert captured.out == ""
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["contract"] == "lusk-http-sweep-v1"
    assert captured.err.strip() == http_sweep.summary_line(report)


def test_summary_line_has_exact_operator_format():
    report = {"summary": {"requests": 5, "http_200": 2, "typed_unavailable": 1, "other": 2}}
    assert http_sweep.summary_line(report) == "SWEEP: 5 requests | 200: 2 | typed-unavailable: 1 | other: 2"


def test_script_has_no_fixture_ids_database_driver_or_credentials():
    source = Path(http_sweep.__file__).read_text(encoding="utf-8")
    for fixture_id in ("c-alpha", "c-beta", "e-one", "d-one", "r-one"):
        assert fixture_id not in source
    assert "psycopg" not in source.lower()
    assert "DATABASE_URL" not in source
    assert "Authorization" not in source
    assert "PGPASSFILE" not in source


def test_url_credentials_are_rejected_and_proxy_credentials_are_disabled():
    with pytest.raises(http_sweep.SweepError):
        http_sweep.UrllibClient("https://user:secret@example.test")
    client = http_sweep.UrllibClient("https://example.test")
    assert not any(isinstance(handler, http_sweep.urllib.request.ProxyHandler)
                   for handler in client._opener.handlers)
