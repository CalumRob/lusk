"""Bounded deferred validation work for owned-series publications (issue #804).

`series_dataset_publication_complete` is a deferred constraint trigger: it fires
at COMMIT, once per publication marker row. The focal observation to provenance
association used to be validated with one correlated ``NOT EXISTS`` subquery.
On a freshly written, still-unanalyzed table PostgreSQL can execute that subquery
as a nested loop whose inner index scan fetches the dataset's provenance rows once
per observation row, so COMMIT work grows with the square of the publication.

Measured on the guarded ``lusk_it_contract`` target (PostgreSQL 18.6) with a
1,186-territory / 4,744-observation publication and no table statistics:

    pre-038 correlated validator   11,283,605 tuple visits   COMMIT 13.1-13.6 s
    set-based EXCEPT validator         37,952 tuple visits   COMMIT  2.9- 4.4 s

The pathological plan only appears in some cost regimes (this same fixture flips
to a linear nested-loop-free plan above roughly 9,000 observations, and the real
Bretagne snapshot reports 92,564 focal points), so the regression pins the *work
shape* rather than a wall-clock threshold, and the fix uses a set operation that
cannot be rescanned per outer row. The bound keeps about six times headroom over
the measured set-based cost while the reverted correlated form exceeds it by more
than forty times.

Integrity guarantees are pinned alongside the work shape: missing focal or named
provenance is still rejected at COMMIT, several provenance revisions per key are
legitimate, rows from another dataset never satisfy or invalidate the focal
dataset, and a rejected replacement leaves the previous good marker and rows in
place.
"""
from __future__ import annotations

import os
import re
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import pytest

pytestmark = pytest.mark.integration

REFERENCE_VERSION = "owned-work-reference-v1"
SOURCE_ID = "owned_work_source"
DATASET_ID = "owned_work"
DECOY_DATASET_ID = "owned_work_decoy"
NEGATIVE_DATASET_ID = "owned_work_negative"
REFERENCE_ID = "owned_work_reference"
REFERENCE_INDICATOR_ID = "owned_work_reference_indicator"
INDICATOR_ID = "owned_work"
AXIS_VALUES = ("2022", "2023", "2024", "2025")
REVISION_ID = "owned-work-revision"
SECOND_REVISION_ID = "owned-work-second-revision"
# 1,186 territories x 4 axis points sits inside the measured regime where the
# correlated validator committed in ~13 s without statistics.
TERRITORY_COUNT = 1186
# Tuple visits (seq_tup_read + idx_tup_fetch) allowed per observation row.
WORK_BOUND_PER_OBSERVATION = 50

MISSING_PROVENANCE = "owned series observation is missing provenance association"


def _target():
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires explicit disposable PostgreSQL publisher DSN")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"] == "lusk_it_contract"
    psycopg = pytest.importorskip("psycopg")
    dsn = os.environ["LUSK_TEST_PUBLISH_DSN"]
    assert urlsplit(dsn).path.lstrip("/") == "lusk_it_contract"
    return psycopg, dsn


def _new_schema(psycopg, dsn, api_root, prefix):
    schema = f"it_owned_{prefix}_" + uuid.uuid4().hex[:12]
    conn = psycopg.connect(dsn, autocommit=True)
    conn.execute(f'CREATE SCHEMA "{schema}"')
    conn.execute(f'SET search_path TO "{schema}"')
    conn.execute((api_root / "schema.sql").read_text(encoding="utf-8"))
    return conn, schema


def _cleanup(psycopg, dsn, *schemas):
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        return
    with psycopg.connect(dsn, autocommit=True) as conn:
        for schema in schemas:
            conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


def _territories(count=TERRITORY_COUNT):
    return [f"W{i:05d}" for i in range(count)]


def _register_reference(conn, count=TERRITORY_COUNT):
    conn.cursor().executemany(
        """INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,
           density_class_code,density_class_label) VALUES (%s,%s,%s,%s,%s,%s,%s)""",
        [(territory, "commune", f"Work {territory}", None, None, None, None)
         for territory in _territories(count)])
    conn.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
        VALUES ('territory_reference',%s,%s)""", (REFERENCE_VERSION, count))
    conn.execute("INSERT INTO source_dataset(source_id,name) VALUES (%s,%s)", (SOURCE_ID, SOURCE_ID))
    conn.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
        VALUES (%s,'v1','2026-01','2025-01-01','2026-02-01')""", (SOURCE_ID,))
    for revision in (REVISION_ID, SECOND_REVISION_ID):
        conn.execute("""INSERT INTO series_provenance_revision(provenance_revision_id,source_id,vintage_id,
            source_name,dataset_name,source_version,reference_date,publication_date,revision_hash)
            VALUES (%s,%s,'v1','Owned work source','Owned work dataset','2026-01','2025-01-01',
            '2026-02-01',%s)""", (revision, SOURCE_ID, revision))


