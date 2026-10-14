BEGIN;
ALTER TABLE aedar_territorial_aggregate
  ADD COLUMN typequ_hierarchy_label text,
  ADD COLUMN typequ_domain_code text,
  ADD COLUMN typequ_domain_label text,
  ADD COLUMN typequ_subdomain_code text,
  ADD COLUMN typequ_subdomain_label text,
  ADD COLUMN typequ_gamme text,
  ADD COLUMN typequ_gamme_status text,
  ADD COLUMN typequ_source_order integer;
ALTER TABLE aedar_territorial_aggregate ADD CONSTRAINT aedar_typequ_metadata_status_check
  CHECK (typequ_gamme_status IS NULL OR typequ_gamme_status IN ('classified','hors_gamme','absent'));
ALTER TABLE aedar_territorial_aggregate ADD CONSTRAINT aedar_typequ_metadata_order_check
  CHECK (typequ_source_order IS NULL OR typequ_source_order BETWEEN 1 AND 235);
ALTER TABLE aedar_territorial_aggregate ADD CONSTRAINT aedar_typequ_metadata_complete_check
  CHECK (
    (typequ_hierarchy_label IS NULL AND typequ_domain_code IS NULL AND typequ_domain_label IS NULL AND typequ_subdomain_code IS NULL AND
     typequ_subdomain_label IS NULL AND typequ_gamme_status IS NULL AND typequ_source_order IS NULL AND typequ_gamme IS NULL)
    OR
    (typequ_hierarchy_label IS NOT NULL AND typequ_domain_code IS NOT NULL AND typequ_domain_label IS NOT NULL AND typequ_subdomain_code IS NOT NULL AND
     typequ_subdomain_label IS NOT NULL AND typequ_gamme_status IS NOT NULL AND typequ_source_order IS NOT NULL AND
     ((typequ_gamme_status='absent' AND typequ_gamme IS NULL) OR
      (typequ_gamme_status='hors_gamme' AND typequ_gamme='Hors Gamme') OR
      (typequ_gamme_status='classified' AND typequ_gamme IS NOT NULL AND typequ_gamme<>'Hors Gamme')))
  );
COMMIT;
