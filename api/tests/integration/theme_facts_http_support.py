"""Shared guarded PostgreSQL fixture support for selected theme-facts HTTP tests."""
import os
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
    from api.main import ReadRepository, app, get_repository, pool
    root = __import__("pathlib").Path(__file__).resolve().parents[3]
    schema = "it_" + uuid.uuid4().hex[:20]
    def scoped(dsn):
        u=urlsplit(dsn); q=parse_qs(u.query); q["options"]=[f"-csearch_path={schema}"]
        return urlunsplit((u.scheme,u.netloc,u.path,urlencode(q,doseq=True),u.fragment))
    pub=psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"],autocommit=True)
    created=False; prior=app.dependency_overrides.get(get_repository); checked=[]
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
        reader=os.environ["LUSK_TEST_READ_USER"]
        pub.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{reader}"'); pub.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{reader}"')
        class Rec:
            def __init__(self,c): self.c=c; self.commands=[]
            def execute(self,*a,**kw):
                if a and isinstance(a[0],str) and a[0].upper().startswith("SET TRANSACTION"): self.commands.append(a[0])
                return self.c.execute(*a,**kw)
            def __getattr__(self,n): return getattr(self.c,n)
        class Pool:
            def connection(self):
                class Ctx:
                    def __enter__(self): self.c=psycopg.connect(scoped(os.environ["LUSK_TEST_READ_DSN"])); self.r=Rec(self.c); checked.append(self.r); return self.r
                    def __exit__(self,*a): self.c.close()
                return Ctx()
        app.dependency_overrides[get_repository]=lambda: ReadRepository(Pool()); pool.cache_clear()
        client=TestClient(app)
        yield pub,client,checked
    finally:
        app.dependency_overrides.pop(get_repository,None)
        if prior is not None: app.dependency_overrides[get_repository]=prior
        pool.cache_clear()
        if created:
            if pub.info.transaction_status != psycopg.pq.TransactionStatus.IDLE: pub.rollback()
            pub.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        pub.close()


def common(client, checked, theme):
    route=f"/api/territories/commune/35238/themes/{theme}/facts"
    mismatch=client.post(route,json={"theme_id":"wrong"})
    assert mismatch.status_code==422
    implicit=client.post(route,json={"theme_id":theme})
    assert implicit.status_code==200,implicit.text
    body=implicit.json(); assert body["comparison"]["selection"] is None
    assert body["comparison"]["scope"]["kind"]=="density_class"
    def has_focal(v):
        if isinstance(v,dict): return "focal_value" in v or any(has_focal(x) for x in v.values())
        if isinstance(v,list): return any(has_focal(x) for x in v)
        return False
    assert not has_focal(body["comparison"])
    empty=client.post(route,json={"theme_id":theme,"selection":[]})
    assert empty.status_code==200,empty.text
    assert empty.json()["comparison"]["selection"]==[]
    if theme != "programmes": assert empty.json().get("readings")
    else: assert empty.json().get("collections")
    assert checked and all(len(c.commands)==1 and "REPEATABLE READ, READ ONLY" in c.commands[0] for c in checked)
    return route
