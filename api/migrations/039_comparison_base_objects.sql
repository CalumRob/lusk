-- #806: restore the missing scalar and ordered-series comparison base objects.
--
-- Fresh installs have always received these six relations from api/schema.sql,
-- but retained migration history only contains 033 and 034, which ALTER them.
-- An existing serving schema that never received the bases therefore cannot
-- apply the lineage migrations. This migration is the explicit additive repair.
--
-- Application order (see api/migrations/README.md):
--   030 -> 039 -> 033 -> 034
-- 030 owns the profile/collection comparison bases that 033 also alters. 039
-- owns only the scalar and ordered-series bases. Apply 033 and 034 only when
-- 039 reports the corresponding family as "present"; when 039 reports
-- "current", those lineage migrations are already applied and must not be run
-- again. Do not run 033/034 blindly after creating current lineage columns.
--
-- Supported per-family starting states:
--   absent  - no base relations; 039 creates the exact pre-lineage contract.
--   present - all three base relations with the exact pre-lineage columns; no-op.
--   current - all three base relations plus the exact 033/034 lineage columns;
--             no-op.
-- Any other shape (one or two base relations, mixed lineage columns, a
-- lineage relation without its base family, a non-table relation, or an
-- unexpected column/type/nullability) aborts the transaction before this
-- migration mutates the target schema.
--
-- These two families have no producer-owned comparison write trigger or
-- validation function in the serving contract. Their controls are the primary
-- keys, foreign keys, CHECK constraints and role grants reproduced below from
-- the pinned pre-lineage schema: the deleted historical scalar-comparison
-- migration 030 (`030_scalar_comparison_aggregates.sql`, commit c6d29805) and
-- the ordered-series addition in commit 7535ce9b. The current migration 030 is
-- the profile/collection step and does not create these two families. The
-- lineage relations and their constraints are created by 033 and 034, not
-- here.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  scalar_relations integer;
  ordered_relations integer;
  scalar_state text;
  ordered_state text;
  scalar_pub_lineage boolean;
  scalar_group_lineage boolean;
  source_lineage boolean;
  ordered_axes boolean;
  ordered_pub_lineage boolean;
  ordered_group_lineage boolean;
  ordered_lineage boolean;
  ordered_zero boolean;
