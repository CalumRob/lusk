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
GRANT SELECT ON mobility_typed_reading TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON mobility_typed_reading TO lusk_publisher;
COMMIT;
