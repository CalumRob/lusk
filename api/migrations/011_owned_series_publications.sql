-- Dataset-owned ordered-series publications. The legacy ordered_series,
-- series_descriptor and table_publication contract remains intact for ENAF
-- until a separately approved reader/publisher rollout.
BEGIN;
CREATE TABLE series_provenance_revision (
  provenance_revision_id text PRIMARY KEY,
  source_id text NOT NULL,
  vintage_id text NOT NULL,
  source_name text NOT NULL,
  dataset_name text NOT NULL,
  source_version text NOT NULL,
  reference_date date NOT NULL,
  publication_date date NOT NULL,
  revision_hash text NOT NULL,
  UNIQUE(source_id, vintage_id, revision_hash)
);
CREATE TABLE series_dataset_publication (
  dataset_id text PRIMARY KEY CHECK(dataset_id ~ '^[a-z][a-z0-9_]{0,95}$'),
  content_version text NOT NULL,
  reference_content_version text NOT NULL,
  row_count bigint NOT NULL CHECK(row_count > 0),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE series_dataset_descriptor (
  dataset_id text NOT NULL REFERENCES series_dataset_publication(dataset_id) ON DELETE CASCADE,
  indicator_id text NOT NULL CHECK(indicator_id ~ '^[a-z][a-z0-9_]{0,95}$'),
  axis_kind text NOT NULL CHECK(axis_kind IN ('year','state_role')),
  axis_values text[] NOT NULL CHECK(cardinality(axis_values)>0),
  completeness text NOT NULL CHECK(completeness IN ('dense_complete','may_be_missing')),
  comparison_point text,
  label text NOT NULL,
  unit text NOT NULL,
  direction text NOT NULL CHECK(direction IN ('high','low','none')),
  allowed_levels text[] NOT NULL CHECK(cardinality(allowed_levels)>0 AND allowed_levels <@ ARRAY['commune','epci','departement','region']::text[]),
  descriptor_version text NOT NULL,
  PRIMARY KEY(dataset_id, indicator_id),
  CHECK(comparison_point IS NULL OR (comparison_point=ANY(axis_values) AND direction IN ('high','low'))),
  CHECK(comparison_point IS NOT NULL OR direction='none')
);
CREATE TABLE series_dataset_observation (
  dataset_id text NOT NULL,
  indicator_id text NOT NULL,
  territory_id text NOT NULL REFERENCES territory_reference(territory_id),
  territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  axis_value text NOT NULL,
  observation_period text NOT NULL,
  value double precision,
  status text NOT NULL CHECK(status IN ('measured','missing')),
  PRIMARY KEY(dataset_id,indicator_id,territory_id,axis_value),
  FOREIGN KEY(dataset_id,indicator_id) REFERENCES series_dataset_descriptor(dataset_id,indicator_id) ON DELETE CASCADE,
  CHECK((status='measured' AND value IS NOT NULL AND value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8)) OR (status='missing' AND value IS NULL))
);
CREATE TABLE series_observation_provenance (
  dataset_id text NOT NULL,
  indicator_id text NOT NULL,
  territory_id text NOT NULL,
  axis_value text NOT NULL,
  provenance_revision_id text NOT NULL REFERENCES series_provenance_revision(provenance_revision_id),
  PRIMARY KEY(dataset_id,indicator_id,territory_id,axis_value,provenance_revision_id),
  FOREIGN KEY(dataset_id,indicator_id,territory_id,axis_value)
    REFERENCES series_dataset_observation(dataset_id,indicator_id,territory_id,axis_value) ON DELETE CASCADE
);
CREATE INDEX series_dataset_observation_axis ON series_dataset_observation(dataset_id,indicator_id,axis_value,territory_id) INCLUDE(value,status);
GRANT SELECT ON series_provenance_revision,series_dataset_publication,series_dataset_descriptor,series_dataset_observation,series_observation_provenance TO lusk_reader;
GRANT SELECT,INSERT ON series_provenance_revision TO lusk_publisher;
GRANT SELECT,INSERT,UPDATE,DELETE ON series_dataset_publication,series_dataset_descriptor,series_dataset_observation,series_observation_provenance TO lusk_publisher;
COMMIT;
