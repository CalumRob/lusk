"""Inspection retention is an explicit opt-in, never the default."""

from api.tests.integration.guarded_database import retain_schema


def test_schema_retention_is_off_by_default(monkeypatch):
    monkeypatch.delenv("LUSK_TEST_RETAIN_SCHEMA", raising=False)
    assert retain_schema() is False


def test_schema_retention_requires_exact_opt_in(monkeypatch):
    monkeypatch.setenv("LUSK_TEST_RETAIN_SCHEMA", "true")
    assert retain_schema() is False
    monkeypatch.setenv("LUSK_TEST_RETAIN_SCHEMA", "1")
    assert retain_schema() is True
