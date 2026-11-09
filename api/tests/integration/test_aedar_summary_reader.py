"""Guarded PostgreSQL contract tests for the AEDAR summary snapshot reader."""
import os
import subprocess
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration


def test_aedar_summary_reader_uses_complete_published_snapshot():
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_READ_USER",
                "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires guarded disposable PostgreSQL publisher/read DSNs")
    psycopg = pytest.importorskip("psycopg")
    from api.aedar_models import AEDAR_AGGREGATE_READINGS
    from api.aedar_reads import _aedar_territory_summary_snapshot
    from api.tests.integration.test_postgres_publication import (
        _aedar_guarded_configuration, _assert_aedar_server_identity)
    from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

    pub_dsn, read_dsn = _aedar_guarded_configuration()
    pub_parts, read_parts = urlsplit(pub_dsn), urlsplit(read_dsn)
    assert pub_parts.username != read_parts.username
    assert pub_parts.path == read_parts.path == "/" + os.environ["LUSK_TEST_DATABASE_NAME"]
    schema = "it_aedar_summary_" + uuid.uuid4().hex[:12]
    def scoped(dsn):
        p=urlsplit(dsn); q=parse_qs(p.query); q["options"]=[f"-csearch_path={schema}"]
        return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q,doseq=True),p.fragment))
    pub = psycopg.connect(pub_dsn, autocommit=True)
    root = Path(__file__).resolve().parents[3]
    try:
        _assert_aedar_server_identity(pub, pub_parts.username)
        with psycopg.connect(read_dsn) as identity:
            _assert_aedar_server_identity(identity, read_parts.username)
        pub.execute(f'CREATE SCHEMA "{schema}"')
        pub.execute(f'SET search_path TO "{schema}"')
        baseline = subprocess.check_output(["git", "show", "75b6ad661d8ab677c33c73152598d097590c7886:api/schema.sql"],cwd=root,text=True,encoding="utf-8")
        pub.execute(baseline)
        pub.execute((root / "api/migrations/040_aedar_reference_only_publication.sql").read_text(encoding="utf-8"))
        pub.execute((root / "api/migrations/041_aedar_territory_summaries.sql").read_text(encoding="utf-8"))
        pub.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{os.environ["LUSK_TEST_READ_USER"]}"')
        pub.execute(f'GRANT SELECT ON table_publication,aedar_territory_summary TO "{os.environ["LUSK_TEST_READ_USER"]}"')
        pub.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES('fixture','commune','Fixture')")
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','ref-v1',1)")
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('aedar_territorial_aggregate','source-v1',0,'ref-v1')")
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,aedar_source_content_version) VALUES('aedar_territory_summary','summary-v1',40,'ref-v1','source-v1')")
        measures = sorted(AEDAR_AGGREGATE_READINGS)
        assert len(measures) == 40
        insert = """INSERT INTO aedar_territory_summary(territory_type,territory_id,measure,value,status,n_typequ,n_addresses,n_observed,coverage_status,source_id,vintage_id,source_url,licence,attribution)
          VALUES('commune','fixture',%s,%s,'available',235,2,470,'covered','source','v1','https://source','licence','credit')"""
        pub.cursor().executemany(insert, [(measure,float(i+1)) for i,measure in enumerate(measures)])
        with psycopg.connect(scoped(read_dsn)) as conn:
            conn.execute(f'SET search_path TO "{schema}"')
            result = _aedar_territory_summary_snapshot(conn,"commune",["fixture"],measures)
            assert result["content_version"] == "summary-v1"
            assert result["reference_content_version"] == "ref-v1"
            assert len(result["readings"]) == 40
            for i,measure in enumerate(measures):
                reading=result["readings"][("fixture",measure)]
                assert (reading["value"],reading["available"],reading["n_typequ"],reading["n_addresses"],reading["n_observed"]) == (float(i+1),True,235,2,470)
                assert reading["statistic"] == "direct" and reading["source_id"] == "source"
        # A summary's own content hash is deliberately not the source-facts hash;
        # its marker binds the exact source and reference clocks. Both stale
        # dependencies and an incomplete requested projection fail closed.
        pub.execute("UPDATE table_publication SET content_version='source-v2' WHERE table_name='aedar_territorial_aggregate'")
        with psycopg.connect(scoped(read_dsn)) as conn, pytest.raises(Exception) as err:
            conn.execute(f'SET search_path TO "{schema}"')
            _aedar_territory_summary_snapshot(conn,"commune",["fixture"],measures)
        assert getattr(err.value,"status_code",None) == 503
        pub.execute("UPDATE table_publication SET content_version='source-v1' WHERE table_name='aedar_territorial_aggregate'")
        for sql,params in [
            ("UPDATE table_publication SET reference_content_version='old-ref' WHERE table_name='aedar_territory_summary'",()),
        ]:
            pub.execute(sql,params)
            with psycopg.connect(scoped(read_dsn)) as conn, pytest.raises(Exception) as err:
                conn.execute(f'SET search_path TO "{schema}"')
                _aedar_territory_summary_snapshot(conn,"commune",["fixture"],measures)
            assert getattr(err.value,"status_code",None) == 503
            pub.execute("UPDATE table_publication SET reference_content_version='ref-v1' WHERE table_name='aedar_territory_summary'")
        # Unavailable summaries retain support evidence that remains derivable;
        # this is distinct from an unavailable value or invented zero.
        pub.execute("UPDATE aedar_territory_summary SET value=NULL,status='unavailable',n_typequ=NULL,n_addresses=2,n_observed=470,coverage_status=NULL WHERE measure=%s",(measures[-1],))
        with psycopg.connect(scoped(read_dsn)) as conn:
            conn.execute(f'SET search_path TO "{schema}"')
            result = _aedar_territory_summary_snapshot(conn,"commune",["fixture"],[measures[-1]])
        unavailable = result["readings"][("fixture",measures[-1])]
        assert (unavailable["value"],unavailable["available"],unavailable["n_addresses"],
                unavailable["n_observed"],unavailable["coverage_status"]) == (None,False,2,470,None)
        pub.execute("DELETE FROM aedar_territory_summary WHERE measure=%s",(measures[-1],))
        with psycopg.connect(scoped(read_dsn)) as conn, pytest.raises(Exception) as err:
            conn.execute(f'SET search_path TO "{schema}"')
            _aedar_territory_summary_snapshot(conn,"commune",["fixture"],measures)
        assert getattr(err.value,"status_code",None) == 503
    finally:
        pub.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        pub.close()
