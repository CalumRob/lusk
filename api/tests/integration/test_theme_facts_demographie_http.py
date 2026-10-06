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
        db.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('demographic_typed_reading','r1',1,'ref-v1')")
    with fixture('demographie',insert) as (db,client,checked):
        assert db.execute("SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version,d.descriptor_version,sd.name,sv.vintage_id,sv.version FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference' JOIN demographic_reading_descriptor d ON d.singleton JOIN source_dataset sd USING(source_id) JOIN source_vintage sv USING(source_id,vintage_id) WHERE p.table_name='demographic_typed_reading'").fetchone()==('r1',1,'ref-v1','ref-v1','r1','Fixture','v1','2026')
        import psycopg
        read_dsn=os.environ['LUSK_TEST_READ_DSN']
        schema=db.execute('SELECT current_schema()').fetchone()[0]
        u=urlsplit(read_dsn); q=parse_qs(u.query); q['options']=['-csearch_path='+schema]
        scoped=urlunsplit((u.scheme,u.netloc,u.path,urlencode(q,doseq=True),u.fragment))
        with psycopg.connect(scoped) as fresh:
            marker=fresh.execute("SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version,d.descriptor_version,d.source_id,sd.name,sv.vintage_id,sv.version,sv.reference_date,sv.publication_date,d.rate_unit FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference' JOIN demographic_reading_descriptor d ON d.singleton JOIN source_dataset sd ON sd.source_id=d.source_id JOIN source_vintage sv ON sv.source_id=d.source_id AND sv.vintage_id=d.vintage_id WHERE p.table_name='demographic_typed_reading'").fetchone()
            duplicates=fresh.execute("SELECT count(*) FROM table_publication WHERE table_name IN ('demographic_typed_reading','territory_reference')").fetchone()[0]
            assert marker and marker[0] and marker[1]>0 and marker[2]==marker[3] and marker[0]==marker[4] and duplicates==2
        route=common(client,checked,'demographie')
        result=client.post(route,json={'theme_id':'demographie'})
        assert result.status_code==200,result.text
        row=result.json()['readings'][0]
        assert all(k in row for k in ('periode','solde_naturel','solde_migratoire','taux_solde_naturel','taux_solde_migratoire','classification','status','provenance','rate_unit'))
        db.execute("DELETE FROM demographic_typed_reading WHERE territory_id='35238'")
        assert client.post(route,json={'theme_id':'demographie'}).status_code==404
