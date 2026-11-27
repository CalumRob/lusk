import pytest
from api.tests.integration.theme_facts_http_support import fixture, common
from api.tests.integration.resource_publication_helper import publish_resource

pytestmark=pytest.mark.integration

def test_programmes_selected_facts_http_snapshot():
    def insert(db):
        db.execute("INSERT INTO source_dataset(source_id,name) VALUES('programme-src','Fixture')")
        db.execute("INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES('programme-src','v1','2026','2026-01-01','2026-02-01')")
        db.execute("INSERT INTO observed_collection_publication(indicator_id,content_version,reference_content_version,row_count) VALUES('programme_membership','c1','ref-v1',1)")
        db.execute("INSERT INTO observed_collection_descriptor(indicator_id,theme_id,kind,label,unit,descriptor_version,allowed_levels,direction) VALUES('programme_membership','programmes','anchored_membership','Programmes','count','d1',ARRAY['commune'],'none')")
        db.execute("INSERT INTO observed_collection_category(indicator_id,detail_key,label,ordinal,source_id,anchor_levels,rider_label) VALUES('programme_membership','grant','Programme aid',0,'programme-src',ARRAY['commune'],'Aid rider')")
        db.execute("INSERT INTO anchored_membership(indicator_id,territory_id,territory_type,detail_key,convention_valant_ort,source_id,vintage_id) VALUES('programme_membership','35238','commune','grant',true,'programme-src','v1')")
        publish_resource(db, "programme_membership", "observed_collection", "c1",
                         reference_content_version="ref-v1")
    with fixture('programmes',insert) as (db,client,checked):
        resource=common(client,checked,'programmes')
        target={"kind":"territory","type":"commune","id":"35238"}
        def read(fields=None):
            payload={"resource":resource,"target":target,"intent":{"kind":"facts"}}
            if fields is not None: payload["fields"]=fields
            return client.post("/api/resources/read",json=payload)
        response=read()
        assert response.status_code==200,response.text
        anchors=read(['anchor_count'])
        riders=read(['rider'])
        assert anchors.status_code==200 and riders.status_code==200
        anchor_collection=anchors.json()
        rider_collection=riders.json()
        assert anchor_collection['summaries'][0]['anchor_count']==1
        assert 'rider' not in anchor_collection['entries'][0]
        assert rider_collection['entries'][0]['rider']=='Aid rider'
        assert 'anchor_count' not in rider_collection['summaries'][0]
        assert anchor_collection['entries'][0]['detail']=='grant'
        assert anchor_collection['entries'][0]['sources']==response.json()['entries'][0]['sources']
        item=response.json()
        assert item['resource']=='programme_membership'
        assert item['content_version']=='c1'
        assert item['entries'][0]['label']=='Programme aid'
        assert item['entries'][0]['rider']=='Aid rider'
        assert item['entries'][0]['sources'][0]['source_id']=='programme-src'
        assert item['availability']=='observed'