def _observation_rows(dataset_id, territories):
    return [(dataset_id, INDICATOR_ID, territory, "commune", axis, axis, 1.0, "measured")
            for territory in territories for axis in AXIS_VALUES]


def _provenance_rows(dataset_id, territories, revisions=(REVISION_ID,)):
    return [(dataset_id, INDICATOR_ID, territory, axis, revision)
            for territory in territories for axis in AXIS_VALUES for revision in revisions]


def _named_reference_rows(dataset_id, axes=AXIS_VALUES[:2]):
    return [(dataset_id, INDICATOR_ID, REFERENCE_ID, axis, axis, 1.0, "measured")
            for axis in axes]


def _named_reference_provenance_rows(dataset_id, axes=AXIS_VALUES[:2]):
    return [(dataset_id, INDICATOR_ID, REFERENCE_ID, axis, REVISION_ID) for axis in axes]


def _write_marker(conn, dataset_id, content_version, row_count):
    conn.execute("""INSERT INTO series_dataset_publication(dataset_id,content_version,
        reference_content_version,row_count) VALUES (%s,%s,%s,%s)""",
        (dataset_id, content_version, REFERENCE_VERSION, row_count))
    conn.execute("""INSERT INTO series_dataset_descriptor(dataset_id,indicator_id,axis_kind,axis_values,
        completeness,comparison_point,label,unit,direction,allowed_levels,descriptor_version,
        active_read_route) VALUES (%s,%s,'year',%s,'may_be_missing',NULL,'Owned work','units','none',
        %s,%s,false)""",
        (dataset_id, INDICATOR_ID, list(AXIS_VALUES), ["commune"], f"{content_version}-d1"))


def _write_publication(conn, dataset_id, content_version, observations, provenance,
                       named_reference=(), named_reference_provenance=()):
    _write_marker(conn, dataset_id, content_version, len(observations) + len(named_reference))
    with conn.cursor().copy("""COPY series_dataset_observation(dataset_id,indicator_id,territory_id,
        territory_type,axis_value,observation_period,value,status) FROM STDIN""") as copy:
        for row in observations:
            copy.write_row(row)
    with conn.cursor().copy("""COPY series_observation_provenance(dataset_id,indicator_id,territory_id,
        axis_value,provenance_revision_id) FROM STDIN""") as copy:
        for row in provenance:
            copy.write_row(row)
    if named_reference:
        conn.execute("""INSERT INTO series_named_reference_descriptor(dataset_id,indicator_id,reference_id,
            reference_label,reference_role,reference_statistic,required,reference_indicator_id,
            active_read_route) VALUES (%s,%s,%s,'Owned work reference','analytical_reference',
            'declared baseline',true,%s,false)""",
            (dataset_id, INDICATOR_ID, REFERENCE_ID, REFERENCE_INDICATOR_ID))
        with conn.cursor().copy("""COPY series_named_reference(dataset_id,indicator_id,reference_id,
            axis_value,observation_period,value,status) FROM STDIN""") as copy:
            for row in named_reference:
                copy.write_row(row)
        with conn.cursor().copy("""COPY series_named_reference_provenance(dataset_id,indicator_id,
            reference_id,axis_value,provenance_revision_id) FROM STDIN""") as copy:
            for row in named_reference_provenance:
                copy.write_row(row)


def _replace_publication(conn, dataset_id, content_version, observations, provenance, **named):
    conn.execute("DELETE FROM series_dataset_publication WHERE dataset_id=%s", (dataset_id,))
    _write_publication(conn, dataset_id, content_version, observations, provenance, **named)


def _tuple_visits(conn, schema):
    """Committed tuple visits of the two focal relations, from PostgreSQL itself."""
    conn.execute("SELECT pg_stat_force_next_flush()")
    conn.execute("SELECT pg_stat_clear_snapshot()")
    rows = conn.execute("""SELECT relname, seq_tup_read + idx_tup_fetch FROM pg_stat_user_tables
        WHERE schemaname=%s AND relname IN ('series_dataset_observation',
        'series_observation_provenance')""", (schema,)).fetchall()
    return {relname: visits for relname, visits in rows}


