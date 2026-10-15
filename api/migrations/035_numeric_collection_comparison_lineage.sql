BEGIN;

ALTER TABLE observed_collection_comparison_publication
  ADD COLUMN lineage_row_count bigint NOT NULL DEFAULT 0 CHECK(lineage_row_count>=0),
  ADD COLUMN lineage_complete boolean NOT NULL DEFAULT false;
ALTER TABLE observed_collection_comparison_group
  ADD COLUMN lineage_source_count integer NOT NULL DEFAULT 0 CHECK(lineage_source_count>=0);
ALTER TABLE observed_collection_comparison_group ADD CONSTRAINT observed_collection_positive_members
  CHECK(member_count>0) NOT VALID;
ALTER TABLE observed_collection_comparison_group ADD CONSTRAINT observed_collection_lineage_support_shape
  CHECK((eligible_count=0 AND lineage_source_count=0) OR (eligible_count>0 AND lineage_source_count>0)) NOT VALID;

CREATE TABLE observed_collection_comparison_lineage (
  indicator_id text NOT NULL, comparison_context text NOT NULL, group_id text NOT NULL,
  territory_type text NOT NULL, detail_key text NOT NULL, observation_period text NOT NULL,
  source_id text NOT NULL, vintage_id text NOT NULL, comparison_content_version text NOT NULL,
  PRIMARY KEY(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period,source_id,vintage_id),
  FOREIGN KEY(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period)
    REFERENCES observed_collection_comparison_group(indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period) ON DELETE CASCADE,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));

CREATE TRIGGER observed_collection_comparison_lineage_owned_write
  BEFORE INSERT OR UPDATE OR DELETE ON observed_collection_comparison_lineage
  FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_comparison_write();
CREATE FUNCTION validate_observed_collection_comparison_lineage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT NEW.lineage_complete OR NEW.lineage_row_count<>(SELECT count(*) FROM observed_collection_comparison_lineage WHERE indicator_id=NEW.indicator_id)
    OR EXISTS(SELECT 1 FROM observed_collection_comparison_lineage WHERE indicator_id=NEW.indicator_id AND comparison_content_version<>NEW.content_version)
    OR EXISTS(SELECT 1 FROM observed_collection_comparison_group g WHERE g.indicator_id=NEW.indicator_id
      AND g.lineage_source_count<>(SELECT count(*) FROM observed_collection_comparison_lineage l WHERE
        (l.indicator_id,l.comparison_context,l.group_id,l.territory_type,l.detail_key,l.observation_period)=
        (g.indicator_id,g.comparison_context,g.group_id,g.territory_type,g.detail_key,g.observation_period)))
  THEN RAISE EXCEPTION 'observed collection comparison lineage is incomplete or stale'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER observed_collection_comparison_lineage_contract AFTER INSERT OR UPDATE ON observed_collection_comparison_publication
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_observed_collection_comparison_lineage();
GRANT SELECT ON observed_collection_comparison_lineage TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON observed_collection_comparison_lineage TO lusk_publisher;

COMMIT;
