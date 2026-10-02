"""Canonical registered BPE publisher -> guarded Postgres -> public HTTP reads."""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def test_canonical_registered_bpe_publisher_is_read_through_http():
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_READ_USER",
                "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX",
                "LUSK_TEST_CANONICAL_DATA_DIR")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires approved guarded PostgreSQL publisher/read DSNs and canonical data")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"].startswith("lusk_it_")
    assert Path(os.environ["LUSK_TEST_CANONICAL_DATA_DIR"], "profils_acces_bpe.parquet").is_file()

    psycopg = pytest.importorskip("psycopg")
    from fastapi.testclient import TestClient
    from api.main import ReadRepository, app, get_repository, pool

    root = Path(__file__).resolve().parents[3]
    pipeline = root / "pipeline"
    schema = "it_" + uuid.uuid4().hex[:20]

    def scoped(dsn: str) -> str:
        parts = urlsplit(dsn)
        query = parse_qs(parts.query)
        query["options"] = [f"-csearch_path={schema}"]
        return urlunsplit((parts.scheme, parts.netloc, parts.path,
                           urlencode(query, doseq=True), parts.fragment))

    publisher_dsn = os.environ["LUSK_TEST_PUBLISH_DSN"]
    reader_dsn = os.environ["LUSK_TEST_READ_DSN"]
    pub = psycopg.connect(publisher_dsn, autocommit=True)
    created = False
    try:
        assert pub.execute("SELECT current_database(),current_user").fetchone() == (
            "lusk_it_contract", urlsplit(publisher_dsn).username)
        with psycopg.connect(reader_dsn) as reader_identity:
            assert reader_identity.execute("SELECT current_database(),current_user").fetchone() == (
                "lusk_it_contract", urlsplit(reader_dsn).username)
        assert urlsplit(publisher_dsn).path.lstrip("/") == "lusk_it_contract"
        assert urlsplit(reader_dsn).path.lstrip("/") == "lusk_it_contract"
        pub.execute(f'CREATE SCHEMA "{schema}"')
        created = True
        pub.execute(f'SET search_path TO "{schema}"')
        pub.execute((root / "api/schema.sql").read_text(encoding="utf-8"))

        # The R wrapper seeds only this owned schema from canonical territory identity,
        # invokes the actual publisher entry point, then performs a true no-op retry.
        script = r'''args<-commandArgs(TRUE); schema<-args[[1]]
pkgload::load_all(normalizePath(".")); canonical_dir<-Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR")
con<-DBI::dbConnect(RPostgres::Postgres(),dbname=Sys.getenv("LUSK_TEST_DATABASE_NAME"),
 host=Sys.getenv("LUSK_PROFILE_TEST_HOST"),port=as.integer(Sys.getenv("LUSK_PROFILE_TEST_PORT")),
 user=Sys.getenv("LUSK_PROFILE_TEST_USER"))
DBI::dbExecute(con,sprintf('SET search_path TO "%s"',schema))
territories<-nanoparquet::read_parquet(file.path(canonical_dir,"territoires.parquet"))
refs<-data.frame(territory_id=as.character(territories$territoire),
 territory_type=as.character(territories$type),name=as.character(territories$nom),
 department_id=as.character(territories$departement),epci_id=as.character(territories$epci),
 density_class_code=as.character(territories$classe_densite_code),
 density_class_label=as.character(territories$classe_densite_libelle_public),stringsAsFactors=FALSE)
DBI::dbWriteTable(con,"territory_reference",refs,append=TRUE,row.names=FALSE)
ref_version<-paste(as.character(openssl::sha256(serialize(refs,NULL))),collapse="")
DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference',$1,$2)",params=list(ref_version,nrow(refs)))
Sys.setenv(LUSK_PUBLISH_BPE="1")
first<-run_bpe_publication_cli("publish",canonical_dir,con,opt_in="1")
second<-run_bpe_publication_cli("publish",canonical_dir,con,opt_in="1")
stopifnot(first$changed, !second$changed,
 first$row_count==nrow(first$projection$facts),
 all(first$projection$facts$territoire %in% refs$territory_id))
expected<-first$projection$facts
target_density<-refs$density_class_code[match("35238",refs$territory_id)]
members<-refs$territory_id[refs$territory_type=="commune" & refs$density_class_code==target_density]
expected_means<-lapply(names(PROFILS_ACCES_BPE),function(k) {
 z<-expected[expected$type=="commune" & expected$territoire %in% members & expected$profil==k,]
 list(detail=k,mean=mean(z$nombre_typequ),eligible_count=nrow(z))
})
names(expected_means)<-NULL
jsonlite::write_json(list(focal=expected[expected$territoire=="35238" & expected$type=="commune",],
 expected_means=expected_means,ref_version=ref_version,row_count=nrow(expected),
 universe_count=first$projection$descriptor$universe_count,
 universe_sha256=first$projection$descriptor$universe_sha256,
 vintage=list(vintage_id=first$projection$descriptor$source$vintage_id[[1]],
  reference_date=first$projection$descriptor$source$reference_date[[1]],
  publication_date=first$projection$descriptor$source$publication_date[[1]])),
 args[[2]],auto_unbox=TRUE,na="null",digits=NA)
DBI::dbDisconnect(con)
'''
        read_role = os.environ["LUSK_TEST_READ_USER"]
        assert re.fullmatch(r"[A-Za-z0-9_$-]+", read_role)
        with pub.transaction():
            pub.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{read_role}"')
            # Schema tables are created before territory facts; grant SELECT for the
            # read-only user on this isolated schema only.
            pub.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{read_role}"')

        temp_root = Path("E:/Temp/opencode")
        with tempfile.TemporaryDirectory(prefix="bpe-http-", dir=temp_root) as tmp:
            tmp_path = Path(tmp)
            script_path = tmp_path / "publish_bpe.R"
            expected_path = tmp_path / "expected.json"
            script_path.write_text(script, encoding="utf-8")
            env = os.environ.copy()
            env["PGPASSFILE"] = str(Path(os.environ["APPDATA"]) / "PostgreSQL/pgpass.conf")
            completed = subprocess.run(["Rscript", str(script_path), schema, str(expected_path)],
                cwd=pipeline, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
            assert completed.returncode == 0, completed.stdout + completed.stderr
            expected = json.loads(expected_path.read_text(encoding="utf-8"))

        rows = pub.execute("SELECT count(*) FROM bpe_profile_evidence").fetchone()
        assert rows == (expected["row_count"],)
        assert pub.execute("SELECT count(*) FROM bpe_profile_evidence_source").fetchone()[0] == rows[0]
        assert pub.execute("SELECT count(*) FROM bpe_profile_class_axis").fetchone() == (4,)
        assert pub.execute("SELECT count(*) FROM bpe_profile_evidence WHERE territory_id='35238' AND territory_type='commune'").fetchone() == (4,)
        assert pub.execute("SELECT content_version,reference_content_version FROM table_publication WHERE table_name='bpe_profile_evidence'").fetchone()[1] == expected["ref_version"]

        class Connections:
            def connection(self):
                class Context:
                    def __enter__(self):
                        self.conn = psycopg.connect(scoped(reader_dsn))
                        return self.conn
                    def __exit__(self, *_args): self.conn.close()
                return Context()

        app.dependency_overrides[get_repository] = lambda: ReadRepository(Connections())
        pool.cache_clear()
        try:
            with TestClient(app) as client:
                focal = client.get("/api/territories/commune/35238/indicators/bpe_access_profile")
                theme = client.get("/api/territories/commune/35238/themes/mobilite/facts")
                comparison = client.post("/api/territories/commune/35238/indicators/bpe_access_profile/comparison",
                    json={"selection": []})
            assert focal.status_code == 200, focal.text
            body = focal.json()
            assert body["shape"] == "bpe_profile_evidence"
            assert body["descriptor"]["universe_count"] == expected["universe_count"]
            assert body["descriptor"]["universe_sha256"] == expected["universe_sha256"]
            assert len(body["classes"]) == 4
            observed = {row["profil"]: row for row in expected["focal"]}
            for row in body["classes"]:
                canonical = observed[row["class_key"]]
                assert row["count"] == canonical["nombre_typequ"]
                if canonical["exemplar_typequ"] is None:
                    assert row["exemplar"] is None
                else:
                    assert row["exemplar"]["typequ"] == canonical["exemplar_typequ"]
                    assert row["exemplar"]["label"] == canonical["exemplar_libelle"]
                    assert row["exemplar"]["access"]["car"] == canonical["exemplar_c"]
                    assert row["exemplar"]["access"]["bike"] == canonical["exemplar_b"]
                    assert row["exemplar"]["access"]["walk_transit"] == canonical["exemplar_t"]
            assert body["sources"][0]["source_id"] == "mobilite_snapshot"
            assert body["sources"][0]["version"] == expected["vintage"]["vintage_id"]
            assert body["sources"][0]["reference_date"] == expected["vintage"]["reference_date"]
            assert body["sources"][0]["publication_date"] == expected["vintage"]["publication_date"]
            means = {r["detail"]: r for r in body["default_comparison"]["results"]}
            for expected_mean in expected["expected_means"]:
                actual = means[expected_mean["detail"]]
                assert actual["mean"] == pytest.approx(expected_mean["mean"])
                assert actual["statistic"] == "mean"
                assert actual["eligible_count"] == expected_mean["eligible_count"]
            assert theme.status_code == 200, theme.text
            assert theme.json()["complete_theme"] is False
            assert theme.json()["bpe_profile_evidence"]["classes"] == body["classes"]
            assert comparison.status_code == 200, comparison.text
            comp = comparison.json()
            assert comp["shape"] == "bpe_profile_evidence"
            assert "focal_value" not in comp and "classes" not in comp
            assert all("exemplar" not in r and "count" not in r for r in comp["results"])
            assert all(r["status"] == "unavailable" and r["mean"] is None for r in comp["results"])
        finally:
            app.dependency_overrides.pop(get_repository, None)
            pool.cache_clear()
    finally:
        if created:
            pub.execute(f'DROP SCHEMA "{schema}" CASCADE')
        pub.close()
