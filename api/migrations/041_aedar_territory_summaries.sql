BEGIN;
ALTER TABLE table_publication ADD COLUMN aedar_source_content_version text;
ALTER TABLE table_publication ADD CONSTRAINT aedar_summary_publication_requires_source CHECK (
  (table_name='aedar_territory_summary' AND aedar_source_content_version IS NOT NULL AND length(aedar_source_content_version)>0)
  OR (table_name<>'aedar_territory_summary' AND aedar_source_content_version IS NULL));
ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK (table_name IN (
  'territory_reference','scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading',
  'economy_typed_reading','economy_activity_evidence','milieux_typed_reading','milieux_reading_absence',
  'aedar_territorial_aggregate','aedar_territory_summary'));
ALTER TABLE table_publication DROP CONSTRAINT shared_fact_publication_requires_reference;
ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference CHECK (
  table_name NOT IN ('scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading',
    'economy_typed_reading','economy_activity_evidence','milieux_typed_reading','milieux_reading_absence',
    'aedar_territorial_aggregate','aedar_territory_summary') OR reference_content_version IS NOT NULL);
CREATE TABLE aedar_territory_summary (
  territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  territory_id text NOT NULL, measure text NOT NULL,
  value double precision, status text NOT NULL CHECK(status IN ('available','unavailable')),
  n_typequ integer, n_addresses bigint, n_observed bigint, coverage_status text,
  source_id text NOT NULL, vintage_id text NOT NULL, source_url text NOT NULL,
  licence text NOT NULL, attribution text NOT NULL, reference_date date, publication_date date,
  PRIMARY KEY(territory_type,territory_id,measure),
  -- Summary support counts observed territory × TYPEQU coordinates; unlike
  -- per-TYPEQU facts this additive count can exceed the address denominator.
  CHECK((status='available' AND value IS NOT NULL AND n_typequ=235 AND n_addresses>0 AND n_observed>=0 AND
         n_observed::numeric<=n_typequ::numeric*n_addresses::numeric AND coverage_status='covered') OR
         (status='unavailable' AND value IS NULL AND n_typequ IS NULL AND
          (n_addresses IS NULL OR n_addresses>=0) AND (n_observed IS NULL OR n_observed>=0)))
);
CREATE INDEX aedar_territory_summary_measure_idx ON aedar_territory_summary(territory_type,measure,territory_id) INCLUDE(value,status,n_addresses,n_observed,coverage_status);
GRANT SELECT ON aedar_territory_summary,table_publication TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON aedar_territory_summary,table_publication TO lusk_publisher;
COMMIT;
