-- Apply once to an existing PostgreSQL database. This file contains no reset/drop operations.
CREATE TABLE IF NOT EXISTS import_publication (
    publication_id text PRIMARY KEY,
    status text NOT NULL CHECK (status IN ('loading', 'validated')),
    row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS active_publication (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    publication_id text NOT NULL REFERENCES import_publication(publication_id)
);

CREATE TABLE IF NOT EXISTS territory_reference (
    publication_id text NOT NULL REFERENCES import_publication(publication_id),
    territory_id text NOT NULL,
    territory_type text NOT NULL,
    name text NOT NULL,
    department_id text,
    epci_id text,
    density_class_code text,
    density_class_label text,
    PRIMARY KEY (publication_id, territory_id)
);

-- Dataset-published registry: validation checks every territory against every
-- expected service, including groups with zero access rows.
CREATE TABLE IF NOT EXISTS publication_service_registry (
    publication_id text NOT NULL REFERENCES import_publication(publication_id),
    service text NOT NULL,
    PRIMARY KEY (publication_id, service)
);

CREATE TABLE IF NOT EXISTS publication_comparison_scope (
    publication_id text PRIMARY KEY REFERENCES import_publication(publication_id),
    scope_key text NOT NULL CHECK (scope_key = 'bretagne'),
    kind text NOT NULL,
    label text NOT NULL
);

CREATE TABLE IF NOT EXISTS essential_service_access (
    publication_id text NOT NULL REFERENCES import_publication(publication_id),
    territory_id text NOT NULL,
    service text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('walk_transit', 'bike', 'car')),
    share double precision CHECK (share IS NULL OR (share >= 0 AND share <= 1)),
    indicator_label text NOT NULL,
    effective_direction text NOT NULL CHECK (effective_direction IN ('high', 'low')),
    source_id text NOT NULL,
    source_name text NOT NULL,
    source_version text NOT NULL,
    reference_date date,
    source_publication_date date,
    PRIMARY KEY (publication_id, territory_id, service, mode),
    FOREIGN KEY (publication_id, territory_id)
        REFERENCES territory_reference(publication_id, territory_id)
);

CREATE INDEX IF NOT EXISTS essential_service_access_active_lookup
    ON essential_service_access (publication_id, territory_id, service);

-- A publication cannot be made active unless every published territory/service has all modes.
CREATE OR REPLACE FUNCTION assert_publication_complete(publication text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE invalid_groups bigint;
BEGIN
    SELECT count(*) INTO invalid_groups
    FROM (
        SELECT t.territory_id, s.service
        FROM territory_reference t
        CROSS JOIN publication_service_registry s
        LEFT JOIN essential_service_access a
          ON a.publication_id = t.publication_id
         AND a.territory_id = t.territory_id AND a.service = s.service
        WHERE t.publication_id = publication AND s.publication_id = publication
        GROUP BY t.territory_id, s.service
        HAVING count(a.mode) <> 3 OR count(DISTINCT a.mode) <> 3
    ) incomplete;
    IF invalid_groups <> 0
       OR NOT EXISTS (SELECT 1 FROM territory_reference WHERE publication_id = publication)
       OR NOT EXISTS (SELECT 1 FROM publication_service_registry WHERE publication_id = publication) THEN
        RAISE EXCEPTION 'publication % has incomplete service triptychs', publication;
    END IF;
    RETURN;
END $$;

CREATE OR REPLACE FUNCTION validate_active_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM import_publication WHERE publication_id = NEW.publication_id AND status = 'validated') THEN
        RAISE EXCEPTION 'publication % is not validated', NEW.publication_id;
    END IF;
    PERFORM assert_publication_complete(NEW.publication_id);
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER active_publication_validate BEFORE INSERT OR UPDATE ON active_publication
FOR EACH ROW EXECUTE FUNCTION validate_active_publication();
