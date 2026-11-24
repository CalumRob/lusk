BEGIN;

-- ADR-0049 step 2 (#1140): publish the producer discovery declaration with the
-- resource version. STRICTLY ADDITIVE: no registry row, global marker, serving
-- descriptor, constraint or grant is changed. The API intersects this table
-- with live, non-retired resource_publication rows and the image-owned grammar.
--
-- One storage resource may project several grammar identities (AEDAR aggregate
-- and summary); publication_resource_id makes that mapping explicit. The
-- content-version equality is part of the READ join, so an old descriptor can
-- never advertise a newer registry version.
--
-- Like every migration in this directory, this file OWNS its transaction:
-- apply it with psql --set ON_ERROR_STOP=on and WITHOUT --single-transaction.

CREATE TABLE IF NOT EXISTS resource_publication_descriptor (
    resource_id text PRIMARY KEY CHECK (resource_id ~ '^[a-z][a-z0-9_]{0,95}$'),
    publication_resource_id text NOT NULL CHECK (publication_resource_id ~ '^[a-z][a-z0-9_]{0,95}$'),
    content_version text NOT NULL CHECK (length(content_version) > 0),
    descriptor jsonb NOT NULL CHECK (jsonb_typeof(descriptor) = 'object'),
    published_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (publication_resource_id) REFERENCES resource_publication(resource_id)
      ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS resource_publication_descriptor_live_idx
  ON resource_publication_descriptor(publication_resource_id,content_version);

GRANT SELECT ON resource_publication_descriptor TO lusk_reader;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON resource_publication_descriptor FROM lusk_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON resource_publication_descriptor TO lusk_publisher;

COMMIT;
