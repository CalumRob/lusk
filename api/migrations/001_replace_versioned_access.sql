-- DESTRUCTIVE to the FOUR original access-serving tables, plus the TWO
-- optional metadata tables introduced after the Pi's first deployment. Run with
-- ON_ERROR_STOP and --single-transaction together with api/schema.sql and
-- api/migrations/001_grant_reader.sql, after operator preflight and backup.
-- Never use CASCADE. A dependent object must cause a safe failure.
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE relation text;
BEGIN
    IF current_database() <> 'lusk' AND current_database() NOT LIKE 'lusk\_it\_%' ESCAPE '\' THEN
        RAISE EXCEPTION 'refusing access migration in database %', current_database();
    END IF;
    IF current_schema() <> 'public' AND current_schema() NOT LIKE 'it\_%' ESCAPE '\' THEN
        RAISE EXCEPTION 'refusing access migration in schema %', current_schema();
    END IF;
    FOREACH relation IN ARRAY ARRAY['import_publication', 'active_publication',
        'territory_reference', 'essential_service_access'] LOOP
        IF to_regclass(format('%I.%I', current_schema(), relation)) IS NULL THEN
            RAISE EXCEPTION 'legacy relation %.% not found', current_schema(), relation;
        END IF;
    END LOOP;
    -- Either the original Pi schema (neither table) or the later six-table
    -- schema (both tables). A partial/unknown migration must be investigated.
    IF (to_regclass(format('%I.publication_service_registry', current_schema())) IS NULL)
       <> (to_regclass(format('%I.publication_comparison_scope', current_schema())) IS NULL) THEN
        RAISE EXCEPTION 'unexpected partial legacy access schema';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'essential_service_access'
          AND column_name = 'publication_id'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'active_publication'
          AND column_name = 'singleton'
    ) THEN
        RAISE EXCEPTION 'serving schema is not the expected legacy version';
    END IF;
END $$;

DROP TABLE essential_service_access;
DROP TABLE IF EXISTS publication_comparison_scope;
DROP TABLE IF EXISTS publication_service_registry;
DROP TABLE active_publication;
DROP TABLE territory_reference;
DROP TABLE import_publication;
DROP FUNCTION validate_active_publication();
DROP FUNCTION assert_publication_complete(text);
