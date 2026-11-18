"""Fast (DB-free) contract for migration 045 / schema.sql parity (#1043)."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M045 = ROOT / "api/migrations/045_aedar_littoral_summary.sql"
SCHEMA = ROOT / "api/schema.sql"


def _m045():
    return M045.read_text(encoding="utf-8")


def _fn(text):
    start = text.index("check_aedar_comparison_publication()")
    end = text.index("END $$;", start) + len("END $$;")
    return text[start:end]


def test_migration_045_widens_aedar_reference_checks():
    m = _m045()
    assert "'density_class','littoral','same_level'" in m
    assert m.count("aedar_reference_context_check") >= 2
    assert m.count("aedar_reference_scope_check") >= 2
    # Scope admits littoral commune/pooled, not a fabricated median group.
    assert "comparison_context='littoral' AND territory_type='commune' AND statistic='pooled'" in m


def test_migration_045_adds_sibling_summary_and_counters_only():
    m = _m045()
    assert "CREATE TABLE IF NOT EXISTS aedar_littoral_summary" in m
    assert "PRIMARY KEY(comparison_content_version,group_id,measure)" in m
    assert "group_id text NOT NULL CHECK(group_id IN ('C','NC'))" in m
    for counter in ("littoral_summary_status_count", "littoral_summary_measure_count",
                    "littoral_summary_row_count"):
        assert counter in m
    # Density-only PK/count contract and peer table unchanged; sibling has its
    # own relation and never inserts C/NC into the density summary.
    assert "ALTER TABLE aedar_density_class_summary" not in m
    assert "CREATE TABLE aedar_density_class_summary" not in m
    assert "INSERT INTO aedar_comparison_territory" not in m


def test_migration_045_trigger_accepts_pre_extension_and_rejects_incomplete():
    fn = _fn(_m045())
    # Pre-extension generation is accepted: zero counters and zero groups.
    assert "IF NEW.littoral_summary_row_count>0 THEN" in fn
    assert "NEW.littoral_summary_status_count<>0" in fn
    assert "zero littoral groups and counters" in fn
    # Incomplete generation is rejected via distinct named exceptions.
    assert "AEDAR littoral summaries are incomplete" in fn
    assert "AEDAR density-class summaries are incomplete" in fn
    # Peer/rank rows stay forbidden and density counters still validated.
    assert "EXISTS(SELECT 1 FROM aedar_comparison_territory)" in fn
    assert "NEW.density_summary_row_count::numeric <>" in fn
    assert "g.comparison_context NOT IN ('density_class','littoral','same_level')" in fn


def test_schema_sql_matches_migrated_aedar_contract():
    m, s = _m045(), SCHEMA.read_text(encoding="utf-8")
    assert _fn(m) == _fn(s)
    assert "CREATE TABLE aedar_littoral_summary" in s
    assert "littoral_summary_status_count" in s
    assert "comparison_context IN ('density_class','littoral','same_level')" in s
    assert "comparison_context='littoral' AND territory_type='commune' AND statistic='pooled'" in s
    assert "GRANT SELECT ON aedar_comparison_publication,aedar_comparison_group,aedar_density_class_summary,aedar_littoral_summary TO lusk_reader;" in s
