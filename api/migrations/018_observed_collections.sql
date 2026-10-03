-- Sparse period/detail facts have real year coordinates, not dense profile zeros.
BEGIN;
CREATE TABLE observed_collection_publication (
  indicator_id text PRIMARY KEY CHECK(indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
  content_version text NOT NULL CHECK(length(content_version)>0),
  reference_content_version text NOT NULL CHECK(length(reference_content_version)>0),
  row_count bigint NOT NULL CHECK(row_count>=0), published_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE observed_collection_descriptor (
  indicator_id text PRIMARY KEY REFERENCES observed_collection_publication(indicator_id) ON DELETE CASCADE,
  theme_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('period_detail','anchored_membership')),
  label text NOT NULL, unit text NOT NULL, descriptor_version text NOT NULL,
  allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
  comparison_detail text, comparison_period text CHECK(comparison_period IS NULL OR comparison_period ~ '^[0-9]{4}$'),
  direction text NOT NULL CHECK(direction IN ('high','low','none')),
  CHECK((direction='none' AND comparison_detail IS NULL AND comparison_period IS NULL) OR
    (direction IN ('high','low') AND comparison_detail IS NOT NULL AND comparison_period IS NOT NULL)));
CREATE TABLE observed_collection_category (
  indicator_id text NOT NULL REFERENCES observed_collection_descriptor(indicator_id) ON DELETE CASCADE,
  detail_key text NOT NULL CHECK(length(detail_key)>0), label text NOT NULL CHECK(length(label)>0),
  ordinal integer NOT NULL CHECK(ordinal>=0), source_id text NOT NULL REFERENCES source_dataset(source_id),
  anchor_levels text[], rider_label text,
  clock_policy text NOT NULL DEFAULT 'dataset' CHECK(clock_policy IN ('dataset','row_reference')),
  PRIMARY KEY(indicator_id,detail_key), UNIQUE(indicator_id,ordinal));
CREATE TABLE period_detail_observation (
  indicator_id text NOT NULL, territory_id text NOT NULL REFERENCES territory_reference(territory_id),
  territory_type text NOT NULL, detail_key text NOT NULL,
  observation_period text NOT NULL CHECK(observation_period ~ '^[0-9]{4}$'),
  value double precision NOT NULL CHECK(value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
  source_id text NOT NULL, vintage_id text NOT NULL,
  PRIMARY KEY(indicator_id,territory_id,observation_period,detail_key),
  FOREIGN KEY(indicator_id,detail_key) REFERENCES observed_collection_category(indicator_id,detail_key) ON DELETE CASCADE,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE TABLE anchored_membership (
  indicator_id text NOT NULL, territory_id text NOT NULL REFERENCES territory_reference(territory_id),
  territory_type text NOT NULL, detail_key text NOT NULL, convention_valant_ort boolean NOT NULL,
  source_id text NOT NULL, vintage_id text NOT NULL,
  PRIMARY KEY(indicator_id,territory_id,detail_key),
  FOREIGN KEY(indicator_id,detail_key) REFERENCES observed_collection_category(indicator_id,detail_key) ON DELETE CASCADE,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE FUNCTION validate_observed_collection_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE id text; stamp timestamptz; BEGIN
  id:=COALESCE(NEW.indicator_id,OLD.indicator_id);
  SELECT published_at INTO stamp FROM observed_collection_publication WHERE indicator_id=id;
  IF TG_OP='DELETE' AND stamp IS NULL THEN RETURN OLD; END IF;
  IF stamp IS DISTINCT FROM transaction_timestamp() THEN RAISE EXCEPTION 'observed collection write outside publication transaction'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observed_collection_descriptor_owned_write BEFORE INSERT OR UPDATE OR DELETE ON observed_collection_descriptor
  FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_write();
CREATE TRIGGER observed_collection_category_owned_write BEFORE INSERT OR UPDATE OR DELETE ON observed_collection_category
  FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_write();
CREATE TRIGGER period_detail_observation_owned_write BEFORE INSERT OR UPDATE OR DELETE ON period_detail_observation
  FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_write();
CREATE TRIGGER anchored_membership_owned_write BEFORE INSERT OR UPDATE OR DELETE ON anchored_membership
  FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_write();
CREATE FUNCTION validate_anchored_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM observed_collection_descriptor d JOIN observed_collection_category c USING(indicator_id)
    JOIN territory_reference t ON t.territory_id=NEW.territory_id
    JOIN source_vintage v ON v.source_id=NEW.source_id AND v.vintage_id=NEW.vintage_id
    WHERE d.indicator_id=NEW.indicator_id AND d.kind='anchored_membership' AND c.detail_key=NEW.detail_key
      AND c.source_id=NEW.source_id AND NEW.territory_type=ANY(c.anchor_levels)
      AND NEW.territory_type=ANY(d.allowed_levels)
      AND t.territory_type=NEW.territory_type AND v.reference_date IS NOT NULL
      AND ((c.clock_policy='row_reference' AND v.publication_date IS NULL) OR
           (c.clock_policy='dataset' AND v.publication_date IS NOT NULL))
      AND (NOT NEW.convention_valant_ort OR c.rider_label IS NOT NULL))
  THEN RAISE EXCEPTION 'membership outside declared source, anchor, rider or reference'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER anchored_membership_contract BEFORE INSERT OR UPDATE ON anchored_membership
  FOR EACH ROW EXECUTE FUNCTION validate_anchored_membership();
CREATE FUNCTION validate_period_detail_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM observed_collection_descriptor d
    JOIN observed_collection_category c USING(indicator_id)
    JOIN territory_reference t ON t.territory_id=NEW.territory_id
    WHERE d.indicator_id=NEW.indicator_id AND d.kind='period_detail' AND c.detail_key=NEW.detail_key
      AND c.source_id=NEW.source_id AND NEW.territory_type=ANY(d.allowed_levels) AND t.territory_type=NEW.territory_type)
  THEN RAISE EXCEPTION 'period/detail observation outside declared coordinates, source or reference'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER period_detail_observation_contract BEFORE INSERT OR UPDATE ON period_detail_observation
  FOR EACH ROW EXECUTE FUNCTION validate_period_detail_observation();
CREATE FUNCTION validate_observed_collection_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM observed_collection_descriptor WHERE indicator_id=NEW.indicator_id) OR
     NOT EXISTS(SELECT 1 FROM observed_collection_category WHERE indicator_id=NEW.indicator_id) OR
     NEW.row_count<>((SELECT count(*) FROM period_detail_observation WHERE indicator_id=NEW.indicator_id)+
       (SELECT count(*) FROM anchored_membership WHERE indicator_id=NEW.indicator_id)) OR
     NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='territory_reference' AND content_version=NEW.reference_content_version)
  THEN RAISE EXCEPTION 'observed collection publication is incomplete or stale'; END IF;
  IF EXISTS(SELECT 1 FROM observed_collection_descriptor d WHERE d.indicator_id=NEW.indicator_id
    AND d.comparison_detail IS NOT NULL AND NOT EXISTS(SELECT 1 FROM observed_collection_category c
      WHERE c.indicator_id=d.indicator_id AND c.detail_key=d.comparison_detail))
  THEN RAISE EXCEPTION 'observed collection comparison category is undeclared'; END IF;
  IF EXISTS(SELECT 1 FROM observed_collection_descriptor d JOIN observed_collection_category c USING(indicator_id)
    WHERE d.indicator_id=NEW.indicator_id AND ((d.kind='anchored_membership' AND
      (c.anchor_levels IS NULL OR cardinality(c.anchor_levels)=0 OR NOT c.anchor_levels <@ ARRAY['commune','epci']::text[]))
      OR (d.kind='period_detail' AND (c.anchor_levels IS NOT NULL OR c.rider_label IS NOT NULL OR c.clock_policy<>'dataset'))))
  THEN RAISE EXCEPTION 'collection categories have incompatible typed anchor or clock policy'; END IF;
  IF EXISTS(SELECT 1 FROM period_detail_observation o JOIN observed_collection_descriptor d USING(indicator_id)
    JOIN observed_collection_category c USING(indicator_id,detail_key)
    WHERE o.indicator_id=NEW.indicator_id AND (d.kind<>'period_detail' OR c.source_id<>o.source_id OR NOT o.territory_type=ANY(d.allowed_levels)))
    OR EXISTS(SELECT 1 FROM anchored_membership o JOIN observed_collection_descriptor d USING(indicator_id)
      JOIN observed_collection_category c USING(indicator_id,detail_key)
      WHERE o.indicator_id=NEW.indicator_id AND (d.kind<>'anchored_membership' OR c.source_id<>o.source_id OR
        NOT o.territory_type=ANY(c.anchor_levels) OR NOT o.territory_type=ANY(d.allowed_levels) OR
        (o.convention_valant_ort AND c.rider_label IS NULL)))
  THEN RAISE EXCEPTION 'observed facts differ from their active descriptor or source'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER observed_collection_publication_contract AFTER INSERT OR UPDATE ON observed_collection_publication
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_publication();
CREATE INDEX period_detail_comparison ON period_detail_observation(indicator_id,observation_period,detail_key,territory_id) INCLUDE(value);
GRANT SELECT ON observed_collection_publication,observed_collection_descriptor,observed_collection_category,period_detail_observation,anchored_membership TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON observed_collection_publication,observed_collection_descriptor,observed_collection_category,period_detail_observation,anchored_membership TO lusk_publisher;
COMMIT;
