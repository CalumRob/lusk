BEGIN;
ALTER TABLE table_publication DROP CONSTRAINT shared_fact_publication_requires_reference;
ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference
 CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading','bpe_profile_evidence','economy_typed_reading','economy_activity_evidence','milieux_typed_reading') OR reference_content_version IS NOT NULL);
ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK(table_name IN (
 'territory_reference','service_registry','essential_service_access','building_ramp','building_grid',
 'scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading',
 'bpe_profile_evidence','economy_typed_reading','economy_activity_evidence','milieux_typed_reading'));
CREATE TABLE milieux_typed_reading (
 territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
 groupe text NOT NULL, story_key text NOT NULL, salience_reason text NOT NULL,
 periode_pop text, periode_artif text, delta_population double precision,
 taux_variation_population double precision, artif_m2_par_habitant double precision,
 artif_m3_par_habitant double precision, trajectoire_artif_par_habitant double precision,
 classification text, status text NOT NULL CHECK(status IN ('measured','unavailable')),
 source_id text NOT NULL, vintage_id text NOT NULL,
 PRIMARY KEY(territory_id,territory_type,groupe),
 FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
 CHECK ((status='measured') = (periode_pop IS NOT NULL AND periode_artif IS NOT NULL AND classification IS NOT NULL)),
 CHECK (delta_population IS NULL OR delta_population NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
 CHECK (taux_variation_population IS NULL OR taux_variation_population NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
 CHECK (artif_m2_par_habitant IS NULL OR artif_m2_par_habitant NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
 CHECK (artif_m3_par_habitant IS NULL OR artif_m3_par_habitant NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))
);
CREATE TABLE milieux_population_provenance_revision (
 population_revision_id text PRIMARY KEY,
 source_id text NOT NULL, vintage_id text NOT NULL, source_name text NOT NULL,
 dataset_name text NOT NULL, source_version text NOT NULL,
 reference_date date, publication_date date, revision_hash text NOT NULL,
 UNIQUE(source_id,vintage_id,revision_hash)
);
CREATE FUNCTION reject_milieux_population_provenance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Milieux population provenance revisions are immutable'; END $$;
CREATE TRIGGER milieux_population_provenance_immutable BEFORE UPDATE OR DELETE ON milieux_population_provenance_revision
 FOR EACH ROW EXECUTE FUNCTION reject_milieux_population_provenance_mutation();
CREATE TABLE milieux_reading_source (
 territory_id text NOT NULL, territory_type text NOT NULL, groupe text NOT NULL,
 field_key text NOT NULL CHECK(field_key IN ('population','artif_m2_par_habitant','artif_m3_par_habitant')),
 source_id text NOT NULL, vintage_id text NOT NULL, source_name text NOT NULL, source_version text NOT NULL,
 reference_date date, publication_date date, observation_period text,
 dataset_id text, dataset_content_version text, state_role text, axis_value text,
 provenance_revision_id text REFERENCES series_provenance_revision(provenance_revision_id),
 population_revision_id text REFERENCES milieux_population_provenance_revision(population_revision_id),
 PRIMARY KEY(territory_id,territory_type,groupe,field_key,source_id,vintage_id),
 FOREIGN KEY(territory_id,territory_type,groupe) REFERENCES milieux_typed_reading(territory_id,territory_type,groupe) ON DELETE CASCADE,
 FOREIGN KEY(dataset_id) REFERENCES series_dataset_publication(dataset_id),
 CHECK ((field_key='population' AND dataset_id IS NULL AND dataset_content_version IS NULL AND state_role IS NULL AND provenance_revision_id IS NULL AND population_revision_id IS NOT NULL)
     OR (field_key IN ('artif_m2_par_habitant','artif_m3_par_habitant') AND dataset_id IS NOT NULL AND dataset_content_version IS NOT NULL AND state_role IN ('M2','M3') AND provenance_revision_id IS NOT NULL AND population_revision_id IS NULL))
);
GRANT SELECT ON milieux_typed_reading,milieux_reading_source TO lusk_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON milieux_typed_reading,milieux_reading_source TO lusk_publisher;
GRANT SELECT ON milieux_population_provenance_revision TO lusk_reader;
GRANT SELECT,INSERT ON milieux_population_provenance_revision TO lusk_publisher;
COMMIT;
