BEGIN;
ALTER TABLE table_publication DROP CONSTRAINT shared_fact_publication_requires_reference;
ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference
 CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading','bpe_profile_evidence','economy_typed_reading','economy_activity_evidence') OR reference_content_version IS NOT NULL);
ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK(table_name IN (
 'territory_reference','service_registry','essential_service_access','building_ramp','building_grid',
 'scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading','bpe_profile_evidence','economy_typed_reading','economy_activity_evidence'));
CREATE TABLE economy_typed_reading (
 territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
 groupe text NOT NULL, story_key text NOT NULL, salience_reason text NOT NULL,
 status text NOT NULL CHECK(status IN ('measured','unavailable')),
 source_id text NOT NULL, vintage_id text NOT NULL,
 PRIMARY KEY(territory_id,territory_type,groupe),
 FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
 FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE TABLE economy_activity_evidence (
 territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
 groupe text NOT NULL, rank smallint NOT NULL CHECK(rank BETWEEN 1 AND 5),
 activity_code text NOT NULL, activity_label text NOT NULL, lq double precision NOT NULL CHECK(lq>=0),
 establishment_count bigint NOT NULL CHECK(establishment_count>=0), park_share double precision,
 source_id text NOT NULL, vintage_id text NOT NULL,
 PRIMARY KEY(territory_id,territory_type,groupe,rank),
 FOREIGN KEY(territory_id,territory_type,groupe) REFERENCES economy_typed_reading(territory_id,territory_type,groupe) ON DELETE CASCADE,
 FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
 CHECK(park_share IS NULL OR park_share BETWEEN 0 AND 1));
COMMIT;
