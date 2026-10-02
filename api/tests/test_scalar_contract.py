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


def test_scalar_cohort_route_returns_sparse_absence_and_peer_specific_lineage():
    from api.main import ReadRepository, scalar_indicator_cohort
    from contextlib import contextmanager

    lineage = [{"source_id": "flores", "name": "Flores", "vintage_id": "2024",
                "version": "2024", "reference_date": None, "publication_date": None}]
    class Cursor:
        def __init__(self, row=None, rows=None): self.row, self.rows = row, rows or []
        def fetchone(self): return self.row
        def fetchall(self): return self.rows
    class Connection:
        def execute(self, sql, params=None):
            if sql.startswith("SET TRANSACTION"): return Cursor()
            if "SELECT scalar.content_version" in sql: return Cursor(("scalar-v1", "territories-v1", "territories-v1", 2))
            if "WITH ranked AS MATERIALIZED" in sql:
                return Cursor(rows=[("c1", "A", 3, "measured", None, None, lineage, 1, 2, None, None, None, None),
                                    ("c2", "B", None, None, None, None, [], None, None, None, None, None, None)])
            if "FROM scalar_descriptor" in sql: return Cursor(("Effectifs", "salariés", "high", "employment", ["commune"], "sparse"))
            if "SELECT territory_id,territory_type,department_id,epci_id" in sql: return Cursor(("c1", "commune", "d1", "e1"))
            if "SELECT 1 FROM territory_reference" in sql: return Cursor((1,))
            raise AssertionError(sql)
        def transaction(self): return null_context()
    @contextmanager
    def null_context(): yield
    class Connections:
        def connection(self): return null_context_value(Connection())
    @contextmanager
    def null_context_value(value): yield value
    result = scalar_indicator_cohort("commune", "c1", "employment", "commune", None, None,
                                     ReadRepository(Connections()))
    assert result["content_version"] == "scalar-v1"
    assert result["observations"] == [
        {"territory_id": "c1", "name": "A", "value": 3, "status": "measured",
         "support_count": None, "denominator_count": None, "sources": lineage,
         "rang_epci": 1, "rang_epci_n": 2, "rang_dep": None, "rang_dep_n": None,
         "rang_reg": None, "rang_reg_n": None},
        {"territory_id": "c2", "name": "B", "value": None, "status": "not_published",
         "support_count": None, "denominator_count": None, "sources": [],
         "rang_epci": None, "rang_epci_n": None, "rang_dep": None, "rang_dep_n": None,
         "rang_reg": None, "rang_reg_n": None},
    ]


def test_scalar_cohort_sql_ranks_natural_universes_before_url_scoped_cohort_filter():
    import inspect
    from api.main import scalar_indicator_cohort

    source = inspect.getsource(scalar_indicator_cohort)
    rank_query = source.split('"""WITH ranked AS MATERIALIZED (', 1)[1].split('"""', 1)[0]
    assert "PARTITION BY t.epci_id ORDER BY" in rank_query
    assert "PARTITION BY t.territory_type ORDER BY" in rank_query
    assert "NULL::bigint AS rang_dep" in rank_query
    assert "t.epci_id IS NULL" in rank_query
    assert "d.direction='high' THEN o.value END DESC" in rank_query
    assert "d.direction='low' THEN o.value END ASC" in rank_query
    assert "RANK() OVER" in rank_query and "COUNT(o.value) OVER" in rank_query
    assert "WHERE d.indicator_id=%s AND t.territory_type=%s" in rank_query
    assert rank_query.index("FROM ranked cohort_source") < rank_query.index("WHERE (%s::text IS NULL OR EXISTS")
    assert rank_query.count("rang_epci") >= 2 and rank_query.count("rang_dep") >= 2 and rank_query.count("rang_reg") >= 2


def test_scalar_cohort_rejects_wrong_comparison_facet_without_computing_wrong_statistics():
    import pytest
    from fastapi import HTTPException
    from api.main import ReadRepository, scalar_indicator_cohort
    from contextlib import contextmanager
    class Cursor:
        def __init__(self,row=None): self.row=row
        def fetchone(self): return self.row
    class Connection:
        def execute(self,sql,params=None):
            if sql.startswith("SET TRANSACTION"): return Cursor(None)
            if "SELECT scalar.content_version" in sql: return Cursor(("v1","r1","r1",1))
            if "FROM scalar_descriptor" in sql: return Cursor(("label","unit","high","different_facet",["commune"],"sparse"))
            raise AssertionError("reader must fail before fetching wrong-facet values")
        def transaction(self): return contextmanager(lambda: (yield))()
    class Connections:
        def connection(self): return contextmanager(lambda: (yield Connection()))()
    with pytest.raises(HTTPException) as error:
        scalar_indicator_cohort("commune","c1","page_indicator","commune",None,None,ReadRepository(Connections()))
    assert error.value.status_code == 503


