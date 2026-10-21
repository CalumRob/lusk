BEGIN;

-- Legacy rank publications remain explicitly incompatible until the canonical
-- reference-only projection is republished. No data is backfilled here.
ALTER TABLE aedar_comparison_publication
  ADD COLUMN publication_mode text NOT NULL DEFAULT 'legacy_rank'
    CHECK(publication_mode IN ('legacy_rank','reference_only'));

-- The summary grain no longer counts focal peers. Removing these columns also
-- prevents a reference-only marker from presenting old eligibility figures.
ALTER TABLE aedar_comparison_group
  DROP COLUMN member_count,
  DROP COLUMN eligible_count,
  DROP COLUMN missing_count;

DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid='aedar_comparison_group'::regclass AND contype='c'
      AND (pg_get_constraintdef(oid) LIKE '%comparison_context%'
        OR pg_get_constraintdef(oid) LIKE '%statistic%')
  LOOP
    EXECUTE format('ALTER TABLE aedar_comparison_group DROP CONSTRAINT %I',item.conname);
  END LOOP;
END $$;
ALTER TABLE aedar_comparison_group
  ADD CONSTRAINT aedar_reference_context_check CHECK(comparison_context IN ('density_class','same_level')),
  ADD CONSTRAINT aedar_reference_statistic_check CHECK(statistic IN ('median','pooled')),
  ADD CONSTRAINT aedar_reference_scope_check CHECK((comparison_context='density_class' AND territory_type='commune' AND statistic='pooled') OR
    (comparison_context='same_level' AND territory_type IN ('epci','departement') AND statistic='median')),
  ADD CONSTRAINT aedar_reference_median_counts_check CHECK((statistic='median' AND n_addresses IS NULL AND n_observed IS NULL AND coverage_status IS NULL) OR statistic='pooled');

ALTER TABLE aedar_comparison_publication
  ALTER COLUMN territory_row_count SET DEFAULT 0,
  ADD CONSTRAINT aedar_reference_only_has_no_territories
    CHECK(publication_mode<>'reference_only' OR territory_row_count=0);

CREATE OR REPLACE FUNCTION check_aedar_comparison_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.publication_mode<>'reference_only'
   OR NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='aedar_territorial_aggregate' AND content_version=NEW.aedar_content_version)
   OR NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='territory_reference' AND content_version=NEW.reference_content_version)
   OR NEW.group_row_count<>(SELECT count(*) FROM aedar_comparison_group)
   OR NEW.territory_row_count<>0
   OR EXISTS(SELECT 1 FROM aedar_comparison_territory)
 THEN RAISE EXCEPTION 'AEDAR reference publication is incomplete, stale, or contains peer rows'; END IF;
 IF EXISTS(SELECT 1 FROM aedar_comparison_group g WHERE
    (g.comparison_context='density_class' AND (g.territory_type<>'commune' OR g.statistic<>'pooled')) OR
    (g.comparison_context='same_level' AND (g.territory_type NOT IN ('epci','departement') OR g.statistic<>'median')) OR
    g.comparison_context NOT IN ('density_class','same_level') OR
    (g.statistic='median' AND (g.n_addresses IS NOT NULL OR g.n_observed IS NOT NULL OR g.coverage_status IS NOT NULL)))
 THEN RAISE EXCEPTION 'AEDAR reference group has an invalid scope or fabricated source counts'; END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS aedar_comparison_publication_contract ON aedar_comparison_publication;
CREATE CONSTRAINT TRIGGER aedar_comparison_publication_contract AFTER INSERT OR UPDATE ON aedar_comparison_publication
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_aedar_comparison_publication();

REVOKE ALL ON aedar_comparison_territory FROM lusk_reader;
GRANT SELECT ON aedar_comparison_publication,aedar_comparison_group TO lusk_reader;

COMMIT;
