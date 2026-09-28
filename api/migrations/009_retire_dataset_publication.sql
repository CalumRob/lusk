-- Issue #600 only. Existing-database retirement; never part of fresh schema.
-- Run only after the operator preflight in api/migrations/README.md.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE actual_columns text[];
BEGIN
  IF current_database() <> 'lusk' THEN
    RAISE EXCEPTION '009 requires database lusk, got %', current_database();
  END IF;
  IF current_schema() <> 'public' THEN
    RAISE EXCEPTION '009 requires public schema, got %', current_schema();
  END IF;
  IF to_regclass('public.dataset_publication') IS NULL THEN
    RAISE EXCEPTION '009 expected public.dataset_publication; refusing unknown state';
  END IF;
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO actual_columns
    FROM pg_attribute a
   WHERE a.attrelid = 'public.dataset_publication'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual_columns IS DISTINCT FROM ARRAY['dataset_key','publication_id','row_count','bretagne_kind','bretagne_label','imported_at']::text[] THEN
    RAISE EXCEPTION '009 found unexpected dataset_publication columns: %', actual_columns;
  END IF;
END $$;
-- RESTRICT is PostgreSQL's default. Deliberately no CASCADE: any catalog
-- dependency aborts the transaction, and operator must investigate it.
DROP TABLE public.dataset_publication RESTRICT;
COMMIT;
