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
 artif_m3_par_habitant double precision, trajectoire_artif_par_habitant text,
 classification text, status text NOT NULL CHECK(status IN ('measured','unavailable')),
 source_id text NOT NULL, vintage_id text NOT NULL,
 PRIMARY KEY(territory_id,territory_type,groupe),
 FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
 FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
 CHECK ((status='measured') = (periode_pop IS NOT NULL AND periode_artif IS NOT NULL AND classification IS NOT NULL)),
 CHECK (delta_population IS NULL OR delta_population NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
 CHECK (taux_variation_population IS NULL OR taux_variation_population NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
 CHECK (artif_m2_par_habitant IS NULL OR artif_m2_par_habitant NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
 CHECK (artif_m3_par_habitant IS NULL OR artif_m3_par_habitant NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))
);
COMMIT;
