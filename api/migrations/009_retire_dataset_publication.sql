-- Issue #600 only. Existing-database retirement; never part of fresh schema.
-- Run only after the operator preflight in api/migrations/README.md.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  actual_columns text[];
  target_schema text;
  rehearsal_schema text;
BEGIN
  rehearsal_schema := current_setting('lusk.migration_009_rehearsal_schema', true);
  IF current_database() = 'lusk' THEN
    IF current_schema() <> 'public' OR rehearsal_schema IS NOT NULL THEN
      RAISE EXCEPTION '009 production path requires lusk.public without rehearsal override';
    END IF;
    target_schema := 'public';
  ELSIF current_database() = 'lusk_it_contract' THEN
    -- Rehearsal is confined to an explicitly opted-in, dedicated random
    -- non-public schema created and owned by the connected test role.
    IF rehearsal_schema IS NULL
       OR rehearsal_schema !~ '^it_[a-f0-9]{20}$'
       OR current_schema() <> rehearsal_schema
       OR current_schema() = 'public'
       OR NOT EXISTS (
         SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
         WHERE n.nspname = rehearsal_schema AND r.rolname = current_user
       ) THEN
      RAISE EXCEPTION '009 rehearsal requires explicit owned random it_* schema in lusk_it_contract';
    END IF;
    target_schema := rehearsal_schema;
  ELSE
    RAISE EXCEPTION '009 requires lusk.public or guarded lusk_it_contract rehearsal; got %', current_database();
  END IF;
  IF to_regclass(format('%I.dataset_publication', target_schema)) IS NULL THEN
    RAISE EXCEPTION '009 expected %.dataset_publication; refusing unknown state', target_schema;
  END IF;
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO actual_columns
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass(format('%I.dataset_publication', target_schema))
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual_columns IS DISTINCT FROM ARRAY['dataset_key','publication_id','row_count','bretagne_kind','bretagne_label','imported_at']::text[] THEN
    RAISE EXCEPTION '009 found unexpected dataset_publication columns: %', actual_columns;
  END IF;
END $$;
-- RESTRICT is PostgreSQL's default. Deliberately no CASCADE: any catalog
-- dependency aborts the transaction, and operator must investigate it.
DO $$
DECLARE target_schema text;
BEGIN
  IF current_database() = 'lusk' THEN
    target_schema := 'public';
  ELSE
    target_schema := current_setting('lusk.migration_009_rehearsal_schema');
  END IF;
  EXECUTE format('DROP TABLE %I.dataset_publication RESTRICT', target_schema);
END $$;
COMMIT;
