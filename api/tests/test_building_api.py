"""The HTTP boundary accepts an explicit peer set, not a default scope."""

from fastapi.testclient import TestClient

from api.main import ReadRepository, _building_publication, app, compare, get_repository
from api.tests.test_building_comparison import curve


class BuildingRepository:
    def read_building(self, territory_type, territory_id, selected):
        assert (territory_type, territory_id) == ("commune", "A")
        assert selected == (("commune", "B"), ("commune", "C"))
        reference = [
            dict(territoire=code, type="commune", departement="22", epci="E")
            for code in ("A", "B", "C")
        ]
        return dict(publication_id="current", territory=dict(id="A", type="commune", name="A"),
                    reference=reference, ramp_rows=curve("B", 2) + curve("C", 6, 10),
                    grid_rows=[
                        dict(territoire=code, type="commune", availability="complete", mode="t",
                             total_buildings=count, breadth_bucket="0", depth_bucket="0",
                             building_count=count, source_id="snapshot", version="v1")
                        for code, count in (("B", 2), ("C", 6))
                    ], direction="high")


def test_explicit_group_never_includes_focal_territory_automatically():
    app.dependency_overrides[get_repository] = BuildingRepository
    try:
        response = TestClient(app).post("/api/territories/commune/A/building-access-comparison", json={
            "selected": [{"type": "commune", "id": "B"}, {"type": "commune", "id": "C"}],
        })
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["publication_id"] == "current"
    assert body["scope"] == {"kind": "custom", "direction": "high", "level": "commune",
                             "members": ["B", "C"]}
    assert body["ramp"]["statistic"] == "mean"
    assert body["ramp"]["member_count"] == 2
    assert len(body["ramp"]["points"]) == 33
    assert body["distribution"]["statistic"] == "mean"
    assert body["distribution"]["total_buildings"] == 8


def test_empty_custom_group_is_rejected_before_repository_read():
    app.dependency_overrides[get_repository] = lambda: object()
    try:
        response = TestClient(app).post("/api/territories/commune/A/building-access-comparison",
                                        json={"selected": []})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 422


def test_one_selected_member_has_no_comparison_instead_of_a_fabricated_curve():
    class SingleMemberRepository:
        def read_building(self, territory_type, territory_id, selected):
            assert selected == (("commune", "B"),)
            return dict(publication_id="v1", territory={"type": territory_type, "id": territory_id},
                        reference=[dict(territoire="A", type="commune"),
                                   dict(territoire="B", type="commune")],
                        ramp_rows=curve("B", 2),
                        grid_rows=[dict(territoire="B", type="commune", availability="complete",
                                        mode="t", total_buildings=2, breadth_bucket="0",
                                        depth_bucket="0", building_count=2,
                                        source_id="snapshot", version="v1")], direction="high")

    app.dependency_overrides[get_repository] = SingleMemberRepository
    try:
        response = TestClient(app).post("/api/territories/commune/A/building-access-comparison",
                                        json={"selected": [{"type": "commune", "id": "B"}]})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    assert response.json()["ramp"] is None
    assert response.json()["distribution"] is None


def test_repository_reads_only_resolved_members_in_one_consistent_publication():
    class Result:
        def __init__(self, values): self.values = values
        def fetchone(self): return self.values[0] if self.values else None
        def fetchall(self): return self.values

    class Connection:
        def __init__(self): self.calls = []
        def transaction(self): return self
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def execute(self, sql, params=None):
            self.calls.append((sql, params))
            if "SET TRANSACTION" in sql: return Result([])
            if "FROM table_publication" in sql:
                return Result([("territory_reference", "ref-1"),
                               ("building_ramp", "ramp-1"), ("building_grid", "grid-1")])
            if "FROM territory_reference" in sql and "WHERE" in sql:
                return Result([("A", "commune", "A")])
            if "FROM territory_reference" in sql:
                return Result([("A", "commune", "22", "E"),
                               ("B", "commune", "22", "E"), ("C", "commune", "22", "E")])
            if "FROM building_ramp" in sql:
                return Result([(r["territoire"], r["type"], r["availability"], r["mode"],
                                r["quantile"], r["accessible_types"], r["total_buildings"],
                                r["source_id"], r["version"], "high")
                               for r in curve("B", 2) + curve("C", 6)])
            if "FROM building_grid" in sql:
                return Result([("B", "commune", "complete", "t", "0", "0", 2, 2, "snapshot", "v1"),
                               ("C", "commune", "complete", "t", "0", "0", 6, 6, "snapshot", "v1")])
            raise AssertionError(sql)

    class Connections:
        def __init__(self): self.current = Connection()
        def connection(self): return self.current

    connections = Connections()
    data = ReadRepository(connections).read_building("commune", "A", (("commune", "B"), ("commune", "C")))
    assert data["publication_id"] == _building_publication([
        ("territory_reference", "ref-1"), ("building_ramp", "ramp-1"),
        ("building_grid", "grid-1")])
    assert data["direction"] == "high"
    assert "REPEATABLE READ, READ ONLY" in connections.current.calls[0][0]
    selected_queries = [(sql, params) for sql, params in connections.current.calls
                        if "FROM building_ramp" in sql or "FROM building_grid" in sql]
    assert len(selected_queries) == 2
    assert all(params == (["B", "C"],) and "ANY(%s)" in sql for sql, params in selected_queries)