BEGIN
  IF current_schema() IS NULL THEN
    RAISE EXCEPTION 'migration 039: current_schema() is unset; select the target schema explicitly';
  END IF;
  IF to_regclass('territory_reference') IS NULL THEN
    RAISE EXCEPTION 'migration 039 precondition failed: territory_reference is missing';
  END IF;
  IF to_regclass('scalar_descriptor') IS NULL THEN
    RAISE EXCEPTION 'migration 039 precondition failed: scalar_descriptor is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname IN (
      'scalar_comparison_publication', 'scalar_comparison_group', 'scalar_comparison_territory',
      'ordered_series_comparison_publication', 'ordered_series_comparison_group',
      'ordered_series_comparison_territory', 'comparison_source_lineage',
      'ordered_series_comparison_lineage', 'ordered_series_comparison_zero_reason')
      AND c.relkind <> 'r'
  ) THEN
    RAISE EXCEPTION 'migration 039: a comparison relation exists but is not an ordinary table; incompatible state';
  END IF;

  SELECT count(*) INTO scalar_relations FROM (VALUES
    ('scalar_comparison_publication'), ('scalar_comparison_group'), ('scalar_comparison_territory')
  ) AS expected(relation)
  WHERE to_regclass(relation) IS NOT NULL;
  SELECT count(*) INTO ordered_relations FROM (VALUES
    ('ordered_series_comparison_publication'), ('ordered_series_comparison_group'),
    ('ordered_series_comparison_territory')
  ) AS expected(relation)
  WHERE to_regclass(relation) IS NOT NULL;

  SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'scalar_comparison_publication'
      AND a.attname = 'lineage_row_count' AND a.attnum > 0 AND NOT a.attisdropped)
    INTO scalar_pub_lineage;
  SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'scalar_comparison_group'
      AND a.attname = 'lineage_source_count' AND a.attnum > 0 AND NOT a.attisdropped)
    INTO scalar_group_lineage;
  SELECT to_regclass('comparison_source_lineage') IS NOT NULL INTO source_lineage;

  SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_publication'
      AND a.attname = 'comparison_axes' AND a.attnum > 0 AND NOT a.attisdropped)
    INTO ordered_axes;
  SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_publication'
      AND a.attname = 'lineage_row_count' AND a.attnum > 0 AND NOT a.attisdropped)
    INTO ordered_pub_lineage;
  SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_group'
      AND a.attname = 'lineage_source_count' AND a.attnum > 0 AND NOT a.attisdropped)
    INTO ordered_group_lineage;
  SELECT to_regclass('ordered_series_comparison_lineage') IS NOT NULL INTO ordered_lineage;
  SELECT to_regclass('ordered_series_comparison_zero_reason') IS NOT NULL INTO ordered_zero;

  -- Scalar family state and exact-shape validation.
  IF scalar_relations = 0 THEN
    IF source_lineage THEN
      RAISE EXCEPTION 'migration 039: scalar comparison bases are absent but comparison_source_lineage exists; incompatible partial state';
    END IF;
    scalar_state := 'absent';
  ELSIF scalar_relations = 3 THEN
    IF scalar_pub_lineage AND scalar_group_lineage AND source_lineage THEN
      scalar_state := 'current';
    ELSIF NOT scalar_pub_lineage AND NOT scalar_group_lineage AND NOT source_lineage THEN
      scalar_state := 'present';
    ELSE
      RAISE EXCEPTION 'migration 039: scalar comparison family has a mixed lineage shape; incompatible partial state';
    END IF;

    IF scalar_state = 'present' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'scalar_comparison_publication'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'content_version:text:1', 'group_row_count:integer:1', 'published_at:timestamp with time zone:1',
          'reference_content_version:text:1', 'scalar_content_version:text:1', 'singleton:boolean:1',
          'territory_row_count:integer:1'])
    THEN
      RAISE EXCEPTION 'migration 039: scalar_comparison_publication does not match the pre-lineage contract';
    END IF;
    IF scalar_state = 'present' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'scalar_comparison_group'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'comparison_context:text:1', 'eligible_count:integer:1', 'group_id:text:1',
          'indicator_id:text:1', 'median:double precision:0', 'member_count:integer:1',
          'missing_count:integer:1', 'statistic:text:1', 'territory_type:text:1'])
    THEN
      RAISE EXCEPTION 'migration 039: scalar_comparison_group does not match the pre-lineage contract';
    END IF;
    IF scalar_state = 'present' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'scalar_comparison_territory'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'comparison_context:text:1', 'group_id:text:1', 'indicator_id:text:1', 'rank:integer:0',
          'rank_size:integer:0', 'status:text:1', 'territory_id:text:1', 'territory_type:text:1',
          'tie_count:integer:0', 'value:double precision:0'])
    THEN
      RAISE EXCEPTION 'migration 039: scalar_comparison_territory does not match the pre-lineage contract';
    END IF;

    IF scalar_state = 'current' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attname = 'lineage_row_count' THEN '0'
               WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'scalar_comparison_publication'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'content_version:text:1', 'group_row_count:integer:1', 'lineage_row_count:integer:0',
          'published_at:timestamp with time zone:1', 'reference_content_version:text:1',
          'scalar_content_version:text:1', 'singleton:boolean:1', 'territory_row_count:integer:1'])
    THEN
      RAISE EXCEPTION 'migration 039: scalar_comparison_publication does not match the current lineage contract';
    END IF;
    IF scalar_state = 'current' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attname = 'lineage_source_count' THEN '0'
               WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'scalar_comparison_group'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'comparison_context:text:1', 'eligible_count:integer:1', 'group_id:text:1',
          'indicator_id:text:1', 'lineage_source_count:integer:0', 'median:double precision:0',
          'member_count:integer:1', 'missing_count:integer:1', 'statistic:text:1',
          'territory_type:text:1'])
    THEN
      RAISE EXCEPTION 'migration 039: scalar_comparison_group does not match the current lineage contract';
    END IF;
    IF scalar_state = 'current' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'scalar_comparison_territory'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'comparison_context:text:1', 'group_id:text:1', 'indicator_id:text:1', 'rank:integer:0',
          'rank_size:integer:0', 'status:text:1', 'territory_id:text:1', 'territory_type:text:1',
          'tie_count:integer:0', 'value:double precision:0'])
    THEN
      RAISE EXCEPTION 'migration 039: scalar_comparison_territory does not match the current lineage contract';
    END IF;
    IF scalar_state = 'current' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'comparison_source_lineage'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'comparison_content_version:text:1', 'comparison_context:text:1',
          'comparison_family:text:1', 'facet_id:text:1', 'group_id:text:1', 'source_id:text:1',
          'territory_type:text:1', 'vintage_id:text:1'])
    THEN
      RAISE EXCEPTION 'migration 039: comparison_source_lineage does not match the current lineage contract';
    END IF;
  ELSE
    RAISE EXCEPTION 'migration 039: scalar comparison family has % of 3 base relations; incompatible partial state',
      scalar_relations;
  END IF;

  -- Ordered-series family state and exact-shape validation.
  IF ordered_relations = 0 THEN
    IF ordered_lineage OR ordered_zero THEN
      RAISE EXCEPTION 'migration 039: ordered-series comparison bases are absent but lineage relations exist; incompatible partial state';
    END IF;
    ordered_state := 'absent';
  ELSIF ordered_relations = 3 THEN
    IF ordered_axes AND ordered_pub_lineage AND ordered_group_lineage AND ordered_lineage AND ordered_zero THEN
      ordered_state := 'current';
    ELSIF NOT ordered_axes AND NOT ordered_pub_lineage AND NOT ordered_group_lineage
      AND NOT ordered_lineage AND NOT ordered_zero THEN
      ordered_state := 'present';
    ELSE
      RAISE EXCEPTION 'migration 039: ordered-series comparison family has a mixed lineage shape; incompatible partial state';
    END IF;

    IF ordered_state = 'present' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_publication'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'content_version:text:1', 'dataset_id:text:1', 'group_row_count:integer:1',
          'indicator_id:text:1', 'ordered_series_content_version:text:1',
          'published_at:timestamp with time zone:1', 'reference_content_version:text:1',
          'territory_row_count:integer:1'])
    THEN
      RAISE EXCEPTION 'migration 039: ordered_series_comparison_publication does not match the pre-lineage contract';
    END IF;
    IF ordered_state = 'present' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_group'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1',
          'eligible_count:integer:1', 'group_id:text:1', 'group_value:double precision:0',
          'indicator_id:text:1', 'member_count:integer:1', 'missing_count:integer:1',
          'statistic:text:1', 'territory_type:text:1'])
    THEN
      RAISE EXCEPTION 'migration 039: ordered_series_comparison_group does not match the pre-lineage contract';
    END IF;
    IF ordered_state = 'present' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_territory'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1', 'group_id:text:1',
          'indicator_id:text:1', 'rank:integer:0', 'rank_size:integer:0', 'status:text:1',
          'territory_id:text:1', 'territory_type:text:1', 'tie_count:integer:0',
          'value:double precision:0'])
    THEN
      RAISE EXCEPTION 'migration 039: ordered_series_comparison_territory does not match the pre-lineage contract';
    END IF;

    IF ordered_state = 'current' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attname = 'lineage_row_count' THEN '0'
               WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_publication'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'comparison_axes:text[]:1', 'content_version:text:1', 'dataset_id:text:1',
          'group_row_count:integer:1', 'indicator_id:text:1', 'lineage_row_count:integer:0',
          'ordered_series_content_version:text:1', 'published_at:timestamp with time zone:1',
          'reference_content_version:text:1', 'territory_row_count:integer:1'])
    THEN
      RAISE EXCEPTION 'migration 039: ordered_series_comparison_publication does not match the current lineage contract';
    END IF;
    IF ordered_state = 'current' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attname = 'lineage_source_count' THEN '0'
               WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_group'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1',
          'eligible_count:integer:1', 'group_id:text:1', 'group_value:double precision:0',
          'indicator_id:text:1', 'lineage_source_count:integer:0', 'member_count:integer:1',
          'missing_count:integer:1', 'statistic:text:1', 'territory_type:text:1'])
    THEN
      RAISE EXCEPTION 'migration 039: ordered_series_comparison_group does not match the current lineage contract';
    END IF;
    IF ordered_state = 'current' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_territory'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1', 'group_id:text:1',
          'indicator_id:text:1', 'rank:integer:0', 'rank_size:integer:0', 'status:text:1',
          'territory_id:text:1', 'territory_type:text:1', 'tie_count:integer:0',
          'value:double precision:0'])
    THEN
      RAISE EXCEPTION 'migration 039: ordered_series_comparison_territory does not match the current lineage contract';
    END IF;
    IF ordered_state = 'current' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_lineage'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1', 'group_id:text:1',
          'indicator_id:text:1', 'provenance_revision_id:text:1', 'territory_type:text:1'])
    THEN
      RAISE EXCEPTION 'migration 039: ordered_series_comparison_lineage does not match the current lineage contract';
    END IF;
    IF ordered_state = 'current' AND (
      (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
          CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_zero_reason'
           AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM ARRAY[
          'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1', 'group_id:text:1',
          'indicator_id:text:1', 'member_count:integer:1', 'reason:text:1', 'territory_type:text:1'])
    THEN
      RAISE EXCEPTION 'migration 039: ordered_series_comparison_zero_reason does not match the current lineage contract';
    END IF;
  ELSE
    RAISE EXCEPTION 'migration 039: ordered-series comparison family has % of 3 base relations; incompatible partial state',
      ordered_relations;
  END IF;

  RAISE NOTICE 'migration 039: scalar comparison family state=%', scalar_state;
  RAISE NOTICE 'migration 039: ordered-series comparison family state=%', ordered_state;
END $$;

-- Exact pre-lineage scalar comparison contract (retired migration 030).
CREATE TABLE IF NOT EXISTS scalar_comparison_publication (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    content_version text NOT NULL,
    scalar_content_version text NOT NULL,
    reference_content_version text NOT NULL,
    group_row_count integer NOT NULL CHECK (group_row_count >= 0),
    territory_row_count integer NOT NULL CHECK (territory_row_count >= 0),
    published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scalar_comparison_group (
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
CREATE TABLE IF NOT EXISTS scalar_comparison_territory (
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

-- Exact pre-lineage owned ordered-series comparison contract (commit 7535ce9b).
CREATE TABLE IF NOT EXISTS ordered_series_comparison_publication (
 dataset_id text NOT NULL, indicator_id text NOT NULL,
 content_version text NOT NULL, ordered_series_content_version text NOT NULL,
 reference_content_version text NOT NULL,
 group_row_count integer NOT NULL CHECK(group_row_count>=0),
 territory_row_count integer NOT NULL CHECK(territory_row_count>=0),
 published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(dataset_id,indicator_id));
CREATE TABLE IF NOT EXISTS ordered_series_comparison_group (
 dataset_id text NOT NULL, indicator_id text NOT NULL,
 comparison_context text NOT NULL CHECK(comparison_context IN ('density_class','epci','bretagne','same_level')),
 group_id text NOT NULL CHECK(length(trim(group_id))>0),
 territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement')),
 axis_value text NOT NULL, statistic text NOT NULL CHECK(statistic IN ('median','mean')),
 group_value double precision, member_count integer NOT NULL CHECK(member_count>0),
 eligible_count integer NOT NULL CHECK(eligible_count>=0), missing_count integer NOT NULL CHECK(missing_count>=0),
 PRIMARY KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value),
 CHECK(member_count=eligible_count+missing_count),
 CHECK((eligible_count=0 AND group_value IS NULL) OR (eligible_count>0 AND group_value IS NOT NULL AND group_value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))));
CREATE TABLE IF NOT EXISTS ordered_series_comparison_territory (
 dataset_id text NOT NULL, indicator_id text NOT NULL,
 comparison_context text NOT NULL, group_id text NOT NULL,
 territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement')),
 axis_value text NOT NULL, territory_id text NOT NULL REFERENCES territory_reference(territory_id),
 value double precision, status text NOT NULL CHECK(status IN ('measured','missing','not_published')),
 rank integer, tie_count integer, rank_size integer,
 PRIMARY KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value,territory_id),
 FOREIGN KEY(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value)
 REFERENCES ordered_series_comparison_group(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value) ON DELETE CASCADE,
 CHECK((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) AND rank>0 AND tie_count>0 AND rank_size>0 AND rank<=rank_size AND tie_count<=rank_size)
 OR (status<>'measured' AND value IS NULL AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)));

