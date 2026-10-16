-- Fresh serving schema. Do not apply over the legacy versioned schema: use the
-- explicit operator migration procedure in README-deploy.md instead.
CREATE TABLE table_publication (
    table_name text PRIMARY KEY CHECK (table_name IN (
        'territory_reference', 'scalar_observation', 'declared_profile', 'ordered_series', 'demographic_typed_reading','selected_reading','economy_typed_reading','economy_activity_evidence','milieux_typed_reading','milieux_reading_absence','mobility_typed_reading','aedar_territorial_aggregate')),
    content_version text NOT NULL,
    row_count integer NOT NULL CHECK (row_count >= 0),
    reference_content_version text,
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shared_fact_publication_requires_reference
      CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading','economy_typed_reading','economy_activity_evidence','milieux_typed_reading','milieux_reading_absence','mobility_typed_reading','aedar_territorial_aggregate') OR reference_content_version IS NOT NULL)
);

-- Closed, dense declared-detail profiles (e.g. structure_age × sex). The
-- ordered axis declarations are persisted with the independently versioned
-- profile table; observations remain one row per coordinate, never JSON blobs.
CREATE TABLE profile_descriptor (
    indicator_id text PRIMARY KEY CHECK (indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
    label text NOT NULL, unit text NOT NULL, allowed_levels text[] NOT NULL,
    completeness text NOT NULL CHECK (completeness = 'dense_complete'),
    descriptor_version text NOT NULL, comparison_detail text, denominator_semantics text,
    detail_units_required boolean NOT NULL DEFAULT false,
    comparison_sex text, comparison_direction text NOT NULL CHECK(comparison_direction IN ('high','low','none')),
    theme_id text CHECK (theme_id ~ '^[a-z][a-z0-9_]{0,63}$'),
    comparison_scalar text, required_scalar_version text,
    CONSTRAINT profile_comparison_contract CHECK (
      (comparison_scalar IS NULL AND required_scalar_version IS NULL AND comparison_detail IS NOT NULL)
      OR (comparison_scalar IS NOT NULL AND comparison_scalar ~ '^[a-z][a-z0-9_]{0,95}$' AND comparison_detail IS NULL AND comparison_sex IS NULL
          AND required_scalar_version IS NOT NULL AND length(required_scalar_version)>0))
);
CREATE TABLE profile_axis (
    indicator_id text NOT NULL REFERENCES profile_descriptor(indicator_id) ON DELETE CASCADE,
    axis_name text NOT NULL CHECK (axis_name IN ('detail','sex')),
    axis_key text NOT NULL, label text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0), unit text,
    PRIMARY KEY (indicator_id, axis_name, axis_key),
    UNIQUE (indicator_id, axis_name, ordinal)
);
CREATE TABLE profile_observation (
    indicator_id text NOT NULL REFERENCES profile_descriptor(indicator_id),
    territory_id text NOT NULL, territory_type text NOT NULL,
    detail_key text NOT NULL, sex_key text NOT NULL,
    detail_axis_name text NOT NULL DEFAULT 'detail' CHECK(detail_axis_name='detail'),
    sex_axis_name text DEFAULT 'sex' CHECK(sex_axis_name='sex'),
    value double precision, status text NOT NULL CHECK (status IN ('measured','not_available','suppressed','unsupported')),
    PRIMARY KEY (indicator_id, territory_id, detail_key, sex_key),
    FOREIGN KEY (indicator_id,detail_axis_name,detail_key) REFERENCES profile_axis(indicator_id,axis_name,axis_key),
    FOREIGN KEY (indicator_id,sex_axis_name,sex_key) REFERENCES profile_axis(indicator_id,axis_name,axis_key),
    CONSTRAINT profile_optional_sex_coordinate CHECK (
      (sex_key='' AND sex_axis_name IS NULL) OR (sex_key<>'' AND sex_axis_name='sex' AND sex_axis_name IS NOT NULL)),
    CHECK ((status='measured') = (value IS NOT NULL)),
    CHECK (value IS NULL OR value NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision))
);

-- Shared scalar foundation. Descriptors own the allowed territory levels and
-- semantic fields; values never infer metadata from their numeric payload.
CREATE TABLE source_dataset (
    source_id text PRIMARY KEY,
    name text NOT NULL
);
CREATE TABLE source_vintage (
    source_id text NOT NULL REFERENCES source_dataset(source_id),
    vintage_id text NOT NULL,
    version text NOT NULL,
    reference_date date,
    publication_date date,
    PRIMARY KEY (source_id, vintage_id)
);
CREATE TABLE profile_descriptor_source (
    indicator_id text NOT NULL REFERENCES profile_descriptor(indicator_id) ON DELETE CASCADE,
    source_id text NOT NULL REFERENCES source_dataset(source_id),
    PRIMARY KEY(indicator_id, source_id)
);
CREATE TABLE profile_observation_source (
    indicator_id text NOT NULL, territory_id text NOT NULL,
    detail_key text NOT NULL, sex_key text NOT NULL,
    source_id text NOT NULL, vintage_id text NOT NULL,
    PRIMARY KEY(indicator_id,territory_id,detail_key,sex_key,source_id,vintage_id),
    FOREIGN KEY(indicator_id,territory_id,detail_key,sex_key)
      REFERENCES profile_observation(indicator_id,territory_id,detail_key,sex_key) ON DELETE CASCADE,
    FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
    FOREIGN KEY(indicator_id,source_id) REFERENCES profile_descriptor_source(indicator_id,source_id)
);
CREATE TABLE scalar_descriptor (
    indicator_id text PRIMARY KEY CHECK (indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
    theme_id text NOT NULL CHECK (theme_id ~ '^[a-z][a-z0-9_]{0,63}$'),
    label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
    unit text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('high', 'low', 'none')),
    comparison_facet text,
    allowed_levels text[] NOT NULL CHECK (cardinality(allowed_levels) > 0
      AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
    denominator_semantics text NOT NULL,
    completeness text NOT NULL CHECK (completeness IN ('dense_complete','sparse')),
    descriptor_version text NOT NULL
);
CREATE TABLE scalar_descriptor_source (
    indicator_id text NOT NULL REFERENCES scalar_descriptor(indicator_id) ON DELETE CASCADE,
    source_id text NOT NULL REFERENCES source_dataset(source_id),
    PRIMARY KEY (indicator_id, source_id)
);
CREATE FUNCTION assert_scalar_descriptor_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text;
BEGIN
  IF TG_OP = 'DELETE' THEN key := OLD.indicator_id;
  ELSE key := NEW.indicator_id;
  END IF;
  IF EXISTS (SELECT 1 FROM scalar_descriptor d WHERE d.indicator_id=key)
     AND NOT EXISTS (SELECT 1 FROM scalar_descriptor_source s WHERE s.indicator_id=key) THEN
    RAISE EXCEPTION 'scalar descriptor must declare at least one source dataset';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER scalar_descriptor_requires_sources
AFTER INSERT OR UPDATE ON scalar_descriptor DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_scalar_descriptor_sources();
CREATE CONSTRAINT TRIGGER scalar_descriptor_source_set_not_empty
AFTER INSERT OR UPDATE OR DELETE ON scalar_descriptor_source DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_scalar_descriptor_sources();

CREATE TABLE territory_reference (
    territory_id text PRIMARY KEY,
    territory_type text NOT NULL,
    name text NOT NULL,
    department_id text,
    epci_id text,
    density_class_code text,
    density_class_label text
);
ALTER TABLE profile_observation ADD CONSTRAINT profile_observation_territory_reference
  FOREIGN KEY (territory_id) REFERENCES territory_reference(territory_id);
CREATE FUNCTION assert_profile_territory_level() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profile_descriptor d WHERE d.indicator_id=NEW.indicator_id
      AND NEW.territory_type=ANY(d.allowed_levels)) OR NOT EXISTS (
      SELECT 1 FROM territory_reference t WHERE t.territory_id=NEW.territory_id
        AND t.territory_type=NEW.territory_type) THEN
    RAISE EXCEPTION 'profile descriptor/territory level mismatch';
  END IF;
  IF (NEW.sex_axis_name IS NOT NULL) <> EXISTS (
      SELECT 1 FROM profile_axis a WHERE a.indicator_id=NEW.indicator_id AND a.axis_name='sex') THEN
    RAISE EXCEPTION 'profile second axis mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profile_territory_level BEFORE INSERT OR UPDATE ON profile_observation
  FOR EACH ROW EXECUTE FUNCTION assert_profile_territory_level();

