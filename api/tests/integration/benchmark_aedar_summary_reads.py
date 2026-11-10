"""Bounded, read-only AEDAR old/new read-path benchmark for an explicit fixture.

Run from the repository root with the explicit guarded test-only settings in
api/tests/integration/README.md and a fixture accepted by the current API marker
gate. The script uses the current checkout and the pinned pre-summary API commit
against the same schema and producer metadata. It never connects with the
publisher role or writes rows.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import inspect
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.parse import parse_qs, quote, urlencode, urlsplit, urlunsplit


OLD_API_COMMIT = "ebb737885548ce4c002bc04fadf178c8d7b0743b"
EXTRAPOLATION_TERRITORIES = 1268
SCHEMA_RE = re.compile(r"it_aedar_[0-9a-f]{16}\Z")
WORKLOAD_LABELS = ("40-values-2-ranks", "40-values-40-ranks")


def _scoped_read_dsn(read_dsn: str, schema: str) -> str:
    parts = urlsplit(read_dsn)
    query = parse_qs(parts.query)
    query["options"] = [
        f"-csearch_path={schema} -cdefault_transaction_read_only=on "
        "-cstatement_timeout=45000 -clock_timeout=5000 "
        "-cidle_in_transaction_session_timeout=60000"
    ]
    # libpq's URI parser does not treat `+` as a space in `options`; use %20
    # so each -c argument remains a separate PostgreSQL option.
    return urlunsplit((parts.scheme, parts.netloc, parts.path,
                       urlencode(query, doseq=True, quote_via=quote), parts.fragment))


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _require_current_api_comparison_marker(connection):
    """Require the current API's full comparison gate before adapter timing."""
    from fastapi import HTTPException
    import psycopg
    from api import aedar_reads

    try:
        return aedar_reads._aedar_comparison_marker(connection)
    except HTTPException as error:
        raise RuntimeError(
            "current API comparison-marker preflight failed; use a fixture with aligned "
            "source/reference clocks and a complete migration-042 comparison publication"
        ) from error
    except (psycopg.errors.UndefinedColumn, psycopg.errors.UndefinedTable) as error:
        raise RuntimeError(
            "benchmark fixture lacks the current AEDAR comparison schema (including migration 042); "
            "do not patch its publication marker"
        ) from error


def _timed_adapter_preparation(connection, fixture, batch, label, active):
    """Validate the API marker outside timing, then measure only preparation."""
    from api import aedar_reads

    active["label"] = None
    prepare = aedar_reads._aedar_prepare_fixed_aggregate_batch
    if "marker" in inspect.signature(prepare).parameters:
        # The current implementation takes the marker as an explicit input.
        marker = _require_current_api_comparison_marker(connection)
        prepare_call = lambda: prepare(
            connection, fixture["territory_type"], fixture["territory_id"],
            fixture["context"], batch, marker)
    else:
        # The pinned old implementation owns its older marker shape. Validate it
        # outside timing too; the full current API gate was already checked by
        # the parent process before either version's worker was launched.
        aedar_reads._aedar_comparison_marker(connection)
        prepare_call = lambda: prepare(
            connection, fixture["territory_type"], fixture["territory_id"],
            fixture["context"], batch)
    active["label"] = label
    started = time.perf_counter()
    try:
        prepared = prepare_call()
    finally:
        active["label"] = None
    elapsed_ms = (time.perf_counter() - started) * 1000
    return prepared, elapsed_ms


