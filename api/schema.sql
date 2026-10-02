-- Fresh serving schema. Do not apply over the legacy versioned schema: use the
-- explicit operator migration procedure in README-deploy.md instead.
CREATE TABLE table_publication (
    table_name text PRIMARY KEY CHECK (table_name IN (
        'territory_reference', 'service_registry', 'essential_service_access',
        'building_ramp', 'building_grid', 'scalar_observation', 'declared_profile', 'ordered_series')),
    content_version text NOT NULL,
    row_count integer NOT NULL CHECK (row_count >= 0),
    reference_content_version text,
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shared_fact_publication_requires_reference
      CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series') OR reference_content_version IS NOT NULL)
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
 dataset_id text NOT NULL REFERENCES series_dataset_publication(dataset_id) ON DELETE CASCADE,
 indicator_id text NOT NULL CHECK(indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
 axis_kind text NOT NULL CHECK(axis_kind IN ('year','state_role','declared_detail')),
 axis_values text[] NOT NULL CHECK(cardinality(axis_values)>0),
 completeness text NOT NULL CHECK(completeness IN ('dense_complete','may_be_missing')),
 comparison_point text, label text NOT NULL, unit text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('high','low','none')),
 allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
 descriptor_version text NOT NULL, PRIMARY KEY(dataset_id,indicator_id),
 CHECK(comparison_point IS NULL OR (comparison_point=ANY(axis_values) AND direction IN ('high','low'))),
 CHECK(comparison_point IS NOT NULL OR direction='none'));
CREATE TABLE series_dataset_observation (
 dataset_id text NOT NULL, indicator_id text NOT NULL,
 territory_id text NOT NULL REFERENCES territory_reference(territory_id),
 territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
 axis_value text NOT NULL, state_role text CHECK(state_role IS NULL OR state_role IN ('M2','M3')),
 observation_period text NOT NULL, value double precision,
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
GRANT SELECT ON series_provenance_revision,series_dataset_publication,series_dataset_descriptor,series_dataset_observation,series_observation_provenance TO lusk_reader;
GRANT SELECT,INSERT ON series_provenance_revision TO lusk_publisher;
 GRANT SELECT,INSERT,UPDATE,DELETE ON series_dataset_publication,series_dataset_descriptor,series_dataset_observation,series_observation_provenance TO lusk_publisher;
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
 IF EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=NEW.dataset_id
   AND o.indicator_id=NEW.indicator_id AND NOT o.axis_value=ANY(NEW.axis_values)) THEN
   RAISE EXCEPTION 'series dataset descriptor excludes published observations';
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
 IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id
   AND d.axis_kind='declared_detail' AND EXISTS(SELECT 1 FROM series_dataset_observation o
     WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id
     GROUP BY o.territory_id HAVING count(DISTINCT o.state_role)<>2)) THEN
   RAISE EXCEPTION 'declared-detail publication must contain both canonical state roles per territory';
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
