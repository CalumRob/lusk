ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK (table_name IN (
 'territory_reference','service_registry','essential_service_access','building_ramp','building_grid','scalar_observation','declared_profile'));
ALTER TABLE table_publication ADD CONSTRAINT profile_publication_requires_reference
 CHECK(table_name <> 'declared_profile' OR reference_content_version IS NOT NULL);
CREATE TABLE profile_descriptor (
 indicator_id text PRIMARY KEY CHECK(indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
 label text NOT NULL, unit text NOT NULL, allowed_levels text[] NOT NULL,
 completeness text NOT NULL CHECK(completeness='dense_complete'), descriptor_version text NOT NULL,
 comparison_detail text NOT NULL, comparison_sex text NOT NULL,
 comparison_direction text NOT NULL CHECK(comparison_direction IN ('high','low','none')));
CREATE TABLE profile_descriptor_source (
 indicator_id text NOT NULL REFERENCES profile_descriptor(indicator_id) ON DELETE CASCADE,
 source_id text NOT NULL REFERENCES source_dataset(source_id), PRIMARY KEY(indicator_id,source_id));
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
 FOREIGN KEY(territory_id) REFERENCES territory_reference(territory_id),
  CHECK((status='measured')=(value IS NOT NULL)),
 CHECK(value IS NULL OR value NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision)));
CREATE FUNCTION assert_profile_territory_level() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profile_descriptor d WHERE d.indicator_id=NEW.indicator_id AND NEW.territory_type=ANY(d.allowed_levels))
 OR NOT EXISTS(SELECT 1 FROM territory_reference t WHERE t.territory_id=NEW.territory_id AND t.territory_type=NEW.territory_type)
 THEN RAISE EXCEPTION 'profile descriptor/territory level mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profile_territory_level BEFORE INSERT OR UPDATE ON profile_observation
 FOR EACH ROW EXECUTE FUNCTION assert_profile_territory_level();
CREATE TABLE profile_observation_source (
 indicator_id text NOT NULL, territory_id text NOT NULL, detail_key text NOT NULL, sex_key text NOT NULL,
 source_id text NOT NULL, vintage_id text NOT NULL,
 PRIMARY KEY(indicator_id,territory_id,detail_key,sex_key,source_id,vintage_id),
 FOREIGN KEY(indicator_id,territory_id,detail_key,sex_key) REFERENCES profile_observation(indicator_id,territory_id,detail_key,sex_key) ON DELETE CASCADE,
 FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
 FOREIGN KEY(indicator_id,source_id) REFERENCES profile_descriptor_source(indicator_id,source_id));
GRANT SELECT ON profile_descriptor,profile_descriptor_source,profile_axis,profile_observation,profile_observation_source TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON profile_descriptor,profile_descriptor_source,profile_axis,profile_observation,profile_observation_source TO lusk_publisher;
