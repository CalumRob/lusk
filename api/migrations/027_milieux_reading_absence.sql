BEGIN;
ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK(table_name IN (
 'territory_reference','service_registry','essential_service_access','building_ramp','building_grid',
 'scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading',
 'bpe_profile_evidence','economy_typed_reading','economy_activity_evidence','milieux_typed_reading',
 'milieux_reading_absence','mobility_typed_reading','mobility_density_distribution'));
ALTER TABLE table_publication DROP CONSTRAINT shared_fact_publication_requires_reference;
ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference
 CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading','bpe_profile_evidence','economy_typed_reading','economy_activity_evidence','milieux_typed_reading','milieux_reading_absence','mobility_typed_reading','mobility_density_distribution') OR reference_content_version IS NOT NULL);
CREATE TABLE milieux_reading_absence (
 territory_id text NOT NULL,
 territory_type text NOT NULL CHECK (territory_type='commune'),
 reason text NOT NULL CHECK (reason='source_record_absent'),
 source_id text NOT NULL,
 vintage_id text NOT NULL,
 source_snapshot_sha256 text NOT NULL CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY (territory_id,territory_type),
 FOREIGN KEY (territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
 FOREIGN KEY (source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);
GRANT SELECT ON milieux_reading_absence TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON milieux_reading_absence TO lusk_publisher;
COMMIT;
