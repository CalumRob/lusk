-- Apply only after api/schema.sql, in the same transaction as the live migration.
-- These are the existing Pi roles; the serving schema is rebuilt by postgres.
GRANT USAGE ON SCHEMA public TO lusk_reader;
GRANT SELECT ON TABLE dataset_publication, territory_reference,
    service_registry, essential_service_access TO lusk_reader;
GRANT USAGE ON SCHEMA public TO lusk_publisher;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dataset_publication,
    territory_reference, service_registry, essential_service_access TO lusk_publisher;
GRANT EXECUTE ON FUNCTION assert_current_dataset_complete(integer) TO lusk_publisher;