def test_catalog_exposes_only_published_territory_identities_for_explicit_choice():
    class CatalogRepository:
        def read_building_catalog(self):
            return {"publication_id": "v1", "territories": [
                {"type": "commune", "id": "22001", "name": "Allineuc"},
                {"type": "epci", "id": "E", "name": "EPCI exemple"},
            ]}

    app.dependency_overrides[get_repository] = CatalogRepository
    try:
        response = TestClient(app).get("/api/building-access/territories")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json() == CatalogRepository().read_building_catalog()


def test_building_identity_composes_only_its_physical_table_versions():
    base = [("territory_reference", "r1"), ("building_ramp", "a1"),
            ("building_grid", "g1")]
    identity = _building_publication(base)
    assert _building_publication(base + [("essential_service_access", "access-2")]) == identity
    assert _building_publication([("territory_reference", "r1"),
                                  ("building_ramp", "a2"), ("building_grid", "g1")]) != identity


def test_building_identity_fails_closed_if_any_required_marker_is_missing():
    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as error:
        _building_publication([("territory_reference", "r1"), ("building_grid", "g1")])
    assert error.value.status_code == 503


def test_initial_building_access_uses_exact_default_rows_and_explicit_scope():
    class InitialRepository:
        def read_building_initial(self, territory_type, territory_id, comparison):
            assert (territory_type, territory_id, comparison) == ("commune", "A", "densite")
            return {"publication_id": "v1", "territory": {"id": "A", "type": "commune", "name": "A"},
                    "scope": {"kind": "communes-densite", "label": "Dense", "comparison_mode": "densite"},
                    "ramp": [{"mode": "t", "quantile": 0.5, "accessible_types": 2}],
                    "peer_ramp": [{"mode": "t", "quantile": 0.5, "accessible_types": 1.5}],
                    "distribution": [{"breadth_bucket": "0", "depth_bucket": "0", "building_count": 4}],
                    "peer_distribution": [{"breadth_bucket": "0", "depth_bucket": "0", "share": 0.6}]}

    app.dependency_overrides[get_repository] = InitialRepository
    try:
        response = TestClient(app).get("/api/territories/commune/A/building-access?comparison=densite")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    assert response.json()["scope"]["comparison_mode"] == "densite"
    assert response.json()["peer_ramp"][0]["accessible_types"] == 1.5


def test_initial_building_access_defaults_commune_to_its_density_class():
    class DefaultRepository:
        def read_building_initial(self, territory_type, territory_id, comparison):
            assert (territory_type, territory_id, comparison) == ("commune", "A", "densite")
            return {"publication_id": "v1", "territory": {"id": "A", "type": "commune", "name": "A"},
                    "scope": {"kind": "communes-densite", "comparison_mode": comparison},
                    "ramp": [], "peer_ramp": None, "distribution": [], "peer_distribution": None}

    app.dependency_overrides[get_repository] = DefaultRepository
    try:
        response = TestClient(app).get("/api/territories/commune/A/building-access")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    assert response.json()["scope"]["kind"] == "communes-densite"


def test_initial_building_access_rejects_arbitrary_comparison_scope():
    app.dependency_overrides[get_repository] = lambda: object()
    try:
        response = TestClient(app).get("/api/territories/commune/A/building-access?comparison=custom")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 422


def test_essential_service_snapshot_can_join_callers_repeatable_read_transaction():
    class Result:
        def __init__(self, rows): self.rows = rows
        def fetchone(self): return self.rows[0] if self.rows else None
        def fetchall(self): return self.rows

    class Connection:
        def __init__(self): self.calls = []; self.transaction_calls = 0
        def transaction(self):
            self.transaction_calls += 1
            raise AssertionError("caller owns transaction")
        def execute(self, sql, params=None):
            self.calls.append((sql, params))
            if "access_publication_metadata" in sql:
                return Result([("services-v1", "communes-densite", "communes denses")])
            if "FROM territory_reference" in sql and "WHERE territory_id" in sql:
                return Result([("A", "A", "commune", "E", "D1", "communes denses")])
            if "FROM essential_service_access" in sql:
                return Result([("A", service, mode, 0.6, f"{service}-{mode}", "high",
                                "src", "Source", "2024", None, None)
                               for service in ("admin", "food", "health", "bank", "school")
                               for mode in ("walk_transit", "bike", "car")])
            raise AssertionError(sql)

    class Connections:
        def connection(self): raise AssertionError("must reuse caller connection")

    connection = Connection()
    raw = ReadRepository(Connections()).read("A", "densite", connection=connection)
    response = compare(raw).model_dump(mode="json")

    assert response["publication_id"] == "services-v1"
    assert response["scope"] == {"kind": "communes-densite", "label": "communes denses",
                                 "member_count": 1}
    assert len(response["services"]) == 5
    assert response["services"][0]["modes"]["car"]["value"] == 0.6
    assert connection.transaction_calls == 0
    assert all("SET TRANSACTION" not in sql for sql, _ in connection.calls)


def test_region_initial_access_returns_focal_facts_without_comparison():
    class RegionRepository:
        def read_building_initial(self, territory_type, territory_id, comparison):
            assert (territory_type, territory_id) == ("region", "53")
            return {"publication_id": "v1", "territory": {"id": "53", "type": "region", "name": "Bretagne"},
                    "scope": {"kind": "regions", "label": "Bretagne", "comparison_mode": comparison},
                    "ramp": [], "peer_ramp": None, "distribution": [], "peer_distribution": None}

    app.dependency_overrides[get_repository] = RegionRepository
    try:
        response = TestClient(app).get("/api/territories/region/53/building-access")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    assert response.json()["peer_ramp"] is None
    assert response.json()["peer_distribution"] is None
