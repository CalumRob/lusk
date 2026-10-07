BEGIN;

-- Keep validation transaction-safe without transaction-state caching: fact
-- changes validate their OLD and NEW territory partitions; descriptor/axis
-- changes validate the complete publication.
CREATE OR REPLACE FUNCTION assert_bpe_profile_evidence_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer; axis_count integer; territory record; bad boolean; partition_rows integer;
BEGIN
  SELECT universe_count INTO expected FROM bpe_profile_evidence_descriptor WHERE singleton;
  IF expected IS NULL THEN RAISE EXCEPTION 'BPE profile evidence descriptor is unavailable'; END IF;
  SELECT count(*) INTO axis_count FROM bpe_profile_class_axis;
  IF axis_count <> 4 THEN RAISE EXCEPTION 'BPE evidence requires exactly four declared class axes'; END IF;
  IF TG_TABLE_NAME <> 'bpe_profile_evidence' THEN
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

CREATE CONSTRAINT TRIGGER bpe_profile_descriptor_complete AFTER INSERT OR UPDATE OR DELETE ON bpe_profile_evidence_descriptor
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_bpe_profile_evidence_complete();
CREATE CONSTRAINT TRIGGER bpe_profile_class_axis_complete AFTER INSERT OR UPDATE OR DELETE ON bpe_profile_class_axis
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_bpe_profile_evidence_complete();

COMMIT;
