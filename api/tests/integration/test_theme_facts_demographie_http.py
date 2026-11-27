import pytest
import os
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from api.tests.integration.theme_facts_http_support import fixture, common

pytestmark=pytest.mark.integration

def test_demographie_selected_facts_http_snapshot():
    def insert(db):
        db.execute("INSERT INTO source_dataset(source_id,name) VALUES('src','Fixture')")
        db.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES('src','v1','2026')")
        db.execute("INSERT INTO demographic_reading_descriptor(singleton,descriptor_version,source_id,vintage_id,rate_unit) VALUES(true,'r1','src','v1','‰')")
        db.execute("INSERT INTO demographic_typed_reading VALUES('35238','commune','naturel','story','reason','2020',1,2,0.1,0.2,'balanced','measured','src','v1')")
        db.execute("INSERT INTO demographic_typed_reading VALUES('35001','commune','naturel','story','reason','2020',2,1,0.2,0.1,'balanced','measured','src','v1')")
        db.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('demographic_typed_reading','r1',2,'ref-v1')")
    with fixture('demographie',insert) as (db,client,checked):
        assert db.execute("SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version,d.descriptor_version,sd.name,sv.vintage_id,sv.version FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference' JOIN demographic_reading_descriptor d ON d.singleton JOIN source_dataset sd USING(source_id) JOIN source_vintage sv USING(source_id,vintage_id) WHERE p.table_name='demographic_typed_reading'").fetchone()==('r1',2,'ref-v1','ref-v1','r1','Fixture','v1','2026')
        import psycopg
        read_dsn=os.environ['LUSK_TEST_READ_DSN']
        schema=db.execute('SELECT current_schema()').fetchone()[0]
        u=urlsplit(read_dsn); q=parse_qs(u.query); q['options']=['-csearch_path='+schema]
        scoped=urlunsplit((u.scheme,u.netloc,u.path,urlencode(q,doseq=True),u.fragment))
        with psycopg.connect(scoped) as fresh:
            marker=fresh.execute("SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version,d.descriptor_version,d.source_id,sd.name,sv.vintage_id,sv.version,sv.reference_date,sv.publication_date,d.rate_unit FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference' JOIN demographic_reading_descriptor d ON d.singleton JOIN source_dataset sd ON sd.source_id=d.source_id JOIN source_vintage sv ON sv.source_id=d.source_id AND sv.vintage_id=d.vintage_id WHERE p.table_name='demographic_typed_reading'").fetchone()
            duplicates=fresh.execute("SELECT count(*) FROM table_publication WHERE table_name IN ('demographic_typed_reading','territory_reference')").fetchone()[0]
            assert marker and marker[0] and marker[1]>0 and marker[2]==marker[3] and marker[0]==marker[4] and duplicates==2
        resource=common(client,checked,'demographie')
        target={"kind":"territory","type":"commune","id":"35238"}
        def read(fields=None):
            payload={"resource":resource,"target":target,"intent":{"kind":"facts"}}
            if fields is not None: payload["fields"]=fields
            return client.post("/api/resources/read",json=payload)
        result=read()
        assert result.status_code==200,result.text
        row=result.json()['facts'][0]
        assert all(k in row for k in ('periode','solde_naturel','solde_migratoire','taux_solde_naturel','taux_solde_migratoire','classification','status','source_id','vintage_id')), row
        assert result.json()['descriptor']['rate_unit']=='‰'
        assert result.json()['descriptor']['source']['source_id']=='src'
        value=read(['periode','solde_naturel','solde_migratoire','taux_solde_naturel','taux_solde_migratoire'])
        status=read(['periode','status'])
        invalid=read(['raw_sql'])
        assert value.status_code==200 and status.status_code==200
        assert read().json()['facts']==result.json()['facts']
        for selected in (value.json(), status.json()):
            selected_reading=selected['facts'][0]
            assert selected_reading['status']=='measured'
            assert selected_reading['source_id']==row['source_id']
            assert selected_reading['vintage_id']==row['vintage_id']
            assert selected_reading['periode']==row['periode']
        assert {'solde_naturel','solde_migratoire','taux_solde_naturel','taux_solde_migratoire'} <= set(value.json()['facts'][0])
        assert not {'solde_naturel','solde_migratoire','taux_solde_naturel','taux_solde_migratoire'} & set(status.json()['facts'][0])
        assert status.json()['facts'][0]['status']=='measured'
        assert invalid.status_code==422
        assert any("r.status" in sql.split(" FROM ")[0]
                   and "r.solde_naturel" not in sql.split(" FROM ")[0]
                   for rec in checked for sql,params in rec.queries
                   if "FROM demographic_typed_reading" in sql)
        checked.clear()
        assert read(['raw_sql']).status_code==422
        assert checked==[]
        assert read([]).status_code==422
        assert read(['status','status']).status_code==422
        db.execute("DELETE FROM demographic_typed_reading WHERE territory_id='35238'")
        assert read().status_code==503
