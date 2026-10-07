-- Fresh serving schema. Do not apply over the legacy versioned schema: use the
-- explicit operator migration procedure in README-deploy.md instead.
CREATE TABLE table_publication (
    table_name text PRIMARY KEY CHECK (table_name IN (
        'territory_reference', 'service_registry', 'essential_service_access',
        'building_ramp', 'building_grid', 'scalar_observation', 'declared_profile', 'ordered_series', 'demographic_typed_reading','selected_reading','bpe_profile_evidence','economy_typed_reading','economy_activity_evidence','milieux_typed_reading','milieux_reading_absence','mobility_typed_reading','mobility_density_distribution')),
    content_version text NOT NULL,
    row_count integer NOT NULL CHECK (row_count >= 0),
    reference_content_version text,
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shared_fact_publication_requires_reference
      CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading','bpe_profile_evidence','economy_typed_reading','economy_activity_evidence','milieux_typed_reading','milieux_reading_absence','mobility_typed_reading','mobility_density_distribution') OR reference_content_version IS NOT NULL)
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

-- The access descriptor is part of the validated access publication, not a
-- renderer constant. It is updated atomically with the access table marker.
CREATE TABLE access_publication_metadata (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    bretagne_kind text NOT NULL,
    bretagne_label text NOT NULL
);

CREATE TABLE territory_reference (
    territory_id text PRIMARY KEY,
    territory_type text NOT NULL,
    name text NOT NULL,
    department_id text,
    epci_id text,
    density_class_code text,
    density_class_label text
);
-- BPE evidence is neither an ordinary median-profile nor raw TYPEQU matrix.
-- Four closed class rows carry producer-selected bounded exemplars; the actual
-- registered TYPEQU universe and its identity are kept with this publication.
CREATE TABLE bpe_profile_evidence_descriptor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  indicator_id text NOT NULL UNIQUE CHECK(indicator_id='bpe_access_profile'),
  descriptor_version text NOT NULL,
  allowed_levels text[] NOT NULL CHECK(allowed_levels=ARRAY['commune','epci','departement','region']::text[]),
  completeness text NOT NULL CHECK(completeness='dense_complete'), classification_id text NOT NULL CHECK(length(trim(classification_id))>0),
  universe_count integer NOT NULL CHECK(universe_count>0), universe_sha256 text NOT NULL CHECK(universe_sha256 ~ '^[0-9a-f]{64}$'),
  registry_filename text NOT NULL CHECK(length(trim(registry_filename))>0), registry_semantic_effect text NOT NULL CHECK(length(trim(registry_semantic_effect))>0),
  membership_sha256 text NOT NULL CHECK(membership_sha256 ~ '^[0-9a-f]{64}$'),
  source_id text NOT NULL REFERENCES source_dataset(source_id), vintage_id text NOT NULL,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);
CREATE TABLE bpe_profile_class_axis (
  class_key text PRIMARY KEY CHECK(class_key ~ '^[a-z][a-z0-9-]{0,63}$'), label text NOT NULL CHECK(length(trim(label))>0),
  ordinal smallint NOT NULL UNIQUE CHECK(ordinal>=0), direction text NOT NULL CHECK(direction IN ('high','low','none'))
);
CREATE TABLE bpe_profile_evidence (
  territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  class_key text NOT NULL REFERENCES bpe_profile_class_axis(class_key), class_label text NOT NULL,
  class_count integer NOT NULL CHECK(class_count>=0), universe_count integer NOT NULL CHECK(universe_count>0),
  exemplar_typequ text, exemplar_label text, exemplar_c double precision, exemplar_b double precision, exemplar_t double precision,
  PRIMARY KEY(territory_type,territory_id,class_key), FOREIGN KEY(territory_id) REFERENCES territory_reference(territory_id),
  CHECK((class_count=0 AND exemplar_typequ IS NULL AND exemplar_label IS NULL AND exemplar_c IS NULL AND exemplar_b IS NULL AND exemplar_t IS NULL) OR
        (class_count>0 AND exemplar_typequ ~ '^[A-Z][0-9]{3}$' AND exemplar_label IS NOT NULL AND exemplar_c BETWEEN 0 AND 1 AND exemplar_b BETWEEN 0 AND 1 AND exemplar_t BETWEEN 0 AND 1)),
  CHECK(universe_count>=class_count)
);
CREATE TABLE bpe_profile_evidence_source (
  territory_type text NOT NULL, territory_id text NOT NULL, class_key text NOT NULL, source_id text NOT NULL, vintage_id text NOT NULL,
  PRIMARY KEY(territory_type,territory_id,class_key,source_id,vintage_id),
  FOREIGN KEY(territory_type,territory_id,class_key) REFERENCES bpe_profile_evidence(territory_type,territory_id,class_key) ON DELETE CASCADE,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);
