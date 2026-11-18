"""Littoral AEDAR fixed-context reads (#1043).

Proves same-status peer resolution, producer-pooled sibling references and
request-time direction-aware ranks for aggregate AND per-cell facets, with the
density/EPCI/Bretagne responses left byte-identical.
"""
import importlib.util
from pathlib import Path

import pytest

from api import aedar_reads
from api.aedar_models import AEDAR_AGGREGATE_READINGS


_spec = importlib.util.spec_from_file_location(
    "aedar_contract_fixtures",
    Path(__file__).with_name("test_aedar_contract.py"))
_contract = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_contract)
Rows = _contract._AedarSelectedRows


def _summary(value, addresses=10, observed=8, status="available"):
    return {
        "value": value, "status": status,
        "n_typequ": 235 if status == "available" else None,
        "n_addresses": addresses, "n_observed": observed,
        "coverage_status": "covered" if status == "available" else None,
        "provenance": ("aedar_bretagne", "2026-v1", "https://example.test",
                       "ODbL", "AEDAR", None, "2026-09-30"),
    }


def _littoral_state():
    # Four communes: two C, two NC. Each is an exact same-status peer set.
    ref_rows = [
        ("22001", "commune", "22", "E1", "D1", "C"),
        ("22002", "commune", "22", "E1", "D1", "C"),
        ("22003", "commune", "29", "E2", "D2", "NC"),
        ("22004", "commune", "29", "E2", "D2", "NC"),
        ("E1", "epci", "22", None, None, None),
        ("E2", "epci", "29", None, None, None),
        ("22", "departement", None, None, None, None),
        ("29", "departement", None, None, None, None),
        ("53", "region", None, None, None, None),
    ]
    aggregates = {}
    for code, value in (("22001", 5.0), ("22002", 9.0), ("22003", 1.0), ("22004", 7.0)):
        aggregates[("member", code)] = {"A104": {
            "label": "A104", "n_addresses": 10, "n_observed": 8,
            "coverage": "covered", "measures": {"count_5_walk_mean": value}}}
        aggregates[("focal", code)] = {"A104": {
            "label": "A104", "n_addresses": 10, "n_observed": 8,
            "coverage": "covered", "measures": {"count_5_walk_mean": value}}}
    summaries = {}
    for code, volume in (("22001", 10.0), ("22002", 20.0),
                         ("22003", 30.0), ("22004", 40.0)):
        kind = "commune"
        summaries[(kind, code, "meanVolume")] = _summary(volume)
        summaries[(kind, code, "meanDiversity")] = _summary(0.5)
    summaries[("epci", "E1", "meanVolume")] = _summary(23.0)
    summaries[("region", "53", "meanVolume")] = _summary(45.0)
    littoral_summaries = {
        ("C", "meanVolume"): _summary(15.0, 20, 16),
        ("C", "meanDiversity"): _summary(0.5, 20, 16),
        ("NC", "meanVolume"): _summary(35.0, 20, 16),
        ("NC", "meanDiversity"): _summary(0.9, 20, 16),
    }
    measure = "count_5_walk_mean"
    group_rows = [
        {"comparison_context": "littoral", "group_id": "C", "typequ": "A104",
         "measure": measure, "value": 7.0, "n_addresses": 20, "n_observed": 16,
         "coverage_status": "covered", "statistic": "pooled"},
        {"comparison_context": "littoral", "group_id": "NC", "typequ": "A104",
         "measure": measure, "value": 4.0, "n_addresses": 20, "n_observed": 16,
         "coverage_status": "covered", "statistic": "pooled"},
    ]
    return {
        "reference": {row[0]: row[1] for row in ref_rows},
        "epci": "E1", "ref_rows": ref_rows, "aggregates": aggregates,
        "summaries": summaries, "density_summaries": {},
        "littoral_summaries": littoral_summaries, "group_rows": group_rows,
    }