def test_scalar_cohort_rejects_unknown_scope_stale_reference_and_overflow():
    import pytest
    from contextlib import contextmanager
    from fastapi import HTTPException
    from api.main import ReadRepository, scalar_indicator_cohort

    def call(case, scope_level="commune", department=None):
        class Cursor:
            def __init__(self,row=None,rows=None): self.row,self.rows=row,rows or []
            def fetchone(self): return self.row
            def fetchall(self): return self.rows
        class Connection:
            def execute(self,sql,params=None):
                if sql.startswith("SET TRANSACTION"): return Cursor()
                if "SELECT scalar.content_version" in sql:
                    return Cursor(("v1","old-reference" if case == "stale" else "r1","r1",1))
                if "WITH ranked AS MATERIALIZED" in sql:
                    if case == "overflow": return Cursor(rows=[("c%d" % i,"Peer",None,None,None,None,[],None,None,None,None,None,None) for i in range(1501)])
                    return Cursor(rows=[] if case == "outside" else [("c1","A",1,"measured",None,None,[{"source_id":"s"}],1,1,1,1,1,1)])
                if "FROM scalar_descriptor" in sql:
                    return Cursor(("label","unit","high","indicator",["commune"],"sparse"))
                if "SELECT territory_id,territory_type,department_id,epci_id" in sql:
                    return Cursor(("c1","commune","d1","e1"))
                if "SELECT 1 FROM territory_reference" in sql:
                    return Cursor(None if case == "unknown_scope" else (1,))
                raise AssertionError(sql)
            def transaction(self): return contextmanager(lambda: (yield))()
        class Connections:
            def connection(self): return contextmanager(lambda: (yield Connection()))()
        return scalar_indicator_cohort("commune","c1","indicator",scope_level,department,None,ReadRepository(Connections()))

    for case,level,dept,status in [
        ("unsupported","epci",None,422), ("unknown_scope","commune","missing",422),
        ("outside","commune","d2",422), ("stale","commune",None,503),
        ("overflow","commune",None,503),
    ]:
        with pytest.raises(HTTPException) as error:
            call(case,level,dept)
        assert error.value.status_code == status


def test_service_scalar_projection_filters_to_registered_service_indicator_ids():
    from api.main import ReadRepository
    import inspect

    source = inspect.getsource(ReadRepository._read)
    assert "service_registry" in source
    assert "'share_' || service || '_' || mode" in source
    assert "CROSS JOIN unnest" in source


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
    reader = inspect.getsource(__import__("api.main", fromlist=["ReadRepository"]).ReadRepository.read_series)
    assert "scope_rows" in reader and "department_id" in reader and "epci_id" in reader
    assert "SELECT count(*) FROM ordered_series" not in reader


def test_series_comparison_uses_declared_direction_and_ties():
    from api.main import summarize_series_comparison
    values = [("focal", 2.0), ("peer-a", 2.0), ("peer-b", 5.0), ("missing-excluded", 9.0)]
    low = summarize_series_comparison(values[:3], "focal", 2.0, "low")
    assert low == {"value": 2.0, "median": 2.0, "rank": 1, "ties": 2, "comparable_count": 3}
    high = summarize_series_comparison(values[:3], "focal", 2.0, "high")
    assert high["rank"] == 2 and high["ties"] == 2
    missing = summarize_series_comparison(values[:3], "focal", None, "low")
    assert missing["rank"] is None and missing["comparable_count"] == 2


