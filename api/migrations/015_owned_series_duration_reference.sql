BEGIN;
ALTER TABLE series_dataset_descriptor DROP CONSTRAINT series_dataset_descriptor_axis_kind_check;
ALTER TABLE series_dataset_descriptor ADD CONSTRAINT series_dataset_descriptor_axis_kind_check
 CHECK(axis_kind IN ('year','state_role','declared_detail','duration_minute'));
ALTER TABLE series_dataset_descriptor ADD COLUMN active_read_route boolean NOT NULL DEFAULT false;
ALTER TABLE series_dataset_descriptor ADD COLUMN axis_numeric_values integer[];
-- Unique index applies only to active declarations (multiple inactive historical rows remain legal).
CREATE UNIQUE INDEX series_dataset_one_active_route ON series_dataset_descriptor(indicator_id) WHERE active_read_route;
CREATE TABLE series_named_reference (
 dataset_id text NOT NULL, indicator_id text NOT NULL, reference_id text NOT NULL,
 reference_label text NOT NULL, reference_role text NOT NULL CHECK(reference_role='analytical_reference'),
 reference_statistic text NOT NULL CHECK(reference_statistic='median_routed_communes'),
 axis_value text NOT NULL, observation_period text NOT NULL, value double precision,
 status text NOT NULL CHECK(status IN ('measured','missing')),
 PRIMARY KEY(dataset_id,indicator_id,reference_id,axis_value),
 FOREIGN KEY(dataset_id,indicator_id) REFERENCES series_dataset_descriptor(dataset_id,indicator_id) ON DELETE CASCADE,
 CHECK((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)) OR (status='missing' AND value IS NULL))
);
CREATE TABLE series_named_reference_provenance (
 dataset_id text NOT NULL, indicator_id text NOT NULL, reference_id text NOT NULL, axis_value text NOT NULL,
 provenance_revision_id text NOT NULL REFERENCES series_provenance_revision(provenance_revision_id),
 PRIMARY KEY(dataset_id,indicator_id,reference_id,axis_value,provenance_revision_id),
 FOREIGN KEY(dataset_id,indicator_id,reference_id,axis_value)
 REFERENCES series_named_reference(dataset_id,indicator_id,reference_id,axis_value) ON DELETE CASCADE
);
CREATE TRIGGER series_named_reference_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_named_reference
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
CREATE TRIGGER series_named_reference_provenance_owned_write BEFORE INSERT OR UPDATE OR DELETE ON series_named_reference_provenance
 FOR EACH ROW EXECUTE FUNCTION validate_series_dataset_write();
GRANT SELECT ON series_named_reference,series_named_reference_provenance TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON series_named_reference,series_named_reference_provenance TO lusk_publisher;
CREATE OR REPLACE FUNCTION validate_series_dataset_descriptor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF cardinality(NEW.axis_values)<>cardinality(ARRAY(SELECT DISTINCT unnest(NEW.axis_values))) THEN RAISE EXCEPTION 'series dataset descriptor has duplicate axis values'; END IF;
 IF NEW.axis_kind='year' AND (EXISTS(SELECT 1 FROM unnest(NEW.axis_values) a WHERE a !~ '^[0-9]{4}$') OR NEW.axis_values<>ARRAY(SELECT a FROM unnest(NEW.axis_values) a ORDER BY a::integer)) THEN RAISE EXCEPTION 'series year axis must be ordered numeric years';
 ELSIF NEW.axis_kind='state_role' AND NEW.axis_values<>ARRAY['M2','M3']::text[] THEN RAISE EXCEPTION 'state-role axis must declare M2 then M3';
 ELSIF NEW.axis_kind='duration_minute' AND (NEW.axis_numeric_values IS NULL OR cardinality(NEW.axis_numeric_values)<>cardinality(NEW.axis_values) OR NEW.axis_values<>ARRAY(SELECT 't'||lpad(a::text,4,'0') FROM unnest(NEW.axis_numeric_values) a) OR NEW.axis_numeric_values<>ARRAY(SELECT a FROM unnest(NEW.axis_numeric_values) a ORDER BY a) OR cardinality(NEW.axis_numeric_values)<>cardinality(ARRAY(SELECT DISTINCT unnest(NEW.axis_numeric_values)))) THEN RAISE EXCEPTION 'duration axis numeric minutes do not match declared detail keys'; END IF;
 IF EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=NEW.dataset_id AND o.indicator_id=NEW.indicator_id AND NOT o.axis_value=ANY(NEW.axis_values)) THEN RAISE EXCEPTION 'series dataset descriptor excludes published observations'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION validate_series_dataset_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_rows bigint; actual_descriptors bigint; BEGIN
 SELECT (SELECT count(*) FROM series_dataset_observation WHERE dataset_id=NEW.dataset_id) + (SELECT count(*) FROM series_named_reference WHERE dataset_id=NEW.dataset_id) INTO actual_rows;
 SELECT count(*) INTO actual_descriptors FROM series_dataset_descriptor WHERE dataset_id=NEW.dataset_id;
 IF actual_rows<>NEW.row_count OR actual_descriptors=0 THEN RAISE EXCEPTION 'owned series marker does not match complete descriptor/observation snapshot'; END IF;
 IF NOT EXISTS(SELECT 1 FROM table_publication t WHERE t.table_name='territory_reference' AND t.content_version=NEW.reference_content_version) THEN RAISE EXCEPTION 'owned series publication is bound to a stale territory reference'; END IF;
 IF EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=NEW.dataset_id AND NOT EXISTS(SELECT 1 FROM series_observation_provenance p WHERE (p.dataset_id,p.indicator_id,p.territory_id,p.axis_value)=(o.dataset_id,o.indicator_id,o.territory_id,o.axis_value))) THEN RAISE EXCEPTION 'owned series observation is missing provenance association'; END IF;
 IF EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=NEW.dataset_id AND NOT EXISTS(SELECT 1 FROM series_named_reference_provenance p WHERE (p.dataset_id,p.indicator_id,p.reference_id,p.axis_value)=(r.dataset_id,r.indicator_id,r.reference_id,r.axis_value))) THEN RAISE EXCEPTION 'named reference observation is missing provenance association'; END IF;
 IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='declared_detail' AND EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id GROUP BY o.territory_id HAVING count(DISTINCT o.state_role)<>2)) THEN RAISE EXCEPTION 'declared-detail publication must contain both canonical state roles per territory'; END IF;
 IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='duration_minute' AND d.completeness='dense_complete' AND EXISTS(SELECT 1 FROM series_dataset_observation o WHERE o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id GROUP BY o.territory_id HAVING count(DISTINCT o.axis_value)<>cardinality(d.axis_values))) THEN RAISE EXCEPTION 'dense duration curve is missing declared focal points'; END IF;
 IF EXISTS(SELECT 1 FROM series_dataset_descriptor d WHERE d.dataset_id=NEW.dataset_id AND d.axis_kind='duration_minute' AND d.completeness='dense_complete' AND EXISTS(SELECT 1 FROM series_named_reference r WHERE r.dataset_id=d.dataset_id AND r.indicator_id=d.indicator_id GROUP BY r.reference_id HAVING count(DISTINCT r.axis_value)<>cardinality(d.axis_values))) THEN RAISE EXCEPTION 'dense duration reference is missing declared points'; END IF;
 RETURN NULL;
END $$;
COMMIT;