CREATE TABLE scalar_observation (
    indicator_id text NOT NULL REFERENCES scalar_descriptor(indicator_id),
    territory_id text NOT NULL REFERENCES territory_reference(territory_id),
    territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement','region')),
    value double precision,
    status text NOT NULL CHECK (status IN ('measured','suppressed','unsupported','not_available')),
    support_count bigint CHECK (support_count IS NULL OR support_count >= 0),
    denominator_count bigint CHECK (denominator_count IS NULL OR denominator_count >= 0),
    PRIMARY KEY (indicator_id, territory_id),
    CHECK ((status = 'measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8))
        OR (status <> 'measured' AND value IS NULL)),
    CHECK (denominator_count IS NULL OR support_count IS NULL OR denominator_count >= support_count)
);
CREATE TABLE scalar_observation_source (
    indicator_id text NOT NULL,
    territory_id text NOT NULL,
    source_id text NOT NULL,
    vintage_id text NOT NULL,
    PRIMARY KEY (indicator_id, territory_id, source_id, vintage_id),
    FOREIGN KEY (indicator_id, territory_id) REFERENCES scalar_observation(indicator_id, territory_id) ON DELETE CASCADE,
    FOREIGN KEY (source_id, vintage_id) REFERENCES source_vintage(source_id, vintage_id),
    FOREIGN KEY (indicator_id, source_id) REFERENCES scalar_descriptor_source(indicator_id, source_id)
);
CREATE FUNCTION assert_scalar_observation_has_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE indicator text; territory text;
BEGIN
 IF TG_OP = 'DELETE' THEN
   indicator := OLD.indicator_id; territory := OLD.territory_id;
 ELSE
   indicator := NEW.indicator_id; territory := NEW.territory_id;
 END IF;
 IF EXISTS (SELECT 1 FROM scalar_observation o WHERE
   o.indicator_id=indicator AND o.territory_id=territory)
   AND NOT EXISTS (SELECT 1 FROM scalar_observation_source s WHERE
     s.indicator_id=indicator AND s.territory_id=territory) THEN
   RAISE EXCEPTION 'scalar observation lacks a source-vintage association';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER scalar_observation_source_required
AFTER INSERT OR UPDATE ON scalar_observation DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_scalar_observation_has_source();
CREATE CONSTRAINT TRIGGER scalar_observation_source_not_empty
AFTER INSERT OR UPDATE OR DELETE ON scalar_observation_source DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_scalar_observation_has_source();
CREATE FUNCTION assert_scalar_levels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scalar_descriptor d
    WHERE d.indicator_id = NEW.indicator_id AND NEW.territory_type = ANY(d.allowed_levels)
      )
    OR NOT EXISTS (SELECT 1 FROM territory_reference t
      WHERE t.territory_id = NEW.territory_id AND t.territory_type = NEW.territory_type) THEN
    RAISE EXCEPTION 'scalar descriptor/territory level mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scalar_observation_levels BEFORE INSERT OR UPDATE ON scalar_observation
FOR EACH ROW EXECUTE FUNCTION assert_scalar_levels();
CREATE FUNCTION assert_scalar_descriptor_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM scalar_observation o WHERE o.indicator_id=OLD.indicator_id
   AND NOT (o.territory_type = ANY(NEW.allowed_levels))) THEN
   RAISE EXCEPTION 'descriptor update invalidates published scalar observations';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scalar_descriptor_compatibility BEFORE UPDATE ON scalar_descriptor
FOR EACH ROW EXECUTE FUNCTION assert_scalar_descriptor_update();
CREATE FUNCTION assert_scalar_territory_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM scalar_observation o JOIN scalar_descriptor d USING(indicator_id)
   WHERE o.territory_id=OLD.territory_id
     AND (NEW.territory_type <> o.territory_type OR NOT (NEW.territory_type = ANY(d.allowed_levels)))) THEN
   RAISE EXCEPTION 'territory update invalidates published scalar observations';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scalar_territory_compatibility BEFORE UPDATE OF territory_type ON territory_reference
FOR EACH ROW EXECUTE FUNCTION assert_scalar_territory_update();

