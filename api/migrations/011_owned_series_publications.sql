-- Dataset-owned ordered-series publications. The legacy ordered_series,
-- series_descriptor and table_publication contract remains intact for ENAF
-- until a separately approved reader/publisher rollout.
BEGIN;
CREATE TABLE series_provenance_revision (
  provenance_revision_id text PRIMARY KEY,
  source_id text NOT NULL,
  vintage_id text NOT NULL,
  source_name text NOT NULL,
  dataset_name text NOT NULL,
  source_version text NOT NULL,
  reference_date date NOT NULL,
  publication_date date NOT NULL,
  revision_hash text NOT NULL,
  UNIQUE(source_id, vintage_id, revision_hash)
);
CREATE FUNCTION reject_series_provenance_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'series provenance revisions are immutable'; END $$;
CREATE TRIGGER series_provenance_revision_immutable BEFORE UPDATE OR DELETE ON series_provenance_revision
 FOR EACH ROW EXECUTE FUNCTION reject_series_provenance_revision_mutation();
CREATE TABLE series_dataset_publication (
  dataset_id text PRIMARY KEY CHECK(dataset_id ~ '^[a-z][a-z0-9_]{0,95}$'),
  content_version text NOT NULL,
  reference_content_version text NOT NULL,
  row_count bigint NOT NULL CHECK(row_count > 0),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE series_dataset_descriptor (
  dataset_id text NOT NULL REFERENCES series_dataset_publication(dataset_id) ON DELETE CASCADE,
  indicator_id text NOT NULL CHECK(indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
  axis_kind text NOT NULL CHECK(axis_kind IN ('year','state_role')),
  axis_values text[] NOT NULL CHECK(cardinality(axis_values)>0),
  completeness text NOT NULL CHECK(completeness IN ('dense_complete','may_be_missing')),
  comparison_point text,
  label text NOT NULL,
  unit text NOT NULL,
  direction text NOT NULL CHECK(direction IN ('high','low','none')),
  allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
  descriptor_version text NOT NULL,
  PRIMARY KEY(dataset_id, indicator_id),
  CHECK(comparison_point IS NULL OR (comparison_point=ANY(axis_values) AND direction IN ('high','low'))),
  CHECK(comparison_point IS NOT NULL OR direction='none')
);
CREATE TABLE series_dataset_observation (
  dataset_id text NOT NULL,
  indicator_id text NOT NULL,
  territory_id text NOT NULL REFERENCES territory_reference(territory_id),
  territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  axis_value text NOT NULL,
  observation_period text NOT NULL,
  value double precision,
  status text NOT NULL CHECK(status IN ('measured','missing')),
  PRIMARY KEY(dataset_id,indicator_id,territory_id,axis_value),
  FOREIGN KEY(dataset_id,indicator_id) REFERENCES series_dataset_descriptor(dataset_id,indicator_id) ON DELETE CASCADE,
  CHECK((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)) OR (status='missing' AND value IS NULL))
);
CREATE TABLE series_observation_provenance (
  dataset_id text NOT NULL,
  indicator_id text NOT NULL,
  territory_id text NOT NULL,
  axis_value text NOT NULL,
  provenance_revision_id text NOT NULL REFERENCES series_provenance_revision(provenance_revision_id),
  PRIMARY KEY(dataset_id,indicator_id,territory_id,axis_value,provenance_revision_id),
  FOREIGN KEY(dataset_id,indicator_id,territory_id,axis_value)
    REFERENCES series_dataset_observation(dataset_id,indicator_id,territory_id,axis_value) ON DELETE CASCADE
);
CREATE FUNCTION validate_series_dataset_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text; marker_exists boolean; marker_time timestamptz; BEGIN
 owner_id:=COALESCE(NEW.dataset_id,OLD.dataset_id);
 SELECT true,p.published_at INTO marker_exists,marker_time FROM series_dataset_publication p WHERE p.dataset_id=owner_id;
 IF TG_OP='DELETE' AND marker_exists IS NULL THEN RETURN OLD; END IF;
 IF marker_exists IS DISTINCT FROM true OR marker_time IS DISTINCT FROM transaction_timestamp() THEN
   RAISE EXCEPTION 'owned series rows can change only in their marker publication transaction';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER series_dataset_descriptor_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_dataset_descriptor
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
CREATE TRIGGER series_dataset_observation_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_dataset_observation
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
CREATE TRIGGER series_observation_provenance_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_observation_provenance
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
CREATE INDEX series_dataset_observation_axis ON series_dataset_observation(dataset_id,indicator_id,axis_value,territory_id) INCLUDE(value,status);
CREATE FUNCTION validate_series_dataset_descriptor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF cardinality(NEW.axis_values)<>cardinality(ARRAY(SELECT DISTINCT unnest(NEW.axis_values))) THEN
   RAISE EXCEPTION 'series dataset descriptor has duplicate axis values';
 END IF;
 IF NEW.axis_kind='year' THEN
   IF EXISTS(SELECT 1 FROM unnest(NEW.axis_values) a WHERE a !~ '^[0-9]{4}$') OR
      NEW.axis_values<>ARRAY(SELECT a FROM unnest(NEW.axis_values) a ORDER BY a::integer) THEN
     RAISE EXCEPTION 'series year axis must be ordered numeric years';
   END IF;
 ELSIF NEW.axis_values<>ARRAY['M2','M3']::text[] THEN
   RAISE EXCEPTION 'state-role axis must declare M2 then M3';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER series_dataset_descriptor_contract BEFORE INSERT OR UPDATE ON series_dataset_descriptor
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_descriptor();
CREATE FUNCTION validate_series_dataset_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM series_dataset_descriptor d JOIN territory_reference t
   ON t.territory_id=NEW.territory_id WHERE d.dataset_id=NEW.dataset_id
   AND d.indicator_id=NEW.indicator_id AND NEW.axis_value=ANY(d.axis_values)
   AND NEW.territory_type=t.territory_type AND NEW.territory_type=ANY(d.allowed_levels)) THEN
   RAISE EXCEPTION 'series observation outside owned descriptor/reference contract';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER series_dataset_observation_contract BEFORE INSERT OR UPDATE ON series_dataset_observation
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_observation();
CREATE FUNCTION validate_series_dataset_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_rows bigint; actual_descriptors bigint; BEGIN
 SELECT count(*) INTO actual_rows FROM series_dataset_observation WHERE dataset_id=NEW.dataset_id;
 SELECT count(*) INTO actual_descriptors FROM series_dataset_descriptor WHERE dataset_id=NEW.dataset_id;
 IF actual_rows<>NEW.row_count OR actual_descriptors=0 THEN
   RAISE EXCEPTION 'owned series marker does not match complete descriptor/observation snapshot';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM table_publication t WHERE t.table_name='territory_reference'
   AND t.content_version=NEW.reference_content_version) THEN
   RAISE EXCEPTION 'owned series publication is bound to a stale territory reference';
 END IF;
 IF EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=NEW.dataset_id
   AND NOT EXISTS(SELECT 1 FROM series_observation_provenance p WHERE p.dataset_id=o.dataset_id
   AND p.indicator_id=o.indicator_id AND p.territory_id=o.territory_id AND p.axis_value=o.axis_value)) THEN
   RAISE EXCEPTION 'owned series observation is missing provenance association';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER series_dataset_publication_complete
 AFTER INSERT OR UPDATE ON series_dataset_publication DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_publication();
