BEGIN;
CREATE TABLE IF NOT EXISTS aedar_comparison_publication (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), content_version text NOT NULL CHECK(content_version ~ '^[0-9a-f]{64}$'),
  source_snapshot_id text NOT NULL CHECK(source_snapshot_id='2026-v1'),
  aedar_content_version text NOT NULL, reference_content_version text NOT NULL,
  input_content_version text NOT NULL CHECK(input_content_version ~ '^[0-9a-f]{64}$'),
  input_identity jsonb NOT NULL CHECK(jsonb_typeof(input_identity)='object'),
  group_row_count bigint NOT NULL CHECK(group_row_count>=0), territory_row_count bigint NOT NULL CHECK(territory_row_count>=0),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS aedar_comparison_group (
  comparison_context text NOT NULL CHECK(comparison_context IN ('density_class','epci','bretagne','same_level')),
  group_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement')),
  typequ text NOT NULL, measure text NOT NULL, statistic text NOT NULL CHECK(statistic IN ('median','direct','pooled')),
  value double precision, n_addresses bigint CHECK(n_addresses IS NULL OR n_addresses>=0),
  n_observed bigint CHECK(n_observed IS NULL OR n_observed>=0 AND n_observed<=n_addresses), coverage_status text,
  member_count integer NOT NULL CHECK(member_count>=0),
  eligible_count integer NOT NULL CHECK(eligible_count>=0), missing_count integer NOT NULL CHECK(missing_count>=0),
  PRIMARY KEY(comparison_context,group_id,territory_type,typequ,measure),
  CHECK(member_count=eligible_count+missing_count),
  CHECK(measure ~ '^count_(5|10|15|20)_(walk|transit|transit_gain|bike_lts2|bike_lts4|car)_(share|min|max|decile[1-9]|mean)$'),
  CHECK((comparison_context='same_level' AND territory_type IN ('epci','departement')) OR
        (comparison_context<>'same_level' AND territory_type='commune')),
  CHECK((comparison_context IN ('epci','bretagne') AND territory_type='commune' AND statistic='direct') OR
        (comparison_context='density_class' AND territory_type='commune' AND statistic='pooled') OR
        (comparison_context='same_level' AND territory_type IN ('epci','departement') AND statistic='median')),
  CHECK(value IS NULL OR value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))
);
CREATE TABLE IF NOT EXISTS aedar_comparison_territory (
  comparison_context text NOT NULL, group_id text NOT NULL, territory_type text NOT NULL,
  territory_id text NOT NULL, typequ text NOT NULL, measure text NOT NULL,
  value double precision, status text NOT NULL CHECK(status IN ('measured','not_available')),
  n_addresses bigint NOT NULL CHECK(n_addresses>=0), n_observed bigint NOT NULL CHECK(n_observed>=0 AND n_observed<=n_addresses),
  coverage_status text NOT NULL,
  rank integer, rank_size integer,
  PRIMARY KEY(comparison_context,group_id,territory_type,territory_id,typequ,measure),
  FOREIGN KEY(comparison_context,group_id,territory_type,typequ,measure)
    REFERENCES aedar_comparison_group(comparison_context,group_id,territory_type,typequ,measure) ON DELETE CASCADE,
  -- Source facts and comparison projections publish in separate transactions.
  -- A source refresh retains the last complete comparison; API marker checks
  -- fail closed until its replacement is published against the new versions.
  CHECK(measure ~ '^count_(5|10|15|20)_(walk|transit|transit_gain|bike_lts2|bike_lts4|car)_(share|min|max|decile[1-9]|mean)$'),
  CHECK((status='measured' AND value IS NOT NULL AND rank>0 AND rank_size>0 AND rank<=rank_size) OR
        (status='not_available' AND value IS NULL AND rank IS NULL AND rank_size IS NULL))
);
GRANT SELECT ON aedar_comparison_publication,aedar_comparison_group,aedar_comparison_territory TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON aedar_comparison_publication,aedar_comparison_group,aedar_comparison_territory TO lusk_publisher;

CREATE OR REPLACE FUNCTION check_aedar_comparison_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='aedar_territorial_aggregate' AND content_version=NEW.aedar_content_version)
   OR NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='territory_reference' AND content_version=NEW.reference_content_version)
   OR NEW.group_row_count<>(SELECT count(*) FROM aedar_comparison_group)
   OR NEW.territory_row_count<>(SELECT count(*) FROM aedar_comparison_territory)
 THEN RAISE EXCEPTION 'AEDAR comparison publication is incomplete or stale'; END IF;
 IF EXISTS(SELECT 1 FROM aedar_comparison_group g WHERE g.member_count<>(SELECT count(*) FROM aedar_comparison_territory t
    WHERE (t.comparison_context,t.group_id,t.territory_type,t.typequ,t.measure)=(g.comparison_context,g.group_id,g.territory_type,g.typequ,g.measure))
   OR g.eligible_count<>(SELECT count(*) FROM aedar_comparison_territory t WHERE
    (t.comparison_context,t.group_id,t.territory_type,t.typequ,t.measure)=(g.comparison_context,g.group_id,g.territory_type,g.typequ,g.measure) AND t.status='measured')
   OR g.missing_count<>(SELECT count(*) FROM aedar_comparison_territory t WHERE
    (t.comparison_context,t.group_id,t.territory_type,t.typequ,t.measure)=(g.comparison_context,g.group_id,g.territory_type,g.typequ,g.measure) AND t.status='not_available'))
 THEN RAISE EXCEPTION 'AEDAR comparison eligibility counts are inconsistent'; END IF;
 IF EXISTS(SELECT 1 FROM aedar_comparison_territory t JOIN aedar_comparison_group g USING(comparison_context,group_id,territory_type,typequ,measure)
   WHERE t.status='measured' AND t.rank_size<>g.eligible_count)
 THEN RAISE EXCEPTION 'AEDAR comparison rank size differs from eligible group size'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aedar_comparison_publication_contract ON aedar_comparison_publication;
CREATE CONSTRAINT TRIGGER aedar_comparison_publication_contract AFTER INSERT OR UPDATE ON aedar_comparison_publication
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_aedar_comparison_publication();
COMMIT;
