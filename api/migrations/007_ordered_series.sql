-- Ordered declared annual series; additive, do not apply to a live Pi here.
BEGIN;
ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check
 CHECK (table_name IN ('territory_reference','service_registry','essential_service_access',
   'building_ramp','building_grid','scalar_observation','declared_profile','ordered_series'));
ALTER TABLE table_publication DROP CONSTRAINT profile_publication_requires_reference;
ALTER TABLE table_publication DROP CONSTRAINT scalar_publication_requires_reference;
ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference
 CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series') OR reference_content_version IS NOT NULL);
CREATE TABLE series_descriptor (
 indicator_id text PRIMARY KEY CHECK(indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
 axis_kind text NOT NULL CHECK(axis_kind='year'),
 axis_values text[] NOT NULL CHECK(cardinality(axis_values)>0),
 completeness text NOT NULL CHECK(completeness IN ('dense_complete','may_be_missing')),
 comparison_point text,
 allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
  label text NOT NULL, unit text NOT NULL, direction text NOT NULL CHECK(direction IN ('high','low','none')),
  source_id text NOT NULL REFERENCES source_dataset(source_id), vintage_id text NOT NULL,
  descriptor_version text NOT NULL,
  CHECK(comparison_point IS NULL OR (comparison_point=ANY(axis_values) AND direction IN ('high','low'))),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE TABLE ordered_series (
 indicator_id text NOT NULL REFERENCES series_descriptor(indicator_id),
 territory_id text NOT NULL REFERENCES territory_reference(territory_id),
 territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
 axis_value text NOT NULL, observation_period text NOT NULL,
 value double precision, status text NOT NULL CHECK(status IN ('measured','missing')),
 source_id text NOT NULL, vintage_id text NOT NULL,
 PRIMARY KEY(indicator_id,territory_id,axis_value),
 FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
 CHECK((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)) OR (status='missing' AND value IS NULL)));
CREATE INDEX territory_reference_series_scope ON territory_reference(territory_type,department_id,epci_id,territory_id);
CREATE INDEX ordered_series_comparison_point ON ordered_series(indicator_id,axis_value,territory_id) INCLUDE(value,status);
CREATE FUNCTION validate_ordered_series() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM series_descriptor d JOIN territory_reference t ON t.territory_id=NEW.territory_id
   WHERE d.indicator_id=NEW.indicator_id AND NEW.axis_value=ANY(d.axis_values) AND NEW.territory_type=ANY(d.allowed_levels)
     AND t.territory_type=NEW.territory_type AND NEW.source_id=d.source_id AND NEW.vintage_id=d.vintage_id)
 THEN RAISE EXCEPTION 'series point outside declared descriptor'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER ordered_series_contract BEFORE INSERT OR UPDATE ON ordered_series
 FOR EACH ROW EXECUTE FUNCTION validate_ordered_series();
GRANT SELECT ON series_descriptor,ordered_series TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON series_descriptor,ordered_series TO lusk_publisher;
COMMIT;