-- Fixed-context scalar comparisons are computed by R from canonical scalar
-- facts. Group statistics and territory-specific rank/tie results keep their
-- distinct grains and share one publication dependency marker.
CREATE TABLE scalar_comparison_publication (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    content_version text NOT NULL,
    scalar_content_version text NOT NULL,
    reference_content_version text NOT NULL,
    group_row_count integer NOT NULL CHECK (group_row_count >= 0),
    territory_row_count integer NOT NULL CHECK (territory_row_count >= 0),
    lineage_row_count integer NOT NULL CHECK (lineage_row_count >= 0),
    published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scalar_comparison_group (
    comparison_context text NOT NULL CHECK (comparison_context IN ('density_class','epci','bretagne','same_level')),
    group_id text NOT NULL CHECK (length(trim(group_id)) > 0),
    territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement')),
    indicator_id text NOT NULL REFERENCES scalar_descriptor(indicator_id),
    statistic text NOT NULL CHECK (statistic='median'),
    median double precision,
    member_count integer NOT NULL CHECK (member_count > 0),
    eligible_count integer NOT NULL CHECK (eligible_count >= 0),
    missing_count integer NOT NULL CHECK (missing_count >= 0),
    lineage_source_count integer NOT NULL CHECK (lineage_source_count >= 0),
    PRIMARY KEY (comparison_context,group_id,territory_type,indicator_id),
    CHECK (member_count=eligible_count+missing_count),
    CHECK ((eligible_count=0 AND median IS NULL) OR
      (eligible_count>0 AND median IS NOT NULL AND median NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)))
);
CREATE TABLE scalar_comparison_territory (
    comparison_context text NOT NULL,
    group_id text NOT NULL,
    territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement')),
    indicator_id text NOT NULL REFERENCES scalar_descriptor(indicator_id),
    territory_id text NOT NULL REFERENCES territory_reference(territory_id),
    value double precision,
    status text NOT NULL CHECK (status IN ('measured','suppressed','unsupported','not_available','not_published')),
    rank integer CHECK (rank IS NULL OR rank > 0),
    tie_count integer CHECK (tie_count IS NULL OR tie_count > 0),
    rank_size integer CHECK (rank_size IS NULL OR rank_size > 0),
    PRIMARY KEY (comparison_context,group_id,territory_type,indicator_id,territory_id),
    FOREIGN KEY (comparison_context,group_id,territory_type,indicator_id)
      REFERENCES scalar_comparison_group(comparison_context,group_id,territory_type,indicator_id) ON DELETE CASCADE,
    CHECK ((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))
      OR (status<>'measured' AND value IS NULL)),
    CHECK ((status='measured' AND rank IS NOT NULL AND tie_count IS NOT NULL AND rank_size IS NOT NULL)
      OR (status<>'measured' AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)),
    CHECK (status<>'measured' OR (rank<=rank_size AND tie_count<=rank_size))
);
-- Shared provenance projection at the resolved comparison group/facet grain.
-- It stores only the source/vintage union for each published group, not one
-- copy per focal territory or a read-time scan of peer observations.
CREATE TABLE comparison_source_lineage (
    comparison_family text NOT NULL CHECK (comparison_family IN
      ('scalar','profile','ordered_series','period_detail','aedar')),
    comparison_context text NOT NULL CHECK (comparison_context IN ('density_class','epci','bretagne','same_level')),
    group_id text NOT NULL CHECK (length(trim(group_id)) > 0),
    territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement')),
    facet_id text NOT NULL CHECK (length(trim(facet_id)) > 0),
    source_id text NOT NULL,
    vintage_id text NOT NULL,
    comparison_content_version text NOT NULL,
    PRIMARY KEY (comparison_family,comparison_context,group_id,territory_type,facet_id,source_id,vintage_id),
    FOREIGN KEY (source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);
GRANT SELECT ON scalar_comparison_publication,scalar_comparison_group,scalar_comparison_territory TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON scalar_comparison_publication,scalar_comparison_group,scalar_comparison_territory TO lusk_publisher;
GRANT SELECT ON comparison_source_lineage TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON comparison_source_lineage TO lusk_publisher;

-- Detail-backed declared profile facets only. Scalar-backed profiles (notably
-- DPE) continue to reference scalar_comparison and are never copied here.
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
    sex_key text NOT NULL DEFAULT '',
    statistic text NOT NULL CHECK (statistic='median'),
    median double precision,
    member_count integer NOT NULL CHECK (member_count > 0),
    eligible_count integer NOT NULL CHECK (eligible_count >= 0),
    missing_count integer NOT NULL CHECK (missing_count >= 0),
    lineage_source_count integer NOT NULL CHECK (lineage_source_count >= 0),
    profile_content_version text NOT NULL,
    reference_content_version text NOT NULL,
    PRIMARY KEY (comparison_context,group_id,territory_type,indicator_id,detail_key,sex_key),
    CHECK (member_count=eligible_count+missing_count),
    CHECK ((eligible_count=0 AND median IS NULL) OR (eligible_count>0 AND median IS NOT NULL AND median NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)))
);
CREATE TABLE profile_comparison_territory (
    comparison_context text NOT NULL, group_id text NOT NULL,
    territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement')),
    indicator_id text NOT NULL REFERENCES profile_descriptor(indicator_id),
    detail_key text NOT NULL, sex_key text NOT NULL DEFAULT '',
    territory_id text NOT NULL REFERENCES territory_reference(territory_id),
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

-- ADR-0038 declared series grain. Missing years are represented by omission;
-- a present row with status='missing' is an explicit unavailable point.
CREATE TABLE series_descriptor (
 indicator_id text PRIMARY KEY CHECK(indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
 axis_kind text NOT NULL CHECK(axis_kind='year'),
 axis_values text[] NOT NULL CHECK(cardinality(axis_values)>0),
 completeness text NOT NULL CHECK(completeness IN ('dense_complete','may_be_missing')),
  comparison_point text,
 allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
   label text NOT NULL, unit text NOT NULL, direction text NOT NULL CHECK(direction IN ('high','low','none')),
   source_id text NOT NULL REFERENCES source_dataset(source_id), vintage_id text NOT NULL,
   descriptor_version text NOT NULL,
   CHECK(comparison_point IS NULL OR (comparison_point=ANY(axis_values) AND direction IN ('high','low'))),
   FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE TABLE ordered_series (
 indicator_id text NOT NULL REFERENCES series_descriptor(indicator_id),
 territory_id text NOT NULL REFERENCES territory_reference(territory_id),
 territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
 axis_value text NOT NULL, observation_period text NOT NULL,
 value double precision, status text NOT NULL CHECK(status IN ('measured','missing')),
 source_id text NOT NULL, vintage_id text NOT NULL,
 PRIMARY KEY(indicator_id,territory_id,axis_value),
 FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
 CHECK((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)) OR (status='missing' AND value IS NULL)));
CREATE INDEX territory_reference_series_scope ON territory_reference(territory_type,department_id,epci_id,territory_id);
CREATE INDEX ordered_series_comparison_point ON ordered_series(indicator_id,axis_value,territory_id) INCLUDE(value,status);
CREATE FUNCTION validate_ordered_series() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM series_descriptor d JOIN territory_reference t ON t.territory_id=NEW.territory_id
  WHERE d.indicator_id=NEW.indicator_id AND NEW.axis_value=ANY(d.axis_values) AND NEW.territory_type=ANY(d.allowed_levels)
    AND t.territory_type=NEW.territory_type AND NEW.source_id=d.source_id AND NEW.vintage_id=d.vintage_id)
 THEN RAISE EXCEPTION 'series point outside declared descriptor'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER ordered_series_contract BEFORE INSERT OR UPDATE ON ordered_series
 FOR EACH ROW EXECUTE FUNCTION validate_ordered_series();
GRANT SELECT ON series_descriptor,ordered_series TO lusk_reader;
  GRANT SELECT,INSERT,UPDATE,DELETE ON series_descriptor,ordered_series TO lusk_publisher;

-- Fixed-context comparisons of owned ordered series. The point axis is part
-- of both keys; source vintages intentionally remain observation provenance.
CREATE TABLE ordered_series_comparison_publication (
 dataset_id text NOT NULL, indicator_id text NOT NULL,
 content_version text NOT NULL, ordered_series_content_version text NOT NULL,
 reference_content_version text NOT NULL,
 group_row_count integer NOT NULL CHECK(group_row_count>=0),
 territory_row_count integer NOT NULL CHECK(territory_row_count>=0),
 lineage_row_count integer NOT NULL CHECK(lineage_row_count>=0),
 comparison_axes text[] NOT NULL CHECK(cardinality(comparison_axes)>0),
 published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(dataset_id,indicator_id));
CREATE TABLE ordered_series_comparison_group (
 dataset_id text NOT NULL, indicator_id text NOT NULL,
 comparison_context text NOT NULL CHECK(comparison_context IN ('density_class','epci','bretagne','same_level')),
 group_id text NOT NULL CHECK(length(trim(group_id))>0),
 territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement')),
 axis_value text NOT NULL, statistic text NOT NULL CHECK(statistic IN ('median','mean')),
 group_value double precision, member_count integer NOT NULL CHECK(member_count>0),
 eligible_count integer NOT NULL CHECK(eligible_count>=0), missing_count integer NOT NULL CHECK(missing_count>=0),
 lineage_source_count integer NOT NULL CHECK(lineage_source_count>=0),
 PRIMARY KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value),
 CHECK(member_count=eligible_count+missing_count),
 CHECK((eligible_count=0 AND group_value IS NULL) OR (eligible_count>0 AND group_value IS NOT NULL AND group_value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))));
CREATE TABLE ordered_series_comparison_territory (
 dataset_id text NOT NULL, indicator_id text NOT NULL,
 comparison_context text NOT NULL, group_id text NOT NULL,
 territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement')),
 axis_value text NOT NULL, territory_id text NOT NULL REFERENCES territory_reference(territory_id),
 value double precision, status text NOT NULL CHECK(status IN ('measured','missing','not_published')),
 rank integer, tie_count integer, rank_size integer,
 PRIMARY KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value,territory_id),
 FOREIGN KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value)
 REFERENCES ordered_series_comparison_group(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value) ON DELETE CASCADE,
 CHECK((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) AND rank>0 AND tie_count>0 AND rank_size>0 AND rank<=rank_size AND tie_count<=rank_size)
 OR (status<>'measured' AND value IS NULL AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)));
CREATE TABLE ordered_series_comparison_lineage (
 dataset_id text NOT NULL, indicator_id text NOT NULL, comparison_context text NOT NULL,
 group_id text NOT NULL, territory_type text NOT NULL, axis_value text NOT NULL,
 provenance_revision_id text NOT NULL,
 PRIMARY KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value,provenance_revision_id),
 FOREIGN KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value)
 REFERENCES ordered_series_comparison_group(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value) ON DELETE CASCADE);
CREATE TABLE ordered_series_comparison_zero_reason (
 dataset_id text NOT NULL, indicator_id text NOT NULL, comparison_context text NOT NULL,
 group_id text NOT NULL, territory_type text NOT NULL, axis_value text NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>0),
 member_count integer NOT NULL CHECK(member_count>0),
 PRIMARY KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value,reason),
 FOREIGN KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value)
 REFERENCES ordered_series_comparison_group(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value) DEFERRABLE INITIALLY DEFERRED);
GRANT SELECT ON ordered_series_comparison_publication,ordered_series_comparison_group,ordered_series_comparison_territory,ordered_series_comparison_lineage,ordered_series_comparison_zero_reason TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON ordered_series_comparison_publication,ordered_series_comparison_group,ordered_series_comparison_territory,ordered_series_comparison_lineage,ordered_series_comparison_zero_reason TO lusk_publisher;

-- Additive dataset-owned contract (migration 011). Legacy ordered_series
-- remains available for the ENAF reader during an explicit rollout.
CREATE TABLE series_provenance_revision (
 provenance_revision_id text PRIMARY KEY, source_id text NOT NULL, vintage_id text NOT NULL,
 source_name text NOT NULL, dataset_name text NOT NULL, source_version text NOT NULL,
 reference_date date NOT NULL, publication_date date NOT NULL, revision_hash text NOT NULL,
 UNIQUE(source_id,vintage_id,revision_hash));
