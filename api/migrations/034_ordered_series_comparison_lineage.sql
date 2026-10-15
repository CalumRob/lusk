BEGIN;

ALTER TABLE ordered_series_comparison_publication ADD COLUMN comparison_axes text[];
ALTER TABLE ordered_series_comparison_publication ADD COLUMN lineage_row_count integer NOT NULL DEFAULT 0 CHECK(lineage_row_count>=0);
ALTER TABLE ordered_series_comparison_group ADD COLUMN lineage_source_count integer NOT NULL DEFAULT 0 CHECK(lineage_source_count>=0);
UPDATE ordered_series_comparison_publication p SET comparison_axes=(
  SELECT array_agg(axis ORDER BY ordinality)
  FROM series_dataset_descriptor d
  CROSS JOIN LATERAL unnest(d.axis_values) WITH ORDINALITY declared(axis,ordinality)
  WHERE d.dataset_id=p.dataset_id AND d.indicator_id=p.indicator_id
    AND EXISTS (SELECT 1 FROM ordered_series_comparison_group g
      WHERE g.dataset_id=p.dataset_id AND g.indicator_id=p.indicator_id AND g.axis_value=declared.axis));
ALTER TABLE ordered_series_comparison_publication ALTER COLUMN comparison_axes SET NOT NULL;
ALTER TABLE ordered_series_comparison_publication ADD CHECK(cardinality(comparison_axes)>0);

CREATE TABLE ordered_series_comparison_lineage (
 dataset_id text NOT NULL, indicator_id text NOT NULL, comparison_context text NOT NULL,
 group_id text NOT NULL, territory_type text NOT NULL, axis_value text NOT NULL,
 provenance_revision_id text NOT NULL REFERENCES series_provenance_revision(provenance_revision_id),
 PRIMARY KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value,provenance_revision_id),
 FOREIGN KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value)
 REFERENCES ordered_series_comparison_group(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value) ON DELETE CASCADE);
CREATE TABLE ordered_series_comparison_zero_reason (
 dataset_id text NOT NULL, indicator_id text NOT NULL, comparison_context text NOT NULL,
 group_id text NOT NULL, territory_type text NOT NULL, axis_value text NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>0), member_count integer NOT NULL CHECK(member_count>0),
 PRIMARY KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value,reason),
 FOREIGN KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value)
 REFERENCES ordered_series_comparison_group(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value) ON DELETE CASCADE);
GRANT SELECT ON ordered_series_comparison_lineage,ordered_series_comparison_zero_reason TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON ordered_series_comparison_lineage,ordered_series_comparison_zero_reason TO lusk_publisher;

COMMIT;
