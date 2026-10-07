"""A populated pre-profile schema must accept declared region profile facts."""
import os
from pathlib import Path
import subprocess
import uuid
from urllib.parse import urlsplit

import pytest

pytestmark = pytest.mark.integration


def test_upgraded_profile_schema_publishes_and_serves_region_facts():
    import psycopg
    from psycopg import sql
    from psycopg_pool import ConnectionPool
    if not os.getenv('LUSK_TEST_PUBLISH_DSN'):
        pytest.skip('requires approved disposable PostgreSQL environment')
    assert os.environ['LUSK_TEST_DATABASE_NAME'].startswith('lusk_it_')
    assert os.environ['LUSK_TEST_DATABASE_PREFIX']=='lusk_it_'
    assert os.environ.get('LUSK_TEST_ALLOW_SCHEMA_CLEANUP')=='1'
    root=Path(__file__).resolve().parents[3]
    schema='it_region_profile_'+uuid.uuid4().hex[:16]
    pool=None
    with psycopg.connect(os.environ['LUSK_TEST_PUBLISH_DSN'],autocommit=True) as conn:
        assert conn.execute('SELECT current_database(),current_user').fetchone()==(
            os.environ['LUSK_TEST_DATABASE_NAME'],urlsplit(os.environ['LUSK_TEST_PUBLISH_DSN']).username)
        conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        try:
            conn.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(schema)))
            conn.execute(subprocess.check_output(['git','show','81012689:api/schema.sql'],cwd=root,text=True))
            # Actual migration-006 constraint retained by the serving upgrade.
            conn.execute("ALTER TABLE profile_observation DROP CONSTRAINT IF EXISTS profile_observation_territory_type_check")
            conn.execute("ALTER TABLE profile_observation ADD CONSTRAINT profile_observation_territory_type_check CHECK(territory_type IN ('commune','epci','departement'))")
            for number in [12,13,14]:
                conn.execute(next((root/'api/migrations').glob(f'{number:03d}_*.sql')).read_text(encoding='utf-8'))
            with conn.transaction():
                conn.execute("INSERT INTO source_dataset VALUES('fixture','Region profile source')")
                conn.execute("INSERT INTO source_vintage VALUES('fixture','fixture-v1','fixture-v1',NULL,NULL)")
                conn.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES('53','region','Bretagne'),('22001','commune','Fixture')")
                conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','ref-v1',2)")
                conn.execute("INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,completeness,descriptor_version,comparison_detail,comparison_direction,theme_id) VALUES('age_du_bati','Age du bâti','%',ARRAY['commune','region'],'dense_complete','v1','lt1919','high','habitat')")
                conn.execute("INSERT INTO profile_descriptor_source VALUES('age_du_bati','fixture')")
                conn.execute("INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal) VALUES('age_du_bati','detail','lt1919','Before 1919',0)")
                conn.execute("INSERT INTO profile_observation(indicator_id,territory_id,territory_type,detail_key,sex_key,sex_axis_name,value,status) VALUES('age_du_bati','22001','commune','lt1919','',NULL,0.25,'measured')")
                conn.execute("INSERT INTO profile_observation_source VALUES('age_du_bati','22001','lt1919','','fixture','fixture-v1')")
                conn.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('declared_profile','profile-v1',1,'ref-v1')")
            old=conn.execute('SELECT * FROM profile_observation').fetchall()
            conn.execute((root/'api/migrations/025_profile_region_upgrade.sql').read_text(encoding='utf-8'))
            with conn.transaction():
                conn.execute("INSERT INTO profile_observation(indicator_id,territory_id,territory_type,detail_key,sex_key,sex_axis_name,value,status) VALUES('age_du_bati','53','region','lt1919','',NULL,0.09,'measured')")
                conn.execute("INSERT INTO profile_observation_source VALUES('age_du_bati','53','lt1919','','fixture','fixture-v1')")
                conn.execute("UPDATE table_publication SET row_count=2 WHERE table_name='declared_profile'")
            assert conn.execute("SELECT * FROM profile_observation WHERE territory_id='22001'").fetchall()==old
            role=sql.Identifier(os.environ['LUSK_TEST_READ_USER'])
            conn.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(sql.Identifier(schema),role))
            conn.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}').format(sql.Identifier(schema),role))
            pool=ConnectionPool(os.environ['LUSK_TEST_READ_DSN'],min_size=1,max_size=1,open=True,
                kwargs={'autocommit':True,'options':f'-csearch_path={schema}'})
            with pool.connection() as reader:
                assert reader.execute('SELECT current_database(),current_user').fetchone()==(
                    os.environ['LUSK_TEST_DATABASE_NAME'],os.environ['LUSK_TEST_READ_USER'])
                assert reader.execute("SELECT value,status FROM profile_observation WHERE territory_type='region' AND territory_id='53'").fetchone()==(0.09,'measured')
        finally:
            if pool:pool.close()
            conn.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