CREATE FUNCTION validate_series_observation_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d text; i text; t text; a text; BEGIN
 d:=COALESCE(NEW.dataset_id,OLD.dataset_id); i:=COALESCE(NEW.indicator_id,OLD.indicator_id);
 t:=COALESCE(NEW.territory_id,OLD.territory_id); a:=COALESCE(NEW.axis_value,OLD.axis_value);
 IF EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=d AND o.indicator_id=i
   AND o.territory_id=t AND o.axis_value=a) AND NOT EXISTS(SELECT 1 FROM series_observation_provenance p
   WHERE p.dataset_id=d AND p.indicator_id=i AND p.territory_id=t AND p.axis_value=a) THEN
   RAISE EXCEPTION 'owned series observation is missing provenance association';
 END IF;
 RETURN NULL;
END $$;
 CREATE CONSTRAINT TRIGGER series_observation_provenance_required
 AFTER INSERT OR UPDATE OR DELETE ON series_observation_provenance DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION validate_series_observation_provenance();
 CREATE CONSTRAINT TRIGGER series_observation_has_provenance
  AFTER INSERT OR UPDATE ON series_dataset_observation DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_series_observation_provenance();
GRANT SELECT ON series_provenance_revision,series_dataset_publication,series_dataset_descriptor,series_dataset_observation,series_observation_provenance TO lusk_reader;
GRANT SELECT,INSERT ON series_provenance_revision TO lusk_publisher;
GRANT SELECT,INSERT,UPDATE,DELETE ON series_dataset_publication,series_dataset_descriptor,series_dataset_observation,series_observation_provenance TO lusk_publisher;
COMMIT;
