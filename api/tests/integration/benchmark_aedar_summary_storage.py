"""One-shot, explicitly opted-in AEDAR summary storage probe.

This writes only a new synthetic table in guarded lusk_it_contract. It copies
one complete retained-fixture territory across synthetic IDs and leaves the
schema in place for inspection. It is deliberately separate from the
read-only adapter benchmark.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit
import uuid


SOURCE_SCHEMA = "it_aedar_1bed7545b6524889"
SOURCE_TABLE = "aedar_territory_summary"
TARGET_TABLE = "aedar_territory_summary"
TERRITORIES = 1268
MEASURES_PER_TERRITORY = 40
EXPECTED_ROWS = TERRITORIES * MEASURES_PER_TERRITORY
CONFIRMATION = "CREATE_SYNTHETIC_SCHEMA_IN_LUSK_IT_CONTRACT"
DEFAULT_EVIDENCE_ROOT = Path(r"E:\Temp\opencode\aedar-summary-storage")


def _write_json(path: Path, value: dict) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def _relation_sizes(connection, schema: str, table: str) -> dict[str, int]:
    row = connection.execute("""SELECT pg_relation_size(c.oid),pg_table_size(c.oid),
            pg_indexes_size(c.oid),pg_total_relation_size(c.oid),
            CASE WHEN c.reltoastrelid=0 THEN 0
                 ELSE pg_total_relation_size(c.reltoastrelid) END
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=%s AND c.relname=%s AND c.relkind='r'""",
        (schema, table)).fetchone()
    if not row:
        raise RuntimeError(f"expected table is absent: {schema}.{table}")
    return {
        "heap_main_bytes": row[0],
        "table_including_toast_bytes": row[1],
        "index_bytes": row[2],
        "total_bytes": row[3],
        "toast_total_bytes": row[4],
    }


def _run(schema: str, evidence_dir: Path) -> dict:
    from psycopg import sql
    import psycopg

    from api.tests.integration.test_postgres_publication import (
        _aedar_guarded_configuration,
        _assert_aedar_server_identity,
    )

    if not re.fullmatch(r"it_aedar_size_[0-9a-f]{32}", schema):
        raise RuntimeError("synthetic schema name is outside the one-shot probe namespace")
    publish_dsn, _read_dsn = _aedar_guarded_configuration()
    parts = urlsplit(publish_dsn)
    if parts.username != "lusk_it_contract_pub":
        raise RuntimeError("refusing a connection that is not the verified publisher test role")

    synthetic_relation = sql.Identifier(schema, TARGET_TABLE)
    source_relation = sql.Identifier(SOURCE_SCHEMA, SOURCE_TABLE)
    columns = sql.SQL(",").join(map(sql.Identifier, (
        "territory_type", "territory_id", "measure", "value", "status",
        "n_typequ", "n_addresses", "n_observed", "coverage_status", "source_id",
        "vintage_id", "source_url", "licence", "attribution", "reference_date",
        "publication_date",
    )))

    os.environ["PGCONNECT_TIMEOUT"] = "5"
    os.environ["PGOPTIONS"] = (
        "-c statement_timeout=45000 -c lock_timeout=5000 "
        "-c idle_in_transaction_session_timeout=60000"
    )
    with psycopg.connect(publish_dsn, connect_timeout=5) as connection:
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        _assert_aedar_server_identity(connection, "lusk_it_contract_pub")
        connection.execute("SET LOCAL statement_timeout = '45s'")
        connection.execute("SET LOCAL lock_timeout = '5s'")
        connection.execute("SET LOCAL idle_in_transaction_session_timeout = '60s'")

        if connection.execute("SELECT to_regnamespace(%s)", (schema,)).fetchone()[0]:
            raise RuntimeError("random synthetic schema already exists; refusing to reuse it")
        if not connection.execute("SELECT to_regclass(%s)",
                                  (f"{SOURCE_SCHEMA}.{SOURCE_TABLE}",)).fetchone()[0]:
            raise RuntimeError("retained summary template table is absent")

        source_before = {
        "rows": connection.execute(
                sql.SQL("SELECT count(*) FROM {}").format(source_relation)).fetchone()[0],
            "relation_sizes": _relation_sizes(connection, SOURCE_SCHEMA, SOURCE_TABLE),
        }
        template = connection.execute(sql.SQL("""SELECT territory_type,territory_id,
                count(*) AS rows,count(DISTINCT measure) AS measures
            FROM {} GROUP BY territory_type,territory_id
            HAVING count(*)=%s AND count(DISTINCT measure)=%s
            ORDER BY territory_type,territory_id LIMIT 1""").format(source_relation),
            (MEASURES_PER_TERRITORY, MEASURES_PER_TERRITORY)).fetchone()
        if not template:
            raise RuntimeError("no complete 40-record territory exists in the retained fixture")
        source_type, source_id, source_rows, source_measures = template

        # All DDL and the single insert target this newly generated schema only.
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        connection.execute(sql.SQL("CREATE TABLE {} (LIKE {} INCLUDING ALL)")
                           .format(synthetic_relation, source_relation))
        inserted = connection.execute(sql.SQL("""INSERT INTO {} ({})
            SELECT source.territory_type,
                   'synthetic-' || lpad(ids.synthetic_id::text,6,'0'),
                   source.measure,source.value,source.status,source.n_typequ,
                   source.n_addresses,source.n_observed,source.coverage_status,
                   source.source_id,source.vintage_id,source.source_url,
                   source.licence,source.attribution,source.reference_date,
                   source.publication_date
            FROM {} AS source
            CROSS JOIN generate_series(1,%s) AS ids(synthetic_id)
            WHERE source.territory_type=%s AND source.territory_id=%s""")
            .format(synthetic_relation, columns, source_relation),
            (TERRITORIES, source_type, source_id))
        if inserted.rowcount != EXPECTED_ROWS:
            raise RuntimeError(f"expected {EXPECTED_ROWS} inserted rows; got {inserted.rowcount}")

        counts = connection.execute(sql.SQL("""SELECT
                count(*) AS rows,
                count(DISTINCT (territory_type,territory_id)) AS territories,
                count(DISTINCT measure) AS measures,
                count(*) FILTER (WHERE territory_id !~ '^synthetic-[0-9]{{6}}$') AS non_synthetic_ids
            FROM {}""").format(synthetic_relation)).fetchone()
        bad_territories = connection.execute(sql.SQL("""SELECT count(*) FROM (
                SELECT territory_type,territory_id
                FROM {} GROUP BY territory_type,territory_id
                HAVING count(*)<>%s OR count(DISTINCT measure)<>%s
            ) AS incomplete""").format(synthetic_relation),
            (MEASURES_PER_TERRITORY, MEASURES_PER_TERRITORY)).fetchone()[0]
        if counts != (EXPECTED_ROWS, TERRITORIES, MEASURES_PER_TERRITORY, 0) or bad_territories:
            raise RuntimeError(
                "synthetic row/territory/measure verification failed: "
                f"counts={counts!r}, incomplete_territories={bad_territories}"
            )

        index_names = [row[0] for row in connection.execute("""SELECT indexrelid::regclass::text
            FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
            JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname=%s AND t.relname=%s ORDER BY indexrelid::regclass::text""",
            (schema, TARGET_TABLE)).fetchall()]
        if len(index_names) != 2:
            raise RuntimeError(f"expected the cloned primary-key and lookup indexes; found {len(index_names)}")

        target_sizes = _relation_sizes(connection, schema, TARGET_TABLE)
        source_after = {
            "rows": connection.execute(
                sql.SQL("SELECT count(*) FROM {}").format(source_relation)).fetchone()[0],
            "relation_sizes": _relation_sizes(connection, SOURCE_SCHEMA, SOURCE_TABLE),
        }
        if source_after != source_before:
            raise RuntimeError("retained source row count or relation sizes changed during the probe")

    return {
        "benchmark": "AEDAR fresh synthetic summary-table physical storage probe",
        "classification": "synthetic guarded test schema; not production storage or acceptance",
        "target": {
            "database": "lusk_it_contract",
            "schema": schema,
            "role": "lusk_it_contract_pub; credentials omitted",
            "retained": True,
        },
        "source_template": {
            "schema": SOURCE_SCHEMA,
            "table": SOURCE_TABLE,
            "territory_type": source_type,
            "territory_id": source_id,
            "source_rows": source_rows,
            "distinct_measures": source_measures,
            "copied_fields": "all summary fields except territory_id; metadata/provenance values are fixture copies",
            "source_before": source_before,
            "source_after": source_after,
        },
        "synthetic_population": {
            "territories": TERRITORIES,
            "measures_per_territory": MEASURES_PER_TERRITORY,
            "expected_rows": EXPECTED_ROWS,
            "verified_rows": counts[0],
            "verified_distinct_territories": counts[1],
            "verified_distinct_measures": counts[2],
            "incomplete_territories": bad_territories,
            "id_pattern": "synthetic-000001 through synthetic-001268",
        },
        "table_definition": "CREATE TABLE LIKE retained summary INCLUDING ALL; cloned constraints and production indexes; no publication marker, trigger, grant, or extra index created",
        "indexes": index_names,
        "relation_sizes_bytes": target_sizes,
        "measurement": "PostgreSQL relation sizes after one INSERT; no ANALYZE, publication, or serving-table writes",
        "evidence_directory": str(evidence_dir),
        "measured_at_utc": datetime.now(timezone.utc).isoformat(),
    }


def _main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create-synthetic-schema", action="store_true",
                        help="explicitly opt into creating one fresh schema/table in guarded lusk_it_contract")
    args = parser.parse_args()

    if not args.create_synthetic_schema:
        parser.error("no database action is the default; pass --create-synthetic-schema to opt in")
    if os.environ.get("AEDAR_STORAGE_PROBE_CONFIRM") != CONFIRMATION:
        parser.error(f"set AEDAR_STORAGE_PROBE_CONFIRM={CONFIRMATION} to confirm this test-only write")
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
        parser.error("unset LUSK_TEST_ALLOW_SCHEMA_CLEANUP; this probe retains its own schema")
    passfile = os.environ.get("PGPASSFILE")
    if not passfile or not Path(passfile).is_file():
        parser.error("set PGPASSFILE to the existing private PostgreSQL passfile")

    schema = "it_aedar_size_" + uuid.uuid4().hex
    run_id = uuid.uuid4().hex
    evidence_dir = DEFAULT_EVIDENCE_ROOT / run_id
    evidence_dir.mkdir(parents=True, exist_ok=False)
    intent = {
        "intent_recorded_at_utc": datetime.now(timezone.utc).isoformat(),
        "purpose": "measure PostgreSQL physical size for a fresh synthetic 50,720-row AEDAR summary table",
        "database": "lusk_it_contract",
        "publisher_role": "lusk_it_contract_pub",
        "schema_to_create": schema,
        "retained_source": f"{SOURCE_SCHEMA}.{SOURCE_TABLE}",
        "planned_operations": [
            "verify guarded server/database/role identity",
            "read one complete retained fixture territory of 40 rows",
            "create the named synthetic schema",
            "clone the summary table definition, constraints, and indexes with LIKE INCLUDING ALL",
            "insert those 40 rows for 1,268 explicitly synthetic territory IDs",
            "verify exact counts and measure PostgreSQL relation sizes",
        ],
        "explicitly_not_planned": [
            "serving database access or live production reads",
            "writes to retained schemas or serving tables",
            "publication markers, publisher execution, API calls, or schema cleanup",
        ],
        "expected_rows": EXPECTED_ROWS,
        "evidence_directory": str(evidence_dir),
        "credentials": "omitted; private PGPASSFILE is used by libpq",
    }
    intent_path = evidence_dir / "intent.json"
    _write_json(intent_path, intent)
    print(f"Pre-DDL intent recorded: {intent_path}", flush=True)

    receipt = _run(schema, evidence_dir)
    receipt["intent_manifest"] = str(intent_path)
    receipt_path = evidence_dir / "receipt.json"
    _write_json(receipt_path, receipt)
    print(json.dumps({
        "receipt": str(receipt_path),
        "schema": schema,
        "rows": receipt["synthetic_population"]["verified_rows"],
        "territories": receipt["synthetic_population"]["verified_distinct_territories"],
        "relation_sizes_bytes": receipt["relation_sizes_bytes"],
    }, indent=2))


if __name__ == "__main__":
    _main()