def _guarded_fixture(schema: str) -> tuple[dict, dict]:
    if not SCHEMA_RE.fullmatch(schema):
        raise RuntimeError("schema must be an explicit retained it_aedar_<16 hex> namespace")
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
        raise RuntimeError("unset LUSK_TEST_ALLOW_SCHEMA_CLEANUP; this benchmark is read-only")

    from api.tests.integration.test_postgres_publication import (
        _aedar_guarded_configuration,
        _assert_aedar_server_identity,
    )
    import psycopg

    _publish_dsn, read_dsn = _aedar_guarded_configuration()
    scoped_dsn = _scoped_read_dsn(read_dsn, schema)
    with psycopg.connect(scoped_dsn) as conn:
        _assert_aedar_server_identity(conn, "lusk_it_contract_read")
        conn.execute("SET TRANSACTION READ ONLY")
        conn.execute(f'SET LOCAL search_path TO "{schema}"')
        if conn.execute("SELECT current_schema()").fetchone()[0] != schema:
            raise RuntimeError("read connection did not enter the explicitly retained schema")
        found = conn.execute("SELECT to_regnamespace(%s)", (schema,)).fetchone()[0]
        if found != schema:
            raise RuntimeError(f"retained guarded schema is absent: {schema}")

        markers = conn.execute("""SELECT table_name,content_version,row_count,
                reference_content_version,aedar_source_content_version
            FROM table_publication
            WHERE table_name IN ('territory_reference','aedar_territorial_aggregate',
                                 'aedar_territory_summary')
            ORDER BY table_name""").fetchall()
        marker_map = {row[0]: row[1:] for row in markers}
        if set(marker_map) != {"territory_reference", "aedar_territorial_aggregate",
                               "aedar_territory_summary"}:
            raise RuntimeError("guarded fixture is missing an AEDAR publication marker")
        summary = marker_map["aedar_territory_summary"]
        aggregate = marker_map["aedar_territorial_aggregate"]
        reference = marker_map["territory_reference"]
        if (summary[2] != reference[0] or summary[3] != aggregate[0]
                or aggregate[2] != reference[0]):
            raise RuntimeError("AEDAR summary/source/reference clocks are not aligned")
        comparison_gate = conn.execute("""SELECT
                p.aedar_content_version=a.content_version,
                p.reference_content_version=r.content_version,
                p.group_row_count,p.territory_row_count,p.publication_mode,
                p.content_version,p.source_snapshot_id,p.aedar_content_version,
                p.reference_content_version,p.input_content_version
            FROM aedar_comparison_publication p
            JOIN table_publication a ON a.table_name='aedar_territorial_aggregate'
            JOIN table_publication r ON r.table_name='territory_reference'
            WHERE p.singleton""").fetchone()
        if not comparison_gate:
            raise RuntimeError("retained fixture is missing its comparison publication marker")
        _require_current_api_comparison_marker(conn)

        measures = [row[0] for row in conn.execute(
            "SELECT DISTINCT measure FROM aedar_territory_summary ORDER BY measure").fetchall()]
        if len(measures) != 40:
            raise RuntimeError(f"expected 40 producer-published summary measures; found {len(measures)}")

        peer_row = conn.execute("""SELECT focal.territory_id,focal.epci_id,
                array_agg(peer.territory_id ORDER BY peer.territory_id)
            FROM territory_reference focal
            JOIN territory_reference peer
              ON peer.territory_type='commune' AND peer.epci_id=focal.epci_id
            WHERE focal.territory_type='commune' AND focal.epci_id IS NOT NULL
            GROUP BY focal.territory_id,focal.epci_id
            HAVING count(*) >= 2
            ORDER BY focal.territory_id
            LIMIT 1""").fetchone()
        if not peer_row:
            raise RuntimeError("fixture has no commune with at least two EPCI-derived peers")
        focal_id, epci_id, peer_ids = peer_row
        if focal_id not in peer_ids:
            raise RuntimeError("fixture-derived peer group does not contain its focal commune")

        expected = len(peer_ids) * len(measures)
        summary_count = conn.execute("""SELECT count(*) FROM aedar_territory_summary
            WHERE territory_type='commune' AND territory_id=ANY(%s::text[])
              AND measure=ANY(%s::text[])""", (peer_ids, measures)).fetchone()[0]
        if summary_count != expected:
            raise RuntimeError("producer-published summary rows are incomplete for the peer fixture")
        aggregate_peers = conn.execute("""SELECT count(*) FROM aedar_territorial_aggregate
            WHERE territory_type='commune' AND territory_id=ANY(%s::text[])""",
            (peer_ids,)).fetchone()[0]
        if aggregate_peers < len(peer_ids):
            raise RuntimeError("legacy source-grain fixture is incomplete for the peer group")

        relations = {}
        for relation in ("aedar_territorial_aggregate", "aedar_territory_summary",
                         "aedar_comparison_group"):
            row = conn.execute("""SELECT pg_relation_size(c.oid),pg_table_size(c.oid),
                    pg_indexes_size(c.oid),pg_total_relation_size(c.oid),
                    CASE WHEN c.reltoastrelid=0 THEN 0
                         ELSE pg_total_relation_size(c.reltoastrelid) END
                FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname=%s AND c.relname=%s""", (schema, relation)).fetchone()
            if not row:
                raise RuntimeError(f"guarded fixture relation is absent: {relation}")
            relations[relation] = {
                "heap_main_bytes": row[0],
                "table_including_toast_bytes": row[1],
                "index_bytes": row[2],
                "total_bytes": row[3],
                "toast_total_bytes": row[4],
            }

        counts = {
            "typed_rows": conn.execute("SELECT count(*) FROM aedar_territorial_aggregate").fetchone()[0],
            "typed_territories": conn.execute("""SELECT count(DISTINCT (territory_type,territory_id))
                FROM aedar_territorial_aggregate""").fetchone()[0],
            "summary_rows": conn.execute("SELECT count(*) FROM aedar_territory_summary").fetchone()[0],
            "summary_territories": conn.execute("""SELECT count(DISTINCT (territory_type,territory_id))
                FROM aedar_territory_summary""").fetchone()[0],
            "comparison_group_rows": conn.execute(
                "SELECT count(*) FROM aedar_comparison_group").fetchone()[0],
        }

    fixture = {
        "territory_type": "commune",
        "territory_id": focal_id,
        "context": "epci",
        "group_id": epci_id,
        "peer_ids": peer_ids,
        "measures": measures,
        "ranked_measures": measures[:2],
    }
    snapshot = {"markers": {name: list(values) for name, values in marker_map.items()},
                "comparison_endpoint_gate": (list(comparison_gate) if comparison_gate else None),
                "current_api_marker_preflight_passed": True,
                "counts": counts, "relations": relations}
    return {"scoped_dsn": scoped_dsn, "fixture": fixture}, snapshot


