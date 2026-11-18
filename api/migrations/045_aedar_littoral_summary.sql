BEGIN;

-- #1043: extend AEDAR with the third fixed context `littoral` (group_id
-- 'C'/'NC', territory_type 'commune', statistic 'pooled'). Additive only:
-- widen the two AEDAR reference CHECKs, add the SIBLING C/NC summary relation
-- and its publication counters, and replace the deferred validator so it
-- accepts an existing complete pre-extension generation (zero littoral groups
-- and counters) while rejecting an incomplete littoral generation. The
-- density-only PK/count contract, its descriptor and aedar_comparison_territory
-- (kept empty) are untouched. Applying this DDL alone publishes nothing.

-- 1. Widen the closed AEDAR reference context/scope CHECKs in place.
DO $m045$
DECLARE
  con_name text;
  def text;
BEGIN
  SELECT c.conname, pg_get_constraintdef(c.oid) INTO con_name, def
  FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname=current_schema() AND r.relname='aedar_comparison_group'
    AND c.contype='c' AND c.conname='aedar_reference_context_check';
  IF con_name IS NOT NULL AND def NOT LIKE '%''littoral''%' THEN
    ALTER TABLE aedar_comparison_group DROP CONSTRAINT aedar_reference_context_check;
    ALTER TABLE aedar_comparison_group ADD CONSTRAINT aedar_reference_context_check
      CHECK(comparison_context IN ('density_class','littoral','same_level'));
  ELSIF con_name IS NULL THEN
    RAISE EXCEPTION 'migration 045: missing aedar_reference_context_check';
  END IF;

  SELECT c.conname, pg_get_constraintdef(c.oid) INTO con_name, def
  FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname=current_schema() AND r.relname='aedar_comparison_group'
    AND c.contype='c' AND c.conname='aedar_reference_scope_check';
  IF con_name IS NOT NULL AND def NOT LIKE '%''littoral''%' THEN
    ALTER TABLE aedar_comparison_group DROP CONSTRAINT aedar_reference_scope_check;
    ALTER TABLE aedar_comparison_group ADD CONSTRAINT aedar_reference_scope_check
      CHECK((comparison_context='density_class' AND territory_type='commune' AND statistic='pooled') OR
            (comparison_context='littoral' AND territory_type='commune' AND statistic='pooled') OR
            (comparison_context='same_level' AND territory_type IN ('epci','departement') AND statistic='median'));
  ELSIF con_name IS NULL THEN
    RAISE EXCEPTION 'migration 045: missing aedar_reference_scope_check';
  END IF;
END;
$m045$;

-- 2. Sibling summary counters on the publication marker (zero = pre-extension).
ALTER TABLE aedar_comparison_publication
  ADD COLUMN IF NOT EXISTS littoral_summary_status_count integer NOT NULL DEFAULT 0 CHECK(littoral_summary_status_count>=0),
  ADD COLUMN IF NOT EXISTS littoral_summary_measure_count integer NOT NULL DEFAULT 0 CHECK(littoral_summary_measure_count>=0),
  ADD COLUMN IF NOT EXISTS littoral_summary_row_count bigint NOT NULL DEFAULT 0 CHECK(littoral_summary_row_count>=0);

