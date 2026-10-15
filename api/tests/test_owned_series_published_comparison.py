import pytest
from fastapi import HTTPException

from api import main


class Cursor:
    def __init__(self, rows=(), row=None): self.rows, self.row = list(rows), row
    def fetchall(self): return self.rows
    def fetchone(self): return self.row if self.row is not None else (self.rows[0] if self.rows else None)


class FixedComparisonConnection:
    def __init__(self, *, context="density_class", stale=None, incomplete=False,
                 stat="median", scope="default_group", custom=False, axis_kind=None, extra_member=False,
                 eligible_count=None, focal_status="measured", bad_focal_rank=False,
                 unsupported_comparison_level=False):
        self.context=context; self.stale=stale; self.incomplete=incomplete
        self.stat=stat; self.scope=scope; self.custom=custom; self.sql=[]
        self.members=["c1","c2"] if context != "bretagne" else ["c1","c2","c3"]
        self.extra_member=extra_member
        self.eligible_count=eligible_count; self.focal_status=focal_status
        self.bad_focal_rank=bad_focal_rank
        self.unsupported_comparison_level=unsupported_comparison_level
        self.zero_reason=None; self.conflicting_zero_reason=False
        self.dataset="owned-v1"; self.indicator="series_x"
        self.axes=["2020","2021"] if stat!="mean" else ["t0000","t0005"]
        self.point=self.axes[-1]
        self.axis_kind=axis_kind or ("duration_minute" if stat=="mean" else "year")

    def execute(self, sql, params=None):
        self.sql.append((sql,params))
        if "WHERE territory_id=%s" in sql and "density_class_code FROM territory_reference" in sql:
            return Cursor(row=("c1","commune","d1"))
        if ("SELECT territory_id,territory_type,department_id,epci_id,density_class_code FROM territory_reference"
                in sql):
            return Cursor(rows=[("c1","commune","35","e1","d1"),
                ("c2","commune","35","e1","d1"),
                ("c3","commune","22","e2","d2")])
        if "SELECT territory_id,epci_id,density_class_code" in sql and "WHERE territory_type='commune'" in sql:
            return Cursor(rows=[("c1","e1","d1"),("c2","e1","d1"),("c3","e2","d2")])
        if "WHERE territory_type='region'" in sql:
            return Cursor(rows=[("r1",)])
        if "FROM series_dataset_publication p LEFT JOIN table_publication" in sql:
            return Cursor(rows=[(self.dataset,"series-v1","ref-v1","ref-v1")])
        if "SELECT d.dataset_id,d.indicator_id,d.theme_id" in sql:
            comparison_levels=["epci","departement"] if self.unsupported_comparison_level else ["commune","epci","departement"]
            descriptor=(self.dataset,self.indicator,"milieux",self.point,"Series","unit","high",
                ["commune","epci","departement"],"d1",self.axes,self.stat,self.scope,
                comparison_levels,self.axis_kind)
            return Cursor(rows=[descriptor])
        if "LEFT JOIN series_dataset_observation o" in sql:
            ids=params[1]
            if "o.value" not in sql:
                return Cursor(rows=[(self.dataset,self.indicator,tid,
                    self.focal_status if tid=="c1" else "measured",
                    f"rev-{tid}-{axis}" if self.axis_kind=="declared_detail" else f"rev-{tid}",axis,
                    ("no_modeled_endpoint_stops" if self.conflicting_zero_reason and axis==self.axes[0]
                     else self.zero_reason))
                    for tid in ids for axis in ( ["M3",self.point] if self.axis_kind=="declared_detail"
                        else (self.axes if self.stat=="mean" else [self.point]))])
            if self.axis_kind=="declared_detail":
                axes=["M3",self.point]
                return Cursor(rows=[(self.dataset,self.indicator,tid,10.0 if tid=="c1" else 5.0,
                    "measured",f"rev-{tid}-{axis}",axis,None) for tid in ids for axis in axes])
            axes=self.axes if self.stat=="mean" else [self.point]
            return Cursor(rows=[(self.dataset,self.indicator,tid,10.0 if tid=="c1" else 5.0,
                "measured",f"rev-{tid}",axis,None) for tid in ids for axis in axes])
        if "FROM series_provenance_revision" in sql:
            return Cursor(rows=[(revision,"source",revision,"Fixture source","Fixture dataset",revision,
                None,None,f"hash-{revision}") for revision in params[0]])
        if "FROM ordered_series_comparison_publication" in sql:
            if self.stale=="missing": return Cursor()
            source="old-series" if self.stale=="series" else "series-v1"
            reference="old-ref" if self.stale=="reference" else "ref-v1"
            group_count=1 if self.incomplete else len(self.axes)
            return Cursor(row=("comparison-v1",source,reference,group_count,len(self.axes)*len(self.members),
                "series-v1","ref-v1"))
        if "FROM ordered_series_comparison_group" in sql:
            axes=["M2","M3"] if self.axis_kind=="declared_detail" else self.axes
            count=len(self.members)+(1 if self.extra_member else 0)
            eligible=count if self.eligible_count is None else self.eligible_count
            rows=[(axis,self.stat,7.5,count,eligible,count-eligible) for axis in axes]
            return Cursor(rows=rows[:1] if self.incomplete else rows)
        if "FROM ordered_series_comparison_territory" in sql:
            member_ids=[params[5]]
            axes=["M2","M3"] if self.axis_kind=="declared_detail" else self.axes
            eligible=len(self.members) if self.eligible_count is None else self.eligible_count
            rank=(None if self.bad_focal_rank=="missing_rank" else 1) if self.focal_status=="measured" else None
            rank_size=(eligible+1 if self.bad_focal_rank=="wrong_rank_size" else eligible) if self.focal_status=="measured" else None
            return Cursor(rows=[(axis,tid,10.0 if self.focal_status=="measured" else None,self.focal_status,
                rank,
                (1 if self.focal_status=="measured" else None),
                rank_size)
                for axis in axes for tid in member_ids])
        if "SELECT DISTINCT state_role" in sql:
            return Cursor(rows=[("M2",),("M3",)] if self.axis_kind=="declared_detail" else [])
        raise AssertionError(sql)


