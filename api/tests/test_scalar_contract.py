from api.main import app


def test_scalar_endpoint_is_named_bounded_and_registered():
    route = next(r for r in app.routes if r.path ==
                 "/api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}")
    assert route.methods == {"GET"}
    assert route.endpoint.__name__ == "scalar_observation"
    assert "repeatable read" in route.endpoint.__code__.co_consts
    sql = " ".join(c for c in route.endpoint.__code__.co_consts if isinstance(c, str))
    assert "WHERE o.indicator_id = %s" in sql
    assert "AND o.territory_id = %s" in sql


def test_fresh_and_additive_schema_define_independent_scalar_publication():
    from pathlib import Path

    root = Path(__file__).parents[1]
    fresh = (root / "schema.sql").read_text()
    migration = (root / "migrations/004_shared_scalar.sql").read_text()
    for sql in (fresh, migration):
        assert "CREATE TABLE scalar_descriptor" in sql
        assert "CREATE TABLE scalar_observation" in sql
        assert "status='measured' AND value IS NOT NULL" in sql or "status = 'measured' AND value IS NOT NULL" in sql
        assert "GRANT SELECT" in sql or sql is fresh
    assert "ALTER TABLE table_publication" in migration
    assert "scalar_observation" in migration
