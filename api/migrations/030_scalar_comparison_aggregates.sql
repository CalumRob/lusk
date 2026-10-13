-- Additive fixed-context scalar comparison projections. No live database
-- application is authorized by this implementation change.
BEGIN;

CREATE TABLE scalar_comparison_publication (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    content_version text NOT NULL,
    scalar_content_version text NOT NULL,
    reference_content_version text NOT NULL,
    group_row_count integer NOT NULL CHECK (group_row_count >= 0),
    territory_row_count integer NOT NULL CHECK (territory_row_count >= 0),
    published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scalar_comparison_group (
    comparison_context text NOT NULL CHECK (comparison_context IN ('density_class','epci','bretagne','same_level')),
    group_id text NOT NULL CHECK (length(trim(group_id)) > 0),
    territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement')),
    indicator_id text NOT NULL REFERENCES scalar_descriptor(indicator_id),
    statistic text NOT NULL CHECK (statistic='median'),
    median double precision,
    member_count integer NOT NULL CHECK (member_count > 0),
    eligible_count integer NOT NULL CHECK (eligible_count >= 0),
    missing_count integer NOT NULL CHECK (missing_count >= 0),
    PRIMARY KEY (comparison_context,group_id,territory_type,indicator_id),
    CHECK (member_count=eligible_count+missing_count),
    CHECK ((eligible_count=0 AND median IS NULL) OR
      (eligible_count>0 AND median IS NOT NULL AND median NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)))
);

CREATE TABLE scalar_comparison_territory (
    comparison_context text NOT NULL,
    group_id text NOT NULL,
    territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement')),
    indicator_id text NOT NULL REFERENCES scalar_descriptor(indicator_id),
    territory_id text NOT NULL REFERENCES territory_reference(territory_id),
    value double precision,
    status text NOT NULL CHECK (status IN ('measured','suppressed','unsupported','not_available','not_published')),
    rank integer CHECK (rank IS NULL OR rank > 0),
    tie_count integer CHECK (tie_count IS NULL OR tie_count > 0),
    rank_size integer CHECK (rank_size IS NULL OR rank_size > 0),
    PRIMARY KEY (comparison_context,group_id,territory_type,indicator_id,territory_id),
    FOREIGN KEY (comparison_context,group_id,territory_type,indicator_id)
      REFERENCES scalar_comparison_group(comparison_context,group_id,territory_type,indicator_id) ON DELETE CASCADE,
    CHECK ((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))
      OR (status<>'measured' AND value IS NULL)),
    CHECK ((status='measured' AND rank IS NOT NULL AND tie_count IS NOT NULL AND rank_size IS NOT NULL)
      OR (status<>'measured' AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)),
    CHECK (status<>'measured' OR (rank<=rank_size AND tie_count<=rank_size))
);

GRANT SELECT ON scalar_comparison_publication,scalar_comparison_group,scalar_comparison_territory TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON scalar_comparison_publication,scalar_comparison_group,scalar_comparison_territory TO lusk_publisher;

COMMIT;