@pytest.mark.parametrize("context,territory_type,selection,scope,expected",[
    ("density_class","commune",None,{"kind":"density_class","density_class_code":"d1"},("density_class","d1","commune")),
    ("epci","commune",[("commune","c1"),("commune","c2")],{"kind":"explicit_selection"},("epci","e1","commune")),
    ("bretagne","commune",[("commune","c1"),("commune","c2"),("commune","c3")],{"kind":"explicit_selection"},("bretagne","r1","commune")),
    ("same_level","epci",None,{"kind":"same_level","territory_type":"epci"},("same_level","r1","epci")),
])
def test_all_canonical_owned_series_contexts_read_published_axis_and_territory_rows(
        context,territory_type,selection,scope,expected):
    conn=FixedComparisonConnection(context=context)
    cohort_type="commune" if territory_type=="commune" else "epci"
    members=tuple(conn.members if cohort_type=="commune" else ["e1","e2"])
    territory_id="c1" if territory_type=="commune" else "e1"
    results,markers,_,_,_ = main._owned_series_comparison_results(conn,
        [(conn.dataset,"milieux",False,conn.indicator)],territory_type,territory_id,selection,
        cohort=(cohort_type,members,scope))
    result=results[0]
    assert result["median"]==7.5
    assert result["rank"]==1
    assert any("FROM series_provenance_revision" in sql for sql,_ in conn.sql)
    group_read=next(params for sql,params in conn.sql if "FROM ordered_series_comparison_group" in sql)
    assert tuple(group_read[2:5])==expected
    assert markers[conn.dataset][1]=="series-v1"
    assert any("FROM ordered_series_comparison_group" in sql for sql,_ in conn.sql)
    assert any("FROM ordered_series_comparison_territory" in sql for sql,_ in conn.sql)
    raw_rows=[sql for sql,_ in conn.sql if "LEFT JOIN series_dataset_observation o" in sql]
    assert len(raw_rows)==1
    assert "o.value" not in raw_rows[0]
    published_territory=next((sql,params) for sql,params in conn.sql
        if "FROM ordered_series_comparison_territory" in sql)
    assert published_territory[1][5]==territory_id


