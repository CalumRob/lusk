-- Read-only operator inventory for migration 039.
-- Invoke with an explicit target schema and a read-only connection:
--   psql "$READ_ONLY_DSN" -X -v ON_ERROR_STOP=1 -v target_schema=public \
--     -f api/migrations/039_operator_state_inventory.sql
-- This file does not apply or authorize a migration. Run once immediately
-- before and once after the approved 030 -> 039 -> 033 -> 034 sequence; retain
-- both outputs for comparison. The session is explicitly READ ONLY.

\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path TO :"target_schema";

-- Prove the connection identity, read-only transaction, and selected schema
-- before interpreting any inventory result.
SELECT current_database() AS database_name,current_user AS database_role,
       current_setting('transaction_read_only') AS transaction_read_only,
       current_schema() AS target_schema;

-- Advisory shape classification only. This does NOT validate constraints,
-- defaults, indexes, triggers, or grants, and is never migration approval.
WITH families(family, base_relations, lineage_relations, sentinels) AS (
  VALUES
    ('scalar',
      ARRAY['scalar_comparison_publication','scalar_comparison_group','scalar_comparison_territory']::text[],
      ARRAY['comparison_source_lineage']::text[],
      ARRAY['scalar_comparison_publication|lineage_row_count',
            'scalar_comparison_group|lineage_source_count']::text[]),
    ('ordered_series',
      ARRAY['ordered_series_comparison_publication','ordered_series_comparison_group','ordered_series_comparison_territory']::text[],
      ARRAY['ordered_series_comparison_lineage','ordered_series_comparison_zero_reason']::text[],
      ARRAY['ordered_series_comparison_publication|lineage_row_count',
            'ordered_series_comparison_group|lineage_source_count']::text[])
), family_state AS (
  SELECT f.family,
    (SELECT count(*) FROM unnest(f.base_relations) r WHERE to_regclass(r) IS NOT NULL) AS base_relation_count,
    (SELECT count(*) FROM unnest(f.lineage_relations) r WHERE to_regclass(r) IS NOT NULL) AS lineage_relation_count,
    (SELECT count(*) FROM unnest(f.sentinels) s(sentinel)
      WHERE EXISTS (SELECT 1 FROM pg_attribute a
        JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND c.relname=split_part(s.sentinel,'|',1)
          AND a.attname=split_part(s.sentinel,'|',2) AND a.attnum>0 AND NOT a.attisdropped)) AS lineage_column_count,
    (SELECT count(*) FILTER (WHERE a.attnotnull)
      FROM unnest(f.sentinels) s(sentinel)
      LEFT JOIN pg_class c ON c.oid=to_regclass(split_part(s.sentinel,'|',1))
      LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=split_part(s.sentinel,'|',2)
        AND a.attnum>0 AND NOT a.attisdropped) AS sentinel_not_null_count,
    (SELECT string_agg(split_part(s.sentinel,'|',1) || '.' || split_part(s.sentinel,'|',2) || '=' ||
        CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULLABLE' END, ', ' ORDER BY s.sentinel)
      FROM unnest(f.sentinels) s(sentinel)
      LEFT JOIN pg_class c ON c.oid=to_regclass(split_part(s.sentinel,'|',1))
      LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=split_part(s.sentinel,'|',2)
        AND a.attnum>0 AND NOT a.attisdropped) AS sentinel_nullability
  FROM families f
)
SELECT family, base_relation_count, lineage_relation_count, lineage_column_count,
       sentinel_not_null_count,
       sentinel_nullability,
        false AS structural_validation_performed,
        'ADVISORY ONLY: shape is not structural validation; do not apply 039 based on this result' AS advisory,
        CASE
          WHEN base_relation_count=0 AND lineage_relation_count=0 AND lineage_column_count=0 THEN 'ABSENT_SHAPE_ONLY'
          WHEN base_relation_count=3 AND lineage_relation_count=0 AND lineage_column_count=0 THEN 'PRESENT_SHAPE_ONLY'
          WHEN family='scalar' AND base_relation_count=3 AND lineage_relation_count=1
               AND lineage_column_count=2 AND sentinel_not_null_count IN (0,2) THEN 'CURRENT_SHAPE_ONLY'
          WHEN family='ordered_series' AND base_relation_count=3 AND lineage_relation_count=2
               AND lineage_column_count=2 AND sentinel_not_null_count IN (0,2)
              AND EXISTS (SELECT 1 FROM pg_attribute a
                JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname=current_schema() AND c.relname='ordered_series_comparison_publication'
                   AND a.attname='comparison_axes' AND a.attnum>0 AND NOT a.attisdropped) THEN 'CURRENT_SHAPE_ONLY'
          ELSE 'INCOMPATIBLE_SHAPE_ONLY / INVESTIGATE'
        END AS observed_shape_only_state
FROM family_state ORDER BY family;

-- Other comparison foundations owned by 030/032/035 are deliberately outside
-- 039. Inventory their presence explicitly instead of treating their absence
-- as evidence that 039 created or repaired them.
WITH owner_relations(relation_name,owner_migration) AS (VALUES
  ('scalar_comparison_publication','039'),('scalar_comparison_group','039'),('scalar_comparison_territory','039'),
  ('ordered_series_comparison_publication','039'),('ordered_series_comparison_group','039'),
  ('ordered_series_comparison_territory','039'),('ordered_series_comparison_lineage','034'),
  ('profile_comparison_publication','030'),('profile_comparison_group','030'),('profile_comparison_territory','030'),
  ('observed_collection_comparison_publication','030'),('observed_collection_comparison_group','030'),
  ('observed_collection_comparison_territory','030'),('observed_collection_comparison_lineage','035'),
  ('aedar_comparison_publication','032'),('aedar_comparison_group','032'),('aedar_comparison_territory','032'),
  ('comparison_source_lineage','033')
)
SELECT relation_name,owner_migration,
       CASE WHEN to_regclass(relation_name) IS NULL THEN 'ABSENT' ELSE 'PRESENT' END AS observed_presence,
       to_regclass(relation_name) AS resolved_relation
FROM owner_relations ORDER BY owner_migration,relation_name;

-- Full column/type/nullability/default inventory. Missing relations naturally
-- produce no rows; use the family-state result above to distinguish absent.
SELECT table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema=current_schema()
  AND table_name IN (
    'scalar_comparison_publication','scalar_comparison_group','scalar_comparison_territory',
    'ordered_series_comparison_publication','ordered_series_comparison_group',
    'ordered_series_comparison_territory','comparison_source_lineage',
    'ordered_series_comparison_lineage','ordered_series_comparison_zero_reason')
ORDER BY table_name,ordinal_position;

-- Constraints include the target/action/deferrability and validation state.
SELECT t.relname AS table_name, c.conname, c.contype,
       pg_get_constraintdef(c.oid) AS definition,
       c.convalidated, c.condeferrable, c.condeferred
FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname=current_schema()
  AND t.relname IN (
    'scalar_comparison_publication','scalar_comparison_group','scalar_comparison_territory',
    'ordered_series_comparison_publication','ordered_series_comparison_group',
    'ordered_series_comparison_territory','comparison_source_lineage',
    'ordered_series_comparison_lineage','ordered_series_comparison_zero_reason')
ORDER BY t.relname,c.contype,c.conname;

-- Required PK/unique indexes and independent indexes, with validity flags.
SELECT t.relname AS table_name, i.indexrelid::regclass AS index_name,
       pg_get_indexdef(i.indexrelid) AS definition,
       i.indisprimary, i.indisunique, i.indisvalid, i.indisready, i.indislive,
       con.conname AS backing_constraint
FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
LEFT JOIN pg_constraint con ON con.conrelid=t.oid AND con.conindid=i.indexrelid
WHERE n.nspname=current_schema()
  AND t.relname IN (
    'scalar_comparison_publication','scalar_comparison_group','scalar_comparison_territory',
    'ordered_series_comparison_publication','ordered_series_comparison_group',
    'ordered_series_comparison_territory','comparison_source_lineage',
    'ordered_series_comparison_lineage','ordered_series_comparison_zero_reason')
ORDER BY t.relname,index_name;

-- Any result is a user trigger; this migration's comparison contract defines
-- none. Internal FK triggers are intentionally excluded.
SELECT t.relname AS table_name,g.tgname,pg_get_triggerdef(g.oid) AS definition
FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname=current_schema() AND NOT g.tgisinternal
  AND t.relname IN (
    'scalar_comparison_publication','scalar_comparison_group','scalar_comparison_territory',
    'ordered_series_comparison_publication','ordered_series_comparison_group',
    'ordered_series_comparison_territory','comparison_source_lineage',
    'ordered_series_comparison_lineage','ordered_series_comparison_zero_reason')
ORDER BY t.relname,g.tgname;

-- Effective reader/publisher table grants and any explicit column grants.
SELECT table_name,grantee,privilege_type,is_grantable
FROM information_schema.role_table_grants
WHERE table_schema=current_schema()
  AND table_name IN (
    'scalar_comparison_publication','scalar_comparison_group','scalar_comparison_territory',
    'ordered_series_comparison_publication','ordered_series_comparison_group',
    'ordered_series_comparison_territory','comparison_source_lineage',
    'ordered_series_comparison_lineage','ordered_series_comparison_zero_reason')
  AND grantee IN ('lusk_reader','lusk_publisher')
ORDER BY table_name,grantee,privilege_type;
SELECT table_name,column_name,grantee,privilege_type,is_grantable
FROM information_schema.column_privileges
WHERE table_schema=current_schema()
  AND table_name IN (
    'scalar_comparison_publication','scalar_comparison_group','scalar_comparison_territory',
    'ordered_series_comparison_publication','ordered_series_comparison_group',
    'ordered_series_comparison_territory','comparison_source_lineage',
    'ordered_series_comparison_lineage','ordered_series_comparison_zero_reason')
  AND grantee IN ('lusk_reader','lusk_publisher')
ORDER BY table_name,column_name,grantee,privilege_type;

-- Exact row counts for comparison bases/lineage and the protected fact/marker
-- surfaces. query_to_xml executes only the fixed SELECTs constructed here.
WITH relations(relation_name) AS (VALUES
  ('scalar_comparison_publication'),('scalar_comparison_group'),('scalar_comparison_territory'),
  ('ordered_series_comparison_publication'),('ordered_series_comparison_group'),
  ('ordered_series_comparison_territory'),('comparison_source_lineage'),
  ('ordered_series_comparison_lineage'),('ordered_series_comparison_zero_reason'),
  ('profile_comparison_publication'),('profile_comparison_group'),('profile_comparison_territory'),
  ('observed_collection_comparison_publication'),('observed_collection_comparison_group'),
  ('observed_collection_comparison_territory'),('observed_collection_comparison_lineage'),
  ('aedar_comparison_publication'),('aedar_comparison_group'),('aedar_comparison_territory'),
  ('territory_reference'),('table_publication'),('scalar_descriptor'),
  ('scalar_descriptor_source'),('scalar_observation'),('scalar_observation_source'),
  ('series_descriptor'),('ordered_series')
)
SELECT relation_name,
  CASE WHEN to_regclass(relation_name) IS NULL THEN NULL
       ELSE (xpath('/row/row_count/text()',
         query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I',current_schema(),relation_name),
                      false,true,'')))[1]::text::bigint
  END AS exact_row_count
FROM relations ORDER BY relation_name;

COMMIT;
