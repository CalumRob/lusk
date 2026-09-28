ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK (table_name IN (
 'territory_reference','service_registry','essential_service_access','building_ramp','building_grid','scalar_observation','declared_profile'));
CREATE TABLE profile_descriptor (
 indicator_id text PRIMARY KEY CHECK(indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
 label text NOT NULL, unit text NOT NULL, allowed_levels text[] NOT NULL,
 completeness text NOT NULL CHECK(completeness='dense_complete'), descriptor_version text NOT NULL);
CREATE TABLE profile_axis (
 indicator_id text NOT NULL REFERENCES profile_descriptor(indicator_id) ON DELETE CASCADE,
 axis_name text NOT NULL CHECK(axis_name IN ('detail','sex')), axis_key text NOT NULL,
 label text NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0),
 PRIMARY KEY(indicator_id,axis_name,axis_key), UNIQUE(indicator_id,axis_name,ordinal));
CREATE TABLE profile_observation (
 indicator_id text NOT NULL REFERENCES profile_descriptor(indicator_id), territory_id text NOT NULL,
 territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement')),
 detail_key text NOT NULL, sex_key text NOT NULL,
 detail_axis_name text NOT NULL DEFAULT 'detail' CHECK(detail_axis_name='detail'),
 sex_axis_name text NOT NULL DEFAULT 'sex' CHECK(sex_axis_name='sex'),
 value double precision, status text NOT NULL CHECK(status IN ('measured','not_available','suppressed','unsupported')),
 PRIMARY KEY(indicator_id,territory_id,detail_key,sex_key),
 FOREIGN KEY(indicator_id,detail_axis_name,detail_key) REFERENCES profile_axis(indicator_id,axis_name,axis_key),
 FOREIGN KEY(indicator_id,sex_axis_name,sex_key) REFERENCES profile_axis(indicator_id,axis_name,axis_key),
 CHECK((status='measured')=(value IS NOT NULL)), CHECK(value IS NULL OR isfinite(value)));
GRANT SELECT ON profile_descriptor,profile_axis,profile_observation TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON profile_descriptor,profile_axis,profile_observation TO lusk_publisher;