@pytest.mark.parametrize("stale",["missing","series","reference"])
def test_owned_series_fixed_comparison_fails_closed_on_missing_or_stale_marker(stale):
    conn=FixedComparisonConnection(stale=stale)
    with pytest.raises(HTTPException) as error:
        main._owned_series_comparison_results(conn,[(conn.dataset,"milieux",False,conn.indicator)],
            "commune","c1",None,cohort=("commune",tuple(conn.members),
                {"kind":"density_class","density_class_code":"d1"}))
    assert error.value.status_code==503


def test_incomplete_published_groups_fail_closed_and_noncanonical_custom_selection_stays_request_time():
    conn=FixedComparisonConnection(incomplete=True)
    with pytest.raises(HTTPException,match="incomplete"):
        main._owned_series_comparison_results(conn,[(conn.dataset,"milieux",False,conn.indicator)],
            "commune","c1",None,cohort=("commune",tuple(conn.members),
                {"kind":"density_class","density_class_code":"d1"}))
    custom=FixedComparisonConnection(custom=True)
    results,*_=main._owned_series_comparison_results(custom,[(custom.dataset,"milieux",False,custom.indicator)],
        "commune","c1",[("commune","c1"),("commune","c3")],
        cohort=("commune",("c1","c3"),{"kind":"explicit_selection"}))
    assert results[0]["median"]==7.5
    assert not any("ordered_series_comparison_" in sql for sql,_ in custom.sql)


def test_overbroad_published_cohort_fails_closed_but_custom_selection_stays_request_time():
    conn=FixedComparisonConnection(extra_member=True)
    with pytest.raises(HTTPException,match="incomplete"):
        main._owned_series_comparison_results(conn,[(conn.dataset,"milieux",False,conn.indicator)],
            "commune","c1",None,cohort=("commune",tuple(conn.members),
                {"kind":"density_class","density_class_code":"d1"}))


@pytest.mark.parametrize("eligible,expected_status,expected_reason",[
    (0,"unavailable","no_selected_comparable_values"),
    (1,"unavailable","fewer_than_two_comparable_values"),
    (2,"available",None),
])
def test_fixed_comparison_missing_focal_uses_published_eligible_count(eligible,expected_status,expected_reason):
    conn=FixedComparisonConnection(eligible_count=eligible,focal_status="missing")
    result=main._owned_series_comparison_results(conn,[(conn.dataset,"milieux",False,conn.indicator)],
        "commune","c1",None,cohort=("commune",tuple(conn.members),
            {"kind":"density_class","density_class_code":"d1"}))[0][0]
    assert result["eligible_count"]==eligible
    assert result["status"]==expected_status and result["reason"]==expected_reason
    assert result["focal_value"] is None and result["rank"] is None


@pytest.mark.parametrize("eligible,expected_status,expected_reason",[
    (1,"unavailable","fewer_than_two_comparable_values"),
    (2,"available",None),
])
def test_fixed_comparison_measured_focal_still_uses_published_eligible_count(
        eligible,expected_status,expected_reason):
    conn=FixedComparisonConnection(eligible_count=eligible)
    result=main._owned_series_comparison_results(conn,[(conn.dataset,"milieux",False,conn.indicator)],
        "commune","c1",None,cohort=("commune",tuple(conn.members),
            {"kind":"density_class","density_class_code":"d1"}))[0][0]
    assert result["eligible_count"]==eligible
    assert result["status"]==expected_status and result["reason"]==expected_reason
    assert result["focal_value"]==10 and result["rank"]==1


@pytest.mark.parametrize("bad_focal_rank",["missing_rank","wrong_rank_size"])
def test_fixed_comparison_fails_closed_on_invalid_measured_focal_rank(bad_focal_rank):
    conn=FixedComparisonConnection(bad_focal_rank=bad_focal_rank)
    with pytest.raises(HTTPException,match="focal comparison result is incomplete"):
        main._owned_series_comparison_results(conn,[(conn.dataset,"milieux",False,conn.indicator)],
            "commune","c1",None,cohort=("commune",tuple(conn.members),
                {"kind":"density_class","density_class_code":"d1"}))