ALTER TABLE ordered_series_comparison_lineage ADD CONSTRAINT ordered_series_comparison_lineage_revision
 FOREIGN KEY(provenance_revision_id) REFERENCES series_provenance_revision(provenance_revision_id);
CREATE FUNCTION reject_series_provenance_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'series provenance revisions are immutable'; END $$;
CREATE TRIGGER series_provenance_revision_immutable BEFORE UPDATE OR DELETE ON series_provenance_revision
 FOR EACH ROW EXECUTE FUNCTION reject_series_provenance_revision_mutation();
CREATE TABLE series_dataset_publication (
 dataset_id text PRIMARY KEY CHECK(dataset_id ~ '^[a-z][a-z0-9_]{0,95}$'),
 content_version text NOT NULL, reference_content_version text NOT NULL,
 row_count bigint NOT NULL CHECK(row_count>0), published_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE series_dataset_descriptor (
  absence_semantics text NOT NULL DEFAULT 'unavailable'
    CHECK (absence_semantics IN ('unavailable','no_record')),
  comparison_levels text[],
 dataset_id text NOT NULL REFERENCES series_dataset_publication(dataset_id) ON DELETE CASCADE,
 indicator_id text NOT NULL CHECK(indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
 axis_kind text NOT NULL CHECK(axis_kind IN ('year','state_role','declared_detail','duration_minute')),
 axis_values text[] NOT NULL CHECK(cardinality(axis_values)>0),
 axis_numeric_values integer[],
 completeness text NOT NULL CHECK(completeness IN ('dense_complete','may_be_missing')),
  comparison_point text, label text NOT NULL, unit text NOT NULL,
  comparison_statistic text,
  comparison_scope text,
  observation_period_kind text CHECK(observation_period_kind IS NULL OR observation_period_kind IN ('snapshot_date','unknown')),
 direction text NOT NULL CHECK(direction IN ('high','low','none')),
 allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
 descriptor_version text NOT NULL, active_read_route boolean NOT NULL DEFAULT false,
 theme_id text,
 PRIMARY KEY(dataset_id,indicator_id),
  CHECK ((comparison_statistic IS NULL AND comparison_scope IS NULL) OR
    (comparison_statistic='median' AND comparison_scope='default_group') OR
    (indicator_id='raccordement_courbe' AND axis_kind='duration_minute' AND completeness='dense_complete' AND
      comparison_statistic='mean' AND comparison_scope='selected_group' AND
      cardinality(axis_values)=73 AND axis_numeric_values[1]=0 AND axis_numeric_values[73]=360)),
  CHECK(comparison_point IS NULL OR (comparison_point=ANY(axis_values) AND direction IN ('high','low'))),
 CHECK(comparison_point IS NOT NULL OR direction='none'));
 ALTER TABLE series_dataset_descriptor ADD CONSTRAINT series_absence_contract
   CHECK (absence_semantics <> 'no_record' OR completeness='may_be_missing');
 ALTER TABLE series_dataset_descriptor ADD CONSTRAINT series_comparison_levels_contract
   CHECK (comparison_levels IS NULL OR
     (cardinality(comparison_levels)>0 AND comparison_levels <@ allowed_levels));
 CREATE UNIQUE INDEX series_dataset_one_active_route ON series_dataset_descriptor(indicator_id) WHERE active_read_route;
CREATE TABLE series_dataset_observation (
 dataset_id text NOT NULL, indicator_id text NOT NULL,
 territory_id text NOT NULL REFERENCES territory_reference(territory_id),
 territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
 axis_value text NOT NULL, state_role text CHECK(state_role IS NULL OR state_role IN ('M2','M3')),
 observation_period text NOT NULL, value double precision,
 missing_reason text,
 status text NOT NULL CHECK(status IN ('measured','missing')),
 PRIMARY KEY(dataset_id,indicator_id,territory_id,axis_value),
 FOREIGN KEY(dataset_id,indicator_id) REFERENCES series_dataset_descriptor(dataset_id,indicator_id) ON DELETE CASCADE,
 CHECK((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)) OR (status='missing' AND value IS NULL)));
CREATE TABLE series_observation_provenance (
 dataset_id text NOT NULL, indicator_id text NOT NULL, territory_id text NOT NULL,
 axis_value text NOT NULL,
 provenance_revision_id text NOT NULL REFERENCES series_provenance_revision(provenance_revision_id),
 PRIMARY KEY(dataset_id,indicator_id,territory_id,axis_value,provenance_revision_id),
 FOREIGN KEY(dataset_id,indicator_id,territory_id,axis_value)
   REFERENCES series_dataset_observation(dataset_id,indicator_id,territory_id,axis_value) ON DELETE CASCADE);
  CREATE TABLE series_named_reference_descriptor (
   dataset_id text NOT NULL, indicator_id text NOT NULL, reference_id text NOT NULL,
   reference_label text NOT NULL, reference_role text NOT NULL CHECK(reference_role='analytical_reference'),
    reference_statistic text NOT NULL CHECK(length(trim(reference_statistic))>0),
    required boolean NOT NULL DEFAULT true,
    reference_indicator_id text NOT NULL CHECK(reference_indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
    active_read_route boolean NOT NULL DEFAULT false,
    PRIMARY KEY(dataset_id,indicator_id,reference_id),
    FOREIGN KEY(dataset_id,indicator_id) REFERENCES series_dataset_descriptor(dataset_id,indicator_id) ON DELETE CASCADE);
 CREATE UNIQUE INDEX series_named_reference_one_active_route
  ON series_named_reference_descriptor(reference_indicator_id) WHERE active_read_route;
  CREATE TABLE series_named_reference (
   dataset_id text NOT NULL, indicator_id text NOT NULL, reference_id text NOT NULL,
 axis_value text NOT NULL, observation_period text NOT NULL, value double precision,
 missing_reason text,
  status text NOT NULL CHECK(status IN ('measured','missing')),
  PRIMARY KEY(dataset_id,indicator_id,reference_id,axis_value),
   FOREIGN KEY(dataset_id,indicator_id,reference_id) REFERENCES series_named_reference_descriptor(dataset_id,indicator_id,reference_id) ON DELETE CASCADE,
  CHECK((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)) OR (status='missing' AND value IS NULL)));
 CREATE TABLE series_named_reference_provenance (
  dataset_id text NOT NULL, indicator_id text NOT NULL, reference_id text NOT NULL, axis_value text NOT NULL,
  provenance_revision_id text NOT NULL REFERENCES series_provenance_revision(provenance_revision_id),
  PRIMARY KEY(dataset_id,indicator_id,reference_id,axis_value,provenance_revision_id),
  FOREIGN KEY(dataset_id,indicator_id,reference_id,axis_value)
   REFERENCES series_named_reference(dataset_id,indicator_id,reference_id,axis_value) ON DELETE CASCADE);
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
CREATE TABLE series_context_parent_policy (
  dataset_id text NOT NULL, indicator_id text NOT NULL,
  focal_level text NOT NULL, parent_level text NOT NULL,
  PRIMARY KEY(dataset_id,indicator_id,focal_level),
  FOREIGN KEY(dataset_id,indicator_id) REFERENCES series_dataset_descriptor(dataset_id,indicator_id) ON DELETE CASCADE,
  CHECK ((focal_level='commune' AND parent_level='epci') OR
    (focal_level IN ('epci','departement') AND parent_level='region')));
CREATE TRIGGER series_context_parent_policy_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_context_parent_policy
  FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
GRANT SELECT ON series_context_parent_policy TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON series_context_parent_policy TO lusk_publisher;
CREATE TRIGGER series_dataset_observation_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_dataset_observation
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
CREATE TRIGGER series_observation_provenance_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_observation_provenance
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
 CREATE TRIGGER series_named_reference_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_named_reference
  FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
 CREATE TRIGGER series_named_reference_descriptor_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_named_reference_descriptor
  FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
 CREATE TRIGGER series_named_reference_provenance_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_named_reference_provenance
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
CREATE INDEX series_dataset_observation_axis ON series_dataset_observation(dataset_id,indicator_id,axis_value,territory_id) INCLUDE(value,status);
  GRANT SELECT ON series_provenance_revision,series_dataset_publication,series_dataset_descriptor,series_dataset_observation,series_observation_provenance,series_named_reference_descriptor,series_named_reference,series_named_reference_provenance TO lusk_reader;
GRANT SELECT,INSERT ON series_provenance_revision TO lusk_publisher;
   GRANT SELECT,INSERT,UPDATE,DELETE ON series_dataset_publication,series_dataset_descriptor,series_dataset_observation,series_observation_provenance,series_named_reference_descriptor,series_named_reference,series_named_reference_provenance TO lusk_publisher;
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
 ELSIF NEW.axis_kind='state_role' AND NEW.axis_values<>ARRAY['M2','M3']::text[] THEN
   RAISE EXCEPTION 'state-role axis must declare M2 then M3';
 ELSIF NEW.axis_kind='declared_detail' AND cardinality(NEW.axis_values)<>cardinality(ARRAY(SELECT DISTINCT unnest(NEW.axis_values))) THEN
  RAISE EXCEPTION 'declared detail axis contains duplicates';
  END IF;
  IF NEW.axis_kind='duration_minute' AND (NEW.axis_numeric_values IS NULL OR cardinality(NEW.axis_numeric_values)<>cardinality(NEW.axis_values)
     OR EXISTS(SELECT 1 FROM unnest(NEW.axis_numeric_values) a WHERE a IS NULL OR a<0 OR a>9999)
     OR NEW.axis_values IS DISTINCT FROM ARRAY(SELECT 't'||lpad(a::text,4,'0') FROM unnest(NEW.axis_numeric_values) WITH ORDINALITY x(a,n) ORDER BY n)
     OR NEW.axis_numeric_values IS DISTINCT FROM ARRAY(SELECT a FROM unnest(NEW.axis_numeric_values) a ORDER BY a)
    OR cardinality(NEW.axis_numeric_values)<>cardinality(ARRAY(SELECT DISTINCT unnest(NEW.axis_numeric_values)))) THEN
    RAISE EXCEPTION 'duration axis numeric minutes do not match declared detail keys';
  END IF;
   IF NEW.active_read_route AND NEW.axis_kind='duration_minute' AND
      (NEW.observation_period_kind IS NULL OR NEW.comparison_statistic IS NULL OR NEW.comparison_scope IS NULL) THEN
     RAISE EXCEPTION 'active duration route requires declared comparison and observation-period semantics';
   END IF;
   IF NEW.comparison_statistic='mean' AND NEW.indicator_id='raccordement_courbe' AND
      (NEW.axis_kind<>'duration_minute' OR NEW.axis_numeric_values IS DISTINCT FROM ARRAY(SELECT generate_series(0,360,5))) THEN
     RAISE EXCEPTION 'national raccordement mean contract requires the complete 0..360 minute grid by five';
   END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=NEW.dataset_id
    AND o.indicator_id=NEW.indicator_id AND NOT o.axis_value=ANY(NEW.axis_values)) THEN
    RAISE EXCEPTION 'series dataset descriptor excludes published observations';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=NEW.dataset_id
    AND r.indicator_id=NEW.indicator_id AND NOT r.axis_value=ANY(NEW.axis_values)) THEN
    RAISE EXCEPTION 'series descriptor excludes published named-reference points';
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
 IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id
   AND d.indicator_id=NEW.indicator_id AND d.axis_kind='declared_detail'
   AND NEW.state_role IS NULL) THEN
   RAISE EXCEPTION 'declared-detail state observation requires its typed M2/M3 role';
 END IF;
 RETURN NEW;