class _LittoralConnection(_contract._AedarSelectedConnection):
    def execute(self, sql, params=None):
        s = sql
        if "SELECT littoral_code FROM territory_reference" in s:
            row = next((r for r in self.state["ref_rows"]
                        if r[0] == params[1] and r[1] == params[0]), None)
            return Rows(["littoral_code"], [(row[5],)] if row and len(row) > 5 else [])
        if "territory_type='commune' AND littoral_code=%s" in s:
            rows = [r for r in self.state["ref_rows"]
                    if r[1] == "commune" and len(r) > 5 and r[5] == params[0]]
            return Rows(["territory_id"], [(r[0],) for r in rows])
        if "aedar_comparison_publication" in s:
            return Rows(["marker"], [(
                "cmp-v1", "2026-v1", "aed-v1", "ref-v1", "inputs-v1", {"address_origins": "sha"},
                1, 0, "reference_only", "aed-v1", "ref-v1", 2, 40, 80, 80, 2, 235,
                2, 40, 80, 80, 2)])
        if "FROM aedar_littoral_summary" in s:
            _, group_id, measures = params
            rows = []
            for measure in measures:
                summary = self.state.get("littoral_summaries", {}).get((group_id, measure))
                if summary is not None:
                    rows.append((measure, summary["value"], summary["status"],
                                 summary["n_typequ"], summary["n_addresses"],
                                 summary["n_observed"], summary["coverage_status"],
                                 "aed-v1", "ref-v1", "inputs-v1"))
            return Rows([], rows)
        if "FROM aedar_comparison_group" in s:
            group_id, typequ, measure = params[0], params[1], params[2]
            rows = [r for r in self.state.get("group_rows", ())
                    if r["group_id"] == group_id and r["typequ"] == typequ
                    and r["measure"] == measure]
            if not rows:
                return Rows(["value", "n_addresses", "n_observed", "coverage_status", "statistic"], [])
            r = rows[0]
            return Rows(["value", "n_addresses", "n_observed", "coverage_status", "statistic"],
                        [(r["value"], r["n_addresses"], r["n_observed"],
                          r["coverage_status"], r["statistic"])])
        if "density_class_code,littoral_code FROM territory_reference WHERE territory_id=%s" in s:
            row = next((r for r in self.state["ref_rows"] if r[0] == params[0]), None)
            return Rows(["territory_id", "territory_type", "density_class_code", "littoral_code"],
                        [(row[0], row[1], row[4], row[5])] if row else [])
        if "density_class_code,littoral_code FROM territory_reference" in s:
            return Rows(["territory_id", "territory_type", "department_id", "epci_id",
                         "density_class_code", "littoral_code"],
                        [tuple(r) for r in self.state["ref_rows"]])
        return super().execute(sql, params)


_FACETS = _contract._aedar_facets()


def _fixed_aggregate(conn, code, measure="meanVolume", context="littoral", fields=None):
    return aedar_reads._aedar_comparison_snapshot(
        conn, "commune", code, context, None, measure, fields,
        _FACETS, snapshot_state={})


def _fixed_cell(conn, code, typequ="A104", measure="count_5_walk_mean"):
    return aedar_reads._aedar_comparison_snapshot(
        conn, "commune", code, "littoral", typequ, measure,
        ["group_value", "value", "rank", "rank_size", "rank_ties"], _FACETS,
        snapshot_state={})["comparison"]


def test_littoral_aggregate_reference_is_pooled_and_same_status_ranked():
    state = _littoral_state()
    c = _fixed_aggregate(_LittoralConnection(state), "22001")
    comp = c["comparison"]
    assert comp["comparison_context"] == "littoral"
    assert comp["group_id"] == "C" and comp["territory_type"] == "commune"
    assert comp["statistic"] == "pooled"
    assert comp["group_value"] == 15.0  # producer-pooled C reference
    assert (comp["rank"], comp["rank_size"], comp["rank_ties"]) == (2, 2, 1)
    nc = _fixed_aggregate(_LittoralConnection(state), "22003")["comparison"]
    assert nc["group_id"] == "NC" and nc["group_value"] == 35.0
    assert (nc["rank"], nc["rank_size"], nc["rank_ties"]) == (2, 2, 1)


def test_littoral_aggregate_rank_ties_and_unavailable_peer_exclusion():
    state = _littoral_state()
    state["summaries"][("commune", "22002", "meanVolume")] = _summary(10.0)
    comp = _fixed_aggregate(_LittoralConnection(state), "22001")["comparison"]
    assert (comp["rank"], comp["rank_size"], comp["rank_ties"]) == (1, 2, 2)
    state = _littoral_state()
    state["summaries"][("commune", "22002", "meanVolume")] = _summary(
        None, status="unavailable")
    comp = _fixed_aggregate(_LittoralConnection(state), "22001")["comparison"]
    assert (comp["rank"], comp["rank_size"], comp["rank_ties"]) == (1, 1, 1)


