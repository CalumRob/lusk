-- Apply only after api/schema.sql, in the same transaction as the live migration.
-- These are the existing Pi roles; the serving schema is rebuilt by postgres.
GRANT USAGE ON SCHEMA public TO lusk_reader;
GRANT SELECT ON TABLE table_publication,
    access_publication_metadata, territory_reference, service_registry,
    essential_service_access, building_ramp, building_grid,
    source_dataset, source_vintage, scalar_descriptor, scalar_descriptor_source, scalar_observation,
    scalar_observation_source TO lusk_reader;
GRANT USAGE ON SCHEMA public TO lusk_publisher;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE table_publication,
    access_publication_metadata,
    territory_reference, service_registry, essential_service_access,
    building_ramp, building_grid, source_dataset, source_vintage,
    scalar_descriptor, scalar_descriptor_source, scalar_observation, scalar_observation_source TO lusk_publisher;
GRANT EXECUTE ON FUNCTION assert_current_dataset_complete(integer) TO lusk_publisher;
GRANT EXECUTE ON FUNCTION assert_building_dataset_complete(integer, integer) TO lusk_publisher;
