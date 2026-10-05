"""Bounded actual-trigger BPE checks in the explicitly approved disposable DB."""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import pytest

pytestmark = pytest.mark.integration


def test_bpe_fact_validation_work_is_partition_local_and_integrity_remains_deferred():
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires explicit disposable PostgreSQL publisher DSN")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"] == "lusk_it_contract"
    psycopg = pytest.importorskip("psycopg")
    dsn = os.environ["LUSK_TEST_PUBLISH_DSN"]
    assert urlsplit(dsn).path.lstrip("/") == "lusk_it_contract"
    schema = "it_bpe_work_" + uuid.uuid4().hex[:12]
    conn = psycopg.connect(dsn, autocommit=True)
    api = Path(__file__).resolve().parents[2]
    try:
        assert conn.execute("SELECT current_database(),current_user").fetchone()[0] == "lusk_it_contract"
        conn.execute(f'CREATE SCHEMA "{schema}"')
        conn.execute(f'SET search_path TO "{schema}"')
        conn.execute((api / "schema.sql").read_text(encoding="utf-8"))
        # Restore migration-016's actual full-table-per-fact implementation to
        # simulate an existing install, then rehearse 026's corrective upgrade.
        old_sql = (api / "migrations/016_bpe_profile_evidence.sql").read_text(encoding="utf-8")
        old_function = old_sql.split("CREATE FUNCTION assert_bpe_profile_evidence_complete()", 1)[1].split("END $$;", 1)[0]
        conn.execute("CREATE OR REPLACE FUNCTION assert_bpe_profile_evidence_complete()" + old_function + "END $$;")
        conn.execute("DROP TRIGGER bpe_profile_descriptor_complete ON bpe_profile_evidence_descriptor")
        conn.execute("DROP TRIGGER bpe_profile_class_axis_complete ON bpe_profile_class_axis")
        conn.execute("INSERT INTO source_dataset VALUES ('test','test source')")
        conn.execute("INSERT INTO source_vintage VALUES ('test','v1','v1',NULL,NULL)")
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','ref',200)")
        with conn.transaction():
            conn.execute("""INSERT INTO bpe_profile_evidence_descriptor
          (indicator_id,descriptor_version,allowed_levels,completeness,classification_id,universe_count,
           universe_sha256,registry_filename,registry_semantic_effect,membership_sha256,source_id,vintage_id)
          VALUES ('bpe_access_profile','v1',ARRAY['commune','epci','departement','region'],
           'dense_complete','test-classification',4,repeat('a',64),'registry','test',repeat('b',64),'test','v1')""")
            axes = [(f"c{i}", f"Class {i}", i, "none") for i in range(4)]
            conn.cursor().executemany("INSERT INTO bpe_profile_class_axis VALUES (%s,%s,%s,%s)", axes)
        refs = [(f"t{i:03}", "commune", f"Territory {i}", None, None, None, None) for i in range(200)]
        refs.append(("t200", "commune", "Move destination", None, None, None, None))
        conn.cursor().executemany("INSERT INTO territory_reference VALUES (%s,%s,%s,%s,%s,%s,%s)", refs)
        facts = [(tid, "commune", key, label, 1, 4, "A001", label, .2, .3, .4)
                 for tid, *_ in refs[:200] for key, label, _, _ in axes]

        def insert_facts(rows):
            with conn.transaction():
                conn.cursor().executemany("""INSERT INTO bpe_profile_evidence
                  (territory_id,territory_type,class_key,class_label,class_count,universe_count,
                   exemplar_typequ,exemplar_label,exemplar_c,exemplar_b,exemplar_t)
                  VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", rows)

        # RED baseline: execute the exact migration-016 function on a tiny
        # publication. It performs the whole-table validation per fact event.
        conn.execute("SELECT pg_stat_force_next_flush()")
        conn.execute("SELECT pg_stat_clear_snapshot()")
        old_before = conn.execute("""SELECT seq_scan FROM pg_stat_user_tables
          WHERE schemaname=%s AND relname='bpe_profile_evidence'""", (schema,)).fetchone()[0]
        insert_facts(facts[:40])
        conn.execute("SELECT pg_stat_force_next_flush()")
        conn.execute("SELECT pg_stat_clear_snapshot()")
        old_after = conn.execute("""SELECT seq_scan FROM pg_stat_user_tables
          WHERE schemaname=%s AND relname='bpe_profile_evidence'""", (schema,)).fetchone()[0]
        old_seq_delta = old_after - old_before
        assert old_seq_delta >= 30, f"legacy full-validator baseline did not reproduce per-event scans: {old_seq_delta}"
        conn.execute("TRUNCATE bpe_profile_evidence_source,bpe_profile_evidence")
        conn.execute((api / "migrations/026_bpe_validation_once_per_transaction.sql").read_text(encoding="utf-8"))

        # PostgreSQL's own per-table scan counters make the regression signal
        # deterministic: 800 fact trigger calls should use the territory PK,
        # not perform 800 whole-publication scans. This measures work shape,
        # not a timing threshold vulnerable to network noise.
        before = conn.execute("""SELECT seq_scan,idx_scan FROM pg_stat_user_tables
          WHERE schemaname=%s AND relname='bpe_profile_evidence'""", (schema,)).fetchone()
        start = __import__("time").perf_counter()
        insert_facts(facts)
        elapsed = __import__("time").perf_counter() - start
        conn.execute("SELECT pg_stat_force_next_flush()")
        conn.execute("SELECT pg_stat_clear_snapshot()")
        after = conn.execute("""SELECT seq_scan,idx_scan FROM pg_stat_user_tables
          WHERE schemaname=%s AND relname='bpe_profile_evidence'""", (schema,)).fetchone()
        seq_delta, idx_delta = after[0] - before[0], after[1] - before[1]
        # Metadata-row deferred events may validate globally, but the work must
        # not scale with the 800 fact events.
        assert seq_delta <= 8, f"whole-publication scans scaled with fact events: {seq_delta}"
        assert idx_delta >= 800, f"expected PK-local group checks, observed only {idx_delta} index scans"
        assert conn.execute("SELECT count(*) FROM bpe_profile_evidence").fetchone() == (800,)
        print(f"BPE trigger proof: legacy_facts=40 legacy_seq_scan_delta={old_seq_delta}; "
              f"fixed_facts=800 territory_groups=200 seq_scan_delta={seq_delta} "
              f"idx_scan_delta={idx_delta} commit_seconds={elapsed:.3f}")

        # An outside-publisher incomplete DELETE is rejected at deferred commit.
        with pytest.raises(psycopg.Error, match="not dense"):
            with conn.transaction():
                conn.execute("DELETE FROM bpe_profile_evidence WHERE territory_id='t000' AND class_key='c0'")
        assert conn.execute("SELECT count(*) FROM bpe_profile_evidence WHERE territory_id='t000'").fetchone() == (4,)

        # Updating an identity validates both OLD and NEW groups; both lose a
        # row, and the transaction rolls back atomically.
        with pytest.raises(psycopg.Error, match="not dense"):
            with conn.transaction():
                conn.execute("UPDATE bpe_profile_evidence SET territory_id='t200' WHERE territory_id='t000' AND class_key='c0'")
        assert conn.execute("SELECT count(*) FROM bpe_profile_evidence WHERE territory_id='t000'").fetchone() == (4,)
        assert conn.execute("SELECT count(*) FROM bpe_profile_evidence WHERE territory_id='t200'").fetchone() == (0,)

        # Metadata has its own full validator; descriptor/axis tampering cannot
        # silently invalidate already-published fact partitions.
        with pytest.raises(psycopg.Error, match="universe/count partition"):
            with conn.transaction():
                conn.execute("UPDATE bpe_profile_evidence_descriptor SET universe_count=5")
        with pytest.raises(psycopg.Error, match="class labels differ"):
            with conn.transaction():
                conn.execute("UPDATE bpe_profile_class_axis SET label='Tampered' WHERE class_key='c0'")
        assert conn.execute("SELECT universe_count FROM bpe_profile_evidence_descriptor").fetchone() == (4,)
        assert conn.execute("SELECT count(*) FROM bpe_profile_class_axis").fetchone() == (4,)

        # Constraint-immediate then later writes must still be checked: no
        # transaction-local "already validated" flag exists to poison.
        with conn.transaction():
            conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
            conn.execute("UPDATE bpe_profile_evidence SET class_count=1 WHERE territory_id='t000' AND class_key IN ('c0','c1')")
            with pytest.raises(psycopg.Error, match="universe/count partition"):
                conn.execute("UPDATE bpe_profile_evidence SET class_count=2 WHERE territory_id='t000' AND class_key='c0'")
    finally:
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        conn.close()
