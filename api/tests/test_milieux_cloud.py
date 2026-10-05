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
        self.queries = []

    def execute(self, sql, params=()):
        sql = " ".join(str(sql).split())
        self.queries.append(sql)
        if "SELECT groupe FROM milieux_typed_reading" in sql:
            return Result([("land",)])
        if "FROM milieux_typed_reading r JOIN territory_reference" in sql:
            return Result(self.readings)
        if "FROM milieux_reading_source b" in sql:
            return Result(self.associations)
        if "FROM series_dataset_publication" in sql:
            return Result(self.publication)
        raise AssertionError(sql)


def test_milieux_cloud_returns_only_selected_plot_facts_and_provenance_windows():
    connection = Connection(
        readings=[("c1", "commune", "A", "2017–2023", "2020–2023", 1.2, 8.0, 9.5, "measured", "rp", "2023")],
        associations=[
            ("c1","population","rp","2023","RP","2023",None,None,"2017–2023",None,None,None,None,None,"pop-r1","rp","2023","RP","2023",None,None,None,None,None,None,None,None,None,None,[]),
            ("c1","artif_m2_par_habitant","ocs-a","v1","OCS A","2025",None,None,"2020–2023","ocs","ocs-v1","M2","M2","ocs-a-r1",None,None,None,None,None,None,None,"ocs-a","v1","OCS A","2025",None,None,"M2","2020–2023",["ocs-a-r1"]),
            ("c1","artif_m2_par_habitant","ocs-b","v2","OCS B","2025",None,None,"2020–2023","ocs","ocs-v1","M2","M2","ocs-b-r1",None,None,None,None,None,None,None,"ocs-b","v2","OCS B","2025",None,None,"M2","2020–2023",["ocs-b-r1"]),
            ("c1","artif_m3_par_habitant","ocs-a","v1","OCS A","2025",None,None,"2020–2023","ocs","ocs-v1","M3","M3","ocs-a-r1",None,None,None,None,None,None,None,"ocs-a","v1","OCS A","2025",None,None,"M3","2020–2023",["ocs-a-r1"]),
            ("c1","artif_m3_par_habitant","ocs-b","v2","OCS B","2025",None,None,"2020–2023","ocs","ocs-v1","M3","M3","ocs-b-r1",None,None,None,None,None,None,None,"ocs-b","v2","OCS B","2025",None,None,"M3","2020–2023",["ocs-b-r1"]),
        ],
        publication=[("ocs","ocs-v1","reference-v1")],
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
    assert len(connection.queries) == 4  # fixed query count, independent of peer/component count


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


def test_milieux_cloud_omits_unavailable_and_na_peers_but_keeps_measured_peer():
    # A source-declared unavailable record and a measured row with a source-backed NA rate
    # both remain valid cohort members, but neither supplies a plot coordinate.
    def peer(code, name, status, rate, m2=None, m3=None):
        return (code,"commune",name,"2017–2023","2020–2023",rate,m2,m3,status,"rp","2023")
    associations=[]
    for code in ("c1","c2","c3"):
        associations.append((code,"population","rp","2023","RP","2023",None,None,"2017–2023",None,None,None,None,None,"pop-r1","rp","2023","RP","2023",None,None,None,None,None,None,None,None,None,None,[]))
        for role,field in (("M2","artif_m2_par_habitant"),("M3","artif_m3_par_habitant")):
            rev=f"{code}-{role}"
            associations.append((code,field,"ocs","v1","OCS","2025",None,None,"2020–2023","ocs","ocs-v1",role,role,rev,None,None,None,None,None,None,None,"ocs","v1","OCS","2025",None,None,role,"2020–2023",[rev]))
    connection = Connection(readings=[peer("c1","A","measured",None,8.0,9.0),
        peer("c2","B","unavailable",None),peer("c3","C","measured",1.2,8.0,9.5)],
        associations=associations, publication=[("ocs","ocs-v1","ref")])
    cloud = _milieux_reading_cloud(connection, ("reading-v1",2,"ref","ref",None),
        "commune","focal","commune",["c1","c2","c3"],None)
    assert cloud["status"] == "available"
    assert cloud["selected_member_count"] == 3 and cloud["plotted_member_count"] == 1
    assert [point["territory"]["territory_id"] for point in cloud["points"]] == ["c3"]


@pytest.mark.parametrize("index,value", [
    (2,"wrong-source"), (3,"wrong-vintage"), (4,"wrong-name"),
    (5,"wrong-version"), (6,"2000-01-01"), (7,"2000-01-01"),
    (8,"wrong-window"), (12,"wrong-axis"), (13,"wrong-revision"),
])
def test_milieux_cloud_rejects_tampered_state_bindings(index, value):
    valid = ("c1","artif_m2_par_habitant","ocs-a","v1","OCS A","2025",None,None,"2020–2023","ocs","ocs-v1","M2","M2","ocs-a-r1",None,None,None,None,None,None,None,"ocs-a","v1","OCS A","2025",None,None,"M2","2020–2023",["ocs-a-r1"])
    tampered=list(valid)
    tampered[index]=value
    connection=Connection(readings=[("c1","commune","A","2017–2023","2020–2023",1.2,8.0,9.5,"measured","rp","2023")],
        associations=[tampered],publication=[("ocs","ocs-v1","ref")])
    with pytest.raises(HTTPException) as error:
        _milieux_reading_cloud(connection,("reading-v1",1,"ref","ref",None),"commune","focal","commune",["c1"],None)
    assert error.value.status_code == 503
    connection = Connection(
        readings=[("c1", "commune", "A", "2017–2023", "2020–2023", 1.2, 8.0, 9.5, "measured", "rp", "2023")],
        associations=[], publication=[])
    with pytest.raises(HTTPException) as error:
        _milieux_reading_cloud(connection, ("reading-v1", 2, "reference-v1", "reference-v1", None),
            "commune", "focal", "commune", ["c1"], None)
    assert error.value.status_code == 503
