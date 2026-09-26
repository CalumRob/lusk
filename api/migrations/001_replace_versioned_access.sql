-- DESTRUCTIVE to the SIX legacy access-serving tables only. Run with
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
        'territory_reference', 'publication_service_registry',
        'publication_comparison_scope', 'essential_service_access'] LOOP
        IF to_regclass(format('%I.%I', current_schema(), relation)) IS NULL THEN
            RAISE EXCEPTION 'legacy relation %.% not found', current_schema(), relation;
        END IF;
    END LOOP;
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
DROP TABLE publication_comparison_scope;
DROP TABLE publication_service_registry;
DROP TABLE active_publication;
DROP TABLE territory_reference;
DROP TABLE import_publication;
DROP FUNCTION validate_active_publication();
DROP FUNCTION assert_publication_complete(text);
