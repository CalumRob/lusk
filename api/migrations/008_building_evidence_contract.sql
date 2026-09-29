-- Additive common descriptor/provenance contract for dedicated building grains.
-- Apply only through the reviewed serial DB migration procedure; never on Pi here.
BEGIN;
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
ALTER TABLE building_ramp ADD CONSTRAINT building_ramp_source_vintage_fk
  FOREIGN KEY(source_id,source_version) REFERENCES source_vintage(source_id,vintage_id) NOT VALID;
ALTER TABLE building_grid ADD CONSTRAINT building_grid_source_vintage_fk
  FOREIGN KEY(source_id,source_version) REFERENCES source_vintage(source_id,vintage_id) NOT VALID;
-- NOT VALID preserves the existing published facts during expand. It still
-- enforces every new/updated row. After canonical source/vintage backfill and
-- operator verification that all historical rows resolve, validate both:
--   ALTER TABLE building_ramp VALIDATE CONSTRAINT building_ramp_source_vintage_fk;
--   ALTER TABLE building_grid VALIDATE CONSTRAINT building_grid_source_vintage_fk;
CREATE FUNCTION assert_building_fact_source() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER building_ramp_source_declared BEFORE INSERT OR UPDATE ON building_ramp
  FOR EACH ROW EXECUTE FUNCTION assert_building_fact_source();
CREATE TRIGGER building_grid_source_declared BEFORE INSERT OR UPDATE ON building_grid
  FOR EACH ROW EXECUTE FUNCTION assert_building_fact_source();

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

CREATE OR REPLACE FUNCTION assert_building_dataset_complete(expected_ramp integer, expected_grid integer)
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

GRANT SELECT ON building_evidence_descriptor, building_evidence_descriptor_source TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON building_evidence_descriptor,
  building_evidence_descriptor_source TO lusk_publisher;
COMMIT;
