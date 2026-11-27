BEGIN;

-- ADR-0049 step 2 (#1141): contract migration after 046 -> 047 -> 048 ->
-- adopt -> new API deploy -> HTTP sweep. Retire typed readings and the global
-- scalar/profile clocks; per-resource registry rows, descriptors, comparison
-- markers and every retained resource fact remain authoritative.
--
-- This file OWNS its transaction. Apply with psql --set ON_ERROR_STOP=on and
-- WITHOUT --single-transaction. Every DROP uses RESTRICT/default dependency
-- behavior: an unexpected dependent object aborts the whole transaction.

SELECT set_config('search_path', current_schema() || ',pg_catalog', TRUE);
SET LOCAL lock_timeout = '5s';

LOCK TABLE table_publication IN ACCESS EXCLUSIVE MODE;

-- Fail before the first mutation if an object outside the retired closure still
-- depends on a typed-reading table. PostgreSQL's own RESTRICT drops remain the
-- final guard; this preflight gives the operator an actionable object list.
DO $migration_049_dependencies$
DECLARE
  blockers text;
BEGIN
  WITH retired_relations AS (
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname IN (
      'demographic_reading_descriptor', 'demographic_typed_reading',
      'selected_reading_publication', 'selected_reading_descriptor', 'habitat_typed_reading',
      'economy_activity_evidence', 'economy_typed_reading', 'milieux_reading_source',
      'milieux_reading_absence', 'milieux_typed_reading', 'milieux_population_provenance_revision',
      'scalar_comparison_publication', 'profile_comparison_publication'
    )
  ), dependents AS (
    -- Inherited/partitioned child tables and other relation-level dependents.
    SELECT n.nspname,c.relname
    FROM pg_depend d
    JOIN retired_relations r ON d.refclassid='pg_class'::regclass AND d.refobjid=r.oid
    JOIN pg_class c ON d.classid='pg_class'::regclass AND c.oid=d.objid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind NOT IN ('i','I','t')
      AND NOT EXISTS (SELECT 1 FROM retired_relations own WHERE own.oid=c.oid)
    UNION
    -- Views/materialized views and rewrite rules record dependencies via pg_rewrite.
    SELECT n.nspname,c.relname
    FROM pg_depend d
    JOIN retired_relations r ON d.refclassid='pg_class'::regclass AND d.refobjid=r.oid
    JOIN pg_rewrite rw ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
    JOIN pg_class c ON c.oid=rw.ev_class
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT EXISTS (SELECT 1 FROM retired_relations own WHERE own.oid=c.oid)
    UNION
    -- Foreign keys from retained tables point at the retired parent table.
    SELECT n.nspname,c.relname
    FROM pg_depend d
    JOIN retired_relations r ON d.refclassid='pg_class'::regclass AND d.refobjid=r.oid
    JOIN pg_constraint fk ON d.classid='pg_constraint'::regclass AND fk.oid=d.objid
    JOIN pg_class c ON c.oid=fk.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT EXISTS (SELECT 1 FROM retired_relations own WHERE own.oid=c.oid)
  )
  SELECT string_agg(format('%I.%I',nspname,relname), ', ' ORDER BY nspname,relname)
    INTO blockers FROM dependents;
  IF blockers IS NOT NULL THEN
    RAISE EXCEPTION 'Typed-reading retirement refused; migrate these dependent objects first: %',
      blockers USING ERRCODE='dependent_objects_still_exist';
  END IF;
END
$migration_049_dependencies$;

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

-- Migration 020 created this composite unique index only for typed-reading FKs.
-- Every referencing table is retired above; fresh post-049 DDL omits it.
DROP INDEX territory_reference_id_type_unique;

DROP FUNCTION IF EXISTS reject_milieux_population_provenance_mutation();

COMMIT;