END $$;
 CREATE TRIGGER series_dataset_observation_contract BEFORE INSERT OR UPDATE ON series_dataset_observation
  FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_observation();
 CREATE FUNCTION validate_series_named_reference() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE allowed_axes text[]; BEGIN
  SELECT d.axis_values INTO allowed_axes FROM series_dataset_descriptor d
   JOIN series_named_reference_descriptor r USING(dataset_id,indicator_id)
   WHERE r.dataset_id=NEW.dataset_id AND r.indicator_id=NEW.indicator_id AND r.reference_id=NEW.reference_id;
  IF allowed_axes IS NULL OR NOT NEW.axis_value=ANY(allowed_axes) THEN
   RAISE EXCEPTION 'named reference point is outside its declared descriptor axis';
  END IF;
  RETURN NEW;
 END $$;
 CREATE TRIGGER series_named_reference_contract BEFORE INSERT OR UPDATE ON series_named_reference
  FOR EACH ROW EXECUTE FUNCTION validate_series_named_reference();
CREATE FUNCTION validate_series_dataset_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_rows bigint; actual_descriptors bigint; BEGIN
 SELECT (SELECT count(*) FROM series_dataset_observation WHERE dataset_id=NEW.dataset_id) +
        (SELECT count(*) FROM series_named_reference WHERE dataset_id=NEW.dataset_id) INTO actual_rows;
 SELECT count(*) INTO actual_descriptors FROM series_dataset_descriptor WHERE dataset_id=NEW.dataset_id;
 IF actual_rows<>NEW.row_count OR actual_descriptors=0 THEN
   RAISE EXCEPTION 'owned series marker does not match complete descriptor/observation snapshot';
 END IF;
 IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='duration_minute'
   AND (EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id AND NOT o.axis_value=ANY(d.axis_values))
     OR EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=d.dataset_id AND r.indicator_id=d.indicator_id AND NOT r.axis_value=ANY(d.axis_values)))) THEN
   RAISE EXCEPTION 'duration facts contain undeclared axis points';
 END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=NEW.dataset_id AND NOT EXISTS(
   SELECT 1 FROM series_named_reference_provenance p WHERE (p.dataset_id,p.indicator_id,p.reference_id,p.axis_value)=(r.dataset_id,r.indicator_id,r.reference_id,r.axis_value))) THEN
   RAISE EXCEPTION 'named reference observation is missing provenance association';
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
 IF EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=NEW.dataset_id AND NOT EXISTS(
   SELECT 1 FROM series_named_reference_provenance p WHERE (p.dataset_id,p.indicator_id,p.reference_id,p.axis_value)=(r.dataset_id,r.indicator_id,r.reference_id,r.axis_value))) THEN
  RAISE EXCEPTION 'named reference observation is missing provenance association';
 END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id
    AND d.axis_kind='declared_detail' AND EXISTS(SELECT 1 FROM series_dataset_observation o
     WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id
     GROUP BY o.territory_id HAVING count(DISTINCT o.state_role)<>2)) THEN
    RAISE EXCEPTION 'declared-detail publication must contain both canonical state roles per territory';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=NEW.dataset_id AND r.indicator_id IN
    (SELECT indicator_id FROM series_dataset_descriptor WHERE dataset_id=NEW.dataset_id)
    AND NOT EXISTS(SELECT 1 FROM series_named_reference_descriptor d WHERE
      (d.dataset_id,d.indicator_id,d.reference_id)=(r.dataset_id,r.indicator_id,r.reference_id))) THEN
   RAISE EXCEPTION 'named reference fact has no declared reference identity';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.required
    AND NOT EXISTS(SELECT 1 FROM series_named_reference r WHERE
      (r.dataset_id,r.indicator_id,r.reference_id)=(d.dataset_id,d.indicator_id,d.reference_id))) THEN
    RAISE EXCEPTION 'required named reference is missing';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference_descriptor d WHERE d.dataset_id=NEW.dataset_id
    AND d.active_read_route AND NOT d.required) THEN
    RAISE EXCEPTION 'active analytical-reference route must be required';
  END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id
    AND d.axis_kind='duration_minute' AND d.active_read_route AND d.observation_period_kind='snapshot_date'
    AND (EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=d.dataset_id
       AND o.indicator_id=d.indicator_id AND o.observation_period !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      OR EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=d.dataset_id
       AND r.indicator_id=d.indicator_id AND r.observation_period !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))) THEN
    RAISE EXCEPTION 'duration snapshot-date observations must carry an ISO date period';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference_descriptor d JOIN series_dataset_descriptor s USING(dataset_id,indicator_id)
    WHERE d.dataset_id=NEW.dataset_id AND d.active_read_route
      AND (SELECT count(DISTINCT r.axis_value) FROM series_named_reference r WHERE
        (r.dataset_id,r.indicator_id,r.reference_id)=(d.dataset_id,d.indicator_id,d.reference_id)
        AND r.axis_value=ANY(s.axis_values))<>cardinality(s.axis_values)) THEN
    RAISE EXCEPTION 'active analytical-reference route is missing declared axis points';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference_descriptor d JOIN series_dataset_descriptor s USING(dataset_id,indicator_id)
    WHERE d.dataset_id=NEW.dataset_id AND d.required AND s.axis_kind='duration_minute'
      AND (SELECT count(DISTINCT r.axis_value) FROM series_named_reference r WHERE
        (r.dataset_id,r.indicator_id,r.reference_id)=(d.dataset_id,d.indicator_id,d.reference_id) AND r.axis_value=ANY(s.axis_values)
        )<>cardinality(s.axis_values)) THEN
   RAISE EXCEPTION 'required named reference is missing declared duration points';
  END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='duration_minute'
    AND d.completeness='dense_complete' AND EXISTS(SELECT 1 FROM series_dataset_observation o
      WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id GROUP BY o.territory_id
      HAVING count(DISTINCT o.axis_value)<>cardinality(d.axis_values))) THEN
    RAISE EXCEPTION 'dense duration curve is missing declared focal points';
  END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='duration_minute'
    AND d.completeness='dense_complete' AND EXISTS(SELECT 1 FROM territory_reference t
      WHERE t.territory_type=ANY(d.allowed_levels) AND NOT EXISTS(SELECT 1 FROM series_dataset_observation o
        WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id
          AND o.territory_id=t.territory_id AND o.territory_type=t.territory_type))) THEN
    RAISE EXCEPTION 'dense duration publication omits an eligible territory from the reference universe';
  END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='duration_minute'
    AND d.completeness='dense_complete' AND EXISTS(SELECT 1 FROM series_named_reference r
      WHERE r.dataset_id=d.dataset_id AND r.indicator_id=d.indicator_id GROUP BY r.reference_id
      HAVING count(DISTINCT r.axis_value)<>cardinality(d.axis_values))) THEN
    RAISE EXCEPTION 'dense duration reference is missing declared points';
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
 CREATE FUNCTION validate_series_named_reference_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE d text; i text; r text; a text; BEGIN
  d:=COALESCE(NEW.dataset_id,OLD.dataset_id); i:=COALESCE(NEW.indicator_id,OLD.indicator_id);
  r:=COALESCE(NEW.reference_id,OLD.reference_id); a:=COALESCE(NEW.axis_value,OLD.axis_value);
  IF EXISTS(SELECT 1 FROM series_named_reference n WHERE n.dataset_id=d AND n.indicator_id=i
    AND n.reference_id=r AND n.axis_value=a) AND NOT EXISTS(SELECT 1 FROM series_named_reference_provenance p
    WHERE p.dataset_id=d AND p.indicator_id=i AND p.reference_id=r AND p.axis_value=a) THEN
   RAISE EXCEPTION 'named reference observation is missing provenance association';
  END IF;
  RETURN NULL;
 END $$;
 CREATE CONSTRAINT TRIGGER series_named_reference_provenance_required
  AFTER INSERT OR UPDATE OR DELETE ON series_named_reference_provenance DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_series_named_reference_provenance();
 CREATE CONSTRAINT TRIGGER series_named_reference_has_provenance
  AFTER INSERT OR UPDATE ON series_named_reference DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_series_named_reference_provenance();

