-- Migration 006 installed a three-level check not present in fresh schema.sql.
-- Remove that obsolete restriction: descriptor eligibility, the typed territory
-- reference FK and assert_profile_territory_level still constrain every fact.
-- No rows, publication markers, grants or indicator-route eligibility change.
BEGIN;
ALTER TABLE profile_observation
  DROP CONSTRAINT IF EXISTS profile_observation_territory_type_check;
COMMIT;
