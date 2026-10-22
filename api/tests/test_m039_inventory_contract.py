"""Offline safeguards for the read-only migration-039 operator report."""

from pathlib import Path


def test_inventory_is_bounded_and_never_claims_structural_validation():
    sql = (Path(__file__).resolve().parents[1] / "migrations/039_operator_state_inventory.sql").read_text(
        encoding="utf-8")

    assert "BEGIN READ ONLY;" in sql
    assert "SET LOCAL statement_timeout = '15s';" in sql
    assert "SET LOCAL lock_timeout = '3s';" in sql
    assert "false AS structural_validation_performed" in sql
    for label in (
        "ABSENT_SHAPE_ONLY", "PRESENT_SHAPE_ONLY", "CURRENT_SHAPE_ONLY",
        "INCOMPATIBLE_SHAPE_ONLY / INVESTIGATE",
    ):
        assert label in sql
    assert "query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I'" in sql
    assert "CASE WHEN to_regclass(relation_name) IS NULL THEN NULL" in sql
    assert "SET LOCAL statement_timeout" in sql
