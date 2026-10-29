from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.resource_catalogue import default_resource_catalogue
from api.resource_requests import ResourceReadItem
from api.semantic_resource_reader import SemanticResourceReader


class Connection:
    def __init__(self, axis_values):
        self.axis_values = axis_values
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append(sql)
        if "FROM observed_collection_category" in sql:
            return Cursor([(value,) for value in ("ACV", "PVD")])
        if "FROM series_descriptor" in sql:
            return Cursor([(self.axis_values,)])
        raise AssertionError(sql)


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


def reader():
    return SemanticResourceReader(
        indicator_facts_snapshot=lambda *args, **kwargs: {"work_units": 3},
        indicator_comparison_preflight=lambda *args, **kwargs: None,
        indicator_comparison_snapshot=lambda *args, **kwargs: {},
        owned_series_route=lambda *args, **kwargs: None,
        owned_named_reference_snapshot=lambda *args, **kwargs: {},
        comparison_field_selection=lambda fields: fields,
        max_owned_series_provenance_per_point=8,
    )


def item(resource, axis, value, intent=None):
    return ResourceReadItem.model_validate({
        "resource": resource,
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "coordinates": {axis: [value]},
        "intent": intent or {"kind": "facts"},
    })


def test_membership_coordinate_filters_category_rows_instead_of_returning_empty():
    catalogue = default_resource_catalogue.__wrapped__()
    resource = catalogue.resources_by_id["couverture_programmes"]
    request = item("couverture_programmes", "membership", "ACV")
    conn = Connection([])
    domains = reader()._coordinate_values(conn, request, resource)
    assert domains["membership"] == {"ACV", "PVD"}
    data = reader()._filter_coordinates({"entries": [{"detail": "ACV"}, {"detail": "PVD"}]},
                                        request.coordinates, resource)
    assert data["entries"] == [{"detail": "ACV"}]


def test_dynamic_axis_domain_comes_from_published_descriptor_not_facts():
    catalogue = default_resource_catalogue.__wrapped__()
    resource = catalogue.resources_by_id["prix_m2"]
    valid = item("prix_m2", "year", "2020")
    conn = Connection(["2020", "2021"])
    assert reader()._coordinate_values(conn, valid, resource)["year"] == {"2020", "2021"}
    invalid = item("prix_m2", "year", "2030")
    with pytest.raises(HTTPException) as error:
        reader().preflight(conn, invalid, catalogue)
    assert error.value.status_code == 422
    assert len(conn.statements) == 2  # descriptor lookups only; facts reader was never invoked


@pytest.mark.parametrize("coordinate,rows,expected", [
    ({"membership": ["ACV"]}, [{"detail": "ACV"}, {"detail": "PVD"}], ["ACV"]),
    ({"year": ["2021"]}, [{"axis": "2020"}, {"axis": "2021"}], ["2021"]),
    ({"duration_minute": ["15"]}, [{"axis": "0"}, {"axis": "15"}], ["15"]),
    ({"declared_detail": ["A"]}, [{"axis": "A"}, {"axis": "B"}], ["A"]),
    ({"sex": ["F"]}, [{"sex": "F"}, {"sex": "M"}], ["F"]),
    ({"typequ": ["B316"]}, [{"typequ": "B316"}, {"typequ": "A104"}], ["B316"]),
    ({"period": ["2025"]}, [{"observation_period": "2024"}, {"observation_period": "2025"}], ["2025"]),
])
def test_declared_axis_names_bind_to_typed_row_properties(coordinate, rows, expected):
    resource = SimpleNamespace()
    result = reader()._filter_coordinates({"entries": rows}, coordinate, resource)
    assert [next(iter(row.values())) for row in result["entries"]] == expected


def test_comparison_coordinate_grammar_is_supported_but_not_ignored():
    parsed = item("prix_m2", "year", "2021", {"kind": "selected_comparison", "members": [
        {"type": "commune", "id": "22002"}]})
    assert parsed.coordinates == {"year": ["2021"]}
    result = reader()._filter_coordinates({"result": {"points": [
        {"axis": "2020", "value": 1}, {"axis": "2021", "value": 2}]}},
        parsed.coordinates, SimpleNamespace())
    assert result["result"]["points"] == [{"axis": "2021", "value": 2}]


def test_scalar_comparison_facet_coordinate_is_applied():
    resource = SimpleNamespace(axes=("duration_minute",))
    result = reader()._filter_coordinates({"result": {
        "source_facet": "t0090", "median": 0.5, "rank": 1, "status": "available"}},
        {"duration_minute": ["t0090"]}, resource)
    assert result["result"]["median"] == 0.5
    unselected = reader()._filter_coordinates({"result": {
        "source_facet": "t0090", "median": 0.5, "rank": 1, "status": "available"}},
        {"duration_minute": ["t0015"]}, resource)
    assert unselected["result"]["status"] == "unavailable"
    assert "median" not in unselected["result"]


def test_profile_comparison_coordinate_binds_the_complete_facet():
    resource = SimpleNamespace(axes=("detail", "sex"), shapes=("declared_profile",))
    result = reader()._filter_coordinates({"result": {
        "source_facet": {"detail": "15-24", "sex": "M"},
        "median": 0.7, "rank": 2, "status": "available"}},
        {"detail": ["15-24"], "sex": ["M"]}, resource)

    assert result["result"]["median"] == 0.7
    assert result["result"]["rank"] == 2
    assert result["result"]["status"] == "available"


def test_period_detail_comparison_maps_requested_period_to_native_observation_period():
    resource = SimpleNamespace(axes=("period", "detail"), shapes=("period_detail",))
    published = {"result": {"source_facet": {"detail": "mobility", "observation_period": "2025"},
        "median": 15.0, "rank": 1, "status": "available"}}
    matched = reader()._filter_coordinates(published,
        {"detail": ["mobility"], "period": ["2025"]}, resource)
    assert matched["result"]["status"] == "available"
    assert matched["result"]["median"] == 15.0

    wrong_period = reader()._filter_coordinates(published,
        {"detail": ["mobility"], "period": ["2024"]}, resource)
    assert wrong_period["result"]["status"] == "unavailable"
    assert wrong_period["result"]["reason"] == "selected_coordinate_has_no_comparison_result"
    assert "median" not in wrong_period["result"]


def test_linked_profile_scalar_comparison_is_not_filtered_as_a_profile_bin():
    resource = SimpleNamespace(axes=("detail",), shapes=("declared_profile",))
    result = reader()._filter_coordinates({"result": {
        "source_facet": "part_passoires", "median": 12.0, "rank": 1,
        "status": "available"}}, {"detail": ["F"]}, resource)

    assert result["result"]["median"] == 12.0
    assert result["result"]["rank"] == 1
