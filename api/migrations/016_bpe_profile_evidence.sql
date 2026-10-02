BEGIN;

ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check;
ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK (table_name IN (
  'territory_reference','service_registry','essential_service_access','building_ramp','building_grid',
  'scalar_observation','declared_profile','ordered_series','bpe_profile_evidence'));
ALTER TABLE table_publication DROP CONSTRAINT shared_fact_publication_requires_reference;
ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference
  CHECK (table_name NOT IN ('scalar_observation','declared_profile','ordered_series','bpe_profile_evidence')
         OR reference_content_version IS NOT NULL);

CREATE TABLE bpe_profile_evidence_descriptor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  indicator_id text NOT NULL UNIQUE CHECK(indicator_id='bpe_access_profile'),
  descriptor_version text NOT NULL,
  allowed_levels text[] NOT NULL CHECK(allowed_levels=ARRAY['commune','epci','departement','region']::text[]),
  completeness text NOT NULL CHECK(completeness='dense_complete'),
  classification_id text NOT NULL CHECK(length(trim(classification_id))>0),
  universe_count integer NOT NULL CHECK(universe_count>0),
  universe_sha256 text NOT NULL CHECK(universe_sha256 ~ '^[0-9a-f]{64}$'),
  registry_filename text NOT NULL CHECK(length(trim(registry_filename))>0),
  registry_semantic_effect text NOT NULL CHECK(length(trim(registry_semantic_effect))>0),
  source_id text NOT NULL REFERENCES source_dataset(source_id),
  vintage_id text NOT NULL,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);
CREATE TABLE bpe_profile_class_axis (
  class_key text PRIMARY KEY CHECK(class_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  label text NOT NULL CHECK(length(trim(label))>0),
  ordinal smallint NOT NULL UNIQUE CHECK(ordinal>=0),
  direction text NOT NULL CHECK(direction IN ('high','low','none'))
);
CREATE TABLE bpe_profile_evidence (
  territory_id text NOT NULL,
  territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
  class_key text NOT NULL REFERENCES bpe_profile_class_axis(class_key),
  class_label text NOT NULL,
  class_count integer NOT NULL CHECK(class_count>=0),
  universe_count integer NOT NULL CHECK(universe_count>0),
  exemplar_typequ text,
  exemplar_label text,
  exemplar_c double precision,
  exemplar_b double precision,
  exemplar_t double precision,
  PRIMARY KEY(territory_type,territory_id,class_key),
  FOREIGN KEY(territory_id) REFERENCES territory_reference(territory_id),
  CHECK((class_count=0 AND exemplar_typequ IS NULL AND exemplar_label IS NULL
         AND exemplar_c IS NULL AND exemplar_b IS NULL AND exemplar_t IS NULL) OR
        (class_count>0 AND exemplar_typequ ~ '^[A-Z][0-9]{3}$' AND exemplar_label IS NOT NULL
         AND exemplar_c BETWEEN 0 AND 1 AND exemplar_b BETWEEN 0 AND 1 AND exemplar_t BETWEEN 0 AND 1)),
  CHECK(universe_count >= class_count)
);
CREATE TABLE bpe_profile_evidence_source (
  territory_type text NOT NULL, territory_id text NOT NULL, class_key text NOT NULL,
  source_id text NOT NULL, vintage_id text NOT NULL,
  PRIMARY KEY(territory_type,territory_id,class_key,source_id,vintage_id),
  FOREIGN KEY(territory_type,territory_id,class_key)
    REFERENCES bpe_profile_evidence(territory_type,territory_id,class_key) ON DELETE CASCADE,
  FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)
);

CREATE FUNCTION assert_bpe_profile_evidence_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer; bad boolean;
BEGIN
  SELECT universe_count INTO expected FROM bpe_profile_evidence_descriptor WHERE singleton;
  IF expected IS NULL THEN RAISE EXCEPTION 'BPE profile evidence descriptor is unavailable'; END IF;
  IF (SELECT count(*) FROM bpe_profile_class_axis) <> 4 THEN
    RAISE EXCEPTION 'BPE evidence requires exactly four declared class axes';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM territory_reference t
    WHERE EXISTS (SELECT 1 FROM bpe_profile_evidence e WHERE e.territory_id=t.territory_id AND e.territory_type=t.territory_type)
      AND (SELECT count(*) FROM bpe_profile_evidence e WHERE e.territory_id=t.territory_id AND e.territory_type=t.territory_type) <>
          (SELECT count(*) FROM bpe_profile_class_axis)
  ) INTO bad;
  IF bad THEN RAISE EXCEPTION 'BPE profile evidence is not dense over declared class axes'; END IF;
  IF EXISTS (SELECT 1 FROM bpe_profile_evidence GROUP BY territory_type,territory_id
             HAVING sum(class_count)<>expected OR min(universe_count)<>expected OR max(universe_count)<>expected)
  THEN RAISE EXCEPTION 'BPE profile evidence universe/count partition is incomplete'; END IF;
  IF EXISTS (SELECT 1 FROM bpe_profile_evidence e JOIN bpe_profile_class_axis a USING(class_key)
             WHERE e.class_label<>a.label)
  THEN RAISE EXCEPTION 'BPE fact class labels differ from the declared class axis'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bpe_profile_evidence_complete
  AFTER INSERT OR UPDATE OR DELETE ON bpe_profile_evidence
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_bpe_profile_evidence_complete();

COMMIT;
