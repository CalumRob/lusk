-- Source absence is distinct from an unpublished/incomplete serving family.
-- Existing descriptors retain their current fail-closed unavailable behavior.
BEGIN;
ALTER TABLE series_dataset_descriptor ADD COLUMN absence_semantics text NOT NULL
  DEFAULT 'unavailable' CHECK (absence_semantics IN ('unavailable','no_record'));
ALTER TABLE series_dataset_descriptor ADD CONSTRAINT series_absence_contract
  CHECK (absence_semantics <> 'no_record' OR completeness='may_be_missing');
ALTER TABLE series_dataset_descriptor ADD COLUMN comparison_levels text[];
ALTER TABLE series_dataset_descriptor ADD CONSTRAINT series_comparison_levels_contract
  CHECK (comparison_levels IS NULL OR
    (cardinality(comparison_levels)>0 AND comparison_levels <@ allowed_levels));
CREATE TABLE series_context_parent_policy (
  dataset_id text NOT NULL, indicator_id text NOT NULL,
  focal_level text NOT NULL, parent_level text NOT NULL,
  PRIMARY KEY(dataset_id,indicator_id,focal_level),
  FOREIGN KEY(dataset_id,indicator_id) REFERENCES series_dataset_descriptor(dataset_id,indicator_id) ON DELETE CASCADE,
  CHECK ((focal_level='commune' AND parent_level='epci') OR
    (focal_level IN ('epci','departement') AND parent_level='region')));
CREATE TRIGGER series_context_parent_policy_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_context_parent_policy
  FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
GRANT SELECT ON series_context_parent_policy TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON series_context_parent_policy TO lusk_publisher;
COMMIT;
