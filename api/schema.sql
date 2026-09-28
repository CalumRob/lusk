-- Fresh serving schema. Do not apply over the legacy versioned schema: use the
-- explicit operator migration procedure in README-deploy.md instead.
CREATE TABLE table_publication (
    table_name text PRIMARY KEY CHECK (table_name IN (
        'territory_reference', 'service_registry', 'essential_service_access',
        'building_ramp', 'building_grid', 'scalar_observation')),
    content_version text NOT NULL,
    row_count integer NOT NULL CHECK (row_count >= 0),
    reference_content_version text,
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT scalar_publication_requires_reference
      CHECK (table_name <> 'scalar_observation' OR reference_content_version IS NOT NULL)
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
CREATE TABLE scalar_descriptor (
    indicator_id text PRIMARY KEY CHECK (indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
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
       OR NEW.quantile IS DISTINCT FROM (expected_quantile #>> '{}')::double precision
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