CREATE FUNCTION assert_bpe_profile_evidence_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer; axis_count integer; territory record; bad boolean; partition_rows integer;
BEGIN
  SELECT universe_count INTO expected FROM bpe_profile_evidence_descriptor WHERE singleton;
  IF expected IS NULL THEN RAISE EXCEPTION 'BPE profile evidence descriptor is unavailable'; END IF;
  SELECT count(*) INTO axis_count FROM bpe_profile_class_axis;
  IF axis_count <> 4 THEN
    RAISE EXCEPTION 'BPE evidence requires exactly four declared class axes';
  END IF;
  IF TG_TABLE_NAME <> 'bpe_profile_evidence' THEN
    -- Descriptor and class-axis edits are rare; validate the whole snapshot
    -- when those metadata rows change.
    SELECT EXISTS (
      SELECT 1 FROM bpe_profile_evidence e
      GROUP BY e.territory_type,e.territory_id
      HAVING count(*) <> axis_count OR sum(e.class_count) <> expected
          OR min(e.universe_count) <> expected OR max(e.universe_count) <> expected
    ) INTO bad;
    IF bad THEN RAISE EXCEPTION 'BPE profile evidence universe/count partition is incomplete'; END IF;
    IF EXISTS (SELECT 1 FROM bpe_profile_evidence e JOIN bpe_profile_class_axis a USING(class_key)
               WHERE e.class_label<>a.label)
    THEN RAISE EXCEPTION 'BPE fact class labels differ from the declared class axis'; END IF;
  ELSE
    -- Fact events are checked only against their affected territory group(s).
    -- The primary key starts with (territory_type, territory_id), making this
    -- bounded to the four rows that form one declared profile.
    FOR territory IN
      SELECT DISTINCT territory_type,territory_id FROM (
        SELECT CASE WHEN TG_OP='DELETE' THEN OLD.territory_type ELSE NEW.territory_type END AS territory_type,
               CASE WHEN TG_OP='DELETE' THEN OLD.territory_id ELSE NEW.territory_id END AS territory_id
        UNION ALL
        SELECT OLD.territory_type,OLD.territory_id WHERE TG_OP='UPDATE'
      ) affected
    LOOP
      SELECT count(*) INTO partition_rows FROM bpe_profile_evidence
        WHERE territory_type=territory.territory_type AND territory_id=territory.territory_id;
      -- An eligible territory can leave the source universe entirely during
      -- replacement; its complete removal is valid. Any surviving partition
      -- must still be dense and a complete source-universe partition.
      IF partition_rows = 0 THEN CONTINUE; END IF;
      SELECT count(*) <> axis_count OR coalesce(sum(class_count),0) <> expected
          OR min(universe_count) <> expected OR max(universe_count) <> expected
        INTO bad FROM bpe_profile_evidence
        WHERE territory_type=territory.territory_type AND territory_id=territory.territory_id;
      IF bad THEN RAISE EXCEPTION 'BPE profile evidence is not dense or its universe/count partition is incomplete'; END IF;
      IF EXISTS (SELECT 1 FROM bpe_profile_evidence e JOIN bpe_profile_class_axis a USING(class_key)
                 WHERE e.territory_type=territory.territory_type AND e.territory_id=territory.territory_id
                   AND e.class_label<>a.label)
      THEN RAISE EXCEPTION 'BPE fact class labels differ from the declared class axis'; END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bpe_profile_evidence_complete AFTER INSERT OR UPDATE OR DELETE ON bpe_profile_evidence
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_bpe_profile_evidence_complete();
CREATE CONSTRAINT TRIGGER bpe_profile_descriptor_complete AFTER INSERT OR UPDATE OR DELETE ON bpe_profile_evidence_descriptor
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_bpe_profile_evidence_complete();
CREATE CONSTRAINT TRIGGER bpe_profile_class_axis_complete AFTER INSERT OR UPDATE OR DELETE ON bpe_profile_class_axis
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_bpe_profile_evidence_complete();
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