def _publish_valid(conn, dataset_id, territories, content_version):
    observations = _observation_rows(dataset_id, territories)
    provenance = _provenance_rows(dataset_id, territories)
    with conn.transaction():
        _write_publication(conn, dataset_id, content_version, observations, provenance)
    return observations


def _validator_source(conn, schema):
    return conn.execute("""SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=%s AND p.proname='validate_series_dataset_publication'""",
        (schema,)).fetchone()[0]


def _semantics_probe(psycopg, conn, territories):
    """Focal publication outcome on one schema: accepted, rejected, restored."""
    observations = _observation_rows(DATASET_ID, territories)
    provenance = _provenance_rows(DATASET_ID, territories)
    with conn.transaction():
        _replace_publication(conn, DATASET_ID, "parity-v1", observations, provenance)
    accepted = conn.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                            (DATASET_ID,)).fetchone()
    incomplete = [row for row in provenance if (row[2], row[3]) != (territories[1], AXIS_VALUES[1])]
    rejected = None
    try:
        with conn.transaction():
            _replace_publication(conn, DATASET_ID, "parity-v2", observations, incomplete)
    except psycopg.Error as error:
        rejected = str(error).strip()
    restored = (conn.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                             (DATASET_ID,)).fetchone(),
                conn.execute("SELECT count(*) FROM series_dataset_observation WHERE dataset_id=%s",
                             (DATASET_ID,)).fetchone())
    return accepted, rejected, restored


def test_owned_series_publication_validation_work_is_bounded_without_statistics():
    psycopg, dsn = _target()
    api_root = Path(__file__).resolve().parents[2]
    conn, schema = _new_schema(psycopg, dsn, api_root, "work")
    try:
        assert conn.execute("SELECT current_database(),current_user").fetchone()[0] == "lusk_it_contract"
        territories = _territories()
        _register_reference(conn)
        observations = _observation_rows(DATASET_ID, territories)
        provenance = _provenance_rows(DATASET_ID, territories)
        # Deliberately no ANALYZE: the schema is freshly written and unanalyzed,
        # which is exactly the state the publisher reaches its COMMIT from.
        before = _tuple_visits(conn, schema)
        start = time.perf_counter()
        with conn.transaction():
            _write_publication(conn, DATASET_ID, "work-v1", observations, provenance)
        elapsed = time.perf_counter() - start
        after = _tuple_visits(conn, schema)
        visits = sum(after[name] - before.get(name, 0) for name in after)
        print(f"owned-series deferred validation without statistics: "
              f"observations={len(observations)} tuple_visits={visits} commit_seconds={elapsed:.3f}")
        assert conn.execute("SELECT count(*) FROM series_dataset_observation WHERE dataset_id=%s",
                            (DATASET_ID,)).fetchone() == (len(observations),)
        assert visits <= WORK_BOUND_PER_OBSERVATION * len(observations), (
            f"deferred validation used {visits} tuple visits for "
            f"{len(observations)} observations")
    finally:
        conn.close()
        _cleanup(psycopg, dsn, schema)


