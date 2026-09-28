from api.main import app


def test_scalar_endpoint_is_named_bounded_and_registered():
    route = next(r for r in app.routes if r.path ==
                 "/api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}")
    assert route.methods == {"GET"}
    assert route.endpoint.__name__ == "scalar_observation"
    sql = " ".join(c for c in route.endpoint.__code__.co_consts if isinstance(c, str))
    assert "REPEATABLE READ, READ ONLY" in sql
    assert "WHERE o.indicator_id = %s" in sql
    assert "AND o.territory_id = %s" in sql
    marker_sql = next(c for c in route.endpoint.__code__.co_consts
                      if isinstance(c, str) and "scalar.reference_content_version" in c)
    assert "scalar.content_version" in marker_sql
    assert "territory.content_version" in marker_sql
    assert "count(" not in marker_sql.lower()
    assert "actual_scalar_rows" not in marker_sql
    assert "actual_territories" not in marker_sql


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


def test_ordered_series_route_and_fresh_schema_mirror_migration():
    from pathlib import Path
    root = Path(__file__).parents[1]
    fresh = (root / "schema.sql").read_text()
    migration = (root / "migrations/007_ordered_series.sql").read_text()
    for sql in (fresh, migration):
        assert "CREATE TABLE series_descriptor" in sql
        assert "CREATE TABLE ordered_series" in sql
        assert "comparison_point" in sql and "axis_values" in sql
        assert "status='measured' AND value IS NOT NULL" in sql
    route = next(r for r in app.routes if r.path ==
        "/api/territories/{territory_type}/{territory_id}/series/{indicator_id}")
    assert route.methods == {"GET"}
    assert route.endpoint.__name__ == "annual_series"
    import inspect
    source = inspect.getsource(route.endpoint)
    assert "read_series" in source


def test_series_comparison_uses_declared_direction_and_ties():
    from api.main import summarize_series_comparison
    values = [("focal", 2.0), ("peer-a", 2.0), ("peer-b", 5.0), ("missing-excluded", 9.0)]
    low = summarize_series_comparison(values[:3], "focal", 2.0, "low")
    assert low == {"value": 2.0, "median": 2.0, "rank": 1, "ties": 2, "comparable_count": 3}
    high = summarize_series_comparison(values[:3], "focal", 2.0, "high")
    assert high["rank"] == 2 and high["ties"] == 2
    missing = summarize_series_comparison(values[:3], "focal", None, "low")
    assert missing["rank"] is None and missing["comparable_count"] == 2
