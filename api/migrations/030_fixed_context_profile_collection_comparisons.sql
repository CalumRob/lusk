-- #753: publish fixed-context profile and sparse numeric collection comparisons.
BEGIN;

CREATE TABLE profile_comparison_publication (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    content_version text NOT NULL,
    profile_content_version text NOT NULL,
    reference_content_version text NOT NULL,
    group_row_count integer NOT NULL CHECK (group_row_count >= 0),
    territory_row_count integer NOT NULL CHECK (territory_row_count >= 0),
    published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_comparison_group (
    comparison_context text NOT NULL CHECK (comparison_context IN ('density_class','epci','bretagne','same_level')),
    group_id text NOT NULL CHECK (length(trim(group_id)) > 0),
    territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement')),
    indicator_id text NOT NULL REFERENCES profile_descriptor(indicator_id),
    detail_key text NOT NULL CHECK (length(trim(detail_key)) > 0),
    sex_key text NOT NULL DEFAULT '', statistic text NOT NULL CHECK (statistic='median'),
    median double precision, member_count integer NOT NULL CHECK (member_count > 0),
    eligible_count integer NOT NULL CHECK (eligible_count >= 0), missing_count integer NOT NULL CHECK (missing_count >= 0),
    profile_content_version text NOT NULL, reference_content_version text NOT NULL,
    PRIMARY KEY (comparison_context,group_id,territory_type,indicator_id,detail_key,sex_key),
    CHECK (member_count=eligible_count+missing_count),
    CHECK ((eligible_count=0 AND median IS NULL) OR (eligible_count>0 AND median IS NOT NULL AND median NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)))
);
CREATE TABLE profile_comparison_territory (
    comparison_context text NOT NULL, group_id text NOT NULL,
    territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement')),
    indicator_id text NOT NULL REFERENCES profile_descriptor(indicator_id), detail_key text NOT NULL,
    sex_key text NOT NULL DEFAULT '', territory_id text NOT NULL REFERENCES territory_reference(territory_id),
    value double precision,
    status text NOT NULL CHECK (status IN ('measured','suppressed','unsupported','not_available','not_published')),
    rank integer CHECK (rank IS NULL OR rank > 0), tie_count integer CHECK (tie_count IS NULL OR tie_count > 0),
    rank_size integer CHECK (rank_size IS NULL OR rank_size > 0),
    profile_content_version text NOT NULL, reference_content_version text NOT NULL,
    PRIMARY KEY (comparison_context,group_id,territory_type,indicator_id,detail_key,sex_key,territory_id),
    FOREIGN KEY (comparison_context,group_id,territory_type,indicator_id,detail_key,sex_key)
      REFERENCES profile_comparison_group(comparison_context,group_id,territory_type,indicator_id,detail_key,sex_key) ON DELETE CASCADE,
    CHECK ((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)) OR (status<>'measured' AND value IS NULL)),
    CHECK ((status='measured' AND rank IS NOT NULL AND tie_count IS NOT NULL AND rank_size IS NOT NULL) OR (status<>'measured' AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)),
    CHECK (status<>'measured' OR (rank<=rank_size AND tie_count<=rank_size))
);
GRANT SELECT ON profile_comparison_publication,profile_comparison_group,profile_comparison_territory TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON profile_comparison_publication,profile_comparison_group,profile_comparison_territory TO lusk_publisher;

CREATE TABLE observed_collection_comparison_publication (
  indicator_id text PRIMARY KEY REFERENCES observed_collection_publication(indicator_id) ON DELETE CASCADE,
  content_version text NOT NULL, collection_content_version text NOT NULL, reference_content_version text NOT NULL,
  group_row_count bigint NOT NULL CHECK(group_row_count>=0), territory_row_count bigint NOT NULL CHECK(territory_row_count>=0),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE observed_collection_comparison_group (
  indicator_id text NOT NULL, comparison_context text NOT NULL CHECK(comparison_context IN ('density_class','epci','bretagne','same_level')),
  group_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement')),
  detail_key text NOT NULL, observation_period text NOT NULL CHECK(observation_period ~ '^[0-9]{4}$'),
  statistic text NOT NULL CHECK(statistic='median'), median double precision,
  member_count integer NOT NULL CHECK(member_count>=0), eligible_count integer NOT NULL CHECK(eligible_count>=0),
  missing_count integer NOT NULL CHECK(missing_count>=0 AND member_count=eligible_count+missing_count),
  collection_content_version text NOT NULL, reference_content_version text NOT NULL,
  PRIMARY KEY(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period),
  FOREIGN KEY(indicator_id,detail_key) REFERENCES observed_collection_category(indicator_id,detail_key) ON DELETE CASCADE,
  CHECK((eligible_count=0 AND median IS NULL) OR (eligible_count>0 AND median IS NOT NULL AND median NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)))
);
CREATE TABLE observed_collection_comparison_territory (
  indicator_id text NOT NULL, comparison_context text NOT NULL, group_id text NOT NULL,
  territory_type text NOT NULL, detail_key text NOT NULL, observation_period text NOT NULL,
  territory_id text NOT NULL REFERENCES territory_reference(territory_id), value double precision,
  status text NOT NULL CHECK(status IN ('measured','not_published')),
  rank integer, tie_count integer, rank_size integer,
  collection_content_version text NOT NULL, reference_content_version text NOT NULL,
  PRIMARY KEY(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period,territory_id),
  FOREIGN KEY(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period)
    REFERENCES observed_collection_comparison_group(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period) ON DELETE CASCADE,
  CHECK((status='measured' AND value IS NOT NULL AND rank>0 AND tie_count>0 AND rank_size>0) OR
        (status='not_published' AND value IS NULL AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)),
  CHECK(status<>'measured' OR (rank<=rank_size AND tie_count<=rank_size))
);
GRANT SELECT ON observed_collection_comparison_publication,observed_collection_comparison_group,observed_collection_comparison_territory TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON observed_collection_comparison_publication,observed_collection_comparison_group,observed_collection_comparison_territory TO lusk_publisher;

