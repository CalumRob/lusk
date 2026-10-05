from pathlib import Path


API = Path(__file__).resolve().parents[1]


def test_bpe_fresh_and_upgrade_contracts_share_partitioned_validator_and_metadata_triggers():
    fresh = (API / "schema.sql").read_text(encoding="utf-8")
    migration = (API / "migrations/026_bpe_partition_validation.sql").read_text(encoding="utf-8")
    for sql in (fresh.lower(), migration.lower()):
        assert "pg_try_advisory_xact_lock" not in sql
        assert "tg_table_name <> 'bpe_profile_evidence'" in sql
        assert "old.territory_type" in sql and "new.territory_type" in sql
        assert "where territory_type=territory.territory_type" in sql
        assert "bpe profile evidence universe/count partition is incomplete" in sql
        assert "bpe profile evidence is not dense" in sql
        assert "bpe fact class labels differ from the declared class axis" in sql
    assert "create constraint trigger bpe_profile_descriptor_complete" in fresh.lower()
    assert "create constraint trigger bpe_profile_class_axis_complete" in fresh.lower()
    assert "create constraint trigger bpe_profile_descriptor_complete" in migration.lower()
    assert "create constraint trigger bpe_profile_class_axis_complete" in migration.lower()
