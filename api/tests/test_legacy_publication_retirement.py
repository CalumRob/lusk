from pathlib import Path


API = Path(__file__).resolve().parents[1]


def test_fresh_schema_uses_only_per_table_publication():
    schema = (API / "schema.sql").read_text(encoding="utf-8")
    assert "CREATE TABLE table_publication" in schema
    assert "dataset_publication" not in schema


def test_retirement_migration_is_guarded_scoped_and_non_cascading():
    migration = (API / "migrations/009_retire_dataset_publication.sql").read_text(encoding="utf-8")
    assert "current_database() = 'lusk'" in migration
    assert "current_schema() <> 'public'" in migration
    assert "actual_columns IS DISTINCT FROM" in migration
    assert "SET LOCAL lock_timeout" in migration
    assert "BEGIN;" in migration and "COMMIT;" in migration
    assert "DROP TABLE %I.dataset_publication RESTRICT" in migration
    assert "current_database() = 'lusk'" in migration
    assert "current_database() = 'lusk_it_contract'" in migration
    assert "^it_[a-f0-9]{20}$" in migration
    assert "DROP TABLE %I.dataset_publication CASCADE" not in migration


def test_operator_guide_requires_backup_and_rehearsal_and_rejects_down_script_claim():
    guide = (API / "migrations/README.md").read_text(encoding="utf-8").lower()
    assert "verified, restorable full database backup" in guide
    assert "lusk_it_contract" in guide and "disposable database" in guide
    assert "external" in guide and "grants" in guide
    assert "there is intentionally no down migration" in guide
    assert "do not apply this migration" in guide