def _archive_old_api(root: Path, destination: Path) -> Path:
    archive = subprocess.run(
        ["git", "archive", "--format=tar", OLD_API_COMMIT, "api"],
        cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if archive.returncode:
        raise RuntimeError("could not extract pinned pre-summary API source")
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive.stdout), mode="r:") as tar:
        for member in tar.getmembers():
            if member.name != "api" and not member.name.startswith("api/"):
                raise RuntimeError("unexpected path in pinned API archive")
        tar.extractall(destination, filter="data")
    return destination


def _run_worker(root: Path, current_root: Path, scoped_dsn: str,
                fixture: dict, version: str) -> dict:
    env = os.environ.copy()
    env["DATABASE_URL"] = scoped_dsn
    env["LUSK_BENCH_FIXTURE"] = json.dumps(fixture, separators=(",", ":"))
    env["LUSK_PRODUCER_METADATA_DIR"] = str(current_root / "pipeline" / "inst" / "extdata")
    env["PYTHONPATH"] = str(root) + os.pathsep + str(current_root)
    env["PYTHONUNBUFFERED"] = "1"
    run = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--worker"],
        cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", timeout=120, check=False)
    if run.returncode:
        # Errors may echo connection details; retain only the terminal traceback
        # lines and redact any URI before making the failure actionable.
        detail = "\n".join(run.stderr.splitlines()[-5:])
        detail = re.sub(r"postgres(?:ql)?://\S+", "[redacted DSN]", detail)
        raise RuntimeError(f"{version} adapter benchmark worker failed (exit {run.returncode}):\n{detail}")
    output = [line.removeprefix("AEDAR_BENCH_JSON=") for line in run.stdout.splitlines()
              if line.startswith("AEDAR_BENCH_JSON=")]
    if len(output) != 1:
        raise RuntimeError(f"{version} API benchmark worker returned no unique receipt")
    return json.loads(output[0])