GRANT SELECT ON scalar_comparison_publication,scalar_comparison_group,scalar_comparison_territory TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON scalar_comparison_publication,scalar_comparison_group,scalar_comparison_territory TO lusk_publisher;
GRANT SELECT ON ordered_series_comparison_publication,ordered_series_comparison_group,ordered_series_comparison_territory TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON ordered_series_comparison_publication,ordered_series_comparison_group,ordered_series_comparison_territory TO lusk_publisher;

-- Postcondition: every family is now either the exact pre-lineage shape or the
-- exact current lineage shape, and both serving roles have the contract grants.
DO $$
DECLARE
  relation text;
  actual text[];
  base_expected text[];
  current_expected text[];
  qualified text;
BEGIN
  FOR relation, base_expected, current_expected IN
    SELECT * FROM (VALUES
      ('scalar_comparison_publication', ARRAY[
        'content_version:text:1', 'group_row_count:integer:1',
        'published_at:timestamp with time zone:1', 'reference_content_version:text:1',
        'scalar_content_version:text:1', 'singleton:boolean:1',
        'territory_row_count:integer:1']::text[], ARRAY[
        'content_version:text:1', 'group_row_count:integer:1', 'lineage_row_count:integer:0',
        'published_at:timestamp with time zone:1', 'reference_content_version:text:1',
        'scalar_content_version:text:1', 'singleton:boolean:1', 'territory_row_count:integer:1']::text[]),
      ('scalar_comparison_group', ARRAY[
        'comparison_context:text:1', 'eligible_count:integer:1', 'group_id:text:1',
        'indicator_id:text:1', 'median:double precision:0', 'member_count:integer:1',
        'missing_count:integer:1', 'statistic:text:1', 'territory_type:text:1']::text[], ARRAY[
        'comparison_context:text:1', 'eligible_count:integer:1', 'group_id:text:1',
        'indicator_id:text:1', 'lineage_source_count:integer:0', 'median:double precision:0',
        'member_count:integer:1', 'missing_count:integer:1', 'statistic:text:1',
        'territory_type:text:1']::text[]),
      ('scalar_comparison_territory', ARRAY[
        'comparison_context:text:1', 'group_id:text:1', 'indicator_id:text:1', 'rank:integer:0',
        'rank_size:integer:0', 'status:text:1', 'territory_id:text:1', 'territory_type:text:1',
        'tie_count:integer:0', 'value:double precision:0']::text[], ARRAY[
        'comparison_context:text:1', 'group_id:text:1', 'indicator_id:text:1', 'rank:integer:0',
        'rank_size:integer:0', 'status:text:1', 'territory_id:text:1', 'territory_type:text:1',
        'tie_count:integer:0', 'value:double precision:0']::text[]),
      ('ordered_series_comparison_publication', ARRAY[
        'content_version:text:1', 'dataset_id:text:1', 'group_row_count:integer:1',
        'indicator_id:text:1', 'ordered_series_content_version:text:1',
        'published_at:timestamp with time zone:1', 'reference_content_version:text:1',
        'territory_row_count:integer:1']::text[], ARRAY[
        'comparison_axes:text[]:1', 'content_version:text:1', 'dataset_id:text:1',
        'group_row_count:integer:1', 'indicator_id:text:1', 'lineage_row_count:integer:0',
        'ordered_series_content_version:text:1', 'published_at:timestamp with time zone:1',
        'reference_content_version:text:1', 'territory_row_count:integer:1']::text[]),
      ('ordered_series_comparison_group', ARRAY[
        'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1',
        'eligible_count:integer:1', 'group_id:text:1', 'group_value:double precision:0',
        'indicator_id:text:1', 'member_count:integer:1', 'missing_count:integer:1',
        'statistic:text:1', 'territory_type:text:1']::text[], ARRAY[
        'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1',
        'eligible_count:integer:1', 'group_id:text:1', 'group_value:double precision:0',
        'indicator_id:text:1', 'lineage_source_count:integer:0', 'member_count:integer:1',
        'missing_count:integer:1', 'statistic:text:1', 'territory_type:text:1']::text[]),
      ('ordered_series_comparison_territory', ARRAY[
        'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1', 'group_id:text:1',
        'indicator_id:text:1', 'rank:integer:0', 'rank_size:integer:0', 'status:text:1',
        'territory_id:text:1', 'territory_type:text:1', 'tie_count:integer:0',
        'value:double precision:0']::text[], ARRAY[
        'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1', 'group_id:text:1',
        'indicator_id:text:1', 'rank:integer:0', 'rank_size:integer:0', 'status:text:1',
        'territory_id:text:1', 'territory_type:text:1', 'tie_count:integer:0',
        'value:double precision:0']::text[])
    ) AS expected_columns(relation, base_columns, current_columns)
  LOOP
    SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
        CASE WHEN a.attname IN ('lineage_row_count', 'lineage_source_count') THEN '0'
             WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
      INTO actual
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = relation
        AND a.attnum > 0 AND NOT a.attisdropped;
    IF actual IS NULL THEN
      RAISE EXCEPTION 'migration 039 postcondition failed: % is missing', relation;
    END IF;
    IF actual IS DISTINCT FROM base_expected AND actual IS DISTINCT FROM current_expected THEN
      RAISE EXCEPTION 'migration 039 postcondition failed: % has an unexpected column contract', relation;
    END IF;
    qualified := quote_ident(current_schema()) || '.' || quote_ident(relation);
    IF NOT has_table_privilege('lusk_reader', qualified, 'SELECT') THEN
      RAISE EXCEPTION 'migration 039 postcondition failed: lusk_reader lacks SELECT on %', relation;
    END IF;
    IF NOT has_table_privilege('lusk_publisher', qualified, 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'migration 039 postcondition failed: lusk_publisher lacks DML on %', relation;
    END IF;
  END LOOP;
END $$;

COMMIT;
