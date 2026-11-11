"""Fixed declared-profile comparisons over an explicit declared detail (#960)."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.resource_catalogue import default_resource_catalogue
from api.resource_requests import ResourceReadItem
from api.semantic_resource_reader import SemanticResourceReader


class Cursor:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


DETAILS = ("t_km_1000", "b_km_1000", "c_km_1000")


class Connection:
    """Answer only the descriptor lookups a fixed profile comparison preflights."""

    def __init__(self, *, default=("b_km_1000", None, None), axes=("detail",),
                 detail_keys=DETAILS, territory_type="commune"):
        self.default = default
        self.axes = axes
        self.detail_keys = detail_keys
        self.territory_type = territory_type
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append((sql, params))
        if "SELECT comparison_detail,comparison_sex,comparison_scalar" in sql:
            return Cursor([self.default] if self.default is not None else [])
        if "SELECT axis_key FROM profile_axis" in sql:
            axis_name = params[1] if params and len(params) > 1 else "detail"
            if axis_name not in self.axes:
                return Cursor()
            if axis_name == "detail":
                return Cursor([(key,) for key in self.detail_keys])
            return Cursor([("F",), ("M",)])
        if "FROM territory_reference WHERE territory_id=%s" in sql:
            return Cursor([(self.territory_type,)])
        raise AssertionError(sql)


def reader(comparison_preflight=None):
    return SemanticResourceReader(
        indicator_facts_snapshot=lambda *args, **kwargs: {"work_units": 1},
        indicator_comparison_preflight=comparison_preflight or (lambda *args, **kwargs: {}),
        indicator_comparison_snapshot=lambda *args, **kwargs: {},
        owned_series_route=lambda *args, **kwargs: None,
        owned_named_reference_snapshot=lambda *args, **kwargs: {},
        comparison_field_selection=lambda fields: fields,
        max_owned_series_provenance_per_point=8,
    )


def fixed_item(coordinates=None, resource="reseaux_par_habitant"):
    request = {
        "resource": resource,
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "intent": {"kind": "fixed_comparison", "context": "default"},
    }
    if coordinates is not None:
        request["coordinates"] = coordinates
    return ResourceReadItem.model_validate(request)


def catalogue():
    return default_resource_catalogue.__wrapped__()


@pytest.mark.parametrize("detail", DETAILS)
def test_fixed_profile_coordinate_selects_each_declared_detail(detail):
    resource = catalogue().resources_by_id["reseaux_par_habitant"]
    request = fixed_item({"detail": [detail]})
    coordinates = reader()._profile_comparison_coordinates(Connection(), request, resource)
    if detail == "b_km_1000":
        # The descriptor's published default keeps the published fast path.
        assert coordinates is None
    else:
        assert coordinates == {"detail": detail}


def test_fixed_profile_coordinate_matches_every_declared_axis():
    resource = SimpleNamespace(axes=("detail", "sex"), axis_values=(),
                               shapes=("declared_profile",), resource_id="structure_age")
    request = ResourceReadItem.model_validate({
        "resource": "structure_age",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "coordinates": {"detail": ["15-24"], "sex": ["M"]},
        "intent": {"kind": "fixed_comparison", "context": "default"},
    })
    conn = Connection(default=("<15", "F", None), axes=("detail", "sex"),
                      detail_keys=("<15", "15-24"))
    coordinates = reader()._profile_comparison_coordinates(conn, request, resource)
    assert coordinates == {"detail": "15-24", "sex": "M"}


def test_fixed_profile_coordinate_rejects_multi_value_axes():
    resource = catalogue().resources_by_id["reseaux_par_habitant"]
    request = fixed_item({"detail": ["t_km_1000", "c_km_1000"]})
    with pytest.raises(HTTPException) as error:
        reader()._profile_comparison_coordinates(Connection(), request, resource)
    assert error.value.status_code == 422


def test_fixed_profile_coordinate_rejects_a_partial_two_axis_point():
    resource = SimpleNamespace(axes=("detail", "sex"),
                               axis_values=(("detail", ("<15", "15-24")), ("sex", ("F", "M"))),
                               shapes=("declared_profile",), resource_id="structure_age")
    request = ResourceReadItem.model_validate({
        "resource": "structure_age",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "coordinates": {"detail": ["15-24"]},
        "intent": {"kind": "fixed_comparison", "context": "default"},
    })
    conn = Connection(default=("<15", "F", None), axes=("detail", "sex"),
                      detail_keys=("<15", "15-24"))
    with pytest.raises(HTTPException) as error:
        reader()._profile_comparison_coordinates(conn, request, resource)
    assert error.value.status_code == 422


def test_fixed_scalar_backed_profile_never_reinterprets_a_bin_as_its_scalar():
    resource = catalogue().resources_by_id["distribution_dpe"]
    request = fixed_item({"detail": ["A"]}, resource="distribution_dpe")
    with pytest.raises(HTTPException) as error:
        reader()._profile_comparison_coordinates(
            Connection(default=("A", None, "part_passoires")), request, resource)
    assert error.value.status_code == 422


def test_fixed_profile_preflight_charges_the_resolved_peer_cell_read():
    members = tuple(f"c{index}" for index in range(400))
    calls = []

    def comparison_preflight(conn, territory_type, territory_id, indicator_id, selection,
                             fields, **kwargs):
        calls.append(kwargs.get("profile_coordinates"))
        return {"members": members, "fixed_context": ("density_class", "D1", "commune"),
                "theme_id": "mobilite", "shape": "profile"}

    default_work = reader(comparison_preflight).preflight(
        Connection(), fixed_item(), catalogue())
    detail_work = reader(comparison_preflight).preflight(
        Connection(), fixed_item({"detail": ["t_km_1000"]}), catalogue())
    # The published default is a keyed lookup; a non-default declared detail is
    # one set-wise read over the resolved cohort's published cells.
    assert default_work == len(DETAILS)
    assert detail_work == len(members) * len(DETAILS)
    assert calls == [None, {"detail": "t_km_1000"}]


def test_fixed_profile_preflight_rejects_an_undeclared_detail_before_reading():
    def comparison_preflight(*_args, **_kwargs):
        pytest.fail("An undeclared coordinate must fail before the comparison preflight")

    with pytest.raises(HTTPException) as error:
        reader(comparison_preflight).preflight(
            Connection(), fixed_item({"detail": ["not_declared"]}), catalogue())
    assert error.value.status_code == 422
