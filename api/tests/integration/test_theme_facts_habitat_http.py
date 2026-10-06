import pytest
from api.tests.integration.theme_facts_http_support import fixture, common

pytestmark=pytest.mark.integration

def test_habitat_selected_facts_http_snapshot():
    def insert(db):
        db.execute("INSERT INTO source_dataset(source_id,name) VALUES('src','Fixture')")
        db.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES('src','v1','2026')")
        db.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('scalar_observation','s1',0,'ref-v1'),('declared_profile','dp1',0,'ref-v1'),('selected_reading','s1',1,'ref-v1')")
        db.execute("INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES('fixture_scalar','habitat','fixture','%', 'high','fixture_scalar',ARRAY['commune'],'none','sparse','s1')")
        db.execute("INSERT INTO scalar_descriptor_source VALUES('fixture_scalar','src')")
        db.execute("INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,completeness,descriptor_version,comparison_scalar,denominator_semantics,comparison_direction,theme_id,required_scalar_version) VALUES('distribution_dpe','DPE','%',ARRAY['commune'],'dense_complete','pd1','fixture_scalar','none','high','habitat','s1')")
        db.execute("INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal) VALUES('distribution_dpe','detail','detail','DPE detail',0)")
        db.execute("INSERT INTO profile_descriptor_source VALUES('distribution_dpe','src')")
        db.execute("INSERT INTO profile_observation(indicator_id,territory_id,territory_type,detail_key,sex_key,sex_axis_name,value,status) VALUES('distribution_dpe','35238','commune','detail','',NULL,1,'measured')")
        db.execute("INSERT INTO profile_observation_source VALUES('distribution_dpe','35238','detail','','src','v1')")
        db.execute("INSERT INTO selected_reading_descriptor(theme_id,descriptor_version,source_id,vintage_id,linked_content_version) VALUES('habitat','s1','src','v1','linked-dp1-s1-ref-v1')")
        db.execute("INSERT INTO selected_reading_publication(theme_id,content_version,reference_content_version,row_count) VALUES('habitat','s1','ref-v1',1)")
        db.execute("INSERT INTO habitat_typed_reading VALUES('35238','commune','logement','story','reason','A',0.2,0.5,10,'measured','src','v1')")
    with fixture('habitat',insert) as (db,client,checked):
        route=common(client,checked,'habitat')
        response=client.post(route,json={'theme_id':'habitat'})
        assert response.status_code==200,response.text
        row=response.json()['readings'][0]
        assert {k:row[k] for k in ('groupe','story_key','salience_reason','classification','part_passoires','part_abc','n_dpe','status','source_id','vintage_id')} == {'groupe':'logement','story_key':'story','salience_reason':'reason','classification':'A','part_passoires':0.2,'part_abc':0.5,'n_dpe':10,'status':'measured','source_id':'src','vintage_id':'v1'}
        db.execute("DELETE FROM habitat_typed_reading WHERE territory_id='35238'")
        absent=client.post(route,json={'theme_id':'habitat','selection':[]})
        assert absent.status_code==404
        comparison=client.post('/api/territories/commune/35238/themes/habitat/comparison',json={'theme_id':'habitat','selection':[]})
        assert comparison.status_code==200,comparison.text
