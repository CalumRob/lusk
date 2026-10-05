"""Bounded selected-group evidence for the Milieux story cloud."""
import pytest
from fastapi import HTTPException

from api.main import _milieux_reading_cloud


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class Connection:
    def __init__(self, *, readings, associations, publication):
        self.readings = readings
        self.associations = associations
        self.publication = publication

    def execute(self, sql, params=()):
        sql = " ".join(str(sql).split())
        if "SELECT groupe FROM milieux_typed_reading" in sql:
            return Result([("land",)])
        if "FROM milieux_typed_reading r JOIN territory_reference" in sql:
            return Result(self.readings)
        if "FROM milieux_reading_source" in sql:
            return Result(self.associations)
        if "FROM series_dataset_publication" in sql:
            return Result([self.publication])
        raise AssertionError(sql)


def test_milieux_cloud_returns_only_selected_plot_facts_and_provenance_windows():
    connection = Connection(
        readings=[("c1", "commune", "A", "2017–2023", "2020–2023", 1.2, 8.0, 9.5, "measured", "rp", "2023")],
        associations=[("population", "2017–2023", None, None, None),
                      ("artif_m2_par_habitant", "2020–2023", "M2", "ocs", "ocs-v1"),
                      ("artif_m3_par_habitant", "2020–2023", "M3", "ocs", "ocs-v1")],
        publication=("ocs-v1", "reference-v1"),
    )
    cloud = _milieux_reading_cloud(connection, ("reading-v1", 2, "reference-v1", "reference-v1", None),
        "commune", "focal", "commune", ["c1"], {"kind": "custom"})
    assert cloud["status"] == "available"
    assert cloud["points"] == [{
        "territory": {"territory_id": "c1", "territory_type": "commune", "name": "A"},
        "periode_pop": "2017–2023", "periode_artif": "2020–2023",
        "taux_variation_population": 1.2, "artif_m2_par_habitant": 8.0,
        "artif_m3_par_habitant": 9.5,
    }]
    assert "focal_value" not in cloud and "focal" not in repr(cloud)


def test_milieux_cloud_preserves_unavailable_empty_group_without_invented_points():
    cloud = _milieux_reading_cloud(Connection(readings=[], associations=[], publication=None),
        ("reading-v1", 2, "reference-v1", "reference-v1", None), "commune", "focal", "commune", [], None)
    assert cloud["status"] == "unavailable"
    assert cloud["reason"] == "no_selected_members"
    assert cloud["points"] == []


def test_milieux_cloud_fails_closed_for_missing_peer_or_incomplete_provenance():
    connection = Connection(readings=[], associations=[], publication=None)
    with pytest.raises(HTTPException) as error:
        _milieux_reading_cloud(connection, ("reading-v1", 2, "reference-v1", "reference-v1", None),
            "commune", "focal", "commune", ["missing"], None)
    assert error.value.status_code == 503
    connection = Connection(
        readings=[("c1", "commune", "A", "2017–2023", "2020–2023", 1.2, 8.0, 9.5, "measured", "rp", "2023")],
        associations=[("population", "2017–2023", None, None, None)], publication=None)
    with pytest.raises(HTTPException) as error:
        _milieux_reading_cloud(connection, ("reading-v1", 2, "reference-v1", "reference-v1", None),
            "commune", "focal", "commune", ["c1"], None)
    assert error.value.status_code == 503
