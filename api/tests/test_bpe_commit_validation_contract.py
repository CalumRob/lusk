from pathlib import Path


API = Path(__file__).resolve().parents[1]
GUARD = "pg_try_advisory_xact_lock(hashtextextended('bpe-profile-validation:' || pg_current_xact_id()::text, 0))"


def test_bpe_full_validation_runs_once_per_transaction_in_fresh_and_upgrade_contracts():
    fresh = (API / "schema.sql").read_text(encoding="utf-8")
    migration = (API / "migrations/026_bpe_validation_once_per_transaction.sql").read_text(encoding="utf-8")
    for sql in (fresh, migration):
        sql = sql.lower()
        assert GUARD in sql
        assert "bpe profile evidence universe/count partition is incomplete" in sql
        assert "bpe profile evidence is not dense over declared class axes" in sql
        assert "bpe fact class labels differ from the declared class axis" in sql
        assert "bpe evidence requires exactly four declared class axes" in sql
        assert "return null" in sql

    historical = (API / "migrations/016_bpe_profile_evidence.sql").read_text(encoding="utf-8")
    assert "CREATE CONSTRAINT TRIGGER bpe_profile_evidence_complete" in historical
    assert "CREATE OR REPLACE FUNCTION assert_bpe_profile_evidence_complete()" in migration
