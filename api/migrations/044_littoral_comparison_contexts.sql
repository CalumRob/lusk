BEGIN;

-- #1042: widen the closed comparison_context domain of the four published
-- comparison families and their shared source-lineage table to admit the
-- littoral context (group_id 'C'/'NC', territory_type 'commune'). Additive
-- only: no row, column, trigger, grant or table is changed, so every existing
-- density/EPCI/Bretagne/same_level generation stays readable and writable.
--
-- Operator ordering: apply AFTER the pack 030 -> 039 -> 033 -> 034 -> 035.
-- The driver is the upgrade-gap case, not 039's definition check: on an upgrade
-- the comparison base tables do not exist until 039 creates them (and the
-- lineage tables until 033/034/035), so 044 has no target to widen if it runs
-- first; running it after the pack also widens each relation exactly once, in
-- its final shape. 039's exact validator now accepts BOTH the pre-044 four-value
-- and the post-044 five-value CHECK (m039_normalize_context), so a widened
-- fresh/current schema replays 039 cleanly. Fresh installs take the widened
-- definition directly from schema.sql. The reference version and every
-- comparison generation must be republished together (see
-- api/migrations/README.md); applying this DDL alone publishes nothing.

DO $m044$
DECLARE
  target_schema_table text;
  existing_check text;
  already_widened boolean;
BEGIN
  FOREACH target_schema_table IN ARRAY ARRAY[
    'scalar_comparison_group',
    'comparison_source_lineage',
    'profile_comparison_group',
    'ordered_series_comparison_group',
    'observed_collection_comparison_group'
  ]
  LOOP
    SELECT c.conname,
           bool_or(pg_get_constraintdef(c.oid) LIKE '%''littoral''%')
      INTO existing_check, already_widened
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = current_schema()
       AND r.relname = target_schema_table
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%comparison_context%'
     GROUP BY c.conname;

    IF existing_check IS NULL THEN
      RAISE EXCEPTION 'migration 044: no comparison_context CHECK on %',
        target_schema_table;
    END IF;
    IF already_widened THEN
      -- Idempotent replay: a fresh/current schema already carries littoral.
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',
      target_schema_table, existing_check);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (comparison_context IN '
      '(''density_class'',''epci'',''bretagne'',''same_level'',''littoral''))',
      target_schema_table, existing_check);
  END LOOP;
END;
$m044$;

COMMIT;
