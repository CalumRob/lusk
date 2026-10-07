BEGIN;
ALTER TABLE table_publication DROP CONSTRAINT shared_fact_publication_requires_reference;
ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference
 CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series','demographic_typed_reading',
  'selected_reading','bpe_profile_evidence','economy_typed_reading','economy_activity_evidence',
  'milieux_typed_reading','milieux_reading_absence','mobility_typed_reading','mobility_density_distribution',
  'aedar_territorial_aggregate') OR reference_content_version IS NOT NULL);
ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK(table_name IN (
 'territory_reference','service_registry','essential_service_access','building_ramp','building_grid',
 'scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading',
 'bpe_profile_evidence','economy_typed_reading','economy_activity_evidence','milieux_typed_reading',
 'milieux_reading_absence','mobility_typed_reading','mobility_density_distribution','aedar_territorial_aggregate'));
CREATE TABLE IF NOT EXISTS aedar_territorial_aggregate (
  territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement','region')),
  territory_id text NOT NULL, typequ text NOT NULL, typequ_label text NOT NULL,
  identity jsonb NOT NULL,
  n_addresses bigint NOT NULL CHECK(n_addresses>=0),
  n_observed bigint NOT NULL CHECK(n_observed>=0 AND n_observed<=n_addresses),
  coverage_status text NOT NULL, measures jsonb NOT NULL,
  source_id text NOT NULL DEFAULT 'aedar_bretagne', vintage_id text NOT NULL DEFAULT '2026-v1',
  source_url text NOT NULL, licence text NOT NULL, attribution text NOT NULL,
  reference_date date, publication_date date,
  PRIMARY KEY(territory_type,territory_id,typequ)
);
CREATE INDEX IF NOT EXISTS aedar_territorial_aggregate_typequ_idx
 ON aedar_territorial_aggregate(territory_type,typequ);
GRANT SELECT ON aedar_territorial_aggregate,table_publication TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON aedar_territorial_aggregate,table_publication TO lusk_publisher;
COMMIT;
