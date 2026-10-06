"""Tiny disposable-Postgres exercise of the public Milieux comparison-only route."""
import os
import re
import uuid
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def test_milieux_comparison_cloud_reads_bounded_source_bound_points_over_http():
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires explicitly guarded private PostgreSQL test configuration")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"].startswith("lusk_it_")
    psycopg = pytest.importorskip("psycopg")
    from fastapi.testclient import TestClient
    from api.main import ReadRepository, app, get_repository, pool

    root = __import__("pathlib").Path(__file__).resolve().parents[3]
    schema = "it_" + uuid.uuid4().hex[:20]

    def scoped(dsn):
        u=urlsplit(dsn); q=parse_qs(u.query); q["options"]=[f"-csearch_path={schema}"]
        return urlunsplit((u.scheme,u.netloc,u.path,urlencode(q,doseq=True),u.fragment))

    pub=psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"],autocommit=True)
    created=False
    prior=app.dependency_overrides.get(get_repository)
    try:
        assert pub.execute("select current_database(),current_user").fetchone()==(
            os.environ["LUSK_TEST_DATABASE_NAME"],urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"]).username)
        with psycopg.connect(os.environ["LUSK_TEST_READ_DSN"]) as identity:
            assert identity.execute("select current_database(),current_user").fetchone()==(
                os.environ["LUSK_TEST_DATABASE_NAME"],urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username)
        pub.execute(f'CREATE SCHEMA "{schema}"'); created=True
        pub.execute(f'SET search_path TO "{schema}"')
        pub.execute((root/"api/schema.sql").read_text(encoding="utf-8"))
        territories=[("35238","commune","Focal","35","243500139","D1"),
            ("35001","commune","Peer A","35","243500139","D1"),
            ("35002","commune","Peer B","35","243500139","D1"),
            ("35003","commune","Unavailable","35","243500139","D1"),
            ("243500139","epci","Fixture EPCI","35",None,None),
            ("35","departement","Fixture dept",None,None,None),
            ("53","region","Fixture region",None,None,None)]
        pub.cursor().executemany("INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,density_class_code) VALUES(%s,%s,%s,%s,%s,%s)",territories)
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','ref-v1',%s)",(len(territories),))
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('milieux_typed_reading','reading-v1',4,'ref-v1')")
        pub.execute("""INSERT INTO milieux_typed_reading(territory_id,territory_type,groupe,story_key,salience_reason,
            periode_pop,periode_artif,delta_population,taux_variation_population,artif_m2_par_habitant,
            artif_m3_par_habitant,trajectoire_artif_par_habitant,classification,status,source_id,vintage_id) VALUES
            ('35238','commune','land','fixture','fixture','2017–2023','2020–2023',10,1.0,8,9,1.1,'up','measured','rp','v2023'),
            ('35001','commune','land','fixture','fixture','2017–2023','2020–2023',8,0.8,7,8,1.1,'up','measured','rp','v2023'),
            ('35002','commune','land','fixture','fixture','2017–2023','2020–2023',6,0.6,6,8,1.3,'up','measured','rp','v2023'),
            ('35003','commune','land','fixture','fixture',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'unavailable','rp','v2023')""")
        # Population provenance revisions intentionally support NULL reference/publication dates.
        pub.execute("""INSERT INTO milieux_population_provenance_revision VALUES
            ('pop-rev','rp','v2023','RP fixture','Population fixture','2023',NULL,NULL,'pop-hash'),
            ('pop-other','rp-other','v-other','Other RP','Population fixture','other',NULL,NULL,'other-hash')""")
        pub.execute("""INSERT INTO source_dataset(source_id,name) VALUES('ocs-a','OCS fixture A'),('ocs-b','OCS fixture B')""")
        pub.execute("""INSERT INTO series_provenance_revision VALUES
            ('ocs-a-r1','ocs-a','v1','OCS fixture A','OCS fixture','2025','2025-01-01','2025-02-01','a-hash'),
            ('ocs-b-r1','ocs-b','v2','OCS fixture B','OCS fixture','2025','2025-01-01','2025-02-01','b-hash')""")
        pub.execute("BEGIN")
        pub.execute("""INSERT INTO series_dataset_publication(dataset_id,content_version,reference_content_version,row_count)
            VALUES('milieux_state','series-v1','ref-v1',6)""")
        pub.execute("""INSERT INTO series_dataset_descriptor(dataset_id,indicator_id,axis_kind,axis_values,completeness,
            comparison_point,label,unit,direction,allowed_levels,descriptor_version,theme_id)
            VALUES('milieux_state','artif_par_habitant','declared_detail',ARRAY['2020','2021','2022','2023','2024','2025'],'dense_complete',NULL,
            'État artificialisé','m²/hab','none',ARRAY['commune'],'series-v1','milieux')""")
        axes={"35238":("2020","2023"),"35001":("2021","2025"),"35002":("2022","2024")}
        for code,m2,m3 in (("35238",8,9),("35001",7,8),("35002",6,8)):
            m2_axis,m3_axis=axes[code]
            for role,axis,value,source,revision in (("M2",m2_axis,m2,"ocs-a","ocs-a-r1"),("M2",m2_axis,m2,"ocs-b","ocs-b-r1"),
                ("M3",m3_axis,m3,"ocs-a","ocs-a-r1"),("M3",m3_axis,m3,"ocs-b","ocs-b-r1")):
                # One declared state axis may have multiple independent source revisions.
                with pub.transaction():
                    if not pub.execute("SELECT 1 FROM series_dataset_observation WHERE territory_id=%s AND axis_value=%s",(code,axis)).fetchone():
                        pub.execute("INSERT INTO series_dataset_observation VALUES('milieux_state','artif_par_habitant',%s,'commune',%s,%s,'2020–2023',%s,NULL,'measured')",
                            (code,axis,role,value))
                    pub.execute("INSERT INTO series_observation_provenance VALUES('milieux_state','artif_par_habitant',%s,%s,%s) ON CONFLICT DO NOTHING",
                        (code,axis,revision))
        pub.execute("COMMIT")
        bindings=[]
        for code in ("35238","35001","35002"):
            bindings.append((code,"population","rp","v2023","RP fixture","2023",None,None,"2017–2023",None,None,None,None,None,"pop-rev"))
            for field,role in (("artif_m2_par_habitant","M2"),("artif_m3_par_habitant","M3")):
                for source,vintage,revision,name in (("ocs-a","v1","ocs-a-r1","OCS fixture A"),("ocs-b","v2","ocs-b-r1","OCS fixture B")):
                    axis=axes[code][0 if role=="M2" else 1]
                    bindings.append((code,field,source,vintage,name,"2025","2025-01-01","2025-02-01","2020–2023",
                        "milieux_state","series-v1",role,axis,revision,None))
        pub.cursor().executemany("""INSERT INTO milieux_reading_source(territory_id,territory_type,groupe,field_key,source_id,vintage_id,
            source_name,source_version,reference_date,publication_date,observation_period,dataset_id,dataset_content_version,
            state_role,axis_value,provenance_revision_id,population_revision_id)
            VALUES(%s,'commune','land',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            [(b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14]) for b in bindings])
        reader=os.environ["LUSK_TEST_READ_USER"]
        assert re.fullmatch(r"[A-Za-z0-9_$-]+",reader)
        pub.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{reader}"')
        pub.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{reader}"')

        query_counts=[]
        class RecordingConnection:
            def __init__(self,conn): self.conn=conn; self.count=0
            def execute(self,*args,**kwargs): self.count+=1; return self.conn.execute(*args,**kwargs)
            def __getattr__(self,name): return getattr(self.conn,name)
        class Connections:
            def connection(self):
                class Context:
                    def __enter__(self):
                        self.conn=psycopg.connect(scoped(os.environ["LUSK_TEST_READ_DSN"]))
                        self.recording=RecordingConnection(self.conn)
                        return self.recording
                    def __exit__(self,*args): query_counts.append(self.recording.count); self.conn.close()
                return Context()
        app.dependency_overrides[get_repository]=lambda: ReadRepository(Connections())
        pool.cache_clear()
        with TestClient(app) as client:
            route=f"/api/territories/commune/35238/themes/milieux/comparison"
            default=client.post(route,json={"theme_id":"milieux"})
            assert default.status_code==200,default.text
            cloud=default.json()["reading_cloud"]
            assert cloud["scope"]["kind"]=="density_class" and cloud["selected_member_count"]==4
            assert {p["territory"]["territory_id"] for p in cloud["points"]}=={"35238","35001","35002"}
            assert all(set(p)=={"territory","periode_pop","periode_artif","taux_variation_population","artif_m2_par_habitant","artif_m3_par_habitant"} for p in cloud["points"])
            assert all(p["periode_pop"]=="2017–2023" and p["periode_artif"]=="2020–2023" for p in cloud["points"])
            assert "focal_value" not in default.json() and "readings" not in default.json()
            default_query_count=query_counts[-1]

            empty=client.post(route,json={"theme_id":"milieux","selection":[]})
            assert empty.status_code==200,empty.text
            assert empty.json()["reading_cloud"]=={"status":"unavailable","reason":"no_selected_members","groupe":None,
                "scope":{"kind":"explicit_selection"},"selected_member_count":0,
                "plotted_member_count":0,"content_version":"reading-v1","points":[]}
            single=client.post(route,json={"theme_id":"milieux","selection":[{"territory_type":"commune","territory_id":"35238"}]})
            assert single.status_code==200 and len(single.json()["reading_cloud"]["points"])==1
            singleton_query_count=query_counts[-1]
            mixed=client.post(route,json={"theme_id":"milieux","selection":[
                {"territory_type":"epci","territory_id":"243500139"},
                {"territory_type":"commune","territory_id":"35238"}]})
            assert mixed.status_code==200 and mixed.json()["reading_cloud"]["selected_member_count"]==4
            assert mixed.json()["reading_cloud"]["plotted_member_count"]==3
            assert len(mixed.json()["reading_cloud"]["points"])==3
            assert query_counts[-1]==singleton_query_count==default_query_count
            unavailable=client.post(route,json={"theme_id":"milieux","selection":[{"territory_type":"commune","territory_id":"35003"}]})
            assert unavailable.status_code==200
            assert unavailable.json()["reading_cloud"]["reason"]=="no_plottable_members"

            # Same-version association corruption must fail closed; restoring each field recovers.
            cases=[("axis_value","wrong-axis",axes["35001"][0],"source_id='ocs-a'"),
                ("source_id","wrong-source","ocs-a","provenance_revision_id='ocs-a-r1'"),
                ("vintage_id","wrong-vintage","v1","source_id='ocs-a'"),
                ("provenance_revision_id","ocs-b-r1","ocs-a-r1","source_id='ocs-a'"),
                ("observation_period","wrong-window","2020–2023","source_id='ocs-a'"),
                ("source_name","wrong-name","OCS fixture A","source_id='ocs-a'"),
                ("source_version","wrong-version","2025","source_id='ocs-a'"),
                ("reference_date","2000-01-01","2025-01-01","source_id='ocs-a'"),
                ("publication_date","2000-01-01","2025-02-01","source_id='ocs-a'"),
                ("dataset_content_version","stale-series","series-v1","source_id='ocs-a'")]
            for column,bad,good,locator in cases:
                pub.execute(f"UPDATE milieux_reading_source SET {column}=%s WHERE territory_id='35001' AND field_key='artif_m2_par_habitant' AND {locator}",(bad,))
                corrupt=client.post(route,json={"theme_id":"milieux","selection":[{"territory_type":"commune","territory_id":"35001"}]})
                assert corrupt.status_code==503,(column,corrupt.text)
                pub.execute(f"UPDATE milieux_reading_source SET {column}=%s WHERE territory_id='35001' AND field_key='artif_m2_par_habitant' AND {locator}",(good,))
                restored=client.post(route,json={"theme_id":"milieux","selection":[{"territory_type":"commune","territory_id":"35001"}]})
                assert restored.status_code==200,(column,restored.text)
            population_cases=[("source_id","wrong-source","rp"),("vintage_id","wrong-vintage","v2023"),
                ("population_revision_id","pop-other","pop-rev"),("source_name","wrong-name","RP fixture"),
                ("source_version","wrong-version","2023"),("reference_date","2000-01-01",None),
                ("publication_date","2000-01-01",None)]
            for column,bad,good in population_cases:
                pub.execute(f"UPDATE milieux_reading_source SET {column}=%s WHERE territory_id='35001' AND field_key='population'",(bad,))
                corrupt=client.post(route,json={"theme_id":"milieux","selection":[{"territory_type":"commune","territory_id":"35001"}]})
                assert corrupt.status_code==503,(column,corrupt.text)
                pub.execute(f"UPDATE milieux_reading_source SET {column}=%s WHERE territory_id='35001' AND field_key='population'",(good,))
                restored=client.post(route,json={"theme_id":"milieux","selection":[{"territory_type":"commune","territory_id":"35001"}]})
                assert restored.status_code==200,(column,restored.text)
            pub.execute("DELETE FROM milieux_typed_reading WHERE territory_id='35238' AND territory_type='commune'")
            empty_without_focal=client.post(route,json={"theme_id":"milieux","selection":[]})
            assert empty_without_focal.status_code==200,empty_without_focal.text
            assert empty_without_focal.json()["reading_cloud"]["reason"]=="no_selected_members"
    finally:
        app.dependency_overrides.pop(get_repository,None)
        if prior is not None:
            app.dependency_overrides[get_repository]=prior
        pool.cache_clear()
        if created:
            pub.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        pub.close()