-- 3. The sibling C/NC summary relation. Distinct PK and descriptor: C/NC are
--    never inserted into aedar_density_class_summary.
CREATE TABLE IF NOT EXISTS aedar_littoral_summary (
  comparison_content_version text NOT NULL REFERENCES aedar_comparison_publication(content_version)
    ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  aedar_content_version text NOT NULL, reference_content_version text NOT NULL,
  input_content_version text NOT NULL CHECK(input_content_version ~ '^[0-9a-f]{64}$'),
  group_id text NOT NULL CHECK(group_id IN ('C','NC')), measure text NOT NULL,
  value double precision, status text NOT NULL CHECK(status IN ('available','unavailable')),
  n_typequ integer, n_addresses bigint CHECK(n_addresses IS NULL OR n_addresses>=0),
  n_observed bigint CHECK(n_observed IS NULL OR n_observed>=0), coverage_status text,
  PRIMARY KEY(comparison_content_version,group_id,measure),
  CHECK(value IS NULL OR value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
  CHECK(COALESCE((status='available' AND value IS NOT NULL AND n_typequ>0 AND n_addresses>0 AND
         n_observed>=0 AND n_observed::numeric<=n_typequ::numeric*n_addresses::numeric AND
         coverage_status='covered') OR
        (status='unavailable' AND value IS NULL AND n_typequ IS NULL),FALSE))
);
GRANT SELECT ON aedar_littoral_summary TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON aedar_littoral_summary TO lusk_publisher;

-- 4. Deferred publication validation: density counters unchanged, littoral
--    sibling optional (pre-extension) but complete when present.
CREATE OR REPLACE FUNCTION check_aedar_comparison_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.publication_mode<>'reference_only'
    OR NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='aedar_territorial_aggregate' AND content_version=NEW.aedar_content_version)
    OR NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='territory_reference' AND content_version=NEW.reference_content_version)
    OR NEW.group_row_count<>(SELECT count(*) FROM aedar_comparison_group)
    OR NEW.territory_row_count<>0
    OR EXISTS(SELECT 1 FROM aedar_comparison_territory)
    OR NEW.density_summary_row_count<>(SELECT count(*) FROM aedar_density_class_summary
       WHERE comparison_content_version=NEW.content_version)
    OR NEW.density_summary_class_count<>(SELECT count(DISTINCT group_id) FROM aedar_comparison_group
       WHERE comparison_context='density_class' AND territory_type='commune')
    OR NEW.density_summary_class_count<>(SELECT count(DISTINCT group_id) FROM aedar_density_class_summary
       WHERE comparison_content_version=NEW.content_version)
    OR NEW.density_summary_measure_count<1
    OR NEW.density_summary_typequ_count<1
    OR NEW.density_summary_row_count::numeric <>
       NEW.density_summary_class_count::numeric*NEW.density_summary_measure_count::numeric
    OR NEW.littoral_summary_status_count<0
    OR NEW.littoral_summary_measure_count<0
    OR NEW.littoral_summary_row_count<0
  THEN RAISE EXCEPTION 'AEDAR reference publication is incomplete, stale, or contains peer rows'; END IF;

  IF EXISTS(SELECT 1 FROM aedar_comparison_group g WHERE
      (g.comparison_context='density_class' AND (g.territory_type<>'commune' OR g.statistic<>'pooled')) OR
      (g.comparison_context='littoral' AND (g.territory_type<>'commune' OR g.statistic<>'pooled')) OR
      (g.comparison_context='same_level' AND (g.territory_type NOT IN ('epci','departement') OR g.statistic<>'median')) OR
      g.comparison_context NOT IN ('density_class','littoral','same_level') OR
      (g.statistic='median' AND (g.n_addresses IS NOT NULL OR g.n_observed IS NOT NULL OR g.coverage_status IS NOT NULL)))
  THEN RAISE EXCEPTION 'AEDAR reference group has an invalid scope or fabricated source counts'; END IF;

  IF EXISTS(SELECT 1 FROM aedar_density_class_summary s
      WHERE s.comparison_content_version=NEW.content_version
      GROUP BY s.group_id HAVING count(*)<>NEW.density_summary_measure_count)
    OR EXISTS(SELECT 1 FROM aedar_density_class_summary s
      WHERE s.comparison_content_version=NEW.content_version AND
        (s.aedar_content_version<>NEW.aedar_content_version OR
         s.reference_content_version<>NEW.reference_content_version OR
         s.input_content_version<>NEW.input_content_version OR
         (s.status='available' AND (s.n_typequ<>NEW.density_summary_typequ_count OR
           s.n_observed::numeric>NEW.density_summary_typequ_count::numeric*s.n_addresses::numeric))))
    OR EXISTS(SELECT 1 FROM aedar_comparison_group g
      WHERE g.comparison_context='density_class' AND g.territory_type='commune'
      AND NOT EXISTS(SELECT 1 FROM aedar_density_class_summary s
        WHERE s.comparison_content_version=NEW.content_version AND s.group_id=g.group_id))
  THEN RAISE EXCEPTION 'AEDAR density-class summaries are incomplete'; END IF;

  IF NEW.littoral_summary_row_count>0 THEN
    IF NEW.littoral_summary_status_count<1
      OR NEW.littoral_summary_measure_count<1
      OR NEW.littoral_summary_row_count::numeric <>
         NEW.littoral_summary_status_count::numeric*NEW.littoral_summary_measure_count::numeric
      OR NEW.littoral_summary_row_count<>(SELECT count(*) FROM aedar_littoral_summary
           WHERE comparison_content_version=NEW.content_version)
      OR NEW.littoral_summary_status_count<>(SELECT count(DISTINCT group_id) FROM aedar_littoral_summary
           WHERE comparison_content_version=NEW.content_version)
      OR EXISTS(SELECT 1 FROM aedar_littoral_summary s
           WHERE s.comparison_content_version=NEW.content_version
           GROUP BY s.group_id HAVING count(*)<>NEW.littoral_summary_measure_count)
      OR EXISTS(SELECT 1 FROM aedar_littoral_summary s
           WHERE s.comparison_content_version=NEW.content_version AND
             (s.aedar_content_version<>NEW.aedar_content_version OR
              s.reference_content_version<>NEW.reference_content_version OR
              s.input_content_version<>NEW.input_content_version OR
              (s.status='available' AND (s.n_typequ<>NEW.density_summary_typequ_count OR
                s.n_observed::numeric>NEW.density_summary_typequ_count::numeric*s.n_addresses::numeric))))
      OR EXISTS(SELECT 1 FROM aedar_comparison_group g
           WHERE g.comparison_context='littoral' AND g.territory_type='commune'
           AND NOT EXISTS(SELECT 1 FROM aedar_littoral_summary s
             WHERE s.comparison_content_version=NEW.content_version AND s.group_id=g.group_id))
    THEN RAISE EXCEPTION 'AEDAR littoral summaries are incomplete'; END IF;
  ELSE
    IF NEW.littoral_summary_status_count<>0
      OR EXISTS(SELECT 1 FROM aedar_littoral_summary WHERE comparison_content_version=NEW.content_version)
      OR EXISTS(SELECT 1 FROM aedar_comparison_group WHERE comparison_context='littoral')
    THEN RAISE EXCEPTION 'AEDAR pre-extension generation must have zero littoral groups and counters'; END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;
