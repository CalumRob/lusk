import pytest
from fastapi import HTTPException

from api import main


class Cursor:
    def __init__(self, rows=(), row=None): self.rows, self.row = list(rows), row
    def fetchall(self): return self.rows
    def fetchone(self): return self.row if self.row is not None else (self.rows[0] if self.rows else None)


class FixedComparisonConnection:
    def __init__(self, *, context="density_class", stale=None, incomplete=False,
                 stat="median", scope="default_group", custom=False, axis_kind=None, extra_member=False):
        self.context=context; self.stale=stale; self.incomplete=incomplete
        self.stat=stat; self.scope=scope; self.custom=custom; self.sql=[]
        self.members=["c1","c2"] if context != "bretagne" else ["c1","c2","c3"]
        self.extra_member=extra_member
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
            descriptor=(self.dataset,self.indicator,"milieux",self.point,"Series","unit","high",
                ["commune","epci","departement"],"d1",self.axes,self.stat,self.scope,
                ["commune","epci","departement"],self.axis_kind)
            return Cursor(rows=[descriptor])
        if "LEFT JOIN series_dataset_observation o" in sql:
            ids=params[1]
            if "o.value" not in sql:
                return Cursor(rows=[(self.dataset,self.indicator,tid,"measured",
                    f"rev-{tid}-{axis}" if self.axis_kind=="declared_detail" else f"rev-{tid}",axis,None)
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
            rows=[(axis,self.stat,7.5,count,count,0) for axis in axes]
            return Cursor(rows=rows[:1] if self.incomplete else rows)
        if "FROM ordered_series_comparison_territory" in sql:
            member_ids=[params[5]]
            axes=["M2","M3"] if self.axis_kind=="declared_detail" else self.axes
            return Cursor(rows=[(axis,tid,10.0 if tid in ("c1","e1") else 5.0,"measured",
                (1 if tid in ("c1","e1") and params[4]=="commune" else None),1,
                len(self.members)) for axis in axes for tid in member_ids])
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
    results,markers,_,_,_ = main._owned_series_comparison_results(conn,
        [(conn.dataset,"milieux",False,conn.indicator)],territory_type,"c1",selection,
        cohort=(cohort_type,members,scope))
    result=results[0]
    assert result["median"]==7.5
    assert (result["rank"]==1) if territory_type=="commune" else result["rank"] is None
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
    assert published_territory[1][5]=="c1"


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
