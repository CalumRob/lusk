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


def test_profile_endpoint_is_bounded_and_uses_independent_marker():
    route = next(r for r in app.routes if r.path ==
                 "/api/territories/{territory_type}/{territory_id}/profiles/{indicator_id}")
    assert route.methods == {"GET"}
    sql = " ".join(c for c in route.endpoint.__code__.co_consts if isinstance(c, str))
    assert "table_name='declared_profile'" in sql
    assert "profile_observation" in sql and "profile_axis" in sql
    assert "ORDER BY d.ordinal,s.ordinal" in sql
    assert "territory_id=%s AND o.territory_type=%s" in sql
    assert "fallback" not in sql.lower()


def test_profile_fresh_schema_and_reserved_additive_migration_declare_dense_axes():
    from pathlib import Path
    root = Path(__file__).parents[1]
    fresh = (root / "schema.sql").read_text()
    migration = (root / "migrations/006_declared_profile.sql").read_text()
    for sql in (fresh, migration):
        assert "CREATE TABLE profile_descriptor" in sql
        assert "CREATE TABLE profile_axis" in sql
        assert "CREATE TABLE profile_observation" in sql
        assert "dense_complete" in sql
        assert "primarykey(indicator_id,territory_id,detail_key,sex_key)" in "".join(sql.lower().split())
    assert "declared_profile" in migration


def test_profile_reader_returns_descriptor_order_and_fails_on_incomplete_snapshot():
    from contextlib import contextmanager
    from types import SimpleNamespace
    from fastapi import HTTPException
    from api.main import declared_profile

    class Cursor:
        def __init__(self, rows): self.rows = rows
        def fetchone(self): return self.rows[0] if self.rows else None
        def fetchall(self): return self.rows

    class Conn:
        def __init__(self, incomplete=False): self.incomplete = incomplete
        @contextmanager
        def transaction(self): yield
        def execute(self, sql, params=None):
            if "table_publication" in sql: return Cursor([("profile-v1",)])
            if "profile_descriptor" in sql: return Cursor([("Structure par âge", "%", ["commune"], "dense_complete", "d1")])
            if "SELECT axis_name" in sql:
                return Cursor([("detail", "<15", "Moins de 15 ans", 0), ("detail", "80+", "80 ans et plus", 1), ("sex", "F", "F", 0), ("sex", "M", "M", 1)])
            rows = [("commune", "<15", "F", .2, "measured"), ("commune", "<15", "M", .2, "measured"),
                    ("commune", "80+", "F", .1, "measured"), ("commune", "80+", "M", .1, "measured")]
            return Cursor(rows[:-1] if self.incomplete else rows)

    class Connections:
        def __init__(self, incomplete=False): self.conn = Conn(incomplete)
        @contextmanager
        def connection(self): yield self.conn
    repo = SimpleNamespace(connections=Connections())
    result = declared_profile("commune", "22001", "structure_age", repo)
    assert [cell["detail"] for cell in result["cells"]] == ["<15", "<15", "80+", "80+"]
    with __import__("pytest").raises(HTTPException) as error:
        declared_profile("commune", "22001", "structure_age", SimpleNamespace(connections=Connections(True)))
    assert error.value.status_code == 503
