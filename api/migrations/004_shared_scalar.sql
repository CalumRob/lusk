-- Additive shared scalar serving primitives. Run transactionally; no pilot
-- relation or reader is changed. Fresh installs receive the equivalent DDL in
-- schema.sql. Reserve 004 for this slice; later grains take distinct numbers.
BEGIN;
ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check
 CHECK (table_name IN ('territory_reference','service_registry','essential_service_access',
   'building_ramp','building_grid','scalar_observation'));
ALTER TABLE table_publication ADD COLUMN reference_content_version text;
ALTER TABLE table_publication ADD CONSTRAINT scalar_publication_requires_reference
 CHECK (table_name <> 'scalar_observation' OR reference_content_version IS NOT NULL);
CREATE TABLE source_dataset (source_id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE source_vintage (
 source_id text NOT NULL REFERENCES source_dataset(source_id), vintage_id text NOT NULL,
 version text NOT NULL, reference_date date, publication_date date,
 PRIMARY KEY(source_id,vintage_id));
CREATE TABLE scalar_descriptor (
 indicator_id text PRIMARY KEY CHECK (indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
 source_id text NOT NULL REFERENCES source_dataset(source_id),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200), unit text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('high','low','none')), comparison_facet text,
 allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@
 ARRAY['commune','epci','departement','region']::text[]),
 denominator_semantics text NOT NULL,
 completeness text NOT NULL CHECK(completeness IN ('dense_complete','sparse')),
 descriptor_version text NOT NULL);
CREATE TABLE scalar_observation (
 indicator_id text NOT NULL REFERENCES scalar_descriptor(indicator_id),
 territory_id text NOT NULL REFERENCES territory_reference(territory_id),
 territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
 value double precision, status text NOT NULL CHECK(status IN ('measured','suppressed','unsupported','not_available')),
 support_count bigint CHECK(support_count IS NULL OR support_count>=0),
 denominator_count bigint CHECK(denominator_count IS NULL OR denominator_count>=0),
 source_id text NOT NULL, vintage_id text NOT NULL,
 PRIMARY KEY(indicator_id,territory_id),
 FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
 CHECK((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)) OR (status<>'measured' AND value IS NULL)),
 CHECK(denominator_count IS NULL OR support_count IS NULL OR denominator_count>=support_count));
CREATE FUNCTION assert_scalar_levels() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM scalar_descriptor d WHERE d.indicator_id=NEW.indicator_id AND NEW.territory_type=ANY(d.allowed_levels) AND d.source_id=NEW.source_id)
 OR NOT EXISTS(SELECT 1 FROM territory_reference t WHERE t.territory_id=NEW.territory_id AND t.territory_type=NEW.territory_type)
 THEN RAISE EXCEPTION 'scalar descriptor/territory level mismatch'; END IF; RETURN NEW; END $$;
CREATE TRIGGER scalar_observation_levels BEFORE INSERT OR UPDATE ON scalar_observation
 FOR EACH ROW EXECUTE FUNCTION assert_scalar_levels();
CREATE TABLE scalar_observation_source (
 indicator_id text NOT NULL, territory_id text NOT NULL, source_id text NOT NULL,
 vintage_id text NOT NULL, PRIMARY KEY(indicator_id,territory_id,source_id,vintage_id),
 FOREIGN KEY(indicator_id,territory_id) REFERENCES scalar_observation(indicator_id,territory_id) ON DELETE CASCADE,
 FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE FUNCTION assert_scalar_source_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM scalar_observation_source s WHERE s.indicator_id=NEW.indicator_id
   AND s.territory_id=NEW.territory_id AND s.source_id=NEW.source_id AND s.vintage_id=NEW.vintage_id) THEN
   RAISE EXCEPTION 'scalar observation lacks its declared source-vintage link'; END IF;
 RETURN NEW; END $$;
CREATE CONSTRAINT TRIGGER scalar_observation_source_required AFTER INSERT OR UPDATE ON scalar_observation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_scalar_source_link();
CREATE FUNCTION assert_scalar_descriptor_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM scalar_observation o WHERE o.indicator_id=OLD.indicator_id
    AND (o.source_id<>NEW.source_id OR NOT(o.territory_type=ANY(NEW.allowed_levels)))) THEN
   RAISE EXCEPTION 'descriptor update invalidates published scalar observations'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER scalar_descriptor_compatibility BEFORE UPDATE ON scalar_descriptor
 FOR EACH ROW EXECUTE FUNCTION assert_scalar_descriptor_update();
CREATE FUNCTION assert_scalar_territory_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM scalar_observation o JOIN scalar_descriptor d USING(indicator_id)
   WHERE o.territory_id=OLD.territory_id
     AND (NEW.territory_type<>o.territory_type OR NOT(NEW.territory_type=ANY(d.allowed_levels)))) THEN
   RAISE EXCEPTION 'territory update invalidates published scalar observations'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER scalar_territory_compatibility BEFORE UPDATE OF territory_type ON territory_reference
 FOR EACH ROW EXECUTE FUNCTION assert_scalar_territory_update();
-- Reader receives no write privilege; publisher retains transactional writes.
GRANT SELECT ON source_dataset, source_vintage, scalar_descriptor, scalar_observation, scalar_observation_source TO lusk_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON source_dataset, source_vintage, scalar_descriptor, scalar_observation, scalar_observation_source TO lusk_publisher;
COMMIT;