CREATE TABLE service_registry (service text PRIMARY KEY);

CREATE TABLE building_evidence_descriptor (
    table_name text PRIMARY KEY CHECK (table_name IN ('building_ramp','building_grid')),
    descriptor_version text NOT NULL,
    contract jsonb NOT NULL CHECK (jsonb_typeof(contract)='object'),
    CHECK (COALESCE((table_name='building_ramp' AND contract->>'shape'='building_ramp'
            AND contract->>'peer_statistic'='building_count_weighted_mean'
            AND jsonb_array_length(contract->'territory_levels')=4
            AND jsonb_array_length(contract->'axes'->'mode')=3
            AND jsonb_array_length(contract->'axes'->'quantile')=11), false) OR
           COALESCE((table_name='building_grid' AND contract->>'shape'='building_grid'
            AND contract->>'peer_statistic'='pooled_building_counts'
            AND jsonb_array_length(contract->'territory_levels')=4
            AND jsonb_typeof(contract->'axes'->'mode')='string'
            AND jsonb_array_length(contract->'axes'->'breadth')=5
            AND jsonb_array_length(contract->'axes'->'depth')=6), false))
);
CREATE TABLE building_evidence_descriptor_source (
    table_name text NOT NULL REFERENCES building_evidence_descriptor(table_name) ON DELETE CASCADE,
    source_id text NOT NULL REFERENCES source_dataset(source_id),
    PRIMARY KEY(table_name,source_id)
);

CREATE TABLE essential_service_access (
    territory_id text NOT NULL REFERENCES territory_reference(territory_id),
    service text NOT NULL REFERENCES service_registry(service),
    mode text NOT NULL CHECK (mode IN ('walk_transit', 'bike', 'car')),
    share double precision CHECK (share IS NULL OR (share >= 0 AND share <= 1)),
    indicator_label text NOT NULL,
    effective_direction text NOT NULL CHECK (effective_direction IN ('high', 'low')),
    source_id text NOT NULL,
    source_name text NOT NULL,
    source_version text NOT NULL,
    reference_date date,
    source_publication_date date,
    PRIMARY KEY (territory_id, service, mode)
);

CREATE INDEX essential_service_access_territory_lookup
    ON essential_service_access (territory_id, service);

