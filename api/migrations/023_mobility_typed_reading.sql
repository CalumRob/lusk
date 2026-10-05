BEGIN;
ALTER TABLE table_publication DROP CONSTRAINT shared_fact_publication_requires_reference;
ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference
 CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series','demographic_typed_reading',
   'selected_reading','bpe_profile_evidence','economy_typed_reading','economy_activity_evidence',
   'milieux_typed_reading','mobility_typed_reading') OR reference_content_version IS NOT NULL);
ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK(table_name IN (
  'territory_reference','service_registry','essential_service_access','building_ramp','building_grid',
  'scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading',
  'bpe_profile_evidence','economy_typed_reading','economy_activity_evidence','milieux_typed_reading',
  'mobility_typed_reading'));
CREATE TABLE mobility_typed_reading (
  territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  groupe text NOT NULL, story_key text NOT NULL, salience_reason text NOT NULL,
  classification_saillance text,
  div_loss_t double precision, div_loss_b double precision,
  status text NOT NULL CHECK(status IN ('measured','unavailable')),
  source_id text NOT NULL, vintage_id text NOT NULL,
  PRIMARY KEY(territory_id,territory_type,groupe),
  FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
  CHECK ((status='measured') = (div_loss_t IS NOT NULL AND div_loss_b IS NOT NULL)),
  CHECK (div_loss_t IS NULL OR (div_loss_t >= 0 AND div_loss_t NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))),
  CHECK (div_loss_b IS NULL OR (div_loss_b >= 0 AND div_loss_b NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))),
  CHECK (div_loss_t IS NULL OR div_loss_b IS NULL OR div_loss_b <= div_loss_t)
);
CREATE TABLE mobility_reading_descriptor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  descriptor_version text NOT NULL CHECK(length(descriptor_version)>0),
  source_id text NOT NULL, vintage_id text NOT NULL,
  source_name text NOT NULL CHECK(length(trim(source_name))>0), dataset_name text NOT NULL CHECK(length(trim(dataset_name))>0),
  source_version text NOT NULL CHECK(length(trim(source_version))>0), reference_date date, publication_date date,
  unit text NOT NULL CHECK(length(trim(unit))>0), direction text NOT NULL CHECK(direction IN ('high','low','none')),
  allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
  missing_status text NOT NULL CHECK(missing_status='unavailable'),
  classification_values text[] NOT NULL CHECK(cardinality(classification_values)>0),
  field_keys text[] NOT NULL CHECK(cardinality(field_keys)>0), story_count integer NOT NULL CHECK(story_count>0),
  clock_count integer NOT NULL CHECK(clock_count>0),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);
CREATE TABLE mobility_reading_story (
  story_key text PRIMARY KEY, groupe text NOT NULL, salience_reason text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal>0),
  UNIQUE(groupe,story_key), UNIQUE(groupe,story_key,salience_reason), UNIQUE(ordinal),
  CHECK(length(trim(story_key))>0 AND length(trim(groupe))>0 AND length(trim(salience_reason))>0)
);
ALTER TABLE mobility_typed_reading ADD CONSTRAINT mobility_reading_story_contract
  FOREIGN KEY(groupe,story_key,salience_reason) REFERENCES mobility_reading_story(groupe,story_key,salience_reason);
CREATE TABLE mobility_reading_clock (
  ordinal integer PRIMARY KEY CHECK(ordinal>0), clock_name text NOT NULL CHECK(length(trim(clock_name))>0),
  frequency text NOT NULL CHECK(length(trim(frequency))>0), reference text NOT NULL CHECK(length(trim(reference))>0),
  trigger text NOT NULL CHECK(length(trim(trigger))>0), UNIQUE(clock_name)
);
GRANT SELECT ON mobility_typed_reading,mobility_reading_descriptor,mobility_reading_story,mobility_reading_clock TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON mobility_typed_reading,mobility_reading_descriptor,mobility_reading_story,mobility_reading_clock TO lusk_publisher;
COMMIT;
