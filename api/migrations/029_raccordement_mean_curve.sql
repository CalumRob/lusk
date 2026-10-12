-- #728: 017 already belongs to the source-absence migration. Keep this
-- additive migration after the existing numbered sequence; never replace 017.
BEGIN;

ALTER TABLE series_dataset_descriptor
  DROP CONSTRAINT IF EXISTS series_dataset_descriptor_comparison_statistic_check,
  DROP CONSTRAINT IF EXISTS series_dataset_descriptor_comparison_scope_check;
ALTER TABLE series_dataset_descriptor
  ADD CONSTRAINT series_comparison_contract CHECK (
    (comparison_statistic IS NULL AND comparison_scope IS NULL) OR
    (comparison_statistic='median' AND comparison_scope='default_group') OR
    (indicator_id='raccordement_courbe' AND axis_kind='duration_minute' AND completeness='dense_complete' AND
      comparison_statistic='mean' AND comparison_scope='selected_group' AND
      cardinality(axis_values)=73 AND axis_numeric_values[1]=0 AND axis_numeric_values[73]=360)
  );

CREATE FUNCTION validate_raccordement_mean_axis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.comparison_statistic='mean' AND NEW.indicator_id='raccordement_courbe' AND
     (NEW.axis_kind<>'duration_minute' OR NEW.axis_numeric_values IS DISTINCT FROM ARRAY(SELECT generate_series(0,360,5))) THEN
    RAISE EXCEPTION 'national raccordement mean contract requires the complete 0..360 minute grid by five';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER series_raccordement_mean_axis BEFORE INSERT OR UPDATE ON series_dataset_descriptor
  FOR EACH ROW EXECUTE FUNCTION validate_raccordement_mean_axis();

COMMIT;
