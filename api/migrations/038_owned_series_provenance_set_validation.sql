-- Migration 038: one set operation for owned-series focal provenance.
--
-- The publication-complete deferred trigger used a correlated NOT EXISTS per
-- observation row. On a freshly written, unanalyzed table that can plan as a
-- nested loop which rescans the dataset's provenance rows once per observation
-- row, so COMMIT work grows with the square of the publication (issue #804:
-- 11,283,605 tuple visits and ~13 s of COMMIT at 4,744 observations).
--
-- This migration replaces only validate_series_dataset_publication(), keeping
-- every other check, every error message, the marker row_count semantics and
-- the NEW.dataset_id scope. Focal provenance becomes one set difference over
-- the exact (dataset_id,indicator_id,territory_id,axis_value) key, which cannot
-- be rescanned per outer row and therefore does not depend on planner table
-- statistics.
--
-- Additive: no table, column, index, trigger or data change. Fresh installs
-- carry the same function body in api/schema.sql.

BEGIN;

CREATE OR REPLACE FUNCTION validate_series_dataset_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_rows bigint; actual_descriptors bigint; BEGIN
 SELECT (SELECT count(*) FROM series_dataset_observation WHERE dataset_id=NEW.dataset_id) +
        (SELECT count(*) FROM series_named_reference WHERE dataset_id=NEW.dataset_id) INTO actual_rows;
 SELECT count(*) INTO actual_descriptors FROM series_dataset_descriptor WHERE dataset_id=NEW.dataset_id;
 IF actual_rows<>NEW.row_count OR actual_descriptors=0 THEN
   RAISE EXCEPTION 'owned series marker does not match complete descriptor/observation snapshot';
 END IF;
 IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='duration_minute'
   AND (EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id AND NOT o.axis_value=ANY(d.axis_values))
     OR EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=d.dataset_id AND r.indicator_id=d.indicator_id AND NOT r.axis_value=ANY(d.axis_values)))) THEN
   RAISE EXCEPTION 'duration facts contain undeclared axis points';
 END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=NEW.dataset_id AND NOT EXISTS(
   SELECT 1 FROM series_named_reference_provenance p WHERE (p.dataset_id,p.indicator_id,p.reference_id,p.axis_value)=(r.dataset_id,r.indicator_id,r.reference_id,r.axis_value))) THEN
   RAISE EXCEPTION 'named reference observation is missing provenance association';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM table_publication t WHERE t.table_name='territory_reference'
   AND t.content_version=NEW.reference_content_version) THEN
   RAISE EXCEPTION 'owned series publication is bound to a stale territory reference';
 END IF;
 IF EXISTS(SELECT 1 FROM (
   SELECT o.dataset_id,o.indicator_id,o.territory_id,o.axis_value FROM series_dataset_observation o
     WHERE o.dataset_id=NEW.dataset_id
   EXCEPT
   SELECT p.dataset_id,p.indicator_id,p.territory_id,p.axis_value FROM series_observation_provenance p
     WHERE p.dataset_id=NEW.dataset_id) AS missing) THEN
   RAISE EXCEPTION 'owned series observation is missing provenance association';
 END IF;
 IF EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=NEW.dataset_id AND NOT EXISTS(
   SELECT 1 FROM series_named_reference_provenance p WHERE (p.dataset_id,p.indicator_id,p.reference_id,p.axis_value)=(r.dataset_id,r.indicator_id,r.reference_id,r.axis_value))) THEN
  RAISE EXCEPTION 'named reference observation is missing provenance association';
 END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id
    AND d.axis_kind='declared_detail' AND EXISTS(SELECT 1 FROM series_dataset_observation o
     WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id
     GROUP BY o.territory_id HAVING count(DISTINCT o.state_role)<>2)) THEN
    RAISE EXCEPTION 'declared-detail publication must contain both canonical state roles per territory';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=NEW.dataset_id AND r.indicator_id IN
    (SELECT indicator_id FROM series_dataset_descriptor WHERE dataset_id=NEW.dataset_id)
    AND NOT EXISTS(SELECT 1 FROM series_named_reference_descriptor d WHERE
      (d.dataset_id,d.indicator_id,d.reference_id)=(r.dataset_id,r.indicator_id,r.reference_id))) THEN
   RAISE EXCEPTION 'named reference fact has no declared reference identity';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.required
    AND NOT EXISTS(SELECT 1 FROM series_named_reference r WHERE
      (r.dataset_id,r.indicator_id,r.reference_id)=(d.dataset_id,d.indicator_id,d.reference_id))) THEN
    RAISE EXCEPTION 'required named reference is missing';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference_descriptor d WHERE d.dataset_id=NEW.dataset_id
    AND d.active_read_route AND NOT d.required) THEN
    RAISE EXCEPTION 'active analytical-reference route must be required';
  END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id
    AND d.axis_kind='duration_minute' AND d.active_read_route AND d.observation_period_kind='snapshot_date'
    AND (EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=d.dataset_id
       AND o.indicator_id=d.indicator_id AND o.observation_period !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      OR EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=d.dataset_id
       AND r.indicator_id=d.indicator_id AND r.observation_period !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))) THEN
    RAISE EXCEPTION 'duration snapshot-date observations must carry an ISO date period';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference_descriptor d JOIN series_dataset_descriptor s USING(dataset_id,indicator_id)
    WHERE d.dataset_id=NEW.dataset_id AND d.active_read_route
      AND (SELECT count(DISTINCT r.axis_value) FROM series_named_reference r WHERE
        (r.dataset_id,r.indicator_id,r.reference_id)=(d.dataset_id,d.indicator_id,d.reference_id)
        AND r.axis_value=ANY(s.axis_values))<>cardinality(s.axis_values)) THEN
    RAISE EXCEPTION 'active analytical-reference route is missing declared axis points';
  END IF;
  IF EXISTS(SELECT 1 FROM series_named_reference_descriptor d JOIN series_dataset_descriptor s USING(dataset_id,indicator_id)
    WHERE d.dataset_id=NEW.dataset_id AND d.required AND s.axis_kind='duration_minute'
      AND (SELECT count(DISTINCT r.axis_value) FROM series_named_reference r WHERE
        (r.dataset_id,r.indicator_id,r.reference_id)=(d.dataset_id,d.indicator_id,d.reference_id) AND r.axis_value=ANY(s.axis_values)
        )<>cardinality(s.axis_values)) THEN
   RAISE EXCEPTION 'required named reference is missing declared duration points';
  END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='duration_minute'
    AND d.completeness='dense_complete' AND EXISTS(SELECT 1 FROM series_dataset_observation o
      WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id GROUP BY o.territory_id
      HAVING count(DISTINCT o.axis_value)<>cardinality(d.axis_values))) THEN
    RAISE EXCEPTION 'dense duration curve is missing declared focal points';
  END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='duration_minute'
    AND d.completeness='dense_complete' AND EXISTS(SELECT 1 FROM territory_reference t
      WHERE t.territory_type=ANY(d.allowed_levels) AND NOT EXISTS(SELECT 1 FROM series_dataset_observation o
        WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id
          AND o.territory_id=t.territory_id AND o.territory_type=t.territory_type))) THEN
    RAISE EXCEPTION 'dense duration publication omits an eligible territory from the reference universe';
  END IF;
  IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='duration_minute'
    AND d.completeness='dense_complete' AND EXISTS(SELECT 1 FROM series_named_reference r
      WHERE r.dataset_id=d.dataset_id AND r.indicator_id=d.indicator_id GROUP BY r.reference_id
      HAVING count(DISTINCT r.axis_value)<>cardinality(d.axis_values))) THEN
    RAISE EXCEPTION 'dense duration reference is missing declared points';
  END IF;
 RETURN NULL;
END $$;

COMMIT;
