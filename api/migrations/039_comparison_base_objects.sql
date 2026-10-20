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
--   present - all three base relations with the exact pre-lineage contract.
--   current - all three base relations plus the exact 033/034 lineage contract.
--
-- A family is accepted only when its complete catalog contract matches one of
-- those states: columns/types/nullability, defaults, primary keys, foreign-key
-- targets/actions/deferrability, CHECK semantics, the indexes backing required
-- primary/unique constraints, user-trigger absence and role grants. A family
-- with one, two or a non-table base relation, mixed lineage columns/relations,
-- an unexpected constraint/default/trigger, an invalid or unique independent
-- index, or a missing required grant aborts the transaction before any target
-- DDL. The validator never repairs an existing present/current family.
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
--
-- Retained exceptions, validated exactly rather than normalized:
--   * 033/034 add the four lineage-count columns nullable (NULL is the legacy
--     sentinel), while fresh schema.sql makes them NOT NULL. A current family
--     must have both count columns nullable or both NOT NULL; a mixed pair is
--     rejected.
--   * 034 creates ordered_series_comparison_zero_reason's group foreign key
--     with ON DELETE CASCADE and no deferrability, while fresh schema.sql is
--     DEFERRABLE INITIALLY DEFERRED without cascade. Exactly those two shapes
--     are accepted; any other target/action/deferrability is rejected. #806
--     does not change 034's deletion semantics.
--
-- Grant policy: absent bases are created and then granted. An existing
-- present/current family must already carry the READER SELECT and PUBLISHER
-- SELECT/INSERT/UPDATE/DELETE grants; 039 fails before DDL instead of repairing
-- them. The later GRANT statements are therefore only effective for newly
-- created bases (and are idempotent no-ops on a validated existing family).
-- Extra grants to other roles and extra publisher privileges are preserved,
-- not revoked. lusk_reader write privileges or grant options are rejected.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE m039_expected_columns (
  relation text PRIMARY KEY,
  columns text[] NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE m039_expected_constraints (
  relation text NOT NULL,
  kind text NOT NULL,
  definition text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE m039_expected_defaults (
  relation text NOT NULL,
  column_name text NOT NULL,
  expression text NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.m039_columns(p_relation text)
RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
           CASE WHEN a.attnotnull THEN '1' ELSE '0' END ORDER BY a.attname)
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname = p_relation
    AND a.attnum > 0
    AND NOT a.attisdropped
$$;

CREATE FUNCTION pg_temp.m039_normalize(p_definition text)
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT btrim(regexp_replace(
    replace(replace(p_definition, quote_ident(current_schema()) || '.', ''),
      current_schema() || '.', ''),
    '\s+', ' ', 'g'))
$$;

INSERT INTO pg_temp.m039_expected_defaults(relation, column_name, expression) VALUES
  ('scalar_comparison_publication', 'singleton', 'true'),
  ('scalar_comparison_publication', 'published_at', 'now()'),
  ('ordered_series_comparison_publication', 'published_at', 'now()');

CREATE FUNCTION pg_temp.m039_validate_comparison_contract(p_phase text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  relation_expected record;
  constraint_expected record;
  actual_columns text[];
  actual_constraints text[];
  expected_constraints text[];
  actual_defaults text[];
  expected_defaults text[];
  extra_indexes text[];
  extra_triggers text[];
  zero_reason_fks text[];
  qualified_name text;
  privilege text;
  fresh_zero_fk constant text := $def$FOREIGN KEY (dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value) REFERENCES ordered_series_comparison_group(dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value) DEFERRABLE INITIALLY DEFERRED$def$;
  retained_zero_fk constant text := $def$FOREIGN KEY (dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value) REFERENCES ordered_series_comparison_group(dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value) ON DELETE CASCADE$def$;
BEGIN
  IF p_phase NOT IN ('pre', 'post') THEN
    RAISE EXCEPTION 'migration 039: invalid validation phase %', p_phase;
  END IF;

  FOR relation_expected IN
    SELECT relation, columns FROM pg_temp.m039_expected_columns ORDER BY relation
  LOOP
    IF to_regclass(relation_expected.relation) IS NULL THEN
      IF p_phase = 'post' THEN
        RAISE EXCEPTION 'migration 039 postcondition failed: expected relation % is missing',
          relation_expected.relation;
      END IF;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relname = relation_expected.relation
        AND c.relkind <> 'r'
    ) THEN
      RAISE EXCEPTION 'migration 039: % is not an ordinary table; incompatible state',
        relation_expected.relation;
    END IF;

    actual_columns := pg_temp.m039_columns(relation_expected.relation);
    IF actual_columns IS DISTINCT FROM relation_expected.columns THEN
      RAISE EXCEPTION 'migration 039: % does not match the expected column contract; expected %, found %',
        relation_expected.relation, relation_expected.columns, actual_columns;
    END IF;

    SELECT array_agg(c.contype::text || '|' ||
             CASE WHEN c.convalidated THEN 'validated' ELSE 'not_valid' END || '|' ||
             pg_temp.m039_normalize(pg_get_constraintdef(c.oid))
             ORDER BY c.contype::text, c.convalidated,
                      pg_temp.m039_normalize(pg_get_constraintdef(c.oid)))
    INTO actual_constraints
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = current_schema()
      AND r.relname = relation_expected.relation
      AND c.contype <> 'n'
      AND NOT (relation_expected.relation = 'ordered_series_comparison_zero_reason'
               AND c.contype = 'f');

    SELECT array_agg(kind || '|validated|' || definition ORDER BY kind, definition)
    INTO expected_constraints
    FROM pg_temp.m039_expected_constraints
    WHERE relation = relation_expected.relation;

    IF actual_constraints IS DISTINCT FROM expected_constraints THEN
      RAISE EXCEPTION 'migration 039: % has an unexpected constraint contract; expected %, found %',
        relation_expected.relation, expected_constraints, actual_constraints;
    END IF;

    FOR constraint_expected IN
      SELECT kind, definition FROM pg_temp.m039_expected_constraints
      WHERE relation = relation_expected.relation AND kind IN ('p', 'u')
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        JOIN pg_index i ON i.indexrelid = c.conindid
        WHERE n.nspname = current_schema()
          AND r.relname = relation_expected.relation
          AND c.contype = constraint_expected.kind
          AND pg_temp.m039_normalize(pg_get_constraintdef(c.oid)) = constraint_expected.definition
          AND i.indisvalid AND i.indisready AND i.indislive AND i.indisunique
      ) THEN
        RAISE EXCEPTION 'migration 039: % required % index is missing or invalid',
          relation_expected.relation, constraint_expected.kind;
      END IF;
    END LOOP;

    -- Additional independent caller indexes are allowed when they are valid
    -- and non-unique. A unique or invalid extra index changes the contract
    -- (or is an unknown destructive structure) and aborts.
    SELECT array_agg(i.indexrelid::regclass::text ORDER BY i.indexrelid::regclass::text)
    INTO extra_indexes
    FROM pg_index i
    JOIN pg_class r ON r.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = current_schema()
      AND r.relname = relation_expected.relation
      AND NOT i.indisprimary
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
      AND (i.indisunique OR NOT i.indisvalid OR NOT i.indisready OR NOT i.indislive);

    IF extra_indexes IS NOT NULL THEN
      RAISE EXCEPTION 'migration 039: % has unsupported unique/invalid independent index(es): %',
        relation_expected.relation, extra_indexes;
    END IF;

    SELECT array_agg(a.attname || '|' || pg_get_expr(d.adbin, d.adrelid) ORDER BY a.attname)
    INTO actual_defaults
    FROM pg_attribute a
    JOIN pg_class r ON r.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = current_schema()
      AND r.relname = relation_expected.relation
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND d.adbin IS NOT NULL;

    SELECT array_agg(column_name || '|' || expression ORDER BY column_name)
    INTO expected_defaults
    FROM pg_temp.m039_expected_defaults
    WHERE relation = relation_expected.relation;

    IF actual_defaults IS DISTINCT FROM expected_defaults THEN
      RAISE EXCEPTION 'migration 039: % has an unexpected default contract; expected %, found %',
        relation_expected.relation, expected_defaults, actual_defaults;
    END IF;

    SELECT array_agg(g.tgname ORDER BY g.tgname)
    INTO extra_triggers
    FROM pg_trigger g
    JOIN pg_class r ON r.oid = g.tgrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = current_schema()
      AND r.relname = relation_expected.relation
      AND NOT g.tgisinternal;

    IF extra_triggers IS NOT NULL THEN
      RAISE EXCEPTION 'migration 039: % has unsupported user trigger(s): % (this contract defines none)',
        relation_expected.relation, extra_triggers;
    END IF;

    IF relation_expected.relation = 'ordered_series_comparison_zero_reason' THEN
      SELECT array_agg((CASE WHEN c.convalidated THEN 'validated|' ELSE 'not_valid|' END) ||
                 pg_temp.m039_normalize(pg_get_constraintdef(c.oid))
               ORDER BY c.convalidated, pg_temp.m039_normalize(pg_get_constraintdef(c.oid)))
      INTO zero_reason_fks
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = current_schema()
        AND r.relname = relation_expected.relation
        AND c.contype = 'f';

      IF zero_reason_fks IS NULL
         OR NOT (zero_reason_fks = ARRAY['validated|' || fresh_zero_fk]
                 OR zero_reason_fks = ARRAY['validated|' || retained_zero_fk]) THEN
        RAISE EXCEPTION 'migration 039: ordered_series_comparison_zero_reason has an unsupported foreign-key contract; only the exact fresh deferrable shape or the retained 034 cascade shape is accepted; found %',
          zero_reason_fks;
      END IF;
    END IF;

    qualified_name := quote_ident(current_schema()) || '.' || quote_ident(relation_expected.relation);

    IF NOT has_table_privilege('lusk_reader', qualified_name, 'SELECT') THEN
      RAISE EXCEPTION 'migration 039: lusk_reader lacks SELECT on %; existing grants are not repaired',
        relation_expected.relation;
    END IF;
    FOREACH privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('lusk_reader', qualified_name, privilege) THEN
        RAISE EXCEPTION 'migration 039: lusk_reader has unexpected % on %; refusing to continue',
          privilege, relation_expected.relation;
      END IF;
    END LOOP;
    FOREACH privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('lusk_publisher', qualified_name, privilege) THEN
        RAISE EXCEPTION 'migration 039: lusk_publisher lacks % on %; existing grants are not repaired',
          privilege, relation_expected.relation;
      END IF;
    END LOOP;
    IF has_table_privilege('lusk_reader', qualified_name, 'SELECT WITH GRANT OPTION') THEN
      RAISE EXCEPTION 'migration 039: lusk_reader has a grant option on %; refusing to continue',
        relation_expected.relation;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) AS x
      WHERE n.nspname = current_schema()
        AND c.relname = relation_expected.relation
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND (x.grantee = 'lusk_reader'::regrole OR x.grantee = 0)
        AND (x.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'REFERENCES')
             OR x.is_grantable)
    ) THEN
      RAISE EXCEPTION 'migration 039: lusk_reader has unexpected column-level write privilege or grant option on %',
        relation_expected.relation;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  scalar_relations integer;
  ordered_relations integer;
  scalar_state text;
  ordered_state text;
  scalar_pub_lineage boolean;
  scalar_group_lineage boolean;
  scalar_pub_lineage_notnull boolean;
  scalar_group_lineage_notnull boolean;
  scalar_sentinel text;
  source_lineage boolean;
  ordered_axes boolean;
  ordered_pub_lineage boolean;
  ordered_group_lineage boolean;
  ordered_pub_lineage_notnull boolean;
  ordered_group_lineage_notnull boolean;
  ordered_sentinel text;
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
  SELECT a.attnotnull INTO scalar_pub_lineage_notnull
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'scalar_comparison_publication'
      AND a.attname = 'lineage_row_count' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT a.attnotnull INTO scalar_group_lineage_notnull
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'scalar_comparison_group'
      AND a.attname = 'lineage_source_count' AND a.attnum > 0 AND NOT a.attisdropped;
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
  SELECT a.attnotnull INTO ordered_pub_lineage_notnull
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_publication'
      AND a.attname = 'lineage_row_count' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT a.attnotnull INTO ordered_group_lineage_notnull
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'ordered_series_comparison_group'
      AND a.attname = 'lineage_source_count' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT to_regclass('ordered_series_comparison_lineage') IS NOT NULL INTO ordered_lineage;
  SELECT to_regclass('ordered_series_comparison_zero_reason') IS NOT NULL INTO ordered_zero;

  -- Scalar family state and exact-shape classification.
  IF scalar_relations = 0 THEN
    IF source_lineage THEN
      RAISE EXCEPTION 'migration 039: scalar comparison bases are absent but comparison_source_lineage exists; incompatible partial state';
    END IF;
    scalar_state := 'absent';
  ELSIF scalar_relations = 3 THEN
    IF scalar_pub_lineage AND scalar_group_lineage AND source_lineage THEN
      IF scalar_pub_lineage_notnull AND scalar_group_lineage_notnull THEN
        scalar_sentinel := 'not_null';
      ELSIF NOT scalar_pub_lineage_notnull AND NOT scalar_group_lineage_notnull THEN
        scalar_sentinel := 'nullable';
      ELSE
        RAISE EXCEPTION 'migration 039: scalar comparison lineage-count columns mix nullable and NOT NULL; incompatible partial state';
      END IF;
      scalar_state := 'current';
    ELSIF NOT scalar_pub_lineage AND NOT scalar_group_lineage AND NOT source_lineage THEN
      scalar_state := 'present';
    ELSE
      RAISE EXCEPTION 'migration 039: scalar comparison family has a mixed lineage shape; incompatible partial state';
    END IF;
  ELSE
    RAISE EXCEPTION 'migration 039: scalar comparison family has % of 3 base relations; incompatible partial state',
      scalar_relations;
  END IF;

  -- Ordered-series family state and exact-shape classification.
  IF ordered_relations = 0 THEN
    IF ordered_lineage OR ordered_zero THEN
      RAISE EXCEPTION 'migration 039: ordered-series comparison bases are absent but lineage relations exist; incompatible partial state';
    END IF;
    ordered_state := 'absent';
  ELSIF ordered_relations = 3 THEN
    IF ordered_axes AND ordered_pub_lineage AND ordered_group_lineage AND ordered_lineage AND ordered_zero THEN
      IF ordered_pub_lineage_notnull AND ordered_group_lineage_notnull THEN
        ordered_sentinel := 'not_null';
      ELSIF NOT ordered_pub_lineage_notnull AND NOT ordered_group_lineage_notnull THEN
        ordered_sentinel := 'nullable';
      ELSE
        RAISE EXCEPTION 'migration 039: ordered-series lineage-count columns mix nullable and NOT NULL; incompatible partial state';
      END IF;
      ordered_state := 'current';
    ELSIF NOT ordered_axes AND NOT ordered_pub_lineage AND NOT ordered_group_lineage
      AND NOT ordered_lineage AND NOT ordered_zero THEN
      ordered_state := 'present';
    ELSE
      RAISE EXCEPTION 'migration 039: ordered-series comparison family has a mixed lineage shape; incompatible partial state';
    END IF;
  ELSE
    RAISE EXCEPTION 'migration 039: ordered-series comparison family has % of 3 base relations; incompatible partial state',
      ordered_relations;
  END IF;

  -- Exact expected columns. For current families the sentinel pair is kept
  -- coherent: both nullable (033/034) or both NOT NULL (fresh schema.sql).
  INSERT INTO pg_temp.m039_expected_columns(relation, columns) VALUES
    ('scalar_comparison_territory', ARRAY[
      'comparison_context:text:1', 'group_id:text:1', 'indicator_id:text:1', 'rank:integer:0',
      'rank_size:integer:0', 'status:text:1', 'territory_id:text:1', 'territory_type:text:1',
      'tie_count:integer:0', 'value:double precision:0']::text[]),
    ('ordered_series_comparison_territory', ARRAY[
      'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1', 'group_id:text:1',
      'indicator_id:text:1', 'rank:integer:0', 'rank_size:integer:0', 'status:text:1',
      'territory_id:text:1', 'territory_type:text:1', 'tie_count:integer:0',
      'value:double precision:0']::text[]);

  IF scalar_state = 'current' THEN
    INSERT INTO pg_temp.m039_expected_columns(relation, columns) VALUES
      ('scalar_comparison_publication', ARRAY[
        'content_version:text:1', 'group_row_count:integer:1',
        'lineage_row_count:integer:' || CASE scalar_sentinel WHEN 'nullable' THEN '0' ELSE '1' END,
        'published_at:timestamp with time zone:1', 'reference_content_version:text:1',
        'scalar_content_version:text:1', 'singleton:boolean:1', 'territory_row_count:integer:1']::text[]),
      ('scalar_comparison_group', ARRAY[
        'comparison_context:text:1', 'eligible_count:integer:1', 'group_id:text:1',
        'indicator_id:text:1',
        'lineage_source_count:integer:' || CASE scalar_sentinel WHEN 'nullable' THEN '0' ELSE '1' END,
        'median:double precision:0', 'member_count:integer:1', 'missing_count:integer:1',
        'statistic:text:1', 'territory_type:text:1']::text[]),
      ('comparison_source_lineage', ARRAY[
        'comparison_content_version:text:1', 'comparison_context:text:1',
        'comparison_family:text:1', 'facet_id:text:1', 'group_id:text:1', 'source_id:text:1',
        'territory_type:text:1', 'vintage_id:text:1']::text[]);
  ELSE
    INSERT INTO pg_temp.m039_expected_columns(relation, columns) VALUES
      ('scalar_comparison_publication', ARRAY[
        'content_version:text:1', 'group_row_count:integer:1',
        'published_at:timestamp with time zone:1', 'reference_content_version:text:1',
        'scalar_content_version:text:1', 'singleton:boolean:1', 'territory_row_count:integer:1']::text[]),
      ('scalar_comparison_group', ARRAY[
        'comparison_context:text:1', 'eligible_count:integer:1', 'group_id:text:1',
        'indicator_id:text:1', 'median:double precision:0', 'member_count:integer:1',
        'missing_count:integer:1', 'statistic:text:1', 'territory_type:text:1']::text[]);
  END IF;

  IF ordered_state = 'current' THEN
    INSERT INTO pg_temp.m039_expected_columns(relation, columns) VALUES
      ('ordered_series_comparison_publication', ARRAY[
        'comparison_axes:text[]:1', 'content_version:text:1', 'dataset_id:text:1',
        'group_row_count:integer:1', 'indicator_id:text:1',
        'lineage_row_count:integer:' || CASE ordered_sentinel WHEN 'nullable' THEN '0' ELSE '1' END,
        'ordered_series_content_version:text:1', 'published_at:timestamp with time zone:1',
        'reference_content_version:text:1', 'territory_row_count:integer:1']::text[]),
      ('ordered_series_comparison_group', ARRAY[
        'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1',
        'eligible_count:integer:1', 'group_id:text:1', 'group_value:double precision:0',
        'indicator_id:text:1',
        'lineage_source_count:integer:' || CASE ordered_sentinel WHEN 'nullable' THEN '0' ELSE '1' END,
        'member_count:integer:1', 'missing_count:integer:1', 'statistic:text:1',
        'territory_type:text:1']::text[]),
      ('ordered_series_comparison_lineage', ARRAY[
        'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1', 'group_id:text:1',
        'indicator_id:text:1', 'provenance_revision_id:text:1', 'territory_type:text:1']::text[]),
      ('ordered_series_comparison_zero_reason', ARRAY[
        'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1', 'group_id:text:1',
        'indicator_id:text:1', 'member_count:integer:1', 'reason:text:1',
        'territory_type:text:1']::text[]);
  ELSE
    INSERT INTO pg_temp.m039_expected_columns(relation, columns) VALUES
      ('ordered_series_comparison_publication', ARRAY[
        'content_version:text:1', 'dataset_id:text:1', 'group_row_count:integer:1',
        'indicator_id:text:1', 'ordered_series_content_version:text:1',
        'published_at:timestamp with time zone:1', 'reference_content_version:text:1',
        'territory_row_count:integer:1']::text[]),
      ('ordered_series_comparison_group', ARRAY[
        'axis_value:text:1', 'comparison_context:text:1', 'dataset_id:text:1',
        'eligible_count:integer:1', 'group_id:text:1', 'group_value:double precision:0',
        'indicator_id:text:1', 'member_count:integer:1', 'missing_count:integer:1',
        'statistic:text:1', 'territory_type:text:1']::text[]);
  END IF;

  -- Pre-lineage constraints for both families. These are the constraints that
  -- 039's DDL creates; current families add the 033/034 constraints below.
  INSERT INTO pg_temp.m039_expected_constraints(relation, kind, definition) VALUES
    ('scalar_comparison_publication', 'c', $c$CHECK ((group_row_count >= 0))$c$),
    ('scalar_comparison_publication', 'c', $c$CHECK (singleton)$c$),
    ('scalar_comparison_publication', 'c', $c$CHECK ((territory_row_count >= 0))$c$),
    ('scalar_comparison_publication', 'p', $c$PRIMARY KEY (singleton)$c$),

    ('scalar_comparison_group', 'c', $c$CHECK ((member_count = (eligible_count + missing_count)))$c$),
    ('scalar_comparison_group', 'c', $c$CHECK ((((eligible_count = 0) AND (median IS NULL)) OR ((eligible_count > 0) AND (median IS NOT NULL) AND (median <> ALL (ARRAY['Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision])))))$c$),
    ('scalar_comparison_group', 'c', $c$CHECK ((comparison_context = ANY (ARRAY['density_class'::text, 'epci'::text, 'bretagne'::text, 'same_level'::text])))$c$),
    ('scalar_comparison_group', 'c', $c$CHECK ((eligible_count >= 0))$c$),
    ('scalar_comparison_group', 'c', $c$CHECK ((length(TRIM(BOTH FROM group_id)) > 0))$c$),
    ('scalar_comparison_group', 'c', $c$CHECK ((member_count > 0))$c$),
    ('scalar_comparison_group', 'c', $c$CHECK ((missing_count >= 0))$c$),
    ('scalar_comparison_group', 'c', $c$CHECK ((statistic = 'median'::text))$c$),
    ('scalar_comparison_group', 'c', $c$CHECK ((territory_type = ANY (ARRAY['commune'::text, 'epci'::text, 'departement'::text])))$c$),
    ('scalar_comparison_group', 'f', $c$FOREIGN KEY (indicator_id) REFERENCES scalar_descriptor(indicator_id)$c$),
    ('scalar_comparison_group', 'p', $c$PRIMARY KEY (comparison_context, group_id, territory_type, indicator_id)$c$),

    ('scalar_comparison_territory', 'c', $c$CHECK ((((status = 'measured'::text) AND (value IS NOT NULL) AND (value <> ALL (ARRAY['Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision]))) OR ((status <> 'measured'::text) AND (value IS NULL))))$c$),
    ('scalar_comparison_territory', 'c', $c$CHECK ((((status = 'measured'::text) AND (rank IS NOT NULL) AND (tie_count IS NOT NULL) AND (rank_size IS NOT NULL)) OR ((status <> 'measured'::text) AND (rank IS NULL) AND (tie_count IS NULL) AND (rank_size IS NULL))))$c$),
    ('scalar_comparison_territory', 'c', $c$CHECK (((status <> 'measured'::text) OR ((rank <= rank_size) AND (tie_count <= rank_size))))$c$),
    ('scalar_comparison_territory', 'c', $c$CHECK (((rank IS NULL) OR (rank > 0)))$c$),
    ('scalar_comparison_territory', 'c', $c$CHECK (((rank_size IS NULL) OR (rank_size > 0)))$c$),
    ('scalar_comparison_territory', 'c', $c$CHECK ((status = ANY (ARRAY['measured'::text, 'suppressed'::text, 'unsupported'::text, 'not_available'::text, 'not_published'::text])))$c$),
    ('scalar_comparison_territory', 'c', $c$CHECK ((territory_type = ANY (ARRAY['commune'::text, 'epci'::text, 'departement'::text])))$c$),
    ('scalar_comparison_territory', 'c', $c$CHECK (((tie_count IS NULL) OR (tie_count > 0)))$c$),
    ('scalar_comparison_territory', 'f', $c$FOREIGN KEY (comparison_context, group_id, territory_type, indicator_id) REFERENCES scalar_comparison_group(comparison_context, group_id, territory_type, indicator_id) ON DELETE CASCADE$c$),
    ('scalar_comparison_territory', 'f', $c$FOREIGN KEY (indicator_id) REFERENCES scalar_descriptor(indicator_id)$c$),
    ('scalar_comparison_territory', 'f', $c$FOREIGN KEY (territory_id) REFERENCES territory_reference(territory_id)$c$),
    ('scalar_comparison_territory', 'p', $c$PRIMARY KEY (comparison_context, group_id, territory_type, indicator_id, territory_id)$c$),

    ('ordered_series_comparison_publication', 'c', $c$CHECK ((group_row_count >= 0))$c$),
    ('ordered_series_comparison_publication', 'c', $c$CHECK ((territory_row_count >= 0))$c$),
    ('ordered_series_comparison_publication', 'p', $c$PRIMARY KEY (dataset_id, indicator_id)$c$),

    ('ordered_series_comparison_group', 'c', $c$CHECK ((member_count = (eligible_count + missing_count)))$c$),
    ('ordered_series_comparison_group', 'c', $c$CHECK ((((eligible_count = 0) AND (group_value IS NULL)) OR ((eligible_count > 0) AND (group_value IS NOT NULL) AND (group_value <> ALL (ARRAY['Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision])))))$c$),
    ('ordered_series_comparison_group', 'c', $c$CHECK ((comparison_context = ANY (ARRAY['density_class'::text, 'epci'::text, 'bretagne'::text, 'same_level'::text])))$c$),
    ('ordered_series_comparison_group', 'c', $c$CHECK ((eligible_count >= 0))$c$),
    ('ordered_series_comparison_group', 'c', $c$CHECK ((length(TRIM(BOTH FROM group_id)) > 0))$c$),
    ('ordered_series_comparison_group', 'c', $c$CHECK ((member_count > 0))$c$),
    ('ordered_series_comparison_group', 'c', $c$CHECK ((missing_count >= 0))$c$),
    ('ordered_series_comparison_group', 'c', $c$CHECK ((statistic = ANY (ARRAY['median'::text, 'mean'::text])))$c$),
    ('ordered_series_comparison_group', 'c', $c$CHECK ((territory_type = ANY (ARRAY['commune'::text, 'epci'::text, 'departement'::text])))$c$),
    ('ordered_series_comparison_group', 'p', $c$PRIMARY KEY (dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value)$c$),

    ('ordered_series_comparison_territory', 'c', $c$CHECK ((((status = 'measured'::text) AND (value IS NOT NULL) AND (value <> ALL (ARRAY['Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision])) AND (rank > 0) AND (tie_count > 0) AND (rank_size > 0) AND (rank <= rank_size) AND (tie_count <= rank_size)) OR ((status <> 'measured'::text) AND (value IS NULL) AND (rank IS NULL) AND (tie_count IS NULL) AND (rank_size IS NULL))))$c$),
    ('ordered_series_comparison_territory', 'c', $c$CHECK ((status = ANY (ARRAY['measured'::text, 'missing'::text, 'not_published'::text])))$c$),
    ('ordered_series_comparison_territory', 'c', $c$CHECK ((territory_type = ANY (ARRAY['commune'::text, 'epci'::text, 'departement'::text])))$c$),
    ('ordered_series_comparison_territory', 'f', $c$FOREIGN KEY (dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value) REFERENCES ordered_series_comparison_group(dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value) ON DELETE CASCADE$c$),
    ('ordered_series_comparison_territory', 'f', $c$FOREIGN KEY (territory_id) REFERENCES territory_reference(territory_id)$c$),
    ('ordered_series_comparison_territory', 'p', $c$PRIMARY KEY (dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value, territory_id)$c$);

  IF scalar_state = 'current' THEN
    INSERT INTO pg_temp.m039_expected_constraints(relation, kind, definition) VALUES
      ('scalar_comparison_publication', 'c', $c$CHECK ((lineage_row_count >= 0))$c$),
      ('scalar_comparison_group', 'c', $c$CHECK ((lineage_source_count >= 0))$c$),
      ('comparison_source_lineage', 'c', $c$CHECK ((comparison_context = ANY (ARRAY['density_class'::text, 'epci'::text, 'bretagne'::text, 'same_level'::text])))$c$),
      ('comparison_source_lineage', 'c', $c$CHECK ((comparison_family = ANY (ARRAY['scalar'::text, 'profile'::text, 'ordered_series'::text, 'period_detail'::text, 'aedar'::text])))$c$),
      ('comparison_source_lineage', 'c', $c$CHECK ((length(TRIM(BOTH FROM facet_id)) > 0))$c$),
      ('comparison_source_lineage', 'c', $c$CHECK ((length(TRIM(BOTH FROM group_id)) > 0))$c$),
      ('comparison_source_lineage', 'c', $c$CHECK ((territory_type = ANY (ARRAY['commune'::text, 'epci'::text, 'departement'::text])))$c$),
      ('comparison_source_lineage', 'f', $c$FOREIGN KEY (source_id, vintage_id) REFERENCES source_vintage(source_id, vintage_id)$c$),
      ('comparison_source_lineage', 'p', $c$PRIMARY KEY (comparison_family, comparison_context, group_id, territory_type, facet_id, source_id, vintage_id)$c$);
  END IF;

  IF ordered_state = 'current' THEN
    INSERT INTO pg_temp.m039_expected_constraints(relation, kind, definition) VALUES
      ('ordered_series_comparison_publication', 'c', $c$CHECK ((cardinality(comparison_axes) > 0))$c$),
      ('ordered_series_comparison_publication', 'c', $c$CHECK ((lineage_row_count >= 0))$c$),
      ('ordered_series_comparison_group', 'c', $c$CHECK ((lineage_source_count >= 0))$c$),
      ('ordered_series_comparison_lineage', 'f', $c$FOREIGN KEY (dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value) REFERENCES ordered_series_comparison_group(dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value) ON DELETE CASCADE$c$),
      ('ordered_series_comparison_lineage', 'f', $c$FOREIGN KEY (provenance_revision_id) REFERENCES series_provenance_revision(provenance_revision_id)$c$),
      ('ordered_series_comparison_lineage', 'p', $c$PRIMARY KEY (dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value, provenance_revision_id)$c$),
      ('ordered_series_comparison_zero_reason', 'c', $c$CHECK ((member_count > 0))$c$),
      ('ordered_series_comparison_zero_reason', 'c', $c$CHECK ((length(TRIM(BOTH FROM reason)) > 0))$c$),
      ('ordered_series_comparison_zero_reason', 'p', $c$PRIMARY KEY (dataset_id, indicator_id, comparison_context, group_id, territory_type, axis_value, reason)$c$);
  END IF;

  -- Validate every existing family before any target DDL runs. Absent bases
  -- are absent by design at this phase and are validated by the postcondition.
  PERFORM pg_temp.m039_validate_comparison_contract('pre');

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

-- These grants complete newly created absent bases. Existing present/current
-- bases were already validated above, so a missing/invalid grant aborts before
-- this point and is never silently repaired.
GRANT SELECT ON scalar_comparison_publication,scalar_comparison_group,scalar_comparison_territory TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON scalar_comparison_publication,scalar_comparison_group,scalar_comparison_territory TO lusk_publisher;
GRANT SELECT ON ordered_series_comparison_publication,ordered_series_comparison_group,ordered_series_comparison_territory TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON ordered_series_comparison_publication,ordered_series_comparison_group,ordered_series_comparison_territory TO lusk_publisher;

-- Postcondition: every expected relation now exists and carries the exact
-- accepted column/constraint/default/index/trigger/grant contract.
DO $$
BEGIN
  PERFORM pg_temp.m039_validate_comparison_contract('post');
END $$;

DROP FUNCTION pg_temp.m039_validate_comparison_contract(text);
DROP FUNCTION pg_temp.m039_normalize(text);
DROP FUNCTION pg_temp.m039_columns(text);

COMMIT;