def test_profile_endpoint_is_bounded_and_uses_independent_marker():
    route = next(r for r in app.routes if r.path ==
                 "/api/territories/{territory_type}/{territory_id}/profiles/{indicator_id}")
    assert route.methods == {"GET"}
    sql = " ".join(c for c in route.endpoint.__code__.co_consts if isinstance(c, str))
    assert "table_name='declared_profile'" in sql
    assert "profile_observation" in sql and "profile_axis" in sql
    assert "LEFT JOIN profile_axis d" in sql and "LEFT JOIN profile_axis s" in sql
    assert "ORDER BY d.ordinal NULLS LAST,s.ordinal NULLS LAST" in sql
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
        assert "CREATE TABLE profile_observation_source" in sql
        assert "dense_complete" in sql
        assert "primarykey(indicator_id,territory_id,detail_key,sex_key)" in "".join(sql.lower().split())
    assert "declared_profile" in migration
    assert "profile_publication_requires_reference" in migration


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
        def __init__(self, incomplete=False, stale=False, bad_facet=False, undeclared=False, bad_direction=False, membership="29"):
            self.incomplete = incomplete; self.stale = stale; self.bad_facet = bad_facet
            self.undeclared = undeclared; self.bad_direction = bad_direction; self.membership = membership; self.queries = []
        @contextmanager
        def transaction(self): yield
        def execute(self, sql, params=None):
            self.queries.append(sql)
            if "table_publication" in sql: return Cursor([("profile-v1", 4, "ref-v1", "ref-v2" if self.stale else "ref-v1")])
            if "FROM territory_reference WHERE territory_id" in sql: return Cursor([(self.membership,)])
            if "SELECT comparison_scalar FROM profile_descriptor" in sql: return Cursor([(None,)])
            if "profile_descriptor" in sql:
                return Cursor([("Structure par âge", "%", ["commune"], "dense_complete", "d1",
                    "outside" if self.bad_facet else "<15", "F", "sideways" if self.bad_direction else "high")])
            if "SELECT axis_name" in sql:
                return Cursor([("detail", "<15", "Moins de 15 ans", 0), ("detail", "80+", "80 ans et plus", 1), ("sex", "F", "F", 0), ("sex", "M", "M", 1)])
            if "SELECT DISTINCT sd.source_id" in sql: return Cursor([("age_detail", "INSEE fixture", "2023", "2023-01-01", None)])
            if "SELECT t.territory_id" in sql:
                return Cursor([("22001", "Fixture", .2, "measured"), ("22002", "Other", .1, "measured")])
            rows = [("commune", "<15", "F", .2, "measured"), ("commune", "<15", "M", .2, "measured"),
                    ("commune", "80+", "F", .1, "measured"), ("commune", "80+", "M", .1, "measured")]
            if self.undeclared: rows.append(("commune", "outside", "F", .3, "measured"))
            return Cursor(rows[:-1] if self.incomplete else rows)

    class Connections:
        def __init__(self, incomplete=False, stale=False, bad_facet=False, undeclared=False, bad_direction=False, membership="29"):
            self.conn = Conn(incomplete, stale, bad_facet, undeclared, bad_direction, membership)
        @contextmanager
        def connection(self): yield self.conn
    repo = SimpleNamespace(connections=Connections())
    result = declared_profile("commune", "22001", "structure_age", repository=repo)
    marker_query = next(sql for sql in repo.connections.conn.queries if "table_publication" in sql)
    assert "count(*)" not in marker_query.lower()
    assert [cell["detail"] for cell in result["cells"]] == ["<15", "<15", "80+", "80+"]
    assert result["comparison"]["detail"] == "<15"
    assert result["comparison"]["sex"] == "F"
    assert [row["value"] for row in result["comparison"]["values"]] == [.2, .1]
    for scope, scope_id, membership in (("departement", "22", "29"), ("epci", "E2", "E1")):
        with __import__("pytest").raises(HTTPException) as error:
            declared_profile("commune", "22001", "structure_age", comparison_scope=scope,
                comparison_scope_id=scope_id, repository=SimpleNamespace(connections=Connections(membership=membership)))
        assert error.value.status_code == 422
    with __import__("pytest").raises(HTTPException) as error:
        declared_profile("commune", "22001", "structure_age", repository=SimpleNamespace(connections=Connections(True)))
    assert error.value.status_code == 503
    for repository in (Connections(bad_facet=True), Connections(bad_direction=True),
                       Connections(undeclared=True), Connections(stale=True)):
        with __import__("pytest").raises(HTTPException) as error:
            declared_profile("commune", "22001", "structure_age",
                             repository=SimpleNamespace(connections=repository))
        assert error.value.status_code == 503


def test_profile_comparison_scope_requires_compatible_explicit_identifier():
    from types import SimpleNamespace
    from fastapi import HTTPException
    from api.main import declared_profile

    invalid_requests = [
        ("commune", "departement", None),
        ("commune", "epci", None),
        ("commune", "bretagne", "29"),
        ("epci", "departement", None),
        ("departement", "epci", "E1"),
    ]
    for territory_type, scope, scope_id in invalid_requests:
        with __import__("pytest").raises(HTTPException) as error:
            declared_profile(territory_type, "id", "structure_age",
                             comparison_scope=scope, comparison_scope_id=scope_id,
                             repository=SimpleNamespace())
        assert error.value.status_code == 422