def _worker() -> None:
    fixture = json.loads(os.environ["LUSK_BENCH_FIXTURE"])
    import psycopg
    from api.resource_catalogue import default_resource_catalogue

    catalogue = default_resource_catalogue()
    declaration = catalogue.resources_by_id["aedar_territorial_aggregate"]
    if not set(fixture["measures"]).issubset(declaration.measure_facets):
        raise RuntimeError("producer-published measures are not accepted by this API declaration")

    queries: dict[str, list[dict]] = {label: [] for label in WORKLOAD_LABELS}
    active = {"label": None}

    class ObservedConnection:
        def __init__(self, connection):
            self._connection = connection

        def execute(self, query, params=None):
            label = active["label"]
            if label is not None:
                queries[label].append({"sql": str(query), "params": params})
            if params is None:
                return self._connection.execute(query)
            return self._connection.execute(query, params)

        def __getattr__(self, name):
            return getattr(self._connection, name)

    results = {}
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        for label in WORKLOAD_LABELS:
            ranked = (fixture["ranked_measures"] if label == WORKLOAD_LABELS[0]
                      else fixture["measures"])
            batch = {"measures": fixture["measures"],
                     "rank_measures": ranked,
                     "peer_ids": fixture["peer_ids"]}
            with conn.transaction():
                conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                prepared, elapsed_ms = _timed_adapter_preparation(
                    ObservedConnection(conn), fixture, batch, label, active)

            comparisons = []
            for measure in fixture["measures"]:
                focal = prepared["territorial"].get(measure, {}).get(fixture["territory_id"])
                group = prepared["groups"].get(measure)
                if focal is None or group is None:
                    raise RuntimeError(f"{label} adapter omitted a focal/group reading: {measure}")
                comparison = {
                    "measure": measure,
                    "value": focal["value"],
                    "available": focal["available"],
                    "n_addresses": focal["n_addresses"],
                    "n_observed": focal["n_observed"],
                    "coverage_status": focal["coverage_status"],
                    "group_value": group["value"],
                    "group_available": group["available"],
                    "group_n_addresses": group["n_addresses"],
                    "group_n_observed": group["n_observed"],
                    "group_coverage_status": group["coverage_status"],
                }
                if measure in ranked:
                    records = prepared["territorial"].get(measure, {})
                    values = [record["value"] for record in records.values()
                              if record["available"] and record["value"] is not None]
                    focal_value = focal["value"]
                    direction = declaration.measure_facets[measure]["direction"]
                    if focal_value is None:
                        rank = rank_size = rank_ties = None
                    else:
                        better = sum(value > focal_value if direction == "high"
                                     else value < focal_value for value in values)
                        rank = better + 1
                        rank_size = len(values)
                        rank_ties = sum(value == focal_value for value in values)
                    comparison.update(rank=rank, rank_size=rank_size, rank_ties=rank_ties)
                comparisons.append(comparison)

            peer_reading_count = sum(len(records) for records in prepared["territorial"].values())
            encoded = json.dumps(comparisons, sort_keys=True, separators=(",", ":"),
                                 ensure_ascii=False, allow_nan=False).encode("utf-8")
            results[label] = {
                "adapter_elapsed_ms": round(elapsed_ms, 3),
                "measurement": ("direct batch-adapter elapsed; SQL and Python adapter work, "
                                "not HTTP/API endpoint latency"),
                "adapter_projection_bytes": len(encoded),
                "projection_items": len(comparisons),
                "value_count": len(comparisons),
                "group_value_count": len(comparisons),
                "rank_count": len(ranked),
                "ranked_measure_ids": ranked,
                "peer_reading_count": peer_reading_count,
                "source_query_count": len(queries[label]),
                "comparison_sha256": hashlib.sha256(encoded).hexdigest(),
            }

    plans = {}
    for label in WORKLOAD_LABELS:
        candidates = []
        for entry in queries[label]:
            sql = " ".join(entry["sql"].lower().split())
            params = entry["params"]
            if not isinstance(params, (tuple, list)):
                continue
            if "from aedar_territory_summary where" in sql and len(params) == 3:
                territory_type, ids, measures = params
                if (territory_type == fixture["territory_type"]
                        and sorted(ids) == sorted(fixture["peer_ids"])
                        and len(measures) == len(fixture["measures"])):
                    candidates.append(entry)
            elif ("from aedar_territorial_aggregate a cross join unnest" in sql
                  and len(params) == 3):
                measures, territory_type, ids = params
                ranked_count = (len(fixture["ranked_measures"]) if label == WORKLOAD_LABELS[0]
                                else len(fixture["measures"]))
                if (territory_type == fixture["territory_type"]
                        and sorted(ids) == sorted(fixture["peer_ids"])
                        and len(measures) == ranked_count):
                    candidates.append(entry)
        if not candidates:
            raise RuntimeError(f"could not identify the peer-population SELECT for {label}")
        plans[label] = candidates[-1]

    print("AEDAR_BENCH_JSON=" + json.dumps({"results": results, "plan_queries": plans},
                                             separators=(",", ":"), allow_nan=False))


