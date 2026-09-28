-- Applied to the Pi's lusk database on 2026-09-28 after the publisher received
-- REFERENCES (territory_id) on territory_reference; do not apply a second time.
-- Keep dataset_publication and its rows untouched for rollback/legacy clients.
CREATE TABLE IF NOT EXISTS table_publication (
    table_name text PRIMARY KEY CHECK (table_name IN (
        'territory_reference', 'service_registry', 'essential_service_access',
        'building_ramp', 'building_grid')),
    content_version text NOT NULL,
    row_count integer NOT NULL CHECK (row_count >= 0),
    published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS access_publication_metadata (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    bretagne_kind text NOT NULL,
    bretagne_label text NOT NULL
);

-- Preserve the currently served access version and its validated descriptor.
-- Existing legacy building_access is intentionally not converted: the new
-- building reader stays unavailable until each physical table is published.
INSERT INTO table_publication (table_name, content_version, row_count, published_at)
SELECT 'essential_service_access', publication_id, row_count, imported_at
FROM dataset_publication WHERE dataset_key = 'essential_service_access'
ON CONFLICT (table_name) DO NOTHING;
INSERT INTO access_publication_metadata (singleton, bretagne_kind, bretagne_label)
SELECT true, bretagne_kind, bretagne_label FROM dataset_publication
WHERE dataset_key = 'essential_service_access'
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE building_ramp (
    territory_id text NOT NULL REFERENCES territory_reference(territory_id),
    territory_type text NOT NULL CHECK (territory_type = 'commune'),
    availability text NOT NULL CHECK (availability IN ('complete', 'absent')),
    mode text NOT NULL CHECK (mode IN ('c', 'b', 't')),
    quantile_index smallint NOT NULL CHECK (quantile_index BETWEEN -1 AND 10),
    quantile double precision,
    accessible_types double precision,
    total_buildings integer NOT NULL CHECK (total_buildings >= 0),
    source_id text NOT NULL,
    source_version text NOT NULL,
    effective_direction text NOT NULL CHECK (effective_direction IN ('high', 'low')),
    PRIMARY KEY (territory_id, mode, quantile_index),
    CHECK ((availability = 'absent' AND quantile_index = -1 AND quantile IS NULL
            AND accessible_types IS NULL AND total_buildings = 0)
        OR (availability = 'complete' AND quantile_index >= 0 AND quantile IS NOT NULL
            AND accessible_types IS NOT NULL AND total_buildings > 0))
);

CREATE TABLE building_grid (
    territory_id text NOT NULL REFERENCES territory_reference(territory_id),
    territory_type text NOT NULL CHECK (territory_type = 'commune'),
    availability text NOT NULL CHECK (availability IN ('complete', 'absent')),
    mode text NOT NULL CHECK (mode = 't'),
    cell_index smallint NOT NULL CHECK (cell_index BETWEEN -1 AND 29),
    breadth_bucket text,
    depth_bucket text,
    building_count integer,
    total_buildings integer NOT NULL CHECK (total_buildings >= 0),
    source_id text NOT NULL,
    source_version text NOT NULL,
    PRIMARY KEY (territory_id, cell_index),
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
           WHERE t.territory_type = 'commune'
             AND (NOT EXISTS (SELECT 1 FROM building_ramp r WHERE r.territory_id = t.territory_id)
                  OR NOT EXISTS (SELECT 1 FROM building_grid g WHERE g.territory_id = t.territory_id))
       ) THEN
        RAISE EXCEPTION 'incomplete building-access dataset';
    END IF;
END $$;

GRANT SELECT ON TABLE building_ramp, building_grid TO lusk_reader;
GRANT SELECT ON TABLE table_publication, access_publication_metadata TO lusk_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE building_ramp, building_grid TO lusk_publisher;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE table_publication, access_publication_metadata TO lusk_publisher;
GRANT EXECUTE ON FUNCTION assert_building_dataset_complete(integer, integer) TO lusk_publisher;
