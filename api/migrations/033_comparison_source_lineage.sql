-- #787: prepublish actual source/vintage lineage at resolved group/facet grain.
BEGIN;

-- NULL distinguishes pre-migration publications from a publisher-declared
-- empty lineage. The API treats NULL expected counts as incomplete (503).
ALTER TABLE scalar_comparison_publication ADD COLUMN lineage_row_count integer CHECK(lineage_row_count>=0);
ALTER TABLE scalar_comparison_group ADD COLUMN lineage_source_count integer CHECK(lineage_source_count>=0);
ALTER TABLE profile_comparison_group ADD COLUMN lineage_source_count integer CHECK(lineage_source_count>=0);

CREATE TABLE comparison_source_lineage (
    comparison_family text NOT NULL CHECK (comparison_family IN
      ('scalar','profile','ordered_series','period_detail','aedar')),
    comparison_context text NOT NULL CHECK (comparison_context IN
      ('density_class','epci','bretagne','same_level')),
    group_id text NOT NULL CHECK (length(trim(group_id)) > 0),
    territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement')),
    facet_id text NOT NULL CHECK (length(trim(facet_id)) > 0),
    source_id text NOT NULL,
    vintage_id text NOT NULL,
    comparison_content_version text NOT NULL,
    PRIMARY KEY (comparison_family,comparison_context,group_id,territory_type,facet_id,source_id,vintage_id),
    FOREIGN KEY (source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);
GRANT SELECT ON comparison_source_lineage TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON comparison_source_lineage TO lusk_publisher;

COMMIT;
