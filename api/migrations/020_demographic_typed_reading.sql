BEGIN;
CREATE UNIQUE INDEX territory_reference_id_type_unique ON territory_reference(territory_id,territory_type);
ALTER TABLE table_publication DROP CONSTRAINT shared_fact_publication_requires_reference;
ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference
 CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading') OR reference_content_version IS NOT NULL);
ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK(table_name IN (
 'territory_reference','service_registry','essential_service_access','building_ramp','building_grid',
  'scalar_observation','declared_profile','ordered_series','demographic_typed_reading','selected_reading'));
CREATE TABLE demographic_reading_descriptor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  descriptor_version text NOT NULL,
  source_id text NOT NULL REFERENCES source_dataset(source_id),
  vintage_id text NOT NULL,
  rate_unit text NOT NULL,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);
CREATE TABLE demographic_typed_reading (
  territory_id text NOT NULL,
  territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  groupe text NOT NULL,
  story_key text NOT NULL,
  salience_reason text NOT NULL,
  periode text,
  solde_naturel double precision,
  solde_migratoire double precision,
  taux_solde_naturel double precision,
  taux_solde_migratoire double precision,
  classification text,
  status text NOT NULL CHECK(status IN ('measured','unavailable')),
  source_id text NOT NULL,
  vintage_id text NOT NULL,
  PRIMARY KEY(territory_id,territory_type,groupe),
  FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
  CHECK ((status='measured') = (periode IS NOT NULL AND solde_naturel IS NOT NULL AND solde_migratoire IS NOT NULL AND
    taux_solde_naturel IS NOT NULL AND taux_solde_migratoire IS NOT NULL AND classification IS NOT NULL)),
  CHECK (solde_naturel IS NULL OR solde_naturel NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
  CHECK (solde_migratoire IS NULL OR solde_migratoire NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
  CHECK (taux_solde_naturel IS NULL OR taux_solde_naturel NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)),
  CHECK (taux_solde_migratoire IS NULL OR taux_solde_migratoire NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))
);
-- Other selected histories share a publication marker, not an untyped payload.
CREATE TABLE selected_reading_descriptor (
  theme_id text PRIMARY KEY CHECK(theme_id IN ('habitat')),
  descriptor_version text NOT NULL, source_id text NOT NULL REFERENCES source_dataset(source_id),
  vintage_id text NOT NULL, linked_content_version text NOT NULL,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id));
CREATE TABLE selected_reading_publication (
  theme_id text PRIMARY KEY REFERENCES selected_reading_descriptor(theme_id) ON DELETE CASCADE,
  content_version text NOT NULL, reference_content_version text NOT NULL,
  row_count integer NOT NULL CHECK(row_count>0), published_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE habitat_typed_reading (
  territory_id text NOT NULL, territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  groupe text NOT NULL, story_key text NOT NULL, salience_reason text NOT NULL,
  classification text, part_passoires double precision, part_abc double precision, n_dpe bigint,
  status text NOT NULL CHECK(status IN ('measured','suppressed','unavailable')),
  source_id text NOT NULL, vintage_id text NOT NULL,
  PRIMARY KEY(territory_id,territory_type,groupe),
  FOREIGN KEY(territory_id,territory_type) REFERENCES territory_reference(territory_id,territory_type),
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id),
  CHECK ((status='measured') = (classification IS NOT NULL AND part_passoires IS NOT NULL AND part_abc IS NOT NULL AND n_dpe IS NOT NULL)),
  CHECK (status <> 'suppressed' OR (part_passoires IS NULL AND part_abc IS NULL)),
  CHECK (part_passoires IS NULL OR part_passoires BETWEEN 0 AND 1), CHECK(part_abc IS NULL OR part_abc BETWEEN 0 AND 1),
  CHECK(n_dpe IS NULL OR n_dpe>=0));
COMMIT;
