BEGIN;

-- ADR-0049 step 2 (#1141): contract migration after 046 -> 047 -> 048 ->
-- adopt -> new API deploy -> HTTP sweep. Retire typed readings and the global
-- scalar/profile clocks; per-resource registry rows, descriptors, comparison
-- markers and every retained resource fact remain authoritative.
--
-- This file OWNS its transaction. Apply with psql --set ON_ERROR_STOP=on and
-- WITHOUT --single-transaction. Every DROP uses RESTRICT/default dependency
-- behavior: an unexpected dependent object aborts the whole transaction.

SELECT set_config('search_path', 'pg_catalog,' || current_schema(), TRUE);
SET LOCAL lock_timeout = '5s';

LOCK TABLE table_publication IN ACCESS EXCLUSIVE MODE;

DELETE FROM table_publication WHERE table_name IN (
  'scalar_observation', 'declared_profile', 'demographic_typed_reading',
  'selected_reading', 'economy_typed_reading', 'economy_activity_evidence',
  'milieux_typed_reading', 'milieux_reading_absence'
);

ALTER TABLE table_publication
  DROP CONSTRAINT table_publication_table_name_check,
  DROP CONSTRAINT shared_fact_publication_requires_reference;

ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check
  CHECK (table_name IN (
    'territory_reference', 'ordered_series', 'aedar_territorial_aggregate',
    'aedar_territory_summary'
  ));

ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference
  CHECK (table_name NOT IN (
    'ordered_series', 'aedar_territorial_aggregate', 'aedar_territory_summary'
  ) OR reference_content_version IS NOT NULL);

-- Explicit FK order. No retained scalar/profile fact table is dropped.
DROP TABLE IF EXISTS milieux_reading_source;
DROP TABLE IF EXISTS milieux_reading_absence;
DROP TABLE IF EXISTS milieux_typed_reading;
DROP TABLE IF EXISTS milieux_population_provenance_revision;

DROP TABLE IF EXISTS economy_activity_evidence;
DROP TABLE IF EXISTS economy_typed_reading;

DROP TABLE IF EXISTS selected_reading_publication;
DROP TABLE IF EXISTS selected_reading_descriptor;
DROP TABLE IF EXISTS habitat_typed_reading;

DROP TABLE IF EXISTS demographic_typed_reading;
DROP TABLE IF EXISTS demographic_reading_descriptor;

DROP TABLE IF EXISTS scalar_comparison_publication;
DROP TABLE IF EXISTS profile_comparison_publication;

DROP FUNCTION IF EXISTS reject_milieux_population_provenance_mutation();

COMMIT;