def _explain_plans(read_dsn: str, schema: str, plan_queries: dict) -> dict:
    import psycopg

    plans = {}
    with psycopg.connect(read_dsn) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        conn.execute(f'SET LOCAL search_path TO "{schema}"')
        for version, label, key in (
            ("old", WORKLOAD_LABELS[0], "old_40-values-2-ranks"),
            ("old", WORKLOAD_LABELS[1], "old_40-values-40-ranks"),
            ("current", WORKLOAD_LABELS[0], "current_40-values-2-ranks"),
            ("current", WORKLOAD_LABELS[1], "current_40-values-40-ranks"),
        ):
            query = plan_queries[version][label]
            sql = query["sql"]
            if not sql.lstrip().lower().startswith("select ") or ";" in sql.rstrip().rstrip(";"):
                raise RuntimeError("refusing to EXPLAIN a non-SELECT or multi-statement query")
            if "aedar_territorial_aggregate" not in sql and "aedar_territory_summary" not in sql:
                raise RuntimeError("refusing an EXPLAIN outside the AEDAR read tables")
            plan = conn.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql,
                                query["params"]).fetchone()[0]
            plans[key] = {
                "source": "captured SELECT from the corresponding fixed-batch adapter call",
                "sql": sql,
                "parameters": query["params"],
                "explain_json": plan,
            }
    return plans


def _postcheck_snapshot(scoped_dsn: str, schema: str) -> dict:
    import psycopg

    snapshot = {}
    with psycopg.connect(scoped_dsn) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        conn.execute(f'SET LOCAL search_path TO "{schema}"')
        for relation in ("aedar_territorial_aggregate", "aedar_territory_summary",
                         "aedar_comparison_group"):
            row = conn.execute("""SELECT pg_relation_size(c.oid),pg_table_size(c.oid),
                    pg_indexes_size(c.oid),pg_total_relation_size(c.oid),
                    CASE WHEN c.reltoastrelid=0 THEN 0
                         ELSE pg_total_relation_size(c.reltoastrelid) END
                FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname=%s AND c.relname=%s""", (schema, relation)).fetchone()
            snapshot[relation] = list(row)
        snapshot["markers"] = conn.execute("""SELECT table_name,content_version,row_count,
                reference_content_version,aedar_source_content_version
            FROM table_publication
            WHERE table_name IN ('territory_reference','aedar_territorial_aggregate',
                                 'aedar_territory_summary') ORDER BY table_name""").fetchall()
        gate = conn.execute("""SELECT
                p.aedar_content_version=a.content_version,
                p.reference_content_version=r.content_version,
                p.group_row_count,p.territory_row_count,p.publication_mode,
                p.content_version,p.source_snapshot_id,p.aedar_content_version,
                p.reference_content_version,p.input_content_version
            FROM aedar_comparison_publication p
            JOIN table_publication a ON a.table_name='aedar_territorial_aggregate'
            JOIN table_publication r ON r.table_name='territory_reference'
            WHERE p.singleton""").fetchone()
        snapshot["comparison_endpoint_gate"] = list(gate) if gate else None
        snapshot["counts"] = [
            conn.execute("SELECT count(*) FROM aedar_territorial_aggregate").fetchone()[0],
            conn.execute("SELECT count(*) FROM aedar_territory_summary").fetchone()[0],
            conn.execute("SELECT count(*) FROM aedar_comparison_group").fetchone()[0],
        ]
    return snapshot


