-- Validate AEDAR comparison counts with one grouped pass. The previous
-- correlated count subqueries scanned the territory publication once per
-- comparison group (439,920 groups in the retained TYPEQU × measure grid).
BEGIN;

CREATE OR REPLACE FUNCTION check_aedar_comparison_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='aedar_territorial_aggregate' AND content_version=NEW.aedar_content_version)
   OR NOT EXISTS(SELECT 1 FROM table_publication WHERE table_name='territory_reference' AND content_version=NEW.reference_content_version)
   OR NEW.group_row_count<>(SELECT count(*) FROM aedar_comparison_group)
   OR NEW.territory_row_count<>(SELECT count(*) FROM aedar_comparison_territory)
 THEN RAISE EXCEPTION 'AEDAR comparison publication is incomplete or stale'; END IF;
 IF EXISTS(SELECT 1 FROM aedar_comparison_group g LEFT JOIN (
    SELECT comparison_context,group_id,territory_type,typequ,measure,count(*) AS member_count,
      count(*) FILTER(WHERE status='measured') AS eligible_count,
      count(*) FILTER(WHERE status='not_available') AS missing_count
    FROM aedar_comparison_territory
    GROUP BY comparison_context,group_id,territory_type,typequ,measure
   ) t USING(comparison_context,group_id,territory_type,typequ,measure)
   WHERE g.member_count<>COALESCE(t.member_count,0)
      OR g.eligible_count<>COALESCE(t.eligible_count,0)
      OR g.missing_count<>COALESCE(t.missing_count,0))
 THEN RAISE EXCEPTION 'AEDAR comparison eligibility counts are inconsistent'; END IF;
 IF EXISTS(SELECT 1 FROM aedar_comparison_territory t JOIN aedar_comparison_group g USING(comparison_context,group_id,territory_type,typequ,measure)
   WHERE t.status='measured' AND t.rank_size<>g.eligible_count)
 THEN RAISE EXCEPTION 'AEDAR comparison rank size differs from eligible group size'; END IF;
 RETURN NEW;
END $$;

COMMIT;