def test_littoral_aggregate_unavailable_focal_is_null_rank_not_zero():
    state = _littoral_state()
    state["summaries"][("commune", "22001", "meanVolume")] = _summary(
        None, status="unavailable")
    comp = _fixed_aggregate(_LittoralConnection(state), "22001")["comparison"]
    assert comp["value"] is None
    assert comp["rank"] is None and comp["rank_size"] is None and comp["rank_ties"] is None
    assert comp["group_value"] == 15.0  # reference still served


def test_littoral_per_cell_reference_and_direction_aware_rank():
    comp = _fixed_cell(_LittoralConnection(_littoral_state()), "22001")
    assert comp["comparison_context"] == "littoral"
    assert comp["group_id"] == "C" and comp["statistic"] == "pooled"
    assert comp["group_value"] == 7.0
    assert comp["value"] == 5.0
    assert (comp["rank"], comp["rank_size"], comp["rank_ties"]) == (2, 2, 1)
    nc = _fixed_cell(_LittoralConnection(_littoral_state()), "22003")
    assert nc["group_id"] == "NC" and nc["group_value"] == 4.0
    assert (nc["rank"], nc["rank_size"], nc["rank_ties"]) == (2, 2, 1)


def test_littoral_per_cell_ties_zero_and_missing_peer():
    state = _littoral_state()
    for key in (("focal", "22002"), ("member", "22002")):
        state["aggregates"][key]["A104"]["measures"]["count_5_walk_mean"] = 5.0
    comp = _fixed_cell(_LittoralConnection(state), "22001")
    assert (comp["rank"], comp["rank_size"], comp["rank_ties"]) == (1, 2, 2)
    state = _littoral_state()
    del state["aggregates"][("member", "22002")]
    del state["aggregates"][("focal", "22002")]
    comp = _fixed_cell(_LittoralConnection(state), "22001")
    assert (comp["rank"], comp["rank_size"], comp["rank_ties"]) == (1, 1, 1)


def test_littoral_finite_zero_is_rankable_and_unavailable_focal_is_null():
    state = _littoral_state()
    state["aggregates"][("focal", "22001")]["A104"]["measures"]["count_5_walk_mean"] = 0.0
    comp = _fixed_cell(_LittoralConnection(state), "22001")
    assert comp["value"] == 0.0
    assert comp["rank"] == 2  # a genuine zero stays eligible
    state = _littoral_state()
    del state["aggregates"][("focal", "22001")]
    conn = _LittoralConnection(state)
    with pytest.raises(Exception):
        _fixed_cell(conn, "22001")


def test_littoral_missing_or_unclassified_focal_fails_closed():
    state = _littoral_state()
    state["ref_rows"][0] = ("22001", "commune", "22", "E1", "D1", None)
    conn = _LittoralConnection(state)
    with pytest.raises(Exception) as exc:
        _fixed_aggregate(conn, "22001")
    assert "classification" in str(exc.value).lower()


def test_littoral_incomplete_sibling_publication_fails_closed():
    state = _littoral_state()
    original = _LittoralConnection.execute

    def broken(self, sql, params=None):
        if "aedar_comparison_publication" in sql:
            return Rows(["marker"], [(
                "cmp-v1", "2026-v1", "aed-v1", "ref-v1", "inputs-v1", {},
                1, 0, "reference_only", "aed-v1", "ref-v1", 2, 40, 80, 80, 2, 235,
                2, 40, 1, 1, 2)])
        return original(self, sql, params)

    _LittoralConnection.execute = broken
    try:
        with pytest.raises(Exception):
            _fixed_aggregate(_LittoralConnection(state), "22001")
    finally:
        _LittoralConnection.execute = original


def test_density_and_direct_contexts_are_unchanged_by_littoral_extension():
    state = _littoral_state()
    # Direct EPCI reference still reads the direct aggregate and stays rankless
    # on the aggregate default projection.
    epci = aedar_reads._aedar_comparison_snapshot(
        _LittoralConnection(state), "commune", "22001", "epci", None, "meanVolume",
        None, _FACETS, snapshot_state={})
    assert epci["comparison"]["comparison_context"] == "epci"
    assert epci["comparison"]["statistic"] == "direct"
