-- Retire legacy BPE/building-access and snapshot-derived Mobility serving
-- projections. Canonical sources and retained scalar/profile/series/collection/
-- AEDAR storage are untouched.
-- The statements intentionally use RESTRICT/default dependency behavior: an
-- unexpected view, FK, or publisher trigger aborts this migration for review.
BEGIN;

LOCK TABLE table_publication IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER IF EXISTS building_publication_descriptor ON table_publication;

DELETE FROM table_publication WHERE table_name IN (
  'service_registry', 'essential_service_access', 'building_ramp', 'building_grid',
  'bpe_profile_evidence', 'mobility_density_distribution', 'mobility_typed_reading'
);

ALTER TABLE table_publication
  DROP CONSTRAINT table_publication_table_name_check,
  DROP CONSTRAINT shared_fact_publication_requires_reference;

ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check
  CHECK (table_name IN (
    'territory_reference', 'scalar_observation', 'declared_profile', 'ordered_series',
    'demographic_typed_reading', 'selected_reading', 'economy_typed_reading',
    'economy_activity_evidence', 'milieux_typed_reading', 'milieux_reading_absence',
    'aedar_territorial_aggregate'
  ));

ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference
  CHECK (table_name NOT IN (
    'scalar_observation', 'declared_profile', 'ordered_series',
    'demographic_typed_reading', 'selected_reading', 'economy_typed_reading',
    'economy_activity_evidence', 'milieux_typed_reading', 'milieux_reading_absence',
    'aedar_territorial_aggregate'
  ) OR reference_content_version IS NOT NULL);

-- Explicit FK order; no CASCADE. A dependent object not inventoried here must
-- stop the upgrade rather than be silently removed.
DROP TABLE IF EXISTS building_evidence_descriptor_source;
DROP TABLE IF EXISTS building_ramp;
DROP TABLE IF EXISTS building_grid;
DROP TABLE IF EXISTS building_evidence_descriptor;
DROP TABLE IF EXISTS essential_service_access;
DROP TABLE IF EXISTS service_registry;

DROP TABLE IF EXISTS bpe_profile_evidence_source;
DROP TABLE IF EXISTS bpe_profile_evidence;
DROP TABLE IF EXISTS bpe_profile_class_axis;
DROP TABLE IF EXISTS bpe_profile_evidence_descriptor;

DROP TABLE IF EXISTS mobility_density_distribution_point;
DROP TABLE IF EXISTS mobility_density_distribution_range;
DROP TABLE IF EXISTS mobility_density_distribution_descriptor;
DROP TABLE IF EXISTS access_publication_metadata;

DROP TABLE IF EXISTS mobility_typed_reading;
DROP TABLE IF EXISTS mobility_reading_story;
DROP TABLE IF EXISTS mobility_reading_clock;
DROP TABLE IF EXISTS mobility_reading_descriptor;

DROP FUNCTION IF EXISTS assert_building_fact_source();
DROP FUNCTION IF EXISTS assert_building_dataset_complete(integer, integer);
DROP FUNCTION IF EXISTS assert_building_descriptor_publication();
DROP FUNCTION IF EXISTS assert_current_dataset_complete(integer);
DROP FUNCTION IF EXISTS assert_bpe_profile_evidence_complete();
DROP FUNCTION IF EXISTS validate_mobility_density_distribution_territory();
DROP FUNCTION IF EXISTS assert_mobility_density_distribution_complete();

COMMIT;