def test_owned_series_provenance_validation_is_dataset_scoped_and_set_based():
    psycopg, dsn = _target()
    api_root = Path(__file__).resolve().parents[2]
    conn, schema = _new_schema(psycopg, dsn, api_root, "scope")
    try:
        _register_reference(conn, 4)
        territories = _territories(3)
        observations = _publish_valid(conn, DATASET_ID, territories, "alpha-v1")
        decoy_observations = _publish_valid(conn, DECOY_DATASET_ID, territories, "beta-v1")
        # Same indicator/territory/axis keys now exist in two datasets. A decoy
        # provenance row from the other dataset must not satisfy the focal one.
        provenance = _provenance_rows(DATASET_ID, territories)
        incomplete = [row for row in provenance if (row[2], row[3]) != (territories[1], AXIS_VALUES[1])]
        with pytest.raises(psycopg.Error, match=MISSING_PROVENANCE):
            with conn.transaction():
                _replace_publication(conn, DATASET_ID, "alpha-v2", observations, incomplete)
        assert conn.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                            (DATASET_ID,)).fetchone() == ("alpha-v1",)
        assert conn.execute("SELECT count(*) FROM series_dataset_observation WHERE dataset_id=%s",
                            (DATASET_ID,)).fetchone() == (len(observations),)
        assert conn.execute("SELECT count(*) FROM series_observation_provenance WHERE dataset_id=%s",
                            (DATASET_ID,)).fetchone() == (len(provenance),)
        assert conn.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                            (DECOY_DATASET_ID,)).fetchone() == ("beta-v1",)
        assert conn.execute("SELECT count(*) FROM series_dataset_observation WHERE dataset_id=%s",
                            (DECOY_DATASET_ID,)).fetchone() == (len(decoy_observations),)

        # Several provenance revisions for one key are legitimate replacements.
        with conn.transaction():
            _replace_publication(conn, DATASET_ID, "alpha-v3", observations,
                                 _provenance_rows(DATASET_ID, territories,
                                                  (REVISION_ID, SECOND_REVISION_ID)))
        assert conn.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                            (DATASET_ID,)).fetchone() == ("alpha-v3",)
        assert conn.execute("SELECT count(*) FROM series_observation_provenance WHERE dataset_id=%s",
                            (DATASET_ID,)).fetchone() == (2 * len(observations),)

        # A neighbouring dataset may grow without touching the focal publication.
        extended = decoy_observations + _observation_rows(DECOY_DATASET_ID, ["W00003"])
        with conn.transaction():
            _replace_publication(conn, DECOY_DATASET_ID, "beta-v2", extended,
                                 _provenance_rows(DECOY_DATASET_ID, territories + ["W00003"]))
        assert conn.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                            (DECOY_DATASET_ID,)).fetchone() == ("beta-v2",)
        assert conn.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                            (DATASET_ID,)).fetchone() == ("alpha-v3",)

        # Re-validating an unchanged marker is a no-op that still commits.
        with conn.transaction():
            conn.execute("UPDATE series_dataset_publication SET content_version=content_version "
                         "WHERE dataset_id=%s", (DATASET_ID,))
        assert conn.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                            (DATASET_ID,)).fetchone() == ("alpha-v3",)

        # EXCEPT compares the full key, so the key columns must stay NOT NULL and
        # the focal relation must hold one row per key: those invariants are what
        # make de-duplicating set semantics equal the old existence check.
        keys = ("dataset_id", "indicator_id", "territory_id", "axis_value")
        declared = conn.execute("""SELECT a.attnotnull FROM pg_attribute a
            JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=%s AND c.relname IN ('series_dataset_observation',
            'series_observation_provenance') AND a.attname=ANY(%s)""",
            (schema, list(keys))).fetchall()
        assert len(declared) == 2 * len(keys) and all(row[0] for row in declared)

        observation = (NEGATIVE_DATASET_ID, INDICATOR_ID, territories[0], "commune",
                       AXIS_VALUES[0], AXIS_VALUES[0], 1.0, "measured")
        observation_sql = """INSERT INTO series_dataset_observation(dataset_id,indicator_id,
            territory_id,territory_type,axis_value,observation_period,value,status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)"""
        # A duplicate observation key is rejected by the primary key, so the
        # EXCEPT left side is a set of distinct keys.
        with pytest.raises(psycopg.errors.UniqueViolation):
            with conn.transaction():
                _write_marker(conn, NEGATIVE_DATASET_ID, "negative-v1", 2)
                conn.execute(observation_sql, observation)
                conn.execute(observation_sql, observation)
        # Two provenance rows for one key must differ by revision; a repeated
        # revision is a duplicate, while a second revision stays legitimate.
        with pytest.raises(psycopg.errors.UniqueViolation):
            with conn.transaction():
                _write_marker(conn, NEGATIVE_DATASET_ID, "negative-v2", 1)
                conn.execute(observation_sql, observation)
                duplicate = (NEGATIVE_DATASET_ID, INDICATOR_ID, territories[0],
                             AXIS_VALUES[0], REVISION_ID)
                for _ in range(2):
                    conn.execute("""INSERT INTO series_observation_provenance(dataset_id,indicator_id,
                        territory_id,axis_value,provenance_revision_id) VALUES (%s,%s,%s,%s,%s)""",
                        duplicate)
        with pytest.raises(psycopg.errors.NotNullViolation):
            with conn.transaction():
                _write_marker(conn, NEGATIVE_DATASET_ID, "negative-v3", 1)
                conn.execute("""INSERT INTO series_observation_provenance(dataset_id,indicator_id,
                    territory_id,axis_value,provenance_revision_id) VALUES (%s,%s,%s,NULL,%s)""",
                    (NEGATIVE_DATASET_ID, INDICATOR_ID, territories[0], REVISION_ID))
        assert conn.execute("SELECT count(*) FROM series_dataset_publication WHERE dataset_id=%s",
                            (NEGATIVE_DATASET_ID,)).fetchone() == (0,)
    finally:
        conn.close()
        _cleanup(psycopg, dsn, schema)


