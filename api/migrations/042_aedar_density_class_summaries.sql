BEGIN;

-- Keep the last comparison generation readable during rollout. The legacy
-- marker is explicitly incompatible until the canonical generation is
-- republished with its density summaries.
ALTER TABLE aedar_comparison_publication
  ADD CONSTRAINT aedar_comparison_publication_content_version_key UNIQUE(content_version),
  ADD COLUMN density_summary_class_count integer NOT NULL DEFAULT 0 CHECK(density_summary_class_count>=0),
  ADD COLUMN density_summary_measure_count integer NOT NULL DEFAULT 0 CHECK(density_summary_measure_count>=0),
  ADD COLUMN density_summary_typequ_count integer NOT NULL DEFAULT 0 CHECK(density_summary_typequ_count>=0),
  ADD COLUMN density_summary_row_count bigint NOT NULL DEFAULT 0 CHECK(density_summary_row_count>=0);

CREATE TABLE aedar_density_class_summary (
  comparison_content_version text NOT NULL REFERENCES aedar_comparison_publication(content_version)
    ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  aedar_content_version text NOT NULL, reference_content_version text NOT NULL,
  input_content_version text NOT NULL CHECK(input_content_version ~ '^[0-9a-f]{64}$'),
  group_id text NOT NULL, measure text NOT NULL,
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

GRANT SELECT ON aedar_density_class_summary TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON aedar_density_class_summary TO lusk_publisher;

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
  THEN RAISE EXCEPTION 'AEDAR reference publication is incomplete, stale, or contains peer rows'; END IF;

  IF EXISTS(SELECT 1 FROM aedar_comparison_group g WHERE
      (g.comparison_context='density_class' AND (g.territory_type<>'commune' OR g.statistic<>'pooled')) OR
      (g.comparison_context='same_level' AND (g.territory_type NOT IN ('epci','departement') OR g.statistic<>'median')) OR
      g.comparison_context NOT IN ('density_class','same_level') OR
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
  RETURN NEW;
END $$;

COMMIT;
