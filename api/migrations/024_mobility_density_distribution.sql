BEGIN;

ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK (table_name IN (
  'territory_reference','service_registry','essential_service_access','building_ramp','building_grid',
  'scalar_observation','declared_profile','ordered_series','bpe_profile_evidence',
  'demographic_typed_reading','selected_reading','economy_typed_reading','economy_activity_evidence',
  'milieux_typed_reading','mobility_typed_reading','mobility_density_distribution'));
ALTER TABLE table_publication DROP CONSTRAINT shared_fact_publication_requires_reference;
ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference CHECK (
  table_name NOT IN ('scalar_observation','declared_profile','ordered_series','bpe_profile_evidence',
    'demographic_typed_reading','selected_reading','economy_typed_reading','economy_activity_evidence',
    'milieux_typed_reading','mobility_typed_reading','mobility_density_distribution')
  OR reference_content_version IS NOT NULL);

CREATE TABLE mobility_density_distribution_descriptor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  descriptor_version text NOT NULL,
  source_id text NOT NULL CHECK (source_id='mobilite_snapshot'),
  vintage_id text NOT NULL,
  axis_count integer NOT NULL CHECK (axis_count > 0),
  density_unit text NOT NULL CHECK (length(trim(density_unit)) > 0),
  decile_unit text NOT NULL CHECK (length(trim(decile_unit)) > 0),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);
CREATE TABLE mobility_density_distribution_range (
  territory_id text NOT NULL,
  territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement','region')),
  minimum double precision,
  maximum double precision,
  status text NOT NULL CHECK (status IN ('measured','not_available','unsupported')),
  source_id text NOT NULL CHECK (source_id='mobilite_snapshot'),
  vintage_id text NOT NULL,
  PRIMARY KEY(territory_type,territory_id),
  FOREIGN KEY(territory_id) REFERENCES territory_reference(territory_id),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
  CHECK ((status='measured' AND minimum IS NOT NULL AND maximum IS NOT NULL AND minimum<=maximum)
      OR (status<>'measured' AND minimum IS NULL AND maximum IS NULL)),
  CHECK (minimum IS NULL OR (minimum NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) AND minimum>=0)),
  CHECK (maximum IS NULL OR (maximum NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) AND maximum>=0))
);
CREATE TABLE mobility_density_distribution_point (
  territory_id text NOT NULL,
  territory_type text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal>=0),
  density double precision,
  density_status text NOT NULL CHECK (density_status IN ('measured','not_available','unsupported')),
  decile double precision,
  decile_status text NOT NULL CHECK (decile_status IN ('measured','not_available','unsupported')),
  source_id text NOT NULL CHECK (source_id='mobilite_snapshot'),
  vintage_id text NOT NULL,
  PRIMARY KEY(territory_type,territory_id,ordinal),
  FOREIGN KEY(territory_type,territory_id) REFERENCES mobility_density_distribution_range(territory_type,territory_id) ON DELETE CASCADE,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
  CHECK ((density_status='measured')=(density IS NOT NULL)),
  CHECK ((decile_status='measured')=(decile IS NOT NULL)),
  CHECK (density IS NULL OR (density NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) AND density>=0)),
  CHECK (decile IS NULL OR decile NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))
);
CREATE FUNCTION validate_mobility_density_distribution_territory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM territory_reference WHERE territory_id=NEW.territory_id AND territory_type=NEW.territory_type)
  THEN RAISE EXCEPTION 'Mobility density distribution territory type differs from reference'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mobility_density_distribution_territory_contract BEFORE INSERT OR UPDATE ON mobility_density_distribution_range
  FOR EACH ROW EXECUTE FUNCTION validate_mobility_density_distribution_territory();

CREATE FUNCTION assert_mobility_density_distribution_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer;
BEGIN
  SELECT axis_count INTO expected FROM mobility_density_distribution_descriptor WHERE singleton;
  IF expected IS NULL THEN RAISE EXCEPTION 'Mobility density distribution descriptor is unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM mobility_density_distribution_range r
    WHERE (SELECT count(*) FROM mobility_density_distribution_point p
      WHERE p.territory_type=r.territory_type AND p.territory_id=r.territory_id) <> expected OR
      (SELECT min(ordinal) FROM mobility_density_distribution_point p
        WHERE p.territory_type=r.territory_type AND p.territory_id=r.territory_id) <> 0 OR
      (SELECT max(ordinal) FROM mobility_density_distribution_point p
        WHERE p.territory_type=r.territory_type AND p.territory_id=r.territory_id) <> expected-1)
  THEN RAISE EXCEPTION 'Mobility density distribution axis is incomplete'; END IF;
  IF EXISTS (SELECT 1 FROM mobility_density_distribution_point p
    WHERE NOT EXISTS (SELECT 1 FROM mobility_density_distribution_range r
      WHERE r.territory_type=p.territory_type AND r.territory_id=p.territory_id))
  THEN RAISE EXCEPTION 'Mobility density distribution has orphan coordinates'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER mobility_density_distribution_complete
  AFTER INSERT OR UPDATE OR DELETE ON mobility_density_distribution_point
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_mobility_density_distribution_complete();
CREATE CONSTRAINT TRIGGER mobility_density_distribution_range_complete
  AFTER INSERT OR UPDATE OR DELETE ON mobility_density_distribution_range
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_mobility_density_distribution_complete();
GRANT SELECT ON mobility_density_distribution_descriptor,mobility_density_distribution_range,mobility_density_distribution_point TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON mobility_density_distribution_descriptor,mobility_density_distribution_range,mobility_density_distribution_point TO lusk_publisher;

COMMIT;