-- The two building grains share territory_reference. -1 represents an explicit
-- absent sentinel, never a missing member or a measured zero.
CREATE TABLE building_ramp (
    territory_id text NOT NULL REFERENCES territory_reference(territory_id),
    territory_type text NOT NULL CHECK (territory_type IN ('commune', 'epci', 'departement', 'region')),
    availability text NOT NULL CHECK (availability IN ('complete', 'absent')),
    mode text NOT NULL CHECK (mode IN ('c', 'b', 't')),
    quantile_index smallint NOT NULL CHECK (quantile_index BETWEEN -1 AND 10),
    quantile double precision,
    accessible_types double precision,
    total_buildings integer NOT NULL CHECK (total_buildings >= 0),
    source_id text NOT NULL,
    source_version text NOT NULL,
    effective_direction text NOT NULL CHECK (effective_direction IN ('high', 'low')),
    PRIMARY KEY (territory_type, territory_id, mode, quantile_index),
    FOREIGN KEY (source_id,source_version) REFERENCES source_vintage(source_id,vintage_id),
    CHECK ((availability = 'absent' AND quantile_index = -1 AND quantile IS NULL
            AND accessible_types IS NULL AND total_buildings = 0)
        OR (availability = 'complete' AND quantile_index >= 0 AND quantile IS NOT NULL
            AND accessible_types IS NOT NULL AND total_buildings > 0))
);

CREATE TABLE building_grid (
    territory_id text NOT NULL REFERENCES territory_reference(territory_id),
    territory_type text NOT NULL CHECK (territory_type IN ('commune', 'epci', 'departement', 'region')),
    availability text NOT NULL CHECK (availability IN ('complete', 'absent')),
    mode text NOT NULL CHECK (mode = 't'),
    cell_index smallint NOT NULL CHECK (cell_index BETWEEN -1 AND 29),
    breadth_bucket text,
    depth_bucket text,
    building_count integer,
    total_buildings integer NOT NULL CHECK (total_buildings >= 0),
    source_id text NOT NULL,
    source_version text NOT NULL,
    PRIMARY KEY (territory_type, territory_id, cell_index),
    FOREIGN KEY (source_id,source_version) REFERENCES source_vintage(source_id,vintage_id),
    CHECK ((availability = 'absent' AND cell_index = -1 AND breadth_bucket IS NULL
            AND depth_bucket IS NULL AND building_count IS NULL AND total_buildings = 0)
        OR (availability = 'complete' AND cell_index >= 0 AND breadth_bucket IS NOT NULL
            AND depth_bucket IS NOT NULL AND building_count >= 0 AND total_buildings > 0))
);

CREATE FUNCTION assert_building_fact_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE serving_table text; descriptor jsonb; expected_quantile jsonb;
  breadth_ordinal integer; depth_ordinal integer; expected_cell_index integer;
