import pytest
from api.tests.integration.theme_facts_http_support import fixture, common

pytestmark=pytest.mark.integration

def test_economie_selected_facts_http_snapshot():
    def insert(db):
        db.execute("INSERT INTO source_dataset(source_id,name) VALUES('src','Fixture')")
        db.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES('src','v1','2026')")
        db.execute("INSERT INTO economy_typed_reading VALUES('35238','commune','activite','story','reason','measured','src','v1')")
        db.execute("INSERT INTO economy_activity_evidence VALUES('35238','commune','activite',1,'A','Activity',1.5,3,0.2,'src','v1')")
        db.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('economy_typed_reading','e1',1,'ref-v1'),('economy_activity_evidence','e1',1,'ref-v1')")
    with fixture('economie',insert) as (db,client,checked):
        route=common(client,checked,'economie')
        result=client.post(route,json={'theme_id':'economie'})
        assert result.status_code==200,result.text
        row=result.json()['readings'][0]
        assert row['activities'][0]['activity_code']=='A'
        # This fixture isolates typed activity evidence; canonical eco_activites scalar coverage
        # is exercised through the guarded registered-publisher HTTP test.
