"""Compatibility checks between the existing Variant E read and group API."""

from fastapi.testclient import TestClient

from api.building_comparison import pooled_peer_distribution, weighted_peer_ramp
from api.main import app, get_repository
from api.tests.test_building_comparison import curve


_LEVELS = ("commune", "epci", "departement", "region")


def _fixture_rows():
    ramp = curve("M1", 2) + curve("M2", 6, 10)
    grid = [
        dict(territoire=member, type="commune", availability="complete", mode="t",
             total_buildings=buildings, breadth_bucket="0", depth_bucket="0",
             building_count=buildings, source_id="snapshot", version="v1")
        for member, buildings in (("M1", 2), ("M2", 6))
    ]
    return ramp, grid


def test_initial_variant_e_and_custom_group_keep_the_same_peer_facts_at_every_level():
    ramp_rows, grid_rows = _fixture_rows()
    expected_ramp = weighted_peer_ramp(ramp_rows, ("M1", "M2"), max_members=2)
    expected_grid = pooled_peer_distribution(grid_rows, ("M1", "M2"), max_members=2)

    class Repository:
        def read_building_initial(self, territory_type, territory_id, comparison):
            return {
                "publication_id": "pub-v1",
                "territory": {"id": territory_id, "type": territory_type, "name": "Focal"},
                "availability": "complete",
                "scope": {"kind": "legacy", "comparison_mode": comparison},
                "ramp": [], "peer_ramp": expected_ramp["points"],
                "distribution": [], "peer_distribution": expected_grid["cells"],
            }

        def read_building(self, territory_type, territory_id, selected):
            assert selected == (("commune", "M1"), ("commune", "M2"))
            return {
                "publication_id": "pub-v1",
                "territory": {"id": territory_id, "type": territory_type, "name": "Focal"},
                "reference": [
                    dict(territoire=member, type="commune", departement="22", epci="E")
                    for member in ("M1", "M2")
                ],
                "ramp_rows": ramp_rows, "grid_rows": grid_rows, "direction": "high",
            }

    app.dependency_overrides[get_repository] = Repository
    try:
        client = TestClient(app)
        for level in _LEVELS:
            focal = {"commune": "F", "epci": "E", "departement": "22", "region": "53"}[level]
            legacy = client.get(f"/api/territories/{level}/{focal}/building-access").json()
            custom = client.post(
                f"/api/territories/{level}/{focal}/building-access-comparison",
                json={"selected": [{"type": "commune", "id": "M1"},
                                   {"type": "commune", "id": "M2"}]},
            )
            assert custom.status_code == 200, custom.text
            current = custom.json()
            assert current["publication_id"] == legacy["publication_id"]
            assert current["territory"] == legacy["territory"]
            assert current["ramp"] == expected_ramp
            assert current["distribution"] == expected_grid
            assert legacy["peer_ramp"] == current["ramp"]["points"]
            assert legacy["peer_distribution"] == current["distribution"]["cells"]
    finally:
        app.dependency_overrides.clear()


def test_custom_api_preserves_explicit_absence_and_fails_closed_for_incomplete_rows():
    reference = [dict(territoire="M1", type="commune", departement="22", epci="E"),
                 dict(territoire="M2", type="commune", departement="22", epci="E")]

    class AbsentRepository:
        def read_building(self, territory_type, territory_id, selected):
            return {"publication_id": "pub-v1", "territory": {"id": "F", "type": territory_type},
                    "reference": reference,
                    "ramp_rows": [dict(territoire=m, type="commune", availability="absent",
                        mode=mode, total_buildings=0, quantile=None, accessible_types=None,
                        source_id="snapshot", version="v1") for m in ("M1", "M2")
                        for mode in ("c", "b", "t")],
                    "grid_rows": [dict(territoire=m, type="commune", availability="absent",
                        mode="t", total_buildings=0, breadth_bucket=None, depth_bucket=None,
                        building_count=None, source_id="snapshot", version="v1") for m in ("M1", "M2")],
                    "direction": "high"}

    app.dependency_overrides[get_repository] = AbsentRepository
    try:
        response = TestClient(app).post("/api/territories/commune/F/building-access-comparison",
            json={"selected": [{"type": "commune", "id": "M1"},
                               {"type": "commune", "id": "M2"}]})
        assert response.status_code == 200
        assert response.json()["ramp"] is None
        assert response.json()["distribution"] is None
    finally:
        app.dependency_overrides.clear()

    class IncompleteRepository(AbsentRepository):
        def read_building(self, territory_type, territory_id, selected):
            data = super().read_building(territory_type, territory_id, selected)
            data["ramp_rows"] = data["ramp_rows"][:-1]
            return data

    app.dependency_overrides[get_repository] = IncompleteRepository
    try:
        response = TestClient(app).post("/api/territories/commune/F/building-access-comparison",
            json={"selected": [{"type": "commune", "id": "M1"},
                               {"type": "commune", "id": "M2"}]})
        assert response.status_code == 503
    finally:
        app.dependency_overrides.clear()