BEGIN
  serving_table := TG_TABLE_NAME;
  SELECT contract INTO descriptor FROM building_evidence_descriptor WHERE table_name=serving_table;
  IF descriptor IS NULL THEN RAISE EXCEPTION 'building fact descriptor is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM building_evidence_descriptor_source s
      WHERE s.table_name=serving_table AND s.source_id=NEW.source_id) THEN
    RAISE EXCEPTION 'building fact source is not declared by its descriptor';
  END IF;
  IF NOT COALESCE(descriptor->'territory_levels' ? NEW.territory_type, false) THEN
    RAISE EXCEPTION 'building fact territory level is not descriptor-eligible';
  END IF;
  IF serving_table='building_ramp' AND NEW.availability='complete' THEN
    expected_quantile := descriptor->'axes'->'quantile'->(NEW.quantile_index::integer);
    IF NOT COALESCE(descriptor->'axes'->'mode' ? NEW.mode, false)
       OR expected_quantile IS NULL OR expected_quantile = 'null'::jsonb
       -- R can emit 0.30000000000000004 for the declared 0.3 position.
       OR NOT COALESCE(abs(NEW.quantile - (expected_quantile #>> '{}')::double precision) <= 1e-12, false)
       OR NEW.effective_direction IS DISTINCT FROM (descriptor->>'direction') THEN
      RAISE EXCEPTION 'ramp point is outside its declared axes';
    END IF;
  ELSIF serving_table='building_grid' AND NEW.availability='complete' THEN
    IF NEW.mode IS DISTINCT FROM (descriptor->'axes'->>'mode') THEN
      RAISE EXCEPTION 'grid cell mode is outside its declared axes';
    END IF;
    SELECT axis.ordinality::integer INTO breadth_ordinal
      FROM jsonb_array_elements_text(descriptor->'axes'->'breadth')
        WITH ORDINALITY AS axis(value, ordinality)
      WHERE axis.value=NEW.breadth_bucket ORDER BY axis.ordinality LIMIT 1;
    SELECT axis.ordinality::integer INTO depth_ordinal
      FROM jsonb_array_elements_text(descriptor->'axes'->'depth')
        WITH ORDINALITY AS axis(value, ordinality)
      WHERE axis.value=NEW.depth_bucket ORDER BY axis.ordinality LIMIT 1;
    IF breadth_ordinal IS NULL OR depth_ordinal IS NULL THEN
      RAISE EXCEPTION 'grid cell is missing a declared breadth/depth axis';
    END IF;
    expected_cell_index := (breadth_ordinal - 1) * jsonb_array_length(descriptor->'axes'->'depth')
                           + depth_ordinal - 1;
    IF NEW.cell_index IS DISTINCT FROM expected_cell_index THEN
      RAISE EXCEPTION 'grid cell index does not match its declared breadth/depth pair';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER building_ramp_source_declared BEFORE INSERT OR UPDATE ON building_ramp
  FOR EACH ROW EXECUTE FUNCTION assert_building_fact_source();
CREATE TRIGGER building_grid_source_declared BEFORE INSERT OR UPDATE ON building_grid
  FOR EACH ROW EXECUTE FUNCTION assert_building_fact_source();

CREATE FUNCTION assert_building_dataset_complete(expected_ramp integer, expected_grid integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF expected_ramp <> (SELECT count(*) FROM building_ramp)
       OR expected_grid <> (SELECT count(*) FROM building_grid)
       OR EXISTS (SELECT 1 FROM territory_reference t WHERE
         (SELECT count(DISTINCT mode) FROM building_ramp r WHERE r.territory_type=t.territory_type AND r.territory_id=t.territory_id) <> 3
         OR EXISTS (SELECT 1 FROM building_ramp r WHERE r.territory_type=t.territory_type AND r.territory_id=t.territory_id
           GROUP BY r.territory_type,r.territory_id HAVING count(DISTINCT availability)<>1 OR count(DISTINCT total_buildings)<>1)
         OR EXISTS (SELECT 1 FROM building_ramp r WHERE r.territory_type=t.territory_type AND r.territory_id=t.territory_id
           GROUP BY r.mode HAVING NOT ((bool_and(availability='absent') AND count(*)=1)
             OR (bool_and(availability='complete') AND count(*)=11)))
         OR (SELECT count(*) FROM building_grid g WHERE g.territory_type=t.territory_type AND g.territory_id=t.territory_id
             AND g.availability='complete') NOT IN (0,30)
         OR (SELECT count(*) FROM building_grid g WHERE g.territory_type=t.territory_type AND g.territory_id=t.territory_id
             AND g.availability='absent') NOT IN (0,1)
         OR (SELECT count(*) FROM building_grid g WHERE g.territory_type=t.territory_type AND g.territory_id=t.territory_id) NOT IN (1,30)
         OR EXISTS (SELECT 1 FROM building_grid g WHERE g.territory_type=t.territory_type AND g.territory_id=t.territory_id
            AND g.availability='complete' GROUP BY g.territory_type,g.territory_id
            HAVING sum(g.building_count) <> min(g.total_buildings))) THEN
        RAISE EXCEPTION 'incomplete building-access dataset';
    END IF;
END $$;

CREATE FUNCTION assert_building_descriptor_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.table_name IN ('building_ramp','building_grid') AND
     NOT EXISTS (SELECT 1 FROM building_evidence_descriptor d
       JOIN building_evidence_descriptor_source s USING(table_name)
       WHERE d.table_name=NEW.table_name AND d.descriptor_version=NEW.content_version) THEN
    RAISE EXCEPTION 'building publication requires matching descriptor and source lineage';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER building_publication_descriptor
  AFTER INSERT OR UPDATE ON table_publication DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_building_descriptor_publication();

-- Called by the publisher inside the replacement transaction, before the
-- table_publication row is updated. The service list comes from metadata.
CREATE FUNCTION assert_current_dataset_complete(expected_rows integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM territory_reference)
       OR NOT EXISTS (SELECT 1 FROM service_registry)
       OR expected_rows <> (SELECT count(*) FROM essential_service_access)
       OR EXISTS (
           SELECT 1 FROM territory_reference t CROSS JOIN service_registry s
           LEFT JOIN essential_service_access a
             ON a.territory_id = t.territory_id AND a.service = s.service
           GROUP BY t.territory_id, s.service
           HAVING count(a.mode) <> 3
       ) THEN
        RAISE EXCEPTION 'incomplete essential-service dataset';
    END IF;
END $$;

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

-- Additive dataset-owned contract (migration 011). Legacy ordered_series
-- remains available for the ENAF reader during an explicit rollout.
CREATE TABLE series_provenance_revision (
 provenance_revision_id text PRIMARY KEY, source_id text NOT NULL, vintage_id text NOT NULL,
 source_name text NOT NULL, dataset_name text NOT NULL, source_version text NOT NULL,
 reference_date date NOT NULL, publication_date date NOT NULL, revision_hash text NOT NULL,
 UNIQUE(source_id,vintage_id,revision_hash));
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
  comparison_statistic text CHECK(comparison_statistic IS NULL OR comparison_statistic='median'),
  comparison_scope text CHECK(comparison_scope IS NULL OR comparison_scope='default_group'),
  observation_period_kind text CHECK(observation_period_kind IS NULL OR observation_period_kind IN ('snapshot_date','unknown')),
 direction text NOT NULL CHECK(direction IN ('high','low','none')),
 allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
 descriptor_version text NOT NULL, active_read_route boolean NOT NULL DEFAULT false,
 theme_id text,
 PRIMARY KEY(dataset_id,indicator_id),
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
CREATE TABLE mobility_density_distribution_descriptor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), descriptor_version text NOT NULL,
  source_id text NOT NULL CHECK(source_id='mobilite_snapshot'), vintage_id text NOT NULL,
  axis_count integer NOT NULL CHECK(axis_count>0),
  allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
  density_unit text NOT NULL CHECK(length(trim(density_unit))>0),
  decile_unit text NOT NULL CHECK(length(trim(decile_unit))>0),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE TABLE mobility_density_distribution_range (
  territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  minimum double precision, maximum double precision, status text NOT NULL CHECK(status IN ('measured','not_available','unsupported')),
  source_id text NOT NULL CHECK(source_id='mobilite_snapshot'), vintage_id text NOT NULL,
  PRIMARY KEY(territory_type,territory_id),
  FOREIGN KEY(territory_id) REFERENCES territory_reference(territory_id),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
  CHECK((status='measured' AND minimum IS NOT NULL AND maximum IS NOT NULL AND minimum<=maximum) OR
        (status<>'measured' AND minimum IS NULL AND maximum IS NULL)),
  CHECK(minimum IS NULL OR (minimum NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) AND minimum>=0)),
  CHECK(maximum IS NULL OR (maximum NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) AND maximum>=0)));
CREATE TABLE mobility_density_distribution_point (
  territory_id text NOT NULL, territory_type text NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0),
  density double precision, density_status text NOT NULL CHECK(density_status IN ('measured','not_available','unsupported')),
  decile double precision, decile_status text NOT NULL CHECK(decile_status IN ('measured','not_available','unsupported')),
  source_id text NOT NULL CHECK(source_id='mobilite_snapshot'), vintage_id text NOT NULL,
  PRIMARY KEY(territory_type,territory_id,ordinal),
  FOREIGN KEY(territory_type,territory_id) REFERENCES mobility_density_distribution_range(territory_type,territory_id) ON DELETE CASCADE,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
  CHECK((density_status='measured')=(density IS NOT NULL)), CHECK((decile_status='measured')=(decile IS NOT NULL)),
  CHECK(density IS NULL OR (density NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) AND density>=0)),
  CHECK(decile IS NULL OR decile NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)));
