BEGIN;

-- ADR-0049 step 2 (#1138): per-resource declared-profile comparison marker.
-- Strictly additive, in the same spirit as 046: no existing row, publication
-- marker, constraint or grant is changed. `table_publication['declared_profile']`
-- and the `profile_comparison_publication` singleton are deliberately LEFT IN
-- PLACE — the current API keeps reading them until the reader cutover in step 4
-- (#1140). The group/territory/lineage rows stay keyed by indicator_id, so they
-- are already per-resource; this marker only supplies the per-resource clock.
-- Applying this DDL alone publishes no resource.
--
-- Like every migration in this directory, this file OWNS its transaction:
-- apply it with psql --set ON_ERROR_STOP=on and WITHOUT --single-transaction.

-- No FK to profile_descriptor: the shape adapter deletes this marker before
-- the descriptor in the same transaction, and an outside FK would violate the
-- wholesale publisher's complete-snapshot replacement invariant.
CREATE TABLE IF NOT EXISTS profile_resource_comparison_publication (
    indicator_id text PRIMARY KEY CHECK (indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
    content_version text NOT NULL,
    profile_content_version text NOT NULL,
    reference_content_version text NOT NULL,
    group_row_count integer NOT NULL CHECK (group_row_count >= 0),
    territory_row_count integer NOT NULL CHECK (territory_row_count >= 0),
    lineage_row_count integer NOT NULL CHECK (lineage_row_count >= 0),
    published_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON profile_resource_comparison_publication TO lusk_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON profile_resource_comparison_publication TO lusk_publisher;

COMMIT;