-- Selected demographic reading facts have their own narrow typed grain.
CREATE TABLE demographic_reading_descriptor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), descriptor_version text NOT NULL,
  source_id text NOT NULL REFERENCES source_dataset(source_id), vintage_id text NOT NULL, rate_unit text NOT NULL,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);
CREATE UNIQUE INDEX territory_reference_id_type_unique ON territory_reference(territory_id,territory_type);
CREATE TABLE demographic_typed_reading (
  territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  groupe text NOT NULL, story_key text NOT NULL, salience_reason text NOT NULL, periode text,
  solde_naturel double precision, solde_migratoire double precision,
  taux_solde_naturel double precision, taux_solde_migratoire double precision, classification text,
  status text NOT NULL CHECK(status IN ('measured','unavailable')), source_id text NOT NULL, vintage_id text NOT NULL,
  PRIMARY KEY(territory_id,territory_type,groupe),
  FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
  CHECK ((status='measured') = (periode IS NOT NULL AND solde_naturel IS NOT NULL AND solde_migratoire IS NOT NULL AND
    taux_solde_naturel IS NOT NULL AND taux_solde_migratoire IS NOT NULL AND classification IS NOT NULL)),
  CHECK (solde_naturel IS NULL OR solde_naturel NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
  CHECK (solde_migratoire IS NULL OR solde_migratoire NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
  CHECK (taux_solde_naturel IS NULL OR taux_solde_naturel NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
  CHECK (taux_solde_migratoire IS NULL OR taux_solde_migratoire NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))
);
CREATE TABLE selected_reading_descriptor (
  theme_id text PRIMARY KEY CHECK(theme_id IN ('habitat')),
  descriptor_version text NOT NULL, source_id text NOT NULL REFERENCES source_dataset(source_id),
  vintage_id text NOT NULL, linked_content_version text NOT NULL,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE TABLE selected_reading_publication (
  theme_id text PRIMARY KEY REFERENCES selected_reading_descriptor(theme_id) ON DELETE CASCADE,
  content_version text NOT NULL, reference_content_version text NOT NULL,
  row_count integer NOT NULL CHECK(row_count>0), published_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE habitat_typed_reading (
  territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  groupe text NOT NULL, story_key text NOT NULL, salience_reason text NOT NULL,
  classification text, part_passoires double precision, part_abc double precision, n_dpe bigint,
  status text NOT NULL CHECK(status IN ('measured','suppressed','unavailable')),
  source_id text NOT NULL, vintage_id text NOT NULL,
  PRIMARY KEY(territory_id,territory_type,groupe),
  FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
  CHECK ((status='measured') = (classification IS NOT NULL AND part_passoires IS NOT NULL AND part_abc IS NOT NULL AND n_dpe IS NOT NULL)),
  CHECK (status <> 'suppressed' OR (part_passoires IS NULL AND part_abc IS NULL)),
  CHECK (part_passoires IS NULL OR part_passoires BETWEEN 0 AND 1), CHECK(part_abc IS NULL OR part_abc BETWEEN 0 AND 1),
  CHECK(n_dpe IS NULL OR n_dpe>=0));
CREATE TABLE economy_typed_reading (
  territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  groupe text NOT NULL, story_key text NOT NULL, salience_reason text NOT NULL,
  status text NOT NULL CHECK(status IN ('measured','unavailable')), source_id text NOT NULL, vintage_id text NOT NULL,
  PRIMARY KEY(territory_id,territory_type,groupe),
  FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE TABLE economy_activity_evidence (
  territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  groupe text NOT NULL, rank smallint NOT NULL CHECK(rank BETWEEN 1 AND 5), activity_code text NOT NULL,
  activity_label text NOT NULL, lq double precision NOT NULL CHECK(lq>=0), establishment_count bigint NOT NULL CHECK(establishment_count>=0),
  park_share double precision, source_id text NOT NULL, vintage_id text NOT NULL,
  PRIMARY KEY(territory_id,territory_type,groupe,rank),
  FOREIGN KEY(territory_id,territory_type,groupe) REFERENCES economy_typed_reading(territory_id,territory_type,groupe) ON DELETE CASCADE,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
  CHECK(park_share IS NULL OR park_share BETWEEN 0 AND 1));
CREATE TABLE milieux_typed_reading (
 territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
 groupe text NOT NULL, story_key text NOT NULL, salience_reason text NOT NULL,
 periode_pop text, periode_artif text, delta_population double precision,
 taux_variation_population double precision, artif_m2_par_habitant double precision,
 artif_m3_par_habitant double precision, trajectoire_artif_par_habitant double precision,
 classification text, status text NOT NULL CHECK(status IN ('measured','unavailable')),
 source_id text NOT NULL, vintage_id text NOT NULL,
 PRIMARY KEY(territory_id,territory_type,groupe),
 FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
 CHECK ((status='measured') = (periode_pop IS NOT NULL AND periode_artif IS NOT NULL AND classification IS NOT NULL)));
CREATE TABLE mobility_typed_reading (
 territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
 groupe text NOT NULL, story_key text NOT NULL, salience_reason text NOT NULL,
 classification_saillance text, div_loss_t double precision, div_loss_b double precision,
 status text NOT NULL CHECK(status IN ('measured','unavailable')),
 source_id text NOT NULL, vintage_id text NOT NULL,
 PRIMARY KEY(territory_id,territory_type,groupe),
 FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
 FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
 CHECK ((status='measured') = (div_loss_t IS NOT NULL AND div_loss_b IS NOT NULL)),
 CHECK (div_loss_t IS NULL OR (div_loss_t >= 0 AND div_loss_t NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))),
 CHECK (div_loss_b IS NULL OR (div_loss_b >= 0 AND div_loss_b NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))),
 CHECK (div_loss_t IS NULL OR div_loss_b IS NULL OR div_loss_b <= div_loss_t));
CREATE TABLE mobility_reading_descriptor (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), descriptor_version text NOT NULL CHECK(length(descriptor_version)>0),
 source_id text NOT NULL, vintage_id text NOT NULL, source_name text NOT NULL CHECK(length(trim(source_name))>0),
 dataset_name text NOT NULL CHECK(length(trim(dataset_name))>0), source_version text NOT NULL CHECK(length(trim(source_version))>0),
 reference_date date, publication_date date,
 unit text NOT NULL CHECK(length(trim(unit))>0), direction text NOT NULL CHECK(direction IN ('high','low','none')),
 allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
 missing_status text NOT NULL CHECK(missing_status='unavailable'),
 classification_values text[] NOT NULL CHECK(cardinality(classification_values)>0),
 field_keys text[] NOT NULL CHECK(cardinality(field_keys)>0), story_count integer NOT NULL CHECK(story_count>0),
 clock_count integer NOT NULL CHECK(clock_count>0),
 FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE TABLE mobility_reading_story (
 story_key text PRIMARY KEY, groupe text NOT NULL, salience_reason text NOT NULL, ordinal integer NOT NULL CHECK(ordinal>0),
 UNIQUE(groupe,story_key), UNIQUE(groupe,story_key,salience_reason), UNIQUE(ordinal),
 CHECK(length(trim(story_key))>0 AND length(trim(groupe))>0 AND length(trim(salience_reason))>0));
ALTER TABLE mobility_typed_reading ADD CONSTRAINT mobility_reading_story_contract
 FOREIGN KEY(groupe,story_key,salience_reason) REFERENCES mobility_reading_story(groupe,story_key,salience_reason);
CREATE TABLE mobility_reading_clock (
 ordinal integer PRIMARY KEY CHECK(ordinal>0), clock_name text NOT NULL CHECK(length(trim(clock_name))>0),
 frequency text NOT NULL CHECK(length(trim(frequency))>0), reference text NOT NULL CHECK(length(trim(reference))>0),
 trigger text NOT NULL CHECK(length(trim(trigger))>0), UNIQUE(clock_name));
CREATE TABLE milieux_population_provenance_revision (
 population_revision_id text PRIMARY KEY,
 source_id text NOT NULL, vintage_id text NOT NULL, source_name text NOT NULL,
 dataset_name text NOT NULL, source_version text NOT NULL,
 reference_date date, publication_date date, revision_hash text NOT NULL,
 UNIQUE(source_id,vintage_id,revision_hash));
CREATE FUNCTION reject_milieux_population_provenance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Milieux population provenance revisions are immutable'; END $$;
CREATE TRIGGER milieux_population_provenance_immutable BEFORE UPDATE OR DELETE ON milieux_population_provenance_revision
 FOR EACH ROW EXECUTE FUNCTION reject_milieux_population_provenance_mutation();
CREATE TABLE milieux_reading_source (
 territory_id text NOT NULL, territory_type text NOT NULL, groupe text NOT NULL,
 field_key text NOT NULL CHECK(field_key IN ('population','artif_m2_par_habitant','artif_m3_par_habitant')),
 source_id text NOT NULL, vintage_id text NOT NULL, source_name text NOT NULL, source_version text NOT NULL,
 reference_date date, publication_date date, observation_period text,
 dataset_id text, dataset_content_version text, state_role text, axis_value text,
 provenance_revision_id text REFERENCES series_provenance_revision(provenance_revision_id),
 population_revision_id text REFERENCES milieux_population_provenance_revision(population_revision_id),
 PRIMARY KEY(territory_id,territory_type,groupe,field_key,source_id,vintage_id),
 FOREIGN KEY(territory_id,territory_type,groupe) REFERENCES milieux_typed_reading(territory_id,territory_type,groupe) ON DELETE CASCADE,
 FOREIGN KEY(dataset_id) REFERENCES series_dataset_publication(dataset_id),
 CHECK ((field_key='population' AND dataset_id IS NULL AND dataset_content_version IS NULL AND state_role IS NULL AND provenance_revision_id IS NULL AND population_revision_id IS NOT NULL)
      OR (field_key IN ('artif_m2_par_habitant','artif_m3_par_habitant') AND dataset_id IS NOT NULL AND dataset_content_version IS NOT NULL AND state_role IN ('M2','M3') AND provenance_revision_id IS NOT NULL AND population_revision_id IS NULL)));
CREATE TABLE milieux_reading_absence (
 territory_id text NOT NULL, territory_type text NOT NULL CHECK (territory_type='commune'),
 reason text NOT NULL CHECK (reason='source_record_absent'), source_id text NOT NULL, vintage_id text NOT NULL,
 source_snapshot_sha256 text NOT NULL CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY (territory_id,territory_type),
 FOREIGN KEY (territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
 FOREIGN KEY (source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
GRANT SELECT ON milieux_typed_reading,milieux_reading_source TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON milieux_typed_reading,milieux_reading_source TO lusk_publisher;
GRANT SELECT ON milieux_reading_absence TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON milieux_reading_absence TO lusk_publisher;
GRANT SELECT ON mobility_typed_reading,mobility_reading_descriptor,mobility_reading_story,mobility_reading_clock TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON mobility_typed_reading,mobility_reading_descriptor,mobility_reading_story,mobility_reading_clock TO lusk_publisher;
GRANT SELECT ON milieux_population_provenance_revision TO lusk_reader;
GRANT SELECT,INSERT ON milieux_population_provenance_revision TO lusk_publisher;
-- Sparse period/detail facts have real year coordinates, not dense profile zeros.
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
-- Fixed comparisons are a derived projection of sparse period/detail facts;
-- they never own observation values or provenance.
CREATE TABLE observed_collection_comparison_publication (
  indicator_id text PRIMARY KEY REFERENCES observed_collection_publication(indicator_id) ON DELETE CASCADE,
  content_version text NOT NULL, collection_content_version text NOT NULL,
  reference_content_version text NOT NULL, group_row_count bigint NOT NULL CHECK(group_row_count>=0),
  territory_row_count bigint NOT NULL CHECK(territory_row_count>=0), lineage_row_count bigint NOT NULL DEFAULT 0 CHECK(lineage_row_count>=0),
  lineage_complete boolean NOT NULL DEFAULT false, published_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE observed_collection_comparison_group (
  indicator_id text NOT NULL, comparison_context text NOT NULL CHECK(comparison_context IN ('density_class','epci','bretagne','same_level')),
  group_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement')),
  detail_key text NOT NULL, observation_period text NOT NULL CHECK(observation_period ~ '^[0-9]{4}$'),
  statistic text NOT NULL CHECK(statistic='median'), median double precision,
  member_count integer NOT NULL CHECK(member_count>0), eligible_count integer NOT NULL CHECK(eligible_count>=0),
  missing_count integer NOT NULL CHECK(missing_count>=0 AND member_count=eligible_count+missing_count),
  lineage_source_count integer NOT NULL DEFAULT 0 CHECK(lineage_source_count>=0),
  collection_content_version text NOT NULL, reference_content_version text NOT NULL,
  PRIMARY KEY(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period),
  FOREIGN KEY(indicator_id,detail_key) REFERENCES observed_collection_category(indicator_id,detail_key) ON DELETE CASCADE,
  CHECK((eligible_count=0 AND median IS NULL) OR (eligible_count>0 AND median IS NOT NULL AND median NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))));
 ALTER TABLE observed_collection_comparison_group ADD CONSTRAINT observed_collection_lineage_support_shape
   CHECK((eligible_count=0 AND lineage_source_count=0) OR (eligible_count>0 AND lineage_source_count>0));
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
  CHECK(status<>'measured' OR (rank<=rank_size AND tie_count<=rank_size)));
 CREATE TABLE observed_collection_comparison_lineage (
  indicator_id text NOT NULL, comparison_context text NOT NULL, group_id text NOT NULL,
  territory_type text NOT NULL, detail_key text NOT NULL, observation_period text NOT NULL,
  source_id text NOT NULL, vintage_id text NOT NULL, comparison_content_version text NOT NULL,
  PRIMARY KEY(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period,source_id,vintage_id),
  FOREIGN KEY(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period)
    REFERENCES observed_collection_comparison_group(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period) ON DELETE CASCADE,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
 GRANT SELECT ON observed_collection_comparison_publication,observed_collection_comparison_group,observed_collection_comparison_territory,observed_collection_comparison_lineage TO lusk_reader;
 GRANT SELECT,INSERT,UPDATE,DELETE ON observed_collection_comparison_publication,observed_collection_comparison_group,observed_collection_comparison_territory,observed_collection_comparison_lineage TO lusk_publisher;
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
 CREATE TRIGGER observed_collection_comparison_lineage_owned_write BEFORE INSERT OR UPDATE OR DELETE ON observed_collection_comparison_lineage
   FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_comparison_write();
CREATE FUNCTION validate_observed_collection_comparison_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT NEW.lineage_complete OR NOT EXISTS(SELECT 1 FROM observed_collection_publication p JOIN observed_collection_descriptor d USING(indicator_id)
    WHERE p.indicator_id=NEW.indicator_id AND d.kind='period_detail'
      AND p.content_version=NEW.collection_content_version AND p.reference_content_version=NEW.reference_content_version)
    OR NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='territory_reference' AND content_version=NEW.reference_content_version)
     OR NEW.group_row_count<>(SELECT count(*) FROM observed_collection_comparison_group WHERE indicator_id=NEW.indicator_id)
     OR NEW.territory_row_count<>(SELECT count(*) FROM observed_collection_comparison_territory WHERE indicator_id=NEW.indicator_id)
     OR NEW.lineage_row_count<>(SELECT count(*) FROM observed_collection_comparison_lineage WHERE indicator_id=NEW.indicator_id)
     OR EXISTS(SELECT 1 FROM observed_collection_comparison_lineage WHERE indicator_id=NEW.indicator_id AND comparison_content_version<>NEW.content_version)
     OR EXISTS(SELECT 1 FROM observed_collection_comparison_group g WHERE g.indicator_id=NEW.indicator_id
       AND g.lineage_source_count<>(SELECT count(*) FROM observed_collection_comparison_lineage l WHERE
         (l.indicator_id,l.comparison_context,l.group_id,l.territory_type,l.detail_key,l.observation_period)=
         (g.indicator_id,g.comparison_context,g.group_id,g.territory_type,g.detail_key,g.observation_period)))
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
CREATE FUNCTION validate_observed_collection_comparison_lineage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.lineage_row_count<>(SELECT count(*) FROM observed_collection_comparison_lineage WHERE indicator_id=NEW.indicator_id)
    OR EXISTS(SELECT 1 FROM observed_collection_comparison_lineage WHERE indicator_id=NEW.indicator_id AND comparison_content_version<>NEW.content_version)
    OR EXISTS(SELECT 1 FROM observed_collection_comparison_group g WHERE g.indicator_id=NEW.indicator_id
      AND g.lineage_source_count<>(SELECT count(*) FROM observed_collection_comparison_lineage l WHERE
        (l.indicator_id,l.comparison_context,l.group_id,l.territory_type,l.detail_key,l.observation_period)=
        (g.indicator_id,g.comparison_context,g.group_id,g.territory_type,g.detail_key,g.observation_period)))
  THEN RAISE EXCEPTION 'observed collection comparison lineage is incomplete or stale'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER observed_collection_comparison_lineage_contract AFTER INSERT OR UPDATE ON observed_collection_comparison_publication
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_comparison_lineage();
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

-- Paired density/decile distribution consumed by the Mobilité focal figure.
-- This is intentionally distinct from a median-comparison profile.
-- Source-shaped AEDAR dense territory � TYPEQU aggregates (not indicator IDs).
CREATE TABLE aedar_territorial_aggregate (
  territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement','region')),
  territory_id text NOT NULL, typequ text NOT NULL, typequ_label text NOT NULL,
  typequ_hierarchy_label text NOT NULL,
  typequ_description text NOT NULL,
  typequ_domain_code text NOT NULL, typequ_domain_label text NOT NULL,
  typequ_subdomain_code text NOT NULL, typequ_subdomain_label text NOT NULL,
  typequ_gamme text, typequ_gamme_status text NOT NULL CHECK(typequ_gamme_status IN ('classified','hors_gamme','absent')),
  typequ_source_order integer NOT NULL CHECK(typequ_source_order BETWEEN 1 AND 235),
  CONSTRAINT aedar_typequ_metadata_complete_check CHECK (COALESCE(
    (typequ_hierarchy_label IS NULL AND typequ_description IS NULL AND typequ_domain_code IS NULL AND typequ_domain_label IS NULL AND
     typequ_subdomain_code IS NULL AND typequ_subdomain_label IS NULL AND typequ_gamme_status IS NULL AND typequ_source_order IS NULL AND typequ_gamme IS NULL)
    OR
    (typequ_hierarchy_label IS NOT NULL AND typequ_description IS NOT NULL AND typequ_domain_code IS NOT NULL AND typequ_domain_label IS NOT NULL AND
     typequ_subdomain_code IS NOT NULL AND typequ_subdomain_label IS NOT NULL AND typequ_gamme_status IS NOT NULL AND typequ_source_order IS NOT NULL AND
     ((typequ_gamme_status='absent' AND typequ_gamme IS NULL) OR
      (typequ_gamme_status='hors_gamme' AND typequ_gamme IS NOT NULL AND typequ_gamme='Hors Gamme') OR
      (typequ_gamme_status='classified' AND typequ_gamme IS NOT NULL AND typequ_gamme<>'Hors Gamme'))), FALSE)),
  identity jsonb NOT NULL, n_addresses bigint NOT NULL CHECK(n_addresses>=0),
  n_observed bigint NOT NULL CHECK(n_observed>=0 AND n_observed<=n_addresses),
  coverage_status text NOT NULL, measures jsonb NOT NULL,
  source_id text NOT NULL DEFAULT 'aedar_bretagne', vintage_id text NOT NULL DEFAULT '2026-v1',
  source_url text NOT NULL, licence text NOT NULL, attribution text NOT NULL,
  reference_date date, publication_date date,
  PRIMARY KEY(territory_type,territory_id,typequ)
);
CREATE INDEX aedar_territorial_aggregate_typequ_idx ON aedar_territorial_aggregate(territory_type,typequ);
GRANT SELECT ON aedar_territorial_aggregate,table_publication TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON aedar_territorial_aggregate,table_publication TO lusk_publisher;

-- Fixed-context AEDAR comparison projection; one row per declared measure.
CREATE TABLE aedar_comparison_publication (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), content_version text NOT NULL CHECK(content_version ~ '^[0-9a-f]{64}$'),
  source_snapshot_id text NOT NULL CHECK(source_snapshot_id='2026-v1'),
  aedar_content_version text NOT NULL, reference_content_version text NOT NULL,
  input_content_version text NOT NULL CHECK(input_content_version ~ '^[0-9a-f]{64}$'),
  input_identity jsonb NOT NULL CHECK(jsonb_typeof(input_identity)='object'),
  group_row_count bigint NOT NULL CHECK(group_row_count>=0), territory_row_count bigint NOT NULL CHECK(territory_row_count>=0),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE aedar_comparison_group (
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
CREATE TABLE aedar_comparison_territory (
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
CREATE FUNCTION check_aedar_comparison_publication() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE CONSTRAINT TRIGGER aedar_comparison_publication_contract AFTER INSERT OR UPDATE ON aedar_comparison_publication
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_aedar_comparison_publication();
