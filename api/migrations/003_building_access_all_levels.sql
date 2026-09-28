-- Expand canonical building facts from commune-only to every published level.
-- Apply after 002_building_access.sql; publisher refresh remains transactional.
BEGIN;

ALTER TABLE building_ramp DROP CONSTRAINT building_ramp_territory_type_check;
ALTER TABLE building_grid DROP CONSTRAINT building_grid_territory_type_check;
ALTER TABLE building_ramp ADD CONSTRAINT building_ramp_territory_type_check
    CHECK (territory_type IN ('commune', 'epci', 'departement', 'region'));
ALTER TABLE building_grid ADD CONSTRAINT building_grid_territory_type_check
    CHECK (territory_type IN ('commune', 'epci', 'departement', 'region'));

ALTER TABLE building_ramp DROP CONSTRAINT building_ramp_pkey;
ALTER TABLE building_grid DROP CONSTRAINT building_grid_pkey;
ALTER TABLE building_ramp ADD CONSTRAINT building_ramp_pkey
    PRIMARY KEY (territory_type, territory_id, mode, quantile_index);
ALTER TABLE building_grid ADD CONSTRAINT building_grid_pkey
    PRIMARY KEY (territory_type, territory_id, cell_index);

CREATE OR REPLACE FUNCTION assert_building_dataset_complete(expected_ramp integer, expected_grid integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF expected_ramp <> (SELECT count(*) FROM building_ramp)
       OR expected_grid <> (SELECT count(*) FROM building_grid)
       OR EXISTS (
            SELECT 1 FROM territory_reference t
            WHERE NOT EXISTS (
                SELECT 1 FROM building_ramp r
                WHERE r.territory_type = t.territory_type AND r.territory_id = t.territory_id)
               OR NOT EXISTS (
                SELECT 1 FROM building_grid g
                WHERE g.territory_type = t.territory_type AND g.territory_id = t.territory_id)
       ) THEN
        RAISE EXCEPTION 'incomplete building-access dataset';
    END IF;
END $$;

COMMIT;