def test_owned_series_named_reference_provenance_checks_are_unchanged():
    psycopg, dsn = _target()
    api_root = Path(__file__).resolve().parents[2]
    conn, schema = _new_schema(psycopg, dsn, api_root, "reference")
    try:
        _register_reference(conn, 2)
        territories = _territories(2)
        observations = _observation_rows(DATASET_ID, territories)
        provenance = _provenance_rows(DATASET_ID, territories)
        named_reference = _named_reference_rows(DATASET_ID)
        named_reference_provenance = _named_reference_provenance_rows(DATASET_ID)
        with pytest.raises(psycopg.Error,
                           match="named reference observation is missing provenance association"):
            with conn.transaction():
                _write_publication(conn, DATASET_ID, "reference-v1", observations, provenance,
                                   named_reference,
                                   named_reference_provenance[:-1])
        assert conn.execute("SELECT count(*) FROM series_dataset_publication WHERE dataset_id=%s",
                            (DATASET_ID,)).fetchone() == (0,)
        with conn.transaction():
            _write_publication(conn, DATASET_ID, "reference-v1", observations, provenance,
                               named_reference, named_reference_provenance)
        assert conn.execute("SELECT count(*) FROM series_named_reference_provenance "
                            "WHERE dataset_id=%s", (DATASET_ID,)).fetchone() == (
            len(named_reference_provenance),)
    finally:
        conn.close()
        _cleanup(psycopg, dsn, schema)


def test_migration_038_matches_fresh_schema_and_bounds_validation_work():
    psycopg, dsn = _target()
    api_root = Path(__file__).resolve().parents[2]
    migration = api_root / "migrations/038_owned_series_provenance_set_validation.sql"
    if not migration.exists():
        pytest.skip("migration 038 is not present in this checkout")
    text = migration.read_text(encoding="utf-8")
    # The migration replaces the validator function and nothing else.
    assert "CREATE OR REPLACE FUNCTION validate_series_dataset_publication()" in text
    assert re.search(r"\bEXCEPT\b", text), "set-based EXCEPT validator is missing"
    for forbidden in ("DROP ", "CREATE TRIGGER", "CREATE TABLE", "ALTER TABLE", "DELETE ", "INSERT "):
        assert forbidden not in text, forbidden

    conn, schema = _new_schema(psycopg, dsn, api_root, "upgrade")
    fresh_conn, fresh_schema = _new_schema(psycopg, dsn, api_root, "fresh")
    try:
        legacy = (api_root / "migrations/015_owned_series_duration_reference.sql").read_text(
            encoding="utf-8")
        legacy_statement = "CREATE OR REPLACE FUNCTION validate_series_dataset_publication()" + \
            legacy.split("CREATE OR REPLACE FUNCTION validate_series_dataset_publication()", 1)[1] \
                  .split("END $$;", 1)[0] + "END $$;"
        conn.execute(legacy_statement)
        assert _validator_source(conn, schema) != _validator_source(fresh_conn, fresh_schema)

        territories = _territories()
        for connection in (conn, fresh_conn):
            _register_reference(connection)
        probe_territories = territories[:3]
        assert _semantics_probe(psycopg, conn, probe_territories) == \
            _semantics_probe(psycopg, fresh_conn, probe_territories)
        assert MISSING_PROVENANCE in _semantics_probe(psycopg, fresh_conn, probe_territories)[1]

        conn.execute(text)
        assert _validator_source(conn, schema) == _validator_source(fresh_conn, fresh_schema)
        assert _semantics_probe(psycopg, conn, probe_territories) == \
            _semantics_probe(psycopg, fresh_conn, probe_territories)

        for connection, label in ((conn, "migrated"), (fresh_conn, "fresh")):
            observations = _observation_rows("upgrade_work", territories)
            provenance = _provenance_rows("upgrade_work", territories)
            before = _tuple_visits(connection, schema if label == "migrated" else fresh_schema)
            with connection.transaction():
                _write_publication(connection, "upgrade_work", "work-v1", observations, provenance)
            after = _tuple_visits(connection, schema if label == "migrated" else fresh_schema)
            visits = sum(after[name] - before.get(name, 0) for name in after)
            print(f"{label} owned-series deferred validation: observations={len(observations)} "
                  f"tuple_visits={visits}")
            assert visits <= WORK_BOUND_PER_OBSERVATION * len(observations), label
    finally:
        conn.close()
        fresh_conn.close()
        _cleanup(psycopg, dsn, schema, fresh_schema)
