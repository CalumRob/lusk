CREATE TABLE IF NOT EXISTS aedar_territorial_aggregate (
  territory_type text NOT NULL CHECK (territory_type IN ('commune','epci','departement','region')),
  territory_id text NOT NULL, typequ text NOT NULL, typequ_label text NOT NULL,
  identity jsonb NOT NULL,
  n_addresses bigint NOT NULL CHECK(n_addresses>=0),
  n_observed bigint NOT NULL CHECK(n_observed>=0 AND n_observed<=n_addresses),
  coverage_status text NOT NULL, measures jsonb NOT NULL,
  source_id text NOT NULL DEFAULT 'aedar_bretagne', vintage_id text NOT NULL DEFAULT '2026-v1',
  source_url text NOT NULL, licence text NOT NULL, attribution text NOT NULL,
  PRIMARY KEY(territory_type,territory_id,typequ)
);
CREATE INDEX IF NOT EXISTS aedar_territorial_aggregate_typequ_idx
 ON aedar_territorial_aggregate(territory_type,typequ);
