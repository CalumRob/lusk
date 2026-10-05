BEGIN;

-- Keep the full publication checks from migration 016, but avoid running
-- their table-wide scans once for every deferred row-trigger event.
CREATE OR REPLACE FUNCTION assert_bpe_profile_evidence_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer; bad boolean;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('bpe-profile-validation:' || pg_current_xact_id()::text, 0)) THEN
    RETURN NULL;
  END IF;
  SELECT universe_count INTO expected FROM bpe_profile_evidence_descriptor WHERE singleton;
  IF expected IS NULL THEN RAISE EXCEPTION 'BPE profile evidence descriptor is unavailable'; END IF;
  IF (SELECT count(*) FROM bpe_profile_class_axis) <> 4 THEN
    RAISE EXCEPTION 'BPE evidence requires exactly four declared class axes';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM territory_reference t
    WHERE EXISTS (SELECT 1 FROM bpe_profile_evidence e WHERE e.territory_id=t.territory_id AND e.territory_type=t.territory_type)
      AND (SELECT count(*) FROM bpe_profile_evidence e WHERE e.territory_id=t.territory_id AND e.territory_type=t.territory_type) <>
          (SELECT count(*) FROM bpe_profile_class_axis)
  ) INTO bad;
  IF bad THEN RAISE EXCEPTION 'BPE profile evidence is not dense over declared class axes'; END IF;
  IF EXISTS (SELECT 1 FROM bpe_profile_evidence GROUP BY territory_type,territory_id
             HAVING sum(class_count)<>expected OR min(universe_count)<>expected OR max(universe_count)<>expected)
  THEN RAISE EXCEPTION 'BPE profile evidence universe/count partition is incomplete'; END IF;
  IF EXISTS (SELECT 1 FROM bpe_profile_evidence e JOIN bpe_profile_class_axis a USING(class_key)
             WHERE e.class_label<>a.label)
  THEN RAISE EXCEPTION 'BPE fact class labels differ from the declared class axis'; END IF;
  RETURN NULL;
END $$;

COMMIT;
