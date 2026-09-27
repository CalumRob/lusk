-- Candidate migration; do not apply to the live service without an operator
-- review and a joint access + building artifact publication.
ALTER TABLE dataset_publication
    DROP CONSTRAINT dataset_publication_dataset_key_check;
ALTER TABLE dataset_publication
    ADD CONSTRAINT dataset_publication_dataset_key_check
    CHECK (dataset_key IN ('essential_service_access', 'building_access'));

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
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE building_ramp, building_grid TO lusk_publisher;
GRANT EXECUTE ON FUNCTION assert_building_dataset_complete(integer, integer) TO lusk_publisher;
