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
COMMIT;