CREATE FUNCTION validate_observed_collection_comparison_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE id text; stamp timestamptz; BEGIN
  id:=COALESCE(NEW.indicator_id,OLD.indicator_id);
  SELECT published_at INTO stamp FROM observed_collection_comparison_publication WHERE indicator_id=id;
  IF TG_OP='DELETE' AND stamp IS NULL THEN RETURN OLD; END IF;
  IF stamp IS DISTINCT FROM transaction_timestamp() THEN RAISE EXCEPTION 'observed collection comparison write outside publication transaction'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observed_collection_comparison_group_owned_write BEFORE INSERT OR UPDATE OR DELETE ON observed_collection_comparison_group
  FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_comparison_write();
CREATE TRIGGER observed_collection_comparison_territory_owned_write BEFORE INSERT OR UPDATE OR DELETE ON observed_collection_comparison_territory
  FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_comparison_write();

CREATE FUNCTION validate_observed_collection_comparison_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM observed_collection_publication p JOIN observed_collection_descriptor d USING(indicator_id)
    WHERE p.indicator_id=NEW.indicator_id AND d.kind='period_detail'
      AND p.content_version=NEW.collection_content_version AND p.reference_content_version=NEW.reference_content_version)
    OR NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='territory_reference' AND content_version=NEW.reference_content_version)
    OR NEW.group_row_count<>(SELECT count(*) FROM observed_collection_comparison_group WHERE indicator_id=NEW.indicator_id)
    OR NEW.territory_row_count<>(SELECT count(*) FROM observed_collection_comparison_territory WHERE indicator_id=NEW.indicator_id)
    OR EXISTS(SELECT 1 FROM observed_collection_comparison_group WHERE indicator_id=NEW.indicator_id
      AND (collection_content_version<>NEW.collection_content_version OR reference_content_version<>NEW.reference_content_version))
    OR EXISTS(SELECT 1 FROM observed_collection_comparison_territory WHERE indicator_id=NEW.indicator_id
      AND (collection_content_version<>NEW.collection_content_version OR reference_content_version<>NEW.reference_content_version))
    OR EXISTS(SELECT 1 FROM observed_collection_comparison_group g WHERE g.indicator_id=NEW.indicator_id
      AND (g.member_count<>(SELECT count(*) FROM observed_collection_comparison_territory t WHERE
          (t.indicator_id,t.comparison_context,t.group_id,t.territory_type,t.detail_key,t.observation_period)=
          (g.indicator_id,g.comparison_context,g.group_id,g.territory_type,g.detail_key,g.observation_period))
        OR g.eligible_count<>(SELECT count(*) FROM observed_collection_comparison_territory t WHERE
          (t.indicator_id,t.comparison_context,t.group_id,t.territory_type,t.detail_key,t.observation_period)=
          (g.indicator_id,g.comparison_context,g.group_id,g.territory_type,g.detail_key,g.observation_period) AND t.status='measured')
        OR g.missing_count<>(SELECT count(*) FROM observed_collection_comparison_territory t WHERE
          (t.indicator_id,t.comparison_context,t.group_id,t.territory_type,t.detail_key,t.observation_period)=
          (g.indicator_id,g.comparison_context,g.group_id,g.territory_type,g.detail_key,g.observation_period) AND t.status='not_published')))
    OR EXISTS(SELECT 1 FROM observed_collection_comparison_group g WHERE g.indicator_id=NEW.indicator_id
      AND (g.detail_key<>(SELECT comparison_detail FROM observed_collection_descriptor WHERE indicator_id=NEW.indicator_id)
        OR g.observation_period<>(SELECT comparison_period FROM observed_collection_descriptor WHERE indicator_id=NEW.indicator_id)
        OR g.member_count<>(SELECT count(*) FROM observed_collection_comparison_territory t WHERE
          t.indicator_id=g.indicator_id AND t.comparison_context=g.comparison_context AND t.group_id=g.group_id
          AND t.territory_type=g.territory_type AND t.detail_key=g.detail_key AND t.observation_period=g.observation_period AND t.status='measured')+
          g.missing_count))
    OR EXISTS(SELECT 1 FROM observed_collection_comparison_territory t JOIN observed_collection_comparison_group g
      USING(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period)
      WHERE t.indicator_id=NEW.indicator_id AND t.status='measured' AND t.rank_size<>g.eligible_count)
  THEN RAISE EXCEPTION 'observed collection comparison publication is incomplete or stale'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER observed_collection_comparison_publication_contract AFTER INSERT OR UPDATE ON observed_collection_comparison_publication
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_comparison_publication();

COMMIT;