def test_fixed_context_with_unsupported_descriptor_preserves_unavailable_dynamic_contract():
    conn=FixedComparisonConnection(unsupported_comparison_level=True)
    result=main._owned_series_comparison_results(conn,[(conn.dataset,"milieux",False,conn.indicator)],
        "commune","c1",None,cohort=("commune",tuple(conn.members),
            {"kind":"density_class","density_class_code":"d1"}))[0][0]
    assert result["status"]=="unavailable"
    assert result["reason"]=="fewer_than_two_comparable_values"
    assert result["focal_value"]==10 and result["comparison_sources"]
    assert any("o.value" in sql for sql,_ in conn.sql if "LEFT JOIN series_dataset_observation o" in sql)


def test_raccordement_fixed_default_uses_published_complete_mean_curve_contract():
    conn=FixedComparisonConnection(stat="mean",scope="selected_group",context="density_class")
    conn.indicator="raccordement_courbe"
    conn.axes=["t0000","t0005"]; conn.point="t0005"
    response=main._owned_series_comparison_result(conn,
        (conn.dataset,"mobilite",False,conn.indicator),"commune","c1",conn.indicator,None)
    result=response["result"]
    assert response["contract"]=="indicator-comparison-v1" and response["shape"]=="series"
    assert result["statistic"]=="mean" and result["mean"]==7.5
    assert result["mean_curve"]["points"]==[
        {"axis":"t0000","value":7.5,"status":"measured"},
        {"axis":"t0005","value":7.5,"status":"measured"}]
    assert result["mean_curve"]["selected_member_count"]==2
    assert result["mean_curve"]["axis_kind"]==conn.axis_kind
    custom, *_ = main._owned_series_comparison_results(conn,[(conn.dataset,"mobilite",False,conn.indicator)],
        "commune","c1",[("commune","c1"),("commune","c3")],
        cohort=("commune",("c1","c3"),{"kind":"explicit_selection"}))
    assert custom[0]["mean"] == result["mean"]
    assert custom[0]["mean_curve"]["points"] == result["mean_curve"]["points"]
    conn.axis_kind="fixture_curve_axis"
    generic=main._owned_series_comparison_results(conn,[(conn.dataset,"mobilite",False,conn.indicator)],
        "commune","c1",None,cohort=("commune",tuple(conn.members),
            {"kind":"density_class","density_class_code":"d1"}))[0][0]
    assert generic["mean_curve"]["axis_kind"]=="fixture_curve_axis"


def test_raccordement_fixed_counts_published_zero_reason_metadata_without_peer_values():
    conn=FixedComparisonConnection(stat="mean",scope="selected_group")
    conn.indicator="raccordement_courbe"; conn.zero_reason="endpoint_stops_but_no_permitted_first_boarding"
    result=main._owned_series_comparison_result(conn,
        (conn.dataset,"mobilite",False,conn.indicator),"commune","c1",conn.indicator,None)["result"]
    assert result["mean_curve"]["model_zero_reason_counts"]=={
        "endpoint_stops_but_no_permitted_first_boarding":2}
    assert all("o.value" not in sql for sql,_ in conn.sql if "LEFT JOIN series_dataset_observation o" in sql)


def test_raccordement_fixed_fails_closed_on_conflicting_zero_reason_metadata():
    conn=FixedComparisonConnection(stat="mean",scope="selected_group")
    conn.indicator="raccordement_courbe"; conn.conflicting_zero_reason=True
    with pytest.raises(HTTPException,match="zero reason conflicts across axes"):
        main._owned_series_comparison_result(conn,
            (conn.dataset,"mobilite",False,conn.indicator),"commune","c1",conn.indicator,None)


def test_ocsge_published_comparison_reports_the_m3_facet_sources_without_requiring_shared_vintages():
    conn=FixedComparisonConnection(axis_kind="declared_detail")
    conn.indicator="artif_par_habitant"
    conn.axes=["M2","M3","2025"]
    conn.point="2025"
    response=main._owned_series_comparison_result(conn,
        (conn.dataset,"milieux",False,conn.indicator),"commune","c1",conn.indicator,None)
    result=response["result"]
    assert result["rank"]==1
    assert {source["vintage_id"] for source in result["comparison_sources"]}=={
        "rev-c1-M3","rev-c2-M3"}
