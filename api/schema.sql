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
    source_id text NOT NULL REFERENCES source_dataset(source_id),
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
    source_id text NOT NULL,
    vintage_id text NOT NULL,
    PRIMARY KEY (indicator_id, territory_id),
    FOREIGN KEY (source_id, vintage_id) REFERENCES source_vintage(source_id, vintage_id),
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
    FOREIGN KEY (source_id, vintage_id) REFERENCES source_vintage(source_id, vintage_id)
);
CREATE FUNCTION assert_scalar_source_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM scalar_observation_source s WHERE
   s.indicator_id=NEW.indicator_id AND s.territory_id=NEW.territory_id
   AND s.source_id=NEW.source_id AND s.vintage_id=NEW.vintage_id) THEN
   RAISE EXCEPTION 'scalar observation lacks its declared source-vintage link';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER scalar_observation_source_required
AFTER INSERT OR UPDATE ON scalar_observation DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_scalar_source_link();
CREATE FUNCTION assert_scalar_levels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scalar_descriptor d
    WHERE d.indicator_id = NEW.indicator_id AND NEW.territory_type = ANY(d.allowed_levels)
      AND d.source_id = NEW.source_id)
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
   AND (o.source_id <> NEW.source_id OR NOT (o.territory_type = ANY(NEW.allowed_levels)))) THEN
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
    CHECK ((availability = 'absent' AND cell_index = -1 AND breadth_bucket IS NULL
            AND depth_bucket IS NULL AND building_count IS NULL AND total_buildings = 0)
        OR (availability = 'complete' AND cell_index >= 0 AND breadth_bucket IS NOT NULL
            AND depth_bucket IS NOT NULL AND building_count >= 0 AND total_buildings > 0))
);

CREATE FUNCTION assert_building_dataset_complete(expected_ramp integer, expected_grid integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF expected_ramp <> (SELECT count(*) FROM building_ramp)
       OR expected_grid <> (SELECT count(*) FROM building_grid)
       OR EXISTS (
           SELECT 1 FROM territory_reference t
             WHERE NOT EXISTS (SELECT 1 FROM building_ramp r WHERE r.territory_type = t.territory_type AND r.territory_id = t.territory_id)
                    OR NOT EXISTS (SELECT 1 FROM building_grid g WHERE g.territory_type = t.territory_type AND g.territory_id = t.territory_id)
       ) THEN
        RAISE EXCEPTION 'incomplete building-access dataset';
    END IF;
END $$;

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