def _main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default=os.environ.get("AEDAR_BENCH_SCHEMA"),
                        help="explicit current compatible it_aedar_<16 hex> test schema")
    parser.add_argument("--output", default=r"E:\Temp\opencode\aedar-summary-benchmark-current.json")
    parser.add_argument("--publisher-aggregate-summary-seconds", type=float, default=None)
    parser.add_argument("--publisher-comparison-seconds", type=float, default=None)
    parser.add_argument("--whole-integration-proof-seconds", type=float, default=None)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        _worker()
        return
    if not args.schema:
        parser.error("provide an explicit current compatible schema with --schema or AEDAR_BENCH_SCHEMA")

    root = _repo_root()
    prepared, before = _guarded_fixture(args.schema)
    current_commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True, encoding="utf-8").strip()
    with tempfile.TemporaryDirectory(prefix="aedar-old-api-", dir=r"E:\Temp\opencode") as tmp:
        old_root = _archive_old_api(root, Path(tmp))
        old = _run_worker(old_root, root, prepared["scoped_dsn"], prepared["fixture"], "old")
        current = _run_worker(root, root, prepared["scoped_dsn"], prepared["fixture"], "current")

    for label in WORKLOAD_LABELS:
        old_digest = old["results"][label]["comparison_sha256"]
        current_digest = current["results"][label]["comparison_sha256"]
        if old_digest != current_digest:
            raise RuntimeError(f"old/current comparison payload mismatch for {label}")

    read_dsn = prepared["scoped_dsn"]
    plan_queries = {"old": old["plan_queries"], "current": current["plan_queries"]}
    plans = _explain_plans(read_dsn, args.schema, plan_queries)
    after = _postcheck_snapshot(read_dsn, args.schema)
    size_keys = ("heap_main_bytes", "table_including_toast_bytes", "index_bytes",
                 "total_bytes", "toast_total_bytes")
    expected_after = {
        "aedar_territorial_aggregate": [before["relations"]["aedar_territorial_aggregate"][key]
            for key in size_keys],
        "aedar_territory_summary": [before["relations"]["aedar_territory_summary"][key]
            for key in size_keys],
        "aedar_comparison_group": [before["relations"]["aedar_comparison_group"][key]
            for key in size_keys],
        "markers": [(name, *values) for name, values in before["markers"].items()],
        "comparison_endpoint_gate": before["comparison_endpoint_gate"],
        "counts": [before["counts"]["typed_rows"], before["counts"]["summary_rows"],
                   before["counts"]["comparison_group_rows"]],
    }
    normalized_after = {key: ([tuple(row) for row in value] if key == "markers" else value)
                        for key, value in after.items()}
    if normalized_after != expected_after:
        raise RuntimeError("read-only benchmark changed fixture rows, publication clocks, or relation sizes")

    summary_rows = before["counts"]["summary_rows"]
    extrapolation_rows = EXTRAPOLATION_TERRITORIES * len(prepared["fixture"]["measures"])
    extrapolated_total_bytes = round(
        before["relations"]["aedar_territory_summary"]["total_bytes"]
        / summary_rows * extrapolation_rows)
    receipt = {
        "benchmark": "AEDAR retained-fixture old/new query-level adapter paths",
        "classification": "synthetic guarded fixture; not production latency",
        "target": {"database": "lusk_it_contract", "schema": args.schema,
                   "role": "dedicated read-only test role; credentials omitted"},
        "api": {
            "old_commit": OLD_API_COMMIT,
            "current_commit": current_commit,
            "endpoint": "POST /api/resources/read-batch",
            "endpoint_latency_reported": False,
            "endpoint_not_run_reason": "this harness is deliberately query-level; it does not time HTTP endpoints",
            "comparison_gate_passes": before["current_api_marker_preflight_passed"],
            "current_api_marker_preflight_passed": before["current_api_marker_preflight_passed"],
            "comparison_marker_gate": {
                "source_clock_matches": before["comparison_endpoint_gate"][0],
                "reference_clock_matches": before["comparison_endpoint_gate"][1],
                "group_row_count": before["comparison_endpoint_gate"][2],
                "territory_row_count": before["comparison_endpoint_gate"][3],
                "publication_mode": before["comparison_endpoint_gate"][4],
                "content_version": before["comparison_endpoint_gate"][5],
                "source_snapshot_id": before["comparison_endpoint_gate"][6],
                "aedar_content_version": before["comparison_endpoint_gate"][7],
                "reference_content_version": before["comparison_endpoint_gate"][8],
                "input_content_version": before["comparison_endpoint_gate"][9],
            },
            "query_level_method": "call the version-specific fixed batch adapter directly in a read-only "
                                  "repeatable-read transaction; includes adapter SQL and Python projection, "
                                  "not HTTP validation, marker preflight, or network overhead",
            "workload_calls_per_version": 2,
            "measures_per_call": 40,
        },
        "workload_fixture": {
            "territory_type": prepared["fixture"]["territory_type"],
            "territory_id": prepared["fixture"]["territory_id"],
            "comparison_context": prepared["fixture"]["context"],
            "group_id": prepared["fixture"]["group_id"],
            "peer_ids": prepared["fixture"]["peer_ids"],
            "producer_published_measure_count": len(prepared["fixture"]["measures"]),
            "ranked_measure_ids": prepared["fixture"]["ranked_measures"],
        },
        "fixture_snapshot_before": before,
        "query_level_adapter_results": {
            "old": old["results"],
            "current": current["results"],
            "adapter_projections_match": True,
        },
        "plans": plans,
        "publisher_stage_receipts": {
            "aggregate_plus_summary_publish_seconds": args.publisher_aggregate_summary_seconds,
            "comparison_publish_seconds": args.publisher_comparison_seconds,
            "provenance": ("separate fixture-stage elapsed receipts from the prior successful guarded "
                           "R publisher proof; not included in query-level adapter timings"),
            "whole_integration_proof_seconds": args.whole_integration_proof_seconds,
            "whole_proof_note": "end-to-end proof duration only; never used as read latency",
        },
        "extrapolation": {
            "territories": EXTRAPOLATION_TERRITORIES,
            "producer_measures_per_territory": len(prepared["fixture"]["measures"]),
            "rows": extrapolation_rows,
            "linear_total_relation_bytes": extrapolated_total_bytes,
            "formula": "fixture summary total bytes / fixture summary rows * extrapolated rows",
            "status": "linear extrapolation from five synthetic territories; not production storage",
        },
        "fixture_snapshot_after": after,
        "read_only_invariant": "row counts, publication markers, and relation sizes match pre-run snapshot",
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
                      encoding="utf-8")
    print(json.dumps({"receipt": str(output), "old": old["results"],
                      "current": current["results"], "plan_count": len(plans)}, indent=2))


if __name__ == "__main__":
    _main()
