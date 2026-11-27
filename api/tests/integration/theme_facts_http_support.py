"""Shared guarded PostgreSQL fixture support for selected theme-facts HTTP tests."""
import os
import re
import uuid
from contextlib import contextmanager
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest


@contextmanager
def fixture(theme, inserts):
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires explicitly guarded private PostgreSQL test configuration")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    psycopg = pytest.importorskip("psycopg")
    from fastapi.testclient import TestClient
    from api.main import ReadRepository, app, get_repository, get_resource_catalogue, pool
    from api.tests.resource_catalogue_fixtures import default_resource_catalogue
    root = __import__("pathlib").Path(__file__).resolve().parents[3]
    schema = "it_" + uuid.uuid4().hex[:20]
    def scoped(dsn):
        u=urlsplit(dsn); q=parse_qs(u.query); q["options"]=[f"-csearch_path={schema}"]
        return urlunsplit((u.scheme,u.netloc,u.path,urlencode(q,doseq=True),u.fragment))
    pub=psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"],autocommit=True)
    created=False; prior=app.dependency_overrides.get(get_repository); checked=[]
    prior_catalogue=app.dependency_overrides.get(get_resource_catalogue)
    try:
        assert pub.execute("select current_database(),current_user").fetchone()==(os.environ["LUSK_TEST_DATABASE_NAME"],urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"]).username)
        pub.execute(f'CREATE SCHEMA "{schema}"'); created=True
        pub.execute(f'SET search_path TO "{schema}"')
        pub.execute((root/"api/schema.sql").read_text(encoding="utf-8"))
        pub.execute("INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,density_class_code) VALUES('35238','commune','Focal','35','243500139','D1'),('35001','commune','Peer','35','243500139','D1')")
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('territory_reference','ref-v1',2,'ref-v1')")
        pub.execute("BEGIN")
        inserts(pub)
        pub.execute("COMMIT")
        reader=urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username
        if not reader or not re.fullmatch(r"[A-Za-z0-9_$-]+", reader):
            pytest.fail("Read DSN must identify a simple PostgreSQL role name")
        pub.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{reader}"'); pub.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{reader}"')
        class Rec:
            def __init__(self,c): self.c=c; self.commands=[]; self.queries=[]
            def execute(self,*a,**kw):
                if a and isinstance(a[0],str) and a[0].upper().startswith("SET TRANSACTION"): self.commands.append(a[0])
                if a and isinstance(a[0],str): self.queries.append((a[0],a[1] if len(a)>1 else None))
                return self.c.execute(*a,**kw)
            def __getattr__(self,n): return getattr(self.c,n)
        class Pool:
            def connection(self):
                class Ctx:
                    def __enter__(self): self.c=psycopg.connect(scoped(os.environ["LUSK_TEST_READ_DSN"])); self.r=Rec(self.c); checked.append(self.r); return self.r
                    def __exit__(self,*a): self.c.close()
                return Ctx()
        app.dependency_overrides[get_repository]=lambda: ReadRepository(Pool())
        catalogue=default_resource_catalogue
        if theme == "programmes":
            from dataclasses import replace
            base=default_resource_catalogue()
            resource=replace(base.resources_by_id["couverture_programmes"],
                resource_id="programme_membership", indicator_id="programme_membership",
                label="Programmes", unit="count", allowed_levels=("commune",))
            catalogue=lambda: replace(base, resources=(*base.resources, resource))
        app.dependency_overrides[get_resource_catalogue]=catalogue
        pool.cache_clear()
        client=TestClient(app)
        yield pub,client,checked
    finally:
        app.dependency_overrides.pop(get_repository,None)
        if prior is not None: app.dependency_overrides[get_repository]=prior
        app.dependency_overrides.pop(get_resource_catalogue,None)
        if prior_catalogue is not None: app.dependency_overrides[get_resource_catalogue]=prior_catalogue
        pool.cache_clear()
        if created:
            if pub.info.transaction_status != psycopg.pq.TransactionStatus.IDLE: pub.rollback()
            pub.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        pub.close()


def common(client, checked, theme):
    resource={"programmes":"programme_membership"}[theme]
    target={"kind":"territory","type":"commune","id":"35238"}
    mismatch=client.post("/api/resources/read",json={"resource":"no_such_resource",
        "target":target,"intent":{"kind":"facts"}})
    assert mismatch.status_code==422, mismatch.text
    implicit=client.post("/api/resources/read",json={"resource":resource,
        "target":target,"intent":{"kind":"facts"}})
    assert implicit.status_code==200,implicit.text
    assert checked and all(len(c.commands)==1 and "REPEATABLE READ, READ ONLY" in c.commands[0] for c in checked)
    return resource
