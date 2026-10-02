-- Expand only. Existing structure_age coordinates and publication remain intact.
ALTER TABLE profile_descriptor
  ALTER COLUMN comparison_detail DROP NOT NULL,
  ALTER COLUMN comparison_sex DROP NOT NULL,
  ADD COLUMN theme_id text CHECK (theme_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  ADD COLUMN comparison_scalar text,
  ADD COLUMN required_scalar_version text,
  ADD CONSTRAINT profile_comparison_contract CHECK (
    (comparison_scalar IS NULL AND required_scalar_version IS NULL AND comparison_detail IS NOT NULL)
    OR (comparison_scalar IS NOT NULL AND comparison_scalar ~ '^[a-z][a-z0-9_]{0,95}$' AND comparison_detail IS NULL AND comparison_sex IS NULL
        AND required_scalar_version IS NOT NULL AND length(required_scalar_version)>0));
ALTER TABLE profile_observation
  ALTER COLUMN sex_axis_name DROP NOT NULL,
  ADD CONSTRAINT profile_optional_sex_coordinate CHECK (
    (sex_key='' AND sex_axis_name IS NULL) OR (sex_key<>'' AND sex_axis_name='sex' AND sex_axis_name IS NOT NULL));
CREATE OR REPLACE FUNCTION assert_profile_territory_level() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profile_descriptor d WHERE d.indicator_id=NEW.indicator_id
      AND NEW.territory_type=ANY(d.allowed_levels)) OR NOT EXISTS (
      SELECT 1 FROM territory_reference t WHERE t.territory_id=NEW.territory_id AND t.territory_type=NEW.territory_type) THEN
    RAISE EXCEPTION 'profile descriptor/territory level mismatch';
  END IF;
  IF (NEW.sex_axis_name IS NOT NULL) <> EXISTS (
      SELECT 1 FROM profile_axis a WHERE a.indicator_id=NEW.indicator_id AND a.axis_name='sex') THEN
    RAISE EXCEPTION 'profile second axis mismatch';
  END IF;
  RETURN NEW;
END $$;
