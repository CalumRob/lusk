-- Correct 008's exact float comparison after an R ramp publication failed.
-- Execute only on the intended serving schema after confirming 008 is installed.
-- No table/marker changes; the existing building triggers retain this function.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF to_regprocedure('assert_building_fact_source()') IS NULL
     OR to_regclass('building_evidence_descriptor') IS NULL THEN
    RAISE EXCEPTION '010 requires the installed building evidence contract';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION assert_building_fact_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE serving_table text; descriptor jsonb; expected_quantile jsonb;
  breadth_ordinal integer; depth_ordinal integer; expected_cell_index integer;
BEGIN
  serving_table := CASE WHEN TG_TABLE_NAME='building_ramp' THEN 'building_ramp' ELSE 'building_grid' END;
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
COMMIT;
