-- Fresh serving schema. Do not apply over the legacy versioned schema: use the
-- explicit operator migration procedure in README-deploy.md instead.
CREATE TABLE dataset_publication (
    dataset_key text PRIMARY KEY CHECK (dataset_key = 'essential_service_access'),
    publication_id text NOT NULL,
    row_count integer NOT NULL CHECK (row_count > 0),
    bretagne_kind text NOT NULL,
    bretagne_label text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE territory_reference (
    territory_id text PRIMARY KEY,
    territory_type text NOT NULL,
    name text NOT NULL,
    department_id text,
    epci_id text,
    density_class_code text,
    density_class_label text
);

CREATE TABLE service_registry (service text PRIMARY KEY);

CREATE TABLE essential_service_access (
    territory_id text NOT NULL REFERENCES territory_reference(territory_id),
    service text NOT NULL REFERENCES service_registry(service),
    mode text NOT NULL CHECK (mode IN ('walk_transit', 'bike', 'car')),
    share double precision CHECK (share IS NULL OR (share >= 0 AND share <= 1)),
    indicator_label text NOT NULL,
    effective_direction text NOT NULL CHECK (effective_direction IN ('high', 'low')),
    source_id text NOT NULL,
    source_name text NOT NULL,
    source_version text NOT NULL,
    reference_date date,
    source_publication_date date,
    PRIMARY KEY (territory_id, service, mode)
);

CREATE INDEX essential_service_access_territory_lookup
    ON essential_service_access (territory_id, service);

-- Called by the publisher inside the replacement transaction, before the
-- dataset_publication row is updated. The service list comes from metadata.
CREATE FUNCTION assert_current_dataset_complete(expected_rows integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM territory_reference)
       OR NOT EXISTS (SELECT 1 FROM service_registry)
       OR expected_rows <> (SELECT count(*) FROM essential_service_access)
       OR EXISTS (
           SELECT 1 FROM territory_reference t CROSS JOIN service_registry s
           LEFT JOIN essential_service_access a
             ON a.territory_id = t.territory_id AND a.service = s.service
           GROUP BY t.territory_id, s.service
           HAVING count(a.mode) <> 3
       ) THEN
        RAISE EXCEPTION 'incomplete essential-service dataset';
    END IF;
END $$;