CREATE FUNCTION validate_mobility_density_distribution_territory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM territory_reference WHERE territory_id=NEW.territory_id AND territory_type=NEW.territory_type)
  THEN RAISE EXCEPTION 'Mobility density distribution territory type differs from reference'; END IF;
  IF NOT EXISTS(SELECT 1 FROM mobility_density_distribution_descriptor d WHERE d.singleton AND NEW.territory_type=ANY(d.allowed_levels))
  THEN RAISE EXCEPTION 'Mobility distribution territory level is outside its active descriptor'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mobility_density_distribution_territory_contract BEFORE INSERT OR UPDATE ON mobility_density_distribution_range
  FOR EACH ROW EXECUTE FUNCTION validate_mobility_density_distribution_territory();
CREATE FUNCTION assert_mobility_density_distribution_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer; territory text; territory_kind text; point_count integer; first_ordinal integer; last_ordinal integer;
  impacted_types text[]; impacted_ids text[]; i integer; BEGIN
  SELECT axis_count INTO expected FROM mobility_density_distribution_descriptor WHERE singleton;
  IF expected IS NULL THEN RAISE EXCEPTION 'Mobility density distribution descriptor is unavailable'; END IF;
  IF TG_OP='DELETE' THEN
    impacted_types:=ARRAY[OLD.territory_type]; impacted_ids:=ARRAY[OLD.territory_id];
  ELSIF TG_OP='UPDATE' AND (OLD.territory_type IS DISTINCT FROM NEW.territory_type OR OLD.territory_id IS DISTINCT FROM NEW.territory_id) THEN
    impacted_types:=ARRAY[OLD.territory_type,NEW.territory_type]; impacted_ids:=ARRAY[OLD.territory_id,NEW.territory_id];
  ELSE
    impacted_types:=ARRAY[NEW.territory_type]; impacted_ids:=ARRAY[NEW.territory_id];
  END IF;
  FOR i IN 1..array_length(impacted_types,1) LOOP
    territory_kind:=impacted_types[i]; territory:=impacted_ids[i];
    IF EXISTS(SELECT 1 FROM mobility_density_distribution_range r WHERE r.territory_type=territory_kind AND r.territory_id=territory) THEN
      SELECT count(*),min(ordinal),max(ordinal) INTO point_count,first_ordinal,last_ordinal FROM mobility_density_distribution_point p
        WHERE p.territory_type=territory_kind AND p.territory_id=territory;
      IF point_count<>expected OR first_ordinal<>0 OR last_ordinal<>expected-1
      THEN RAISE EXCEPTION 'Mobility density distribution axis is incomplete for %/%',territory_kind,territory; END IF;
    ELSIF EXISTS(SELECT 1 FROM mobility_density_distribution_point p WHERE p.territory_type=territory_kind AND p.territory_id=territory) THEN
      RAISE EXCEPTION 'Mobility density distribution has orphan coordinates for %/%',territory_kind,territory;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER mobility_density_distribution_points_complete AFTER INSERT OR UPDATE OR DELETE
  ON mobility_density_distribution_point DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_mobility_density_distribution_complete();
CREATE CONSTRAINT TRIGGER mobility_density_distribution_ranges_complete AFTER INSERT OR UPDATE OR DELETE
  ON mobility_density_distribution_range DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_mobility_density_distribution_complete();
GRANT SELECT ON mobility_density_distribution_descriptor,mobility_density_distribution_range,mobility_density_distribution_point TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON mobility_density_distribution_descriptor,mobility_density_distribution_range,mobility_density_distribution_point TO lusk_publisher;
