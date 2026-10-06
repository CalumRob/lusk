"""Bounded, read-only comparisons over R-published access facts."""

from contextlib import asynccontextmanager
from functools import lru_cache
import hashlib
import json
import os
from contextlib import nullcontext
import unicodedata
from statistics import median
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Path, Query
from pydantic import BaseModel, Field
from psycopg_pool import ConnectionPool
from api.profile_reads import focal_profiles
from api.observed_collections import collection_descriptors, collection_snapshot, collection_comparison

from api.building_comparison import (
    ComparisonInputError, pooled_peer_distribution, resolve_commune_members,
    weighted_peer_ramp,
)


class Rank(BaseModel):
    position: int
    size: int


class ThemeTerritorySelection(BaseModel):
    territory_type: Literal["commune", "epci", "departement", "region"]
    territory_id: str = Field(min_length=1, max_length=32)


class ThemeComparisonRequest(BaseModel):
    theme_id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    # Match the existing typed building-selection boundary, which accommodates
    # the whole published territory universe rather than a 500-territory subset.
    # Omitted means the published default cohort; an explicit [] means none.
    selection: list[ThemeTerritorySelection] | None = Field(default=None, max_length=1500)


class IndicatorComparisonRequest(BaseModel):
    # Omitting the body or selection selects the published default; [] is empty.
    selection: list[ThemeTerritorySelection] | None = Field(default=None, max_length=1500)


class ModeComparison(BaseModel):
    value: float | None
    median: float | None
    rank: Rank | None
    direction: Literal["high", "low"]
    indicator_label: str
    source_id: str
    source_name: str
    source_version: str
    reference_date: str | None
    source_publication_date: str | None


class ServiceComparison(BaseModel):
    id: str
    modes: dict[str, ModeComparison]
    peer_median_car_gap: float | None
    peer_median_bike_gain: float | None


class ComparisonResponse(BaseModel):
    publication_id: str
    territory: dict[str, str]
    scope: dict[str, str | int] | None
    services: list[ServiceComparison]


class SelectedTerritory(BaseModel):
    type: Literal["commune", "epci", "departement", "region"]
    id: str = Field(min_length=1, max_length=32)


class BuildingSelection(BaseModel):
    selected: list[SelectedTerritory] = Field(min_length=1, max_length=1500)


MAX_TERRITORY_SEARCH_SCAN = 1500


@lru_cache(maxsize=1)
def pool() -> ConnectionPool:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise HTTPException(503, "DATABASE_URL is not configured")
    return ConnectionPool(conninfo=url, min_size=0, max_size=4, open=True,
                          kwargs={"autocommit": True})


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    if pool.cache_info().currsize:
        pool().close()
        pool.cache_clear()


app = FastAPI(title="Lusk read API — architecture spike", lifespan=lifespan)


def _building_publication(markers: list[tuple[str, str]]) -> str:
    versions = dict(markers)
    required = ("territory_reference", "building_ramp", "building_grid")
    if any(not versions.get(name) for name in required):
        raise HTTPException(503, "No building-access dataset has been published")
    payload = json.dumps([(name, versions[name]) for name in required],
                         ensure_ascii=True, separators=(",", ":"))
    return "building-v1-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _search_normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value.lower())
    value = "".join(char for char in value if not 0x0300 <= ord(char) <= 0x036F)
    return " ".join(value.replace("œ", "oe").replace("æ", "ae").replace("'", " ")
                 .replace("’", " ").replace("-", " ").split())


def search_territory_rows(rows: list[dict], query: str, limit: int) -> list[dict]:
    """Return all name candidates tied at the result-limit boundary.

    The app's existing rechercherTerritoires applies the final French
    localeCompare ordering and truncates this candidate window to `limit`.
    """
    normalized = _search_normalize(query)
    scored = []
    for row in rows:
        name = _search_normalize(row["name"])
        score = 100 if name == normalized else 80 if name.startswith(normalized) else 60 if any(
            word.startswith(normalized) for word in name.split()
        ) else 40 if normalized in name else 0
        if score:
            scored.append((score, row))
    # Static payload order is type (commune, EPCI, département, région), then
    # identifier. Repository reads preserve this stable base order; JS stable
    # sort preserves it where French collation considers labels equal.
    scored.sort(key=lambda item: (-item[0], len(item[1]["name"])))
    if len(scored) <= limit:
        return [row for _, row in scored]
    cutoff_score, cutoff_row = scored[limit - 1]
    cutoff_length = len(cutoff_row["name"])
    return [row for score, row in scored
            if score > cutoff_score or (score == cutoff_score and len(row["name"]) <= cutoff_length)]


def summarize_series_comparison(values: list[tuple[str, float]], focal_id: str,
                                focal_value: float | None, direction: str) -> dict:
    """Direction-aware rank/median for one metadata-declared axis point."""
    if direction not in ("high", "low"):
        raise ValueError("Series comparison requires declared high/low direction")
    members = {territory_id: value for territory_id, value in values if territory_id != focal_id}
    if focal_value is not None:
        members[focal_id] = focal_value
    ordered = list(members.values())
    if focal_value is None:
        rank = ties = None
    else:
        better = sum(value > focal_value if direction == "high" else value < focal_value
                     for value in ordered)
        rank = better + 1
        ties = sum(value == focal_value for value in ordered)
    return {"value": focal_value, "median": median(ordered) if ordered else None,
            "rank": rank, "ties": ties, "comparable_count": len(ordered)}


class ReadRepository:
    def __init__(self, connections: ConnectionPool):
        self.connections = connections

    def read(self, territory_id: str, comparison: str, *, connection=None) -> dict:
        return self._read("commune", territory_id, comparison, connection=connection)

    def read_series(self, territory_type: str, territory_id: str, indicator_id: str,
                    scope_level: str, department_id: str | None = None,
                    epci_id: str | None = None) -> dict:
        """Read a declared series from one repeatable-read publication snapshot."""
        with self.connections.connection() as connection:
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                marker = connection.execute(
                    """SELECT s.content_version,s.reference_content_version,t.content_version,
                              s.row_count
                       FROM table_publication s LEFT JOIN table_publication t
                         ON t.table_name='territory_reference' WHERE s.table_name='ordered_series'"""
                ).fetchone()
                if not marker or not marker[0] or not marker[1] or marker[1] != marker[2]:
                    raise HTTPException(503, "Series publication is unavailable")
                descriptor = connection.execute(
                    """SELECT axis_kind,axis_values,completeness,comparison_point,label,unit,direction,
                              source_id,vintage_id,descriptor_version
                       ,allowed_levels FROM series_descriptor WHERE indicator_id=%s""", (indicator_id,)
                ).fetchone()
                if not descriptor:
                    raise HTTPException(404, "Series descriptor is unavailable")
                target = connection.execute(
                    "SELECT name,department_id,epci_id FROM territory_reference WHERE territory_id=%s AND territory_type=%s",
                    (territory_id, territory_type),
                ).fetchone()
                if not target:
                    raise HTTPException(404, "Territory not found")
                if territory_type not in descriptor[10]:
                    raise HTTPException(422, "Series is not declared for this territory level")
                rows = connection.execute(
                    """SELECT s.axis_value,s.observation_period,s.value,s.status,s.source_id,s.vintage_id,
                              v.version,v.reference_date,v.publication_date
                       FROM ordered_series s JOIN source_vintage v USING(source_id,vintage_id)
                       WHERE s.indicator_id=%s AND s.territory_id=%s
                         AND s.territory_type=%s ORDER BY array_position(%s::text[],s.axis_value)""",
                    (indicator_id, territory_id, territory_type, list(descriptor[1])),
                ).fetchall()
                if scope_level not in descriptor[10]:
                    raise HTTPException(422, "Comparison scope level is not declared for this series")
                if scope_level != "commune" and (department_id or epci_id):
                    raise HTTPException(422, "Department/EPCI filters apply only to commune scope")
                if department_id and epci_id:
                    raise HTTPException(422, "Choose one existing commune scope filter")
                if department_id and (territory_type != "commune" or target[1] != department_id):
                    raise HTTPException(422, "Department filter does not contain the focal territory")
                if epci_id and (territory_type != "commune" or target[2] != epci_id):
                    raise HTTPException(422, "EPCI filter does not contain the focal territory")
                axis_limit = len(descriptor[1])
                territory_limit = min(5_000, max(1, 100_000 // axis_limit))
                scoped_ids = connection.execute(
                    """SELECT t.territory_id FROM territory_reference t
                       WHERE t.territory_type=%s
                         AND (%s::text IS NULL OR t.department_id=%s)
                         AND (%s::text IS NULL OR t.epci_id=%s)
                         AND EXISTS (SELECT 1 FROM ordered_series eligible
                           WHERE eligible.indicator_id=%s AND eligible.territory_id=t.territory_id)
                       ORDER BY t.territory_id LIMIT %s""",
                    (scope_level, department_id, department_id, epci_id, epci_id,
                     indicator_id, territory_limit + 1),
                ).fetchall()
                if len(scoped_ids) > territory_limit:
                    raise HTTPException(413, "Requested series scope exceeds the bounded comparison cohort")
                scope_rows = connection.execute(
                    """SELECT s.territory_id,t.name,s.axis_value,s.observation_period,s.value,s.status,
                              s.source_id,s.vintage_id,v.version,v.reference_date,v.publication_date
                       FROM ordered_series s JOIN territory_reference t USING(territory_id)
                       JOIN source_vintage v USING(source_id,vintage_id)
                       WHERE s.indicator_id=%s AND s.territory_id=ANY(%s::text[])
                       ORDER BY s.territory_id,array_position(%s::text[],s.axis_value)
                       LIMIT %s""",
                    (indicator_id, [row[0] for row in scoped_ids], list(descriptor[1]),
                     territory_limit * axis_limit + 1),
                ).fetchall()
                if len(scope_rows) > territory_limit * axis_limit:
                    raise HTTPException(413, "Requested series scope exceeds the bounded comparison cohort")
                by_axis = {row[0]: row for row in rows}
                if len(by_axis) != len(rows) or any(axis not in descriptor[1] for axis in by_axis):
                    raise HTTPException(503, "Invalid published series axis")
                if descriptor[2] == "dense_complete" and set(by_axis) != set(descriptor[1]):
                    raise HTTPException(503, "Incomplete published series")
                points = []
                for axis in descriptor[1]:
                    row = by_axis.get(axis)
                    points.append({"axis": axis, "status": row[3] if row else "missing",
                                   "value": row[2] if row else None,
                                   "observation_period": row[1] if row else None,
                                   "source_id": row[4] if row else descriptor[7],
                                   "vintage_id": row[5] if row else descriptor[8],
                                   "source_version": row[6] if row else None,
                                   "source_reference_date": row[7] if row else None,
                                   "source_publication_date": row[8] if row else None})
                focal_value = next((v for axis, _, v, status, *_ in rows if axis == descriptor[3] and status == "measured"), None)
                grouped_scope: dict[str, dict] = {}
                for peer_id, peer_name, axis, period, value, status, source, vintage, version, reference_date, publication_date in scope_rows:
                    group = grouped_scope.setdefault(peer_id, {"territory": {"id": peer_id, "type": scope_level, "name": peer_name}, "points": []})
                    group["points"].append({"axis": axis, "observation_period": period, "value": value,
                        "status": status, "source_id": source, "vintage_id": vintage,
                        "source_version": version, "source_reference_date": reference_date,
                        "source_publication_date": publication_date})
                if descriptor[2] == "dense_complete" and any(
                        {point["axis"] for point in group["points"]} != set(descriptor[1])
                        for group in grouped_scope.values()):
                    raise HTTPException(503, "Incomplete published comparison series")
                cohort_point_values = [(territory["territory"]["id"], next(
                    (point["value"] for point in territory["points"]
                     if point["axis"] == descriptor[3] and point["status"] == "measured"), None))
                    for territory in grouped_scope.values()]
                cohort_point_values = [(territory_id, value) for territory_id, value in cohort_point_values if value is not None]
                focal_in_scope = territory_id in grouped_scope
                comparison = {"point": descriptor[3],
                    **summarize_series_comparison(cohort_point_values, territory_id,
                        focal_value if focal_in_scope else None, descriptor[6]),
                    "scope": {"kind": "level", "territory_type": scope_level,
                        "department_id": department_id, "epci_id": epci_id}}
                return {"publication_id": marker[0], "territory":{"id":territory_id,"type":territory_type,"name":target[0]},
                         "indicator_id":indicator_id,"axis_kind":descriptor[0],"completeness":descriptor[2],
                         "label":descriptor[4],"unit":descriptor[5],"direction":descriptor[6],
                        "descriptor_version":descriptor[9],"comparison_point":descriptor[3],"points":points,
                        "availability": "complete" if all(point["status"] == "measured" for point in points) else "incomplete",
                         "comparison": comparison,
                          "scope_series": list(grouped_scope.values())}

    def read_owned_series(self, dataset_id: str, territory_type: str, territory_id: str,
                          indicator_id: str, scope_level: str, department_id: str | None,
                          epci_id: str | None, comparison_detail: str | None = None) -> dict:
        """Read an owned focal series and its declared peer cohort in one snapshot."""
        with self.connections.connection() as connection:
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                publication = connection.execute(
                    """SELECT content_version,reference_content_version,row_count,published_at
                       FROM series_dataset_publication WHERE dataset_id=%s""", (dataset_id,)
                ).fetchone()
                reference = connection.execute(
                    "SELECT content_version FROM table_publication WHERE table_name='territory_reference'"
                ).fetchone()
                if not publication or not reference or publication[1] != reference[0]:
                    raise HTTPException(503, "Owned series publication is unavailable")
                descriptor = connection.execute(
                    """SELECT axis_kind,axis_values,completeness,comparison_point,label,unit,direction,
                              allowed_levels,descriptor_version
                       FROM series_dataset_descriptor WHERE dataset_id=%s AND indicator_id=%s""",
                    (dataset_id, indicator_id),
                ).fetchone()
                if not descriptor:
                    raise HTTPException(404, "Owned series descriptor is unavailable")
                if territory_type not in descriptor[7]:
                    raise HTTPException(422, "Owned series is not declared for this territory level")
                if scope_level not in descriptor[7]:
                    raise HTTPException(422, "Owned series comparison scope is not declared")
                if scope_level != "commune" and (department_id or epci_id):
                    raise HTTPException(422, "Department/EPCI filters apply only to commune scope")
                if department_id and epci_id:
                    raise HTTPException(422, "Choose one existing commune scope filter")
                target = connection.execute(
                    "SELECT name,territory_type,department_id,epci_id FROM territory_reference WHERE territory_id=%s",
                    (territory_id,),
                ).fetchone()
                if not target:
                    raise HTTPException(404, "Territory not found")
                if target[1] != territory_type:
                    raise HTTPException(422, "Territory identity/type mismatch")
                if department_id and (territory_type != "commune" or target[2] != department_id):
                    raise HTTPException(422, "Department filter does not contain the focal territory")
                if epci_id and (territory_type != "commune" or target[3] != epci_id):
                    raise HTTPException(422, "EPCI filter does not contain the focal territory")
                if comparison_detail is not None and comparison_detail != descriptor[3]:
                    raise HTTPException(422, "Comparison detail must match the dataset descriptor comparison point")
                comparison_point = descriptor[3]
                axis_limit = len(descriptor[1])
                territory_limit = min(5_000, max(1, 100_000 // axis_limit))
                scoped_ids = connection.execute(
                    """SELECT t.territory_id FROM territory_reference t
                       WHERE t.territory_type=%s AND (%s::text IS NULL OR t.department_id=%s)
                         AND (%s::text IS NULL OR t.epci_id=%s)
                         AND EXISTS(SELECT 1 FROM series_dataset_observation e WHERE e.dataset_id=%s
                           AND e.indicator_id=%s AND e.territory_id=t.territory_id)
                       ORDER BY t.territory_id LIMIT %s""",
                    (scope_level,department_id,department_id,epci_id,epci_id,dataset_id,indicator_id,
                     territory_limit+1),
                ).fetchall()
                if len(scoped_ids)>territory_limit:
                    raise HTTPException(413,"Requested owned-series scope exceeds the bounded cohort")
                peer_ids=[row[0] for row in scoped_ids]
                read_ids=list(dict.fromkeys([*peer_ids,territory_id]))
                scope_rows = connection.execute(
                    """SELECT o.territory_id,t.name,t.territory_type,o.axis_value,o.state_role,o.observation_period,
                              o.value,o.status,
                              p.provenance_revision_id,p.source_id,p.vintage_id,p.source_name,p.dataset_name,
                              p.source_version,p.reference_date,p.publication_date,p.revision_hash
                       FROM series_dataset_observation o
                       JOIN territory_reference t USING(territory_id)
                       LEFT JOIN series_observation_provenance a USING(dataset_id,indicator_id,territory_id,axis_value)
                       LEFT JOIN series_provenance_revision p USING(provenance_revision_id)
                       WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_id=ANY(%s::text[])
                       ORDER BY o.territory_id,array_position(%s::text[],o.axis_value),p.provenance_revision_id
                       LIMIT %s""",
                    (dataset_id,indicator_id,read_ids,list(descriptor[1]),
                     territory_limit*axis_limit*8+1),
                ).fetchall()
                if len(scope_rows)>territory_limit*axis_limit*8:
                    raise HTTPException(413,"Owned-series provenance scope exceeds the bounded response")
                if not scope_rows:
                    raise HTTPException(404, "Owned series observations are unavailable")
                grouped: dict[str, dict] = {}
                for row in scope_rows:
                    peer_id,peer_name,peer_type,axis,role,period,value,status = row[:8]
                    group=grouped.setdefault(peer_id,{"territory":{"id":peer_id,"type":peer_type,"name":peer_name},"points":[]})
                    point=next((p for p in group["points"] if p["axis"]==axis),None)
                    if point is None:
                        point={"axis":axis,"state_role":role,"observation_period":period,"value":value,
                            "status":status,"provenance":[]}
                        group["points"].append(point)
                    if row[8] is None:
                        raise HTTPException(503, "Owned series provenance is incomplete")
                    point["provenance"].append({"revision_id":row[8],"source_id":row[9],
                        "vintage_id":row[10],"source_name":row[11],"dataset_name":row[12],
                        "version":row[13],"reference_date":row[14],"publication_date":row[15],
                        "revision_hash":row[16]})
                if any(point["axis"] not in descriptor[1] for group in grouped.values() for point in group["points"]):
                    raise HTTPException(503,"Owned series contains an undeclared axis")
                focal=grouped.get(territory_id)
                if focal is None:
                    raise HTTPException(404,"Focal territory has no owned observations")
                comparison = None
                if descriptor[3] is not None:
                    cohort = []
                    for peer_id in peer_ids:
                        peer = grouped.get(peer_id)
                        facet = next((p for p in peer["points"] if p["axis"] == comparison_point), None) if peer else None
                        if facet and facet["status"] == "measured":
                            cohort.append((peer_id, facet["value"]))
                    focal_facet = next((p for p in focal["points"] if p["axis"] == comparison_point), None)
                    focal_value = focal_facet["value"] if focal_facet and focal_facet["status"] == "measured" else None
                    summary = summarize_series_comparison(cohort, territory_id, focal_value, descriptor[6])
                    comparison = {"point": comparison_point, "direction": descriptor[6], **summary,
                        "scope":{"kind":"level","territory_type":scope_level,
                        "department_id":department_id,"epci_id":epci_id,
                        "rank_field":("rang_epci" if territory_type == "commune" and epci_id else
                            "rang_dep" if territory_type == "commune" and department_id else
                            "rang_reg" if territory_type != "region" else None)}}
                    for peer_id in peer_ids:
                        peer = grouped.get(peer_id)
                        facet = next((p for p in peer["points"] if p["axis"] == comparison_point), None) if peer else None
                        if facet:
                            peer_summary = summarize_series_comparison(cohort, peer_id,
                                facet["value"] if facet["status"] == "measured" else None, descriptor[6])
                            facet["comparison_rank"] = peer_summary["rank"]
                            facet["comparison_ties"] = peer_summary["ties"]
                            facet["comparison_count"] = peer_summary["comparable_count"]
                            facet["comparison_median"] = peer_summary["median"]
                return {"dataset_id":dataset_id,"publication_id":publication[0],
                    "reference_content_version":publication[1],"published_at":publication[3],
                    "territory":{"id":territory_id,"type":territory_type,"name":target[0]},
                    "indicator_id":indicator_id,"axis_kind":descriptor[0],"completeness":descriptor[2],
                    "label":descriptor[4],"unit":descriptor[5],"direction":descriptor[6],
                    "descriptor_version":descriptor[8],"comparison_point":descriptor[3],
                    "comparison":comparison,"comparison_point":comparison_point,
                    "points":focal["points"],"scope_series":[grouped[peer_id] for peer_id in peer_ids if peer_id in grouped],
                    "availability":"complete" if all(p["status"]=="measured" for p in focal["points"]) else "incomplete"}

    def read_level(self, territory_type: str, territory_id: str, *, connection=None) -> dict:
        return self._read(territory_type, territory_id, None, connection=connection)

    def read_selected(self, territory_type: str, territory_id: str, selected, *, connection=None) -> dict:
        return self._read(territory_type, territory_id, None, connection=connection, selected=selected)

    def read_building_catalog(self) -> dict:
        with self.connections.connection() as connection:
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                publication = _building_publication(connection.execute(
                    """SELECT table_name, content_version FROM table_publication
                       WHERE table_name IN ('territory_reference', 'building_ramp', 'building_grid')"""
                ).fetchall())
                rows = connection.execute(
                    """SELECT territory_type, territory_id, name FROM territory_reference
                       ORDER BY territory_type, name, territory_id"""
                ).fetchall()
                return {"publication_id": publication,
                          "territories": [dict(zip(("type", "id", "name"), row)) for row in rows]}

    def search_territories(self, query: str, limit: int) -> dict:
        with self.connections.connection() as connection:
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                marker = connection.execute(
                    "SELECT content_version FROM table_publication WHERE table_name = 'territory_reference'"
                ).fetchone()
                if not marker:
                    raise HTTPException(503, "No territory reference has been published")
                rows = connection.execute(
                    """SELECT territory_type, territory_id, name FROM territory_reference
                       ORDER BY CASE territory_type WHEN 'commune' THEN 0 WHEN 'epci' THEN 1
                                WHEN 'departement' THEN 2 WHEN 'region' THEN 3 ELSE 4 END,
                                territory_id LIMIT %s""", (MAX_TERRITORY_SEARCH_SCAN + 1,)
                ).fetchall()
                if len(rows) > MAX_TERRITORY_SEARCH_SCAN:
                    raise HTTPException(503, "Territory reference exceeds search scan bound")
                entries = [dict(zip(("type", "id", "name"), row)) for row in rows]
                exact_code = next((row for row in entries if row["id"] == query.strip()), None)
                return {"publication_id": "territory-v1-" + marker[0], "query": query,
                        "limit": limit, "candidate_limit": MAX_TERRITORY_SEARCH_SCAN,
                        "exact_code": exact_code,
                        "candidates": search_territory_rows(entries, query, limit)}

    def read_building_initial(self, territory_type: str, territory_id: str,
                              comparison_mode: str | None = None, *, connection=None,
                              selected=None) -> dict:
        """Read canonical focal facts and same-level published default peers."""
        owns_connection = connection is None
        connection_context = self.connections.connection() if owns_connection else nullcontext(connection)
        with connection_context as connection:
            with (connection.transaction() if owns_connection else nullcontext()):
                if owns_connection:
                    connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                publication = _building_publication(connection.execute(
                    """SELECT table_name, content_version FROM table_publication
                       WHERE table_name IN ('territory_reference', 'building_ramp', 'building_grid')"""
                ).fetchall())
                target = connection.execute(
                    """SELECT territory_id, territory_type, name, department_id, epci_id,
                              density_class_code, density_class_label
                       FROM territory_reference WHERE territory_id = %s AND territory_type = %s""",
                    (territory_id, territory_type),
                ).fetchone()
                if not target:
                    raise HTTPException(404, "Territory not found")
                tid, ttype, name, department, epci, density, density_label = target
                if ttype == "commune" and comparison_mode == "epci":
                    if not epci:
                        raise HTTPException(422, "EPCI comparison unavailable for this commune")
                    parent = connection.execute(
                        "SELECT name FROM territory_reference WHERE territory_id = %s AND territory_type = 'epci'",
                        (epci,),
                    ).fetchone()
                    if not parent:
                        raise HTTPException(503, "Published EPCI reference is incomplete")
                    kind = "communes-epci"
                elif ttype == "commune" and comparison_mode == "densite":
                    if not density or not density_label:
                        raise HTTPException(422, "Density comparison unavailable for this commune")
                    kind = "communes-densite"
                else:
                    kind = f"{ {'commune': 'communes', 'epci': 'epcis', 'departement': 'departements', 'region': 'regions'}[ttype] }-bretagne"
                reference_rows = connection.execute(
                    """SELECT territory_id, territory_type, department_id, epci_id,
                              density_class_code FROM territory_reference"""
                ).fetchall()
                reference = [dict(zip(("id", "type", "departement", "epci", "densite"), row))
                             for row in reference_rows]
                members = None
                peer_type = ttype
                if selected is not None:
                    try:
                        peer_type, members, _ = _comparison_cohort(connection, ttype, tid, selected)
                    except HTTPException:
                        raise
                    except ComparisonInputError as exc:
                        raise HTTPException(422, str(exc)) from exc
                    kind = "explicit_selection"
                elif ttype == "region":
                    kind = "regions"
                elif ttype == "commune":
                    if comparison_mode == "densite":
                        members = tuple(sorted(r[0] for r in reference_rows
                                               if r[1] == "commune" and r[4] == density))
                    elif comparison_mode == "epci":
                        members = tuple(sorted(r[0] for r in reference_rows
                                               if r[1] == "commune" and r[3] == epci))
                    else:
                        members = tuple(sorted(r[0] for r in reference_rows if r[1] == "commune"))
                else:
                    members = tuple(sorted(r[0] for r in reference_rows if r[1] == ttype))
                    kind = "epcis-bretagne" if ttype == "epci" else "departements-bretagne"
                focal_and_peers = set(members or ()) | {tid}
                if selected is None:
                    ramp_sql = """SELECT territory_id, territory_type, availability, mode, quantile_index,
                               quantile, accessible_types, total_buildings, source_id, source_version
                        FROM building_ramp WHERE territory_type = %s AND territory_id = ANY(%s)"""
                    ramp_params = (ttype, list(focal_and_peers))
                    grid_sql = """SELECT territory_id, territory_type, availability, mode, breadth_bucket,
                               depth_bucket, building_count, total_buildings, source_id, source_version,
                               building_count::double precision / NULLIF(total_buildings,0) AS share
                        FROM building_grid WHERE territory_type = %s AND territory_id = ANY(%s)"""
                    grid_params = ramp_params
                else:
                    ramp_sql = """SELECT territory_id, territory_type, availability, mode, quantile_index,
                               quantile, accessible_types, total_buildings, source_id, source_version
                        FROM building_ramp WHERE (territory_type='commune' AND territory_id=ANY(%s))
                          OR (territory_type=%s AND territory_id=%s)"""
                    ramp_params = (list(members or ()), ttype, tid)
                    grid_sql = """SELECT territory_id, territory_type, availability, mode, breadth_bucket,
                               depth_bucket, building_count, total_buildings, source_id, source_version,
                               building_count::double precision / NULLIF(total_buildings,0) AS share
                        FROM building_grid WHERE (territory_type='commune' AND territory_id=ANY(%s))
                          OR (territory_type=%s AND territory_id=%s)"""
                    grid_params = ramp_params
                ramp_rows = connection.execute(ramp_sql, ramp_params).fetchall()
                grid_rows = connection.execute(grid_sql, grid_params).fetchall()
                ramp_data = [dict(zip(("territoire", "type", "availability", "mode", "quantile_index",
                                      "quantile", "accessible_types", "total_buildings", "source_id", "version"), row))
                             for row in ramp_rows]
                grid_data = [dict(zip(("territoire", "type", "availability", "mode", "breadth_bucket",
                                      "depth_bucket", "building_count", "total_buildings", "source_id", "version", "share"), row))
                             for row in grid_rows]
                # Selected reads also fetch focal facts, potentially at a different
                # level. Aggregation helpers accept only declared peer rows.
                peer_ramp_data = ([row for row in ramp_data
                                   if row["type"] == peer_type and row["territoire"] in members]
                                  if selected is not None else ramp_data)
                peer_grid_data = ([row for row in grid_data
                                   if row["type"] == peer_type and row["territoire"] in members]
                                  if selected is not None else grid_data)
                try:
                    peer_ramp = (weighted_peer_ramp(peer_ramp_data, members, max_members=len(reference),
                                                    member_type=peer_type) if members else None)
                    peer_distribution = (pooled_peer_distribution(peer_grid_data, members,
                                                                  max_members=len(reference),
                                                                  member_type=peer_type) if members else None)
                except ComparisonInputError as exc:
                    raise HTTPException(503, "Incomplete building-access publication") from exc
                target_ramp = [r for r in ramp_data if r["territoire"] == tid and r["type"] == ttype]
                target_grid = [r for r in grid_data if r["territoire"] == tid and r["type"] == ttype]
                source_rows = connection.execute("""SELECT DISTINCT r.source_id,s.name,v.version,
                    v.reference_date,v.publication_date
                    FROM building_ramp r JOIN source_dataset s USING(source_id)
                    JOIN source_vintage v ON v.source_id=r.source_id AND v.vintage_id=r.source_version
                    WHERE r.territory_id=%s AND r.territory_type=%s ORDER BY r.source_id,v.version""",
                    (tid, ttype)).fetchall()
                if not source_rows:
                    raise HTTPException(503, "Building-access source provenance is unavailable")
                presentation = {table: contract.get("presentation") for table, contract in connection.execute(
                    "SELECT table_name,contract FROM building_evidence_descriptor WHERE table_name IN ('building_ramp','building_grid')"
                ).fetchall()}
                if ({r["availability"] for r in target_ramp} == {"absent"} and
                    {r["availability"] for r in target_grid} == {"absent"} and
                    len(target_ramp) == 3 and {r["mode"] for r in target_ramp} == {"c", "b", "t"} and
                    len(target_grid) == 1):
                    availability = "absent"
                    focal_ramp, focal_grid = [], []
                elif ({r["availability"] for r in target_ramp} == {"complete"} and
                      {r["availability"] for r in target_grid} == {"complete"} and
                      len(target_ramp) == 33 and len(target_grid) == 30):
                    availability = "complete"
                    focal_ramp, focal_grid = target_ramp, target_grid
                else:
                    raise HTTPException(503, "Incomplete published building figure")
                focal_ramp.sort(key=lambda r: (r["mode"], r["quantile"]))
                focal_grid.sort(key=lambda r: (r["breadth_bucket"], r["depth_bucket"]))
                return {
                    "publication_id": publication,
                    "territory": {"id": tid, "type": ttype, "name": name},
                    "availability": availability,
                    "presentation": presentation,
                    "scope": None if ttype == "region" and selected is None else {
                        "kind": kind,
                        "comparison_mode": "selected" if selected is not None else
                            comparison_mode if ttype == "commune" else "bretagne",
                        **({"member_count": len(members)} if selected is not None else {})},
                    "sources": [{"source_id": row[0], "name": row[1], "version": row[2],
                        "reference_date": row[3].isoformat() if row[3] else None,
                        "publication_date": row[4].isoformat() if row[4] else None}
                        for row in source_rows],
                    "ramp": None if availability == "absent" else [{"mode": r["mode"], "quantile_index": r["quantile_index"],
                              **{k: r[k] for k in ("quantile", "accessible_types", "total_buildings", "source_id")},
                              "source_version": r["version"]} for r in focal_ramp],
                    "peer_ramp": peer_ramp,
                    "distribution": None if availability == "absent" else [{**{k: r[k] for k in ("breadth_bucket", "depth_bucket", "building_count", "total_buildings", "source_id", "share")},
                                      "source_version": r["version"]} for r in focal_grid],
                    "peer_distribution": peer_distribution,
                }

    def read_building(self, territory_type: str, territory_id: str,
                      selected: tuple[tuple[str, str], ...], *, connection=None) -> dict:
        # The reference, publication marker and selected rows share one MVCC view.
        owns_connection = connection is None
        connection_context = self.connections.connection() if owns_connection else nullcontext(connection)
        with connection_context as connection:
            with (connection.transaction() if owns_connection else nullcontext()):
                if owns_connection:
                    connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                publication = _building_publication(connection.execute(
                    """SELECT table_name, content_version FROM table_publication
                       WHERE table_name IN ('territory_reference', 'building_ramp', 'building_grid')"""
                ).fetchall())
                territory = connection.execute(
                    """SELECT territory_id, territory_type, name FROM territory_reference
                       WHERE territory_id = %s AND territory_type = %s""",
                    (territory_id, territory_type),
                ).fetchone()
                if not territory:
                    raise HTTPException(404, "Territory not found")
                reference = [dict(zip(("territoire", "type", "departement", "epci"), row))
                             for row in connection.execute(
                                 """SELECT territory_id, territory_type, department_id, epci_id
                                    FROM territory_reference""").fetchall()]
                try:
                    members = resolve_commune_members(reference, selected,
                                                      max_members=len(reference))
                except ComparisonInputError as exc:
                    raise HTTPException(422, str(exc)) from exc
                ramp_rows = connection.execute(
                    """SELECT territory_id, territory_type, availability, mode,
                              quantile, accessible_types, total_buildings,
                              source_id, source_version, effective_direction
                       FROM building_ramp WHERE territory_type = 'commune' AND territory_id = ANY(%s)""",
                    (list(members),),
                ).fetchall()
                grid_rows = connection.execute(
                    """SELECT territory_id, territory_type, availability, mode,
                              breadth_bucket, depth_bucket, building_count,
                              total_buildings, source_id, source_version
                       FROM building_grid WHERE territory_type = 'commune' AND territory_id = ANY(%s)""",
                    (list(members),),
                ).fetchall()
                directions = {row[9] for row in ramp_rows}
                if len(directions) != 1 or next(iter(directions)) not in ("high", "low"):
                    raise HTTPException(503, "Inconsistent published ramp direction")
                return {
                    "publication_id": publication,
                    "territory": dict(zip(("id", "type", "name"), territory)),
                    "reference": reference,
                    "ramp_rows": [dict(zip(("territoire", "type", "availability", "mode",
                                             "quantile", "accessible_types", "total_buildings",
                                             "source_id", "version"), row))
                                  for row in (point[:9] for point in ramp_rows)],
                    "grid_rows": [dict(zip(("territoire", "type", "availability", "mode",
                                             "breadth_bucket", "depth_bucket", "building_count",
                                             "total_buildings", "source_id", "version"), row))
                                  for row in grid_rows],
                    "direction": next(iter(directions)),
                }

    def _read(self, territory_type: str, territory_id: str, comparison: str | None,
              *, connection=None, selected=None) -> dict:
        # A caller may compose this projection into an existing read-only
        # repeatable-read transaction (the Mobility theme snapshot does so).
        # Standalone route callers retain ownership of connection/transaction.
        owns_connection = connection is None
        connection_context = self.connections.connection() if owns_connection else nullcontext(connection)
        with connection_context as connection:
            with (connection.transaction() if owns_connection else nullcontext()):
                if owns_connection:
                    connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                active = connection.execute(
                    """SELECT p.content_version, m.bretagne_kind, m.bretagne_label
                       FROM table_publication p CROSS JOIN access_publication_metadata m
                       WHERE p.table_name = 'essential_service_access' AND m.singleton"""
                ).fetchone()
                if not active:
                    raise HTTPException(503, "No access dataset has been published")
                publication = active[0]
                target = connection.execute(
                    """SELECT territory_id, name, territory_type, epci_id,
                               density_class_code, density_class_label
                       FROM territory_reference
                         WHERE territory_id = %s AND territory_type = %s""",
                    (territory_id, territory_type),
                ).fetchone()
                if target is None:
                    raise HTTPException(404, f"{territory_type.title()} not found")
                code, name, _, epci, density, density_label = target
                selected_ids = None
                if selected is not None:
                    _, selected_ids, _ = _comparison_cohort(connection, territory_type, code, selected)
                    condition, value = "territory_id", code
                    kind, label = "explicit_selection", None
                elif territory_type == "epci":
                    condition, value = "territory_type", "epci"
                    kind, label = "epcis-bretagne", None
                elif territory_type == "departement":
                    condition, value = "territory_type", "departement"
                    kind, label = "departements-bretagne", None
                elif territory_type == "region":
                    condition, value = "territory_id", code
                    kind, label = None, None
                elif comparison == "densite":
                    if not density or not density_label:
                        raise HTTPException(422, "Density comparison unavailable for this commune")
                    condition, value = "density_class_code", density
                    kind, label = "communes-densite", density_label
                elif comparison == "epci":
                    if not epci:
                        raise HTTPException(422, "EPCI comparison unavailable for this commune")
                    parent = connection.execute(
                        """SELECT name FROM territory_reference
                           WHERE territory_id = %s AND territory_type = 'epci'""",
                        (epci,),
                    ).fetchone()
                    if not parent:
                        raise HTTPException(503, "Published EPCI reference is incomplete")
                    condition, value = "epci_id", epci
                    kind, label = "communes-epci", f"communes de {parent[0]}"
                else:
                    condition, value = "territory_type", "commune"
                    kind, label = active[1:]
                # Reversible server-side cutover: remain on the frozen table by
                # default; when enabled, missing/stale scalar publication fails
                # closed (never falls back to the legacy table or static JSON).
                if os.environ.get("LUSK_SERVICES_SCALAR_READ") == "1":
                    markers = connection.execute(
                        """SELECT scalar.content_version, scalar.reference_content_version,
                                  territory.content_version
                           FROM table_publication scalar LEFT JOIN table_publication territory
                             ON territory.table_name='territory_reference'
                           WHERE scalar.table_name='scalar_observation'"""
                    ).fetchone()
                    if (not markers or not markers[0] or not markers[1] or
                            markers[1] != markers[2]):
                        raise HTTPException(503, "Scalar service publication is unavailable or stale")
                    scalar_sql = f"""SELECT o.indicator_id, o.territory_id, o.value, o.status,
                                  d.label, d.direction, sd.source_id, sd.name,
                                  sv.version, sv.reference_date, sv.publication_date
                           FROM scalar_observation o
                           JOIN scalar_descriptor d USING(indicator_id)
                           JOIN territory_reference t ON t.territory_id=o.territory_id
                             AND t.territory_type=o.territory_type
                            JOIN scalar_observation_source os
                              ON os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id
                            JOIN source_dataset sd ON sd.source_id=os.source_id
                            JOIN source_vintage sv ON sv.source_id=os.source_id
                              AND sv.vintage_id=os.vintage_id
                     WHERE o.indicator_id = ANY (
                              SELECT 'share_' || service || '_' || mode
                              FROM service_registry
                              CROSS JOIN unnest(ARRAY['t','b','c']::text[]) AS mode
                            )
                               AND {{scope_clause}}
                             AND o.territory_type = ANY(d.allowed_levels)
                            ORDER BY o.indicator_id, o.territory_id, sd.source_id, sv.vintage_id"""
                    if selected is None:
                        scalar_sql = scalar_sql.format(scope_clause=f"o.territory_type = %s AND t.{condition} = %s")
                        scalar_params = (territory_type, value)
                    else:
                        scalar_sql = scalar_sql.format(scope_clause="((o.territory_type='commune' AND o.territory_id=ANY(%s::text[])) OR (o.territory_type=%s AND o.territory_id=%s))")
                        scalar_params = (list(selected_ids or ()), territory_type, code)
                    scalar_rows = connection.execute(scalar_sql, scalar_params).fetchall()
                    converted = []
                    for row in scalar_rows:
                        indicator = row[0]
                        parts = indicator.split("_")
                        if len(parts) != 3 or parts[0] != "share" or parts[2] not in ("t", "b", "c"):
                            raise HTTPException(503, "Malformed service scalar descriptor")
                        mode = {"t": "walk_transit", "b": "bike", "c": "car"}[parts[2]]
                        converted.append({"territory_id": row[1], "service": parts[1], "mode": mode,
                            "share": row[2] if row[3] == "measured" else None,
                            "indicator_label": row[4], "direction": row[5], "source_id": row[6],
                            "source_name": row[7], "source_version": row[8],
                            "reference_date": row[9], "source_publication_date": row[10]})
                    if not converted or len({r[0] for r in scalar_rows}) != 15:
                        raise HTTPException(503, "Incomplete scalar service publication")
                    publication = "scalar-service-v1-" + hashlib.sha256(
                        (markers[0] + ":" + markers[2]).encode("utf-8")).hexdigest()
                    return {"publication_id": publication,
                        "territory": {"id": code, "name": name, "type": territory_type},
                        "scope": {"kind": kind, **({"label": label} if label is not None else {})} if kind else None,
                        "comparison": (bool(selected_ids) if selected is not None else territory_type != "region"),
                        **({"peer_member_ids": list(selected_ids)} if selected is not None else {}),
                        "rows": converted}
                # `condition` is selected exclusively from the three literals above; all
                # externally supplied values are parameters, never SQL identifiers.
                if selected is None:
                    rows = connection.execute(
                        f"""SELECT a.territory_id, a.service, a.mode, a.share, a.indicator_label,
                                   a.effective_direction, a.source_id, a.source_name, a.source_version,
                                   a.reference_date, a.source_publication_date
                            FROM essential_service_access a JOIN territory_reference t ON t.territory_id=a.territory_id
                            WHERE t.territory_type = %s AND t.{condition} = %s""",
                        (territory_type, value),
                    ).fetchall()
                else:
                    rows = connection.execute(
                        """SELECT a.territory_id, a.service, a.mode, a.share, a.indicator_label,
                                   a.effective_direction, a.source_id, a.source_name, a.source_version,
                                   a.reference_date, a.source_publication_date
                            FROM essential_service_access a JOIN territory_reference t ON t.territory_id=a.territory_id
                            WHERE (t.territory_type='commune' AND a.territory_id=ANY(%s))
                               OR (t.territory_type=%s AND a.territory_id=%s)""",
                        (list(selected_ids or ()), territory_type, code),
                    ).fetchall()
                return {
                    "publication_id": publication,
                    "territory": {"id": code, "name": name, "type": territory_type},
                    "scope": {"kind": kind, **({"label": label} if label is not None else {})} if kind else None,
                    "comparison": (bool(selected_ids) if selected is not None else territory_type != "region"),
                    **({"peer_member_ids": list(selected_ids)} if selected is not None else {}),
                    "rows": [dict(zip(("territory_id", "service", "mode", "share",
                                     "indicator_label", "direction", "source_id", "source_name",
                                     "source_version", "reference_date", "source_publication_date"), row)) for row in rows],
                }


def get_repository() -> ReadRepository:
    return ReadRepository(pool())


@app.get("/api/building-access/territories")
def building_access_territories(repository: ReadRepository = Depends(get_repository)) -> dict:
    return repository.read_building_catalog()


@app.get("/api/territories/search")
def search_territories(
    q: str = Query(min_length=1, max_length=64),
    limit: int = Query(default=8, ge=1, le=50),
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Bounded search over the R-published territory reference."""
    if not q.strip():
        raise HTTPException(422, "Query must contain a non-whitespace character")
    return repository.search_territories(q, limit)


@app.get("/api/territories/{territory_type}/{territory_id}/building-access")
def initial_building_access(
    territory_type: Literal["commune", "epci", "departement", "region"],
    territory_id: str,
    comparison: Literal["bretagne", "densite", "epci"] = Query(default="densite"),
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Initial view; non-commune comparisons use same-level peer territories."""
    return repository.read_building_initial(territory_type, territory_id, comparison)


@app.post("/api/territories/{territory_type}/{territory_id}/building-access-comparison")
def custom_building_comparison(
    territory_type: Literal["commune", "epci", "departement", "region"],
    territory_id: str,
    selection: BuildingSelection,
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    selected = tuple((item.type, item.id) for item in selection.selected)
    data = repository.read_building(territory_type, territory_id, selected)
    try:
        members = resolve_commune_members(data["reference"], selected,
                                          max_members=len(data["reference"]))
    except ComparisonInputError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        ramp = weighted_peer_ramp(data["ramp_rows"], members, max_members=max(2, len(members)))
        distribution = pooled_peer_distribution(data["grid_rows"], members,
                                                max_members=max(2, len(members)))
    except ComparisonInputError as exc:
        raise HTTPException(503, "Incomplete building-access publication") from exc
    return {"publication_id": data["publication_id"], "territory": data["territory"],
            "scope": {"kind": "custom", "direction": data["direction"],
                      "level": "commune", "members": members},
            "ramp": ramp, "distribution": distribution}


def compare(data: dict) -> ComparisonResponse:
    target = data["territory"]["id"]
    members = {row["territory_id"] for row in data["rows"]}
    peer_member_ids = data.get("peer_member_ids")
    peer_ids = set(peer_member_ids) if peer_member_ids is not None else members
    has_comparison = data.get("comparison", True)
    if target not in members:
        raise HTTPException(503, "Published comparison does not include its target")
    grouped: dict[str, dict[str, dict[str, dict]]] = {}
    for row in data["rows"]:
        by_member = grouped.setdefault(row["service"], {}).setdefault(row["mode"], {})
        if row["territory_id"] in by_member:
            raise HTTPException(503, "Duplicate published access observation")
        by_member[row["territory_id"]] = row
    services = []
    for service, modes in sorted(grouped.items()):
        response_modes = {}
        for mode, observations in sorted(modes.items()):
            focal = observations.get(target)
            if focal is None:
                raise HTTPException(503, "Incomplete published target")
            if peer_member_ids is not None and not peer_ids.issubset(observations):
                raise HTTPException(503, "Incomplete published selected comparison")
            direction = focal["direction"]
            if direction not in ("high", "low") or any(
                row["direction"] != direction for row in observations.values()
            ):
                raise HTTPException(503, "Inconsistent published comparison direction")
            values = [row["share"] for member_id, row in observations.items()
                      if member_id in peer_ids and row["share"] is not None]
            value = focal["share"]
            rank = None if value is None or target not in peer_ids or not has_comparison else Rank(
                position=1 + sum(v > value if direction == "high" else v < value for v in values),
                size=len(values),
            )
            response_modes[mode] = ModeComparison(
                value=value, median=median(values) if values and has_comparison else None, rank=rank,
                direction=direction, indicator_label=focal["indicator_label"],
                source_id=focal["source_id"], source_name=focal["source_name"],
                source_version=focal["source_version"],
                reference_date=str(focal["reference_date"]) if focal["reference_date"] else None,
                source_publication_date=(str(focal["source_publication_date"])
                                         if focal["source_publication_date"] else None),
            )

        def median_difference(first: str, second: str) -> float | None:
            if first not in modes or second not in modes:
                return None
            differences = [modes[first][tid]["share"] - modes[second][tid]["share"]
                            for tid in modes[first].keys() & modes[second].keys() & peer_ids
                           if modes[first][tid]["share"] is not None
                           and modes[second][tid]["share"] is not None]
            return round(median(differences), 12) if differences else None

        services.append(ServiceComparison(
            id=service, modes=response_modes,
            peer_median_car_gap=median_difference("car", "walk_transit") if has_comparison else None,
            peer_median_bike_gain=median_difference("bike", "walk_transit") if has_comparison else None,
        ))
    return ComparisonResponse(
        publication_id=data["publication_id"], territory=data["territory"],
        scope={**data["scope"], "member_count": len(peer_ids)} if data["scope"] else None,
        services=services,
    )


def _comparison_cohort(conn, territory_type, territory_id, selection):
    target = conn.execute(
        "SELECT territory_id,territory_type,density_class_code FROM territory_reference WHERE territory_id=%s",
        (territory_id,),
    ).fetchone()
    if not target:
        raise HTTPException(404, "Focal territory not found")
    if target[1] != territory_type:
        raise HTTPException(422, "Focal territory type does not match route")
    refs = [dict(zip(("territoire", "type", "departement", "epci", "densite"), row))
            for row in conn.execute(
                "SELECT territory_id,territory_type,department_id,epci_id,density_class_code FROM territory_reference"
            ).fetchall()]
    if selection is None:
        if territory_type == "commune":
            density = target[2]
            if not density:
                raise HTTPException(503, "Published default density class is unavailable")
            members = tuple(sorted(r["territoire"] for r in refs
                                   if r["type"] == "commune" and r["densite"] == density))
            return "commune", members, {"kind": "density_class", "density_class_code": density,
                                         "territory_type": "commune"}
        if territory_type in ("epci", "departement"):
            members = tuple(sorted(r["territoire"] for r in refs if r["type"] == territory_type))
            return territory_type, members, {"kind": "same_level", "territory_type": territory_type}
        return territory_type, (), None
    if not selection:
        return "commune", (), {"kind": "explicit_selection"}
    try:
        members = resolve_commune_members(refs, selection, max_members=len(refs))
    except ComparisonInputError as exc:
        raise HTTPException(422, str(exc)) from exc
    return "commune", members, {"kind": "explicit_selection"}


def _profile_comparison_results(conn, profiles, members, cohort_type, territory_id):
    """Compare only declared profile facets, using one batch query per facet grain."""
    external = [p for p in profiles if p.get("comparison_scalar")]
    details = [p for p in profiles if not p.get("comparison_scalar")]
    read_ids = list(dict.fromkeys([*members, territory_id]))
    scalar_rows = []
    if external:
        scalar_rows = conn.execute(
            """SELECT p.indicator_id,s.label,s.unit,s.direction,s.comparison_facet,s.allowed_levels,
                      s.descriptor_version,o.territory_id,o.value,o.status,
                      COALESCE((SELECT json_agg(json_build_object('source_id',os.source_id,
                        'vintage_id',os.vintage_id,'name',sd.name,'version',sv.version,
                        'reference_date',sv.reference_date,'publication_date',sv.publication_date)
                        ORDER BY os.source_id,os.vintage_id)
                        FROM scalar_observation_source os JOIN source_dataset sd USING(source_id)
                        JOIN source_vintage sv USING(source_id,vintage_id)
                        WHERE os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id),'[]'::json)
               FROM profile_descriptor p
               JOIN scalar_descriptor s ON s.indicator_id=p.comparison_scalar
               LEFT JOIN scalar_observation o ON o.indicator_id=s.indicator_id
                    AND o.territory_type=%s AND o.territory_id=ANY(%s)
               WHERE p.indicator_id=ANY(%s) ORDER BY p.indicator_id,o.territory_id""",
            (cohort_type, read_ids, [p["indicator"] for p in external]),
        ).fetchall()
    detail_rows = []
    detail_contracts = {}
    if details:
        detail_contracts = {row[0]: row for row in conn.execute(
            """SELECT d.indicator_id,d.comparison_detail,d.comparison_sex,d.unit,
                      d.denominator_semantics,d.descriptor_version,d.detail_units_required,a.unit
               FROM profile_descriptor d LEFT JOIN profile_axis a
                 ON a.indicator_id=d.indicator_id AND a.axis_name='detail'
                  AND a.axis_key=d.comparison_detail
               WHERE d.indicator_id=ANY(%s)""",
            ([p["indicator"] for p in details],),
        ).fetchall()}
        detail_rows = conn.execute(
            """SELECT d.indicator_id,o.territory_id,o.value,o.status,
                      COALESCE((SELECT json_agg(json_build_object('source_id',os.source_id,
                        'vintage_id',os.vintage_id,'name',sd.name,'version',sv.version,
                        'reference_date',sv.reference_date,'publication_date',sv.publication_date)
                        ORDER BY os.source_id,os.vintage_id)
                        FROM profile_observation_source os JOIN source_dataset sd USING(source_id)
                        JOIN source_vintage sv USING(source_id,vintage_id)
                        WHERE os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id
                          AND os.detail_key=o.detail_key AND os.sex_key=o.sex_key),'[]'::json)
               FROM profile_descriptor d JOIN profile_observation o
                 ON o.indicator_id=d.indicator_id AND o.detail_key=d.comparison_detail
                  AND o.sex_key=COALESCE(d.comparison_sex,'')
               WHERE d.indicator_id=ANY(%s) AND o.territory_type=%s AND o.territory_id=ANY(%s)
               ORDER BY d.indicator_id,o.territory_id""",
            ([p["indicator"] for p in details], cohort_type, read_ids),
        ).fetchall()
    scalar_by_profile, detail_by_profile = {}, {}
    for row in scalar_rows:
        scalar_by_profile.setdefault(row[0], []).append(row)
    for row in detail_rows:
        detail_by_profile.setdefault(row[0], []).append(row)

    def summary(profile, facet, unit, direction, rows):
        indicator = profile["indicator"]
        values = [(row[0], float(row[1])) for row in rows
                  if row[0] in members and row[2] == "measured" and row[1] is not None]
        focal_row = next((row for row in rows if row[0] == territory_id), None)
        focal_value = (float(focal_row[1]) if focal_row and focal_row[2] == "measured"
                       and focal_row[1] is not None else None)
        better = sum(v > focal_value if direction == "high" else v < focal_value for _, v in values) if focal_value is not None else None
        ties = sum(v == focal_value for _, v in values) if focal_value is not None else None
        enough = len(values) >= 2
        sources, seen = [], set()
        for row in rows:
            if row[0] not in members:
                continue
            for source in row[3] or []:
                key = (source["source_id"], source["vintage_id"])
                if key not in seen:
                    seen.add(key)
                    sources.append(source)
        return {"indicator": indicator, "facet": facet, "label": profile["label"],
            "unit": unit, "direction": direction, "statistic": "median",
            "profile_descriptor_version": profile.get("descriptor_version"),
            "scalar_descriptor_version": profile.get("scalar_descriptor_version"),
            "required_scalar_version": profile.get("required_scalar_version"),
            "source_facet_label": profile.get("source_facet_label"),
            "denominator_semantics": profile.get("denominator_semantics"),
            "status": "available" if enough else "unavailable",
            "reason": None if enough else "fewer_than_two_comparable_values",
            "selected_member_count": len(members), "eligible_count": len(values),
            "focal_value": focal_value, "focal_in_selection": territory_id in members,
            "median": median([v for _, v in values]) if enough else None,
            "rank": better + 1 if enough and territory_id in members and focal_value is not None else None,
            "rank_size": len(values) if enough and territory_id in members and focal_value is not None else None,
            "rank_ties": ties if enough and territory_id in members and focal_value is not None else None,
            "comparison_sources": sources}

    output = []
    for profile in external:
        rows = scalar_by_profile.get(profile["indicator"], [])
        if not rows:
            raise HTTPException(503, "Profile scalar comparison facet is unavailable")
        descriptor = rows[0]
        if descriptor[4] != profile["comparison_scalar"] or descriptor[3] not in ("high", "low"):
            raise HTTPException(503, "Profile scalar comparison facet is invalid")
        if cohort_type not in descriptor[5]:
            output.append({"indicator": profile["indicator"], "facet": profile["comparison_scalar"],
                           "status": "unavailable", "reason": "facet_not_eligible_for_cohort"})
            continue
        normalized = [(r[7], r[8], r[9], r[10]) for r in rows if r[7] is not None]
        profile_metadata = {**profile, "source_facet_label": descriptor[1],
                            "scalar_descriptor_version": descriptor[6]}
        output.append(summary(profile_metadata, profile["comparison_scalar"], descriptor[2], descriptor[3], normalized))
    for profile in details:
        point = profile.get("comparison_point")
        if not point or point.get("direction") not in ("high", "low"):
            raise HTTPException(503, "Profile detail comparison point is invalid")
        detail, sex = point["detail"], point.get("sex")
        contract = detail_contracts.get(profile["indicator"])
        if not contract or contract[1] != detail or contract[2] != sex:
            raise HTTPException(503, "Profile comparison point does not match its published descriptor")
        if contract[6]:
            if not contract[7] or not str(contract[7]).strip():
                raise HTTPException(503, "Profile comparison unit is unavailable")
            unit = contract[7]
        else:
            if not contract[3] or (contract[7] is not None and contract[7] != contract[3]):
                raise HTTPException(503, "Legacy profile comparison unit is incompatible")
            unit = contract[7] if contract[7] is not None else contract[3]
        cell = next((c for c in profile["cells"] if c["detail"] == detail and c.get("sex") == sex), None)
        if cell is None:
            raise HTTPException(503, "Profile comparison cell is unavailable")
        normalized = [(r[1], r[2], r[3], r[4]) for r in detail_by_profile.get(profile["indicator"], [])]
        output.append(summary(profile, {"detail": detail, "sex": sex}, unit,
                              point["direction"], normalized))
    return output


def _theme_comparison_snapshot(conn, territory_type, territory_id, theme_id, selection,
                               *, indicator_id=None, profiles=None, profile_version=None, has_readings=False):
    """Read scalar and profile comparisons from the caller's MVCC snapshot."""
    scalar_descriptors = conn.execute(
        """SELECT indicator_id,label,unit,direction,comparison_facet,allowed_levels,descriptor_version
           FROM scalar_descriptor WHERE theme_id=%s AND (%s::text IS NULL OR indicator_id=%s)
           ORDER BY indicator_id""", (theme_id, indicator_id, indicator_id)
    ).fetchall()
    if profiles is None:
        profiles, profile_version = focal_profiles(conn, territory_type, territory_id,
            theme_id=theme_id, indicator_id=indicator_id)
    bpe_available = (theme_id == "mobilite" and
        conn.execute("SELECT to_regclass('bpe_profile_evidence_descriptor')").fetchone()[0] and
        conn.execute("SELECT 1 FROM bpe_profile_evidence_descriptor WHERE singleton AND indicator_id='bpe_access_profile'").fetchone())
    owned_descriptors=[]
    if conn.execute("SELECT to_regclass('series_dataset_descriptor')").fetchone()[0]:
        has_theme=conn.execute("""SELECT EXISTS(SELECT 1 FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name='series_dataset_descriptor' AND column_name='theme_id')""").fetchone()[0]
        has_route=conn.execute("""SELECT EXISTS(SELECT 1 FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name='series_dataset_descriptor' AND column_name='active_read_route')""").fetchone()[0]
        if has_theme and has_route:
            owned_descriptors=conn.execute("""SELECT dataset_id,indicator_id FROM series_dataset_descriptor
                WHERE theme_id=%s AND active_read_route AND (%s::text IS NULL OR indicator_id=%s)
                ORDER BY indicator_id""",(theme_id,indicator_id,indicator_id)).fetchall()
    collections = collection_descriptors(conn,indicator_id=indicator_id,theme_id=theme_id)
    reading_marker = _demographic_reading_marker(conn) if theme_id == "demographie" else None
    milieux_marker = _milieux_reading_marker(conn) if theme_id == "milieux" else None
    if not scalar_descriptors and not profiles and not owned_descriptors and not collections and not has_readings and not reading_marker and not milieux_marker and not bpe_available:
        raise HTTPException(404, "No published facts for this theme")
    reference = conn.execute(
        "SELECT content_version FROM table_publication WHERE table_name='territory_reference'"
    ).fetchone()
    if not reference or not reference[0]:
        raise HTTPException(503, "Territory reference publication is unavailable")
    scalar_marker = None
    if scalar_descriptors:
        scalar_marker = conn.execute(
            """SELECT content_version,reference_content_version FROM table_publication
               WHERE table_name='scalar_observation'"""
        ).fetchone()
        if not scalar_marker or not scalar_marker[0] or scalar_marker[1] != reference[0]:
            raise HTTPException(503, "Scalar publication is unavailable or incompatible")
    cohort_type, members, scope = _comparison_cohort(conn, territory_type, territory_id, selection)
    results = []
    if scalar_descriptors:
        scalar_rows = conn.execute(
            """SELECT o.indicator_id,o.territory_id,o.territory_type,o.value,o.status,
                 COALESCE((SELECT json_agg(json_build_object('source_id',os.source_id,'vintage_id',os.vintage_id,
                   'name',sd.name,'version',sv.version,'reference_date',sv.reference_date,
                   'publication_date',sv.publication_date) ORDER BY os.source_id,os.vintage_id)
                   FROM scalar_observation_source os JOIN source_dataset sd USING(source_id)
                   JOIN source_vintage sv USING(source_id,vintage_id)
                   WHERE os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id),'[]'::json)
               FROM scalar_observation o JOIN scalar_descriptor d USING(indicator_id)
                WHERE d.theme_id=%s AND (%s::text IS NULL OR d.indicator_id=%s)
                  AND ((o.territory_type=%s AND o.territory_id=ANY(%s))
                  OR (o.territory_id=%s AND o.territory_type=%s))""",
             (theme_id, indicator_id, indicator_id, cohort_type, list(members), territory_id, territory_type),
        ).fetchall()
        by_indicator = {}
        for row in scalar_rows:
            by_indicator.setdefault(row[0], []).append(row)
        for indicator, label, unit, direction, facet, levels, version in scalar_descriptors:
            if not facet or facet != indicator or direction not in ("high", "low") or cohort_type not in levels:
                results.append({"indicator_id": indicator, "status": "unavailable",
                                "reason": "unsupported_comparison_contract"})
                continue
            rows = by_indicator.get(indicator, [])
            peers = [row for row in rows if row[2] == cohort_type and row[1] in members]
            values = [(row[1], float(row[3])) for row in peers
                      if row[4] == "measured" and row[3] is not None]
            focal = next((row for row in rows if row[1] == territory_id and row[2] == territory_type), None)
            focal_value = float(focal[3]) if focal and focal[4] == "measured" and focal[3] is not None else None
            rank = (1 + sum(v > focal_value if direction == "high" else v < focal_value
                            for _, v in values)) if focal_value is not None and territory_id in members else None
            sources, seen = [], set()
            for row in peers:
                for source in row[5] or []:
                    key = (source["source_id"], source["vintage_id"])
                    if key not in seen:
                        seen.add(key)
                        sources.append(source)
            results.append({"indicator_id": indicator, "label": label, "unit": unit,
                "direction": direction, "statistic": "median", "descriptor_version": version,
                "status": "available" if values else "unavailable",
                "reason": None if values else "no_selected_comparable_values",
                "selected_member_count": len(members), "eligible_count": len(values),
                "missing_count": max(0, len(members) - len(values)), "focal_value": focal_value,
                "focal_in_selection": territory_id in members,
                "median": median([value for _, value in values]) if values else None,
                "rank": rank, "rank_size": len(values) if rank is not None else None,
                "comparison_sources": sources})
    profile_results = _profile_comparison_results(conn, profiles, members, cohort_type, territory_id)
    bpe_results = _bpe_profile_comparison(conn, territory_type, territory_id, selection)["results"] if bpe_available else []
    owned_results,owned_markers,_,_,_=_owned_series_comparison_results(conn,
        [(dataset_id,theme_id,False,owned_indicator,None)
         for dataset_id,owned_indicator in owned_descriptors],
        territory_type,territory_id,selection,cohort=(cohort_type,members,scope))
    results.extend(owned_results)
    results.extend(bpe_results)
    collection_results = [collection_comparison(conn,descriptor,territory_type,territory_id,cohort_type,members)
                          for descriptor in collections]
    results.extend(collection_results)
    reading_cloud = (_demographic_reading_cloud(conn, reading_marker, territory_type, territory_id,
        cohort_type, members, scope) if reading_marker else None)
    if milieux_marker:
        reading_cloud = _milieux_reading_cloud(conn, milieux_marker, territory_type, territory_id,
            cohort_type, members, scope)
    return {"contract": "theme-comparison-v1", "complete_theme": False, "theme_id": theme_id,
        "content_version": scalar_marker[0] if scalar_marker else (
             next(iter(owned_markers.values()))[1] if owned_markers else collection_results[0]["content_version"] if collection_results else reading_marker[0] if reading_marker else milieux_marker[0] if milieux_marker else (_bpe_profile_publication(conn)[0] if bpe_available else None)),
        "reading_content_version": reading_marker[0] if reading_marker else milieux_marker[0] if milieux_marker else None,
        "reading_cloud": reading_cloud,
        "collection_content_versions":{result["indicator_id"]:result["content_version"] for result in collection_results},
        "reference_content_version": reference[0],
        "selection": None if selection is None else [
            {"territory_type": level, "territory_id": code} for level, code in selection],
        "scope": {**scope, "member_count": len(members)} if scope else None,
        "results": results, "profile_content_version": profile_version,
        "profile_comparisons": profile_results}


def _demographic_reading_marker(conn):
    """Return a compatible selected-reading marker from this caller-owned snapshot."""
    if not conn.execute("SELECT to_regclass('demographic_typed_reading')").fetchone()[0]:
        return None
    marker = conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,
        t.content_version,d.descriptor_version,d.source_id,sd.name,sv.vintage_id,sv.version,
        sv.reference_date,sv.publication_date,d.rate_unit
        FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
        JOIN demographic_reading_descriptor d ON d.singleton
        JOIN source_dataset sd ON sd.source_id=d.source_id
        JOIN source_vintage sv ON sv.source_id=d.source_id AND sv.vintage_id=d.vintage_id
        WHERE p.table_name='demographic_typed_reading'""").fetchone()
    if marker is None:
        return None
    if (not marker[0] or marker[1] < 1 or marker[2] != marker[3] or
            marker[0] != marker[4] or not marker[5] or not marker[7] or not marker[11]):
        raise HTTPException(503, "Demographic reading publication is unavailable or incompatible")
    return marker


def _demographic_reading_cloud(conn, marker, territory_type, territory_id,
                               cohort_type, members, scope):
    """Minimal selected-group plot evidence; never a history dump or focal summary."""
    focal = conn.execute("""SELECT groupe,story_key FROM demographic_typed_reading
        WHERE territory_id=%s AND territory_type=%s ORDER BY groupe""",
        (territory_id, territory_type)).fetchall()
    if len(focal) != 1:
        raise HTTPException(503, "Demographic cloud reading identity is ambiguous or absent")
    group, story_key = focal[0]
    points = []
    if members:
        rows = conn.execute("""SELECT o.territory_id,o.territory_type,t.name,o.periode,
            o.taux_solde_naturel,o.taux_solde_migratoire,o.status,o.source_id,o.vintage_id
            FROM demographic_typed_reading o JOIN territory_reference t
              ON t.territory_id=o.territory_id AND t.territory_type=o.territory_type
            WHERE o.groupe=%s AND o.territory_type=%s AND o.territory_id=ANY(%s::text[])
            ORDER BY t.name,o.territory_id""", (group,cohort_type,list(members))).fetchall()
        if len(rows) != len(set(members)):
            raise HTTPException(503, "Selected demographic cloud members have missing reading facts")
        if any(row[6] != "measured" or row[4] is None or row[5] is None or
               row[7] != marker[5] or row[8] != marker[7] for row in rows):
            raise HTTPException(503, "Selected demographic cloud facts are unavailable or incompatible")
        points = [{"territory": {"territory_id":row[0],"territory_type":row[1],"name":row[2]},
                   "periode":row[3],"taux_solde_naturel":row[4],"taux_solde_migratoire":row[5]}
                  for row in rows]
    return {"status":"available" if points else "unavailable",
        "reason":None if points else "no_selected_members","groupe":group,"story_key":story_key,
        "scope":scope,"rate_unit":marker[11],"source":{"source_id":marker[5],"name":marker[6],
            "vintage_id":marker[7],"version":marker[8],
            "reference_date":marker[9].isoformat() if marker[9] else None,
            "publication_date":marker[10].isoformat() if marker[10] else None},
        "content_version":marker[0],"points":points}


def _milieux_reading_marker(conn):
    """Pin the typed Milieux reading and shared territory reference in this snapshot."""
    if not conn.execute("SELECT to_regclass('milieux_typed_reading')").fetchone()[0]:
        return None
    marker = conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version,
        p.content_version FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
        WHERE p.table_name='milieux_typed_reading'""").fetchone()
    if not marker:
        raise HTTPException(503, "Milieux reading publication is unavailable")
    if not marker[0] or marker[1] < 1 or marker[2] != marker[3]:
        raise HTTPException(503, "Milieux reading publication is unavailable or incompatible")
    absence_exists = conn.execute("SELECT to_regclass('milieux_reading_absence')").fetchone()[0]
    if absence_exists:
        absence = conn.execute("SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='milieux_reading_absence'").fetchone()
        if absence and (absence[0] != marker[0] or absence[2] != marker[2]):
            raise HTTPException(503, "Milieux source-absence publication is stale or incompatible")
        marker = (*marker, bool(absence), absence[0] if absence else None)
    return marker


def _milieux_reading_cloud(conn, marker, territory_type, territory_id, cohort_type, members, scope):
    """Return only selected Milieux cloud coordinates and identities; never focal facts/history."""
    if not members:
        return {"status":"unavailable","reason":"no_selected_members","groupe":None,
            "scope":scope,"selected_member_count":0,"plotted_member_count":0,
            "content_version":marker[0],"points":[]}
    focal = conn.execute("SELECT groupe FROM milieux_typed_reading WHERE territory_id=%s AND territory_type=%s ORDER BY groupe",
        (territory_id, territory_type)).fetchall()
    if len(focal) != 1:
        raise HTTPException(503, "Milieux cloud reading identity is ambiguous or absent")
    group = focal[0][0]
    points = []
    if members:
        rows = conn.execute("""SELECT r.territory_id,r.territory_type,t.name,r.periode_pop,r.periode_artif,
            r.taux_variation_population,r.artif_m2_par_habitant,r.artif_m3_par_habitant,r.status,r.source_id,r.vintage_id
            FROM milieux_typed_reading r JOIN territory_reference t
              ON t.territory_id=r.territory_id AND t.territory_type=r.territory_type
            WHERE r.groupe=%s AND r.territory_type=%s AND r.territory_id=ANY(%s::text[])
            ORDER BY t.name,r.territory_id""", (group,cohort_type,list(members))).fetchall()
        selected_members = set(members)
        by_code = {row[0]:row for row in rows}
        absent = []
        missing = selected_members - set(by_code)
        if missing and len(marker) > 5 and marker[5]:
            declarations = conn.execute("""SELECT territory_id,territory_type,reason,source_id,vintage_id,source_snapshot_sha256
                FROM milieux_reading_absence WHERE territory_type=%s AND territory_id=ANY(%s::text[])""",
                (cohort_type,sorted(missing))).fetchall()
            declared = {row[0]:row for row in declarations}
            if set(declared) != missing or any(d[2] != "source_record_absent" or not d[5] for d in declarations):
                raise HTTPException(503, "Selected Milieux members have undeclared or invalid reading absence")
            absence_pub = conn.execute("SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='milieux_reading_absence'").fetchone()
            if (absence_pub is None or absence_pub[0] != marker[6] or absence_pub[2] != marker[2] or
                    absence_pub[1] < len(declarations)):
                raise HTTPException(503, "Milieux source-absence publication is stale or incomplete")
            absent = declarations
        elif missing:
            raise HTTPException(503, "Selected Milieux cloud members have missing reading facts")
        # Fetch complete immutable population/state bindings for the whole selected set. These
        # joins check the association's exact state axis and revision rather than trusting its
        # denormalized clock columns. No per-peer/per-state round trips.
        bindings = conn.execute("""SELECT b.territory_id,b.field_key,b.source_id,b.vintage_id,b.source_name,
            b.source_version,b.reference_date,b.publication_date,b.observation_period,b.dataset_id,
            b.dataset_content_version,b.state_role,b.axis_value,b.provenance_revision_id,b.population_revision_id,
            p.source_id,p.vintage_id,p.source_name,p.source_version,p.reference_date,p.publication_date,
            s.source_id,s.vintage_id,s.source_name,s.source_version,s.reference_date,s.publication_date,
            o.state_role,o.observation_period,
            ARRAY(SELECT a.provenance_revision_id FROM series_observation_provenance a
              WHERE a.dataset_id=b.dataset_id AND a.indicator_id='artif_par_habitant'
                AND a.territory_id=b.territory_id AND a.axis_value=b.axis_value
              ORDER BY a.provenance_revision_id)
            FROM milieux_reading_source b
            LEFT JOIN milieux_population_provenance_revision p ON p.population_revision_id=b.population_revision_id
            LEFT JOIN series_provenance_revision s ON s.provenance_revision_id=b.provenance_revision_id
            LEFT JOIN series_dataset_observation o ON o.dataset_id=b.dataset_id AND o.indicator_id='artif_par_habitant'
              AND o.territory_id=b.territory_id AND o.territory_type=b.territory_type AND o.axis_value=b.axis_value
            WHERE b.territory_type=%s AND b.territory_id=ANY(%s::text[]) AND b.groupe=%s
            ORDER BY b.territory_id,b.field_key,b.source_id,b.vintage_id,b.provenance_revision_id""",
            (cohort_type,list(members),group)).fetchall()
        publications = conn.execute("""SELECT dataset_id,content_version,reference_content_version
            FROM series_dataset_publication WHERE dataset_id=ANY(%s::text[])""",
            (list({b[9] for b in bindings if b[9] is not None}),)).fetchall()
        published = {p[0]:p[1:] for p in publications}
        by_peer = {}
        for b in bindings:
            (code,field,source,vintage,name,version,ref_date,pub_date,period,dataset,dataset_version,
             role,axis,revision,pop_revision,p_source,p_vintage,p_name,p_version,p_ref,p_pub,
             s_source,s_vintage,s_name,s_version,s_ref,s_pub,observed_role,observed_period,registered_revisions)=b
            if field == "population":
                valid = (pop_revision is not None and revision is None and p_source == source and p_vintage == vintage
                    and p_name == name and p_version == version and p_ref == ref_date and p_pub == pub_date)
            else:
                valid = (revision is not None and pop_revision is None and s_source == source and s_vintage == vintage
                    and s_name == name and s_version == version and s_ref == ref_date and s_pub == pub_date
                    and observed_role == role and observed_period == period
                    and revision in (registered_revisions or [])
                    and role == ("M2" if field == "artif_m2_par_habitant" else "M3")
                    and published.get(dataset) == (dataset_version,marker[3]))
            if not valid:
                raise HTTPException(503, "Milieux cloud source binding is stale or incompatible")
            by_peer.setdefault(code,{}).setdefault(field,[]).append((source,vintage,revision,pop_revision,period,axis,dataset,dataset_version,role,registered_revisions))
        for code,row in by_code.items():
            fields=by_peer.get(code,{})
            population=fields.get("population",[])
            m2=fields.get("artif_m2_par_habitant",[])
            m3=fields.get("artif_m3_par_habitant",[])
            if row[8] == "unavailable":
                # Source-declared unavailable readings may have no resolved windows or state
                # associations; their typed status is not a broken publication.
                continue
            if (not population or not m2 or not m3 or any(item[4]!=row[3] for item in population)
                or any(item[4]!=row[4] or item[8]!="M2" for item in m2)
                or any(item[4]!=row[4] or item[8]!="M3" for item in m3)):
                raise HTTPException(503, "Milieux cloud source component sets/windows are incomplete")
            for field_items in (m2,m3):
                by_coordinate={}
                for item in field_items:
                    by_coordinate.setdefault((item[6],item[5]),{"bound":set(),"registered":set()})
                    by_coordinate[(item[6],item[5])]["bound"].add(item[2])
                    by_coordinate[(item[6],item[5])]["registered"].update(item[9] or [])
                if any(not group["registered"] or group["bound"] != group["registered"]
                       for group in by_coordinate.values()):
                    raise HTTPException(503, "Milieux cloud state component set differs from published provenance")
            if any(item[0]!=row[9] or item[1]!=row[10] for item in population):
                raise HTTPException(503, "Milieux cloud population provenance differs from its reading")
            # A source-declared unavailable peer is valid evidence but has no plot coordinate.
            if row[8] != "measured":
                continue
            if any(value is None for value in row[5:8]):
                # The fiche selector intentionally omits source-supported NA coordinates
                # (e.g. zero mean population) rather than placing them at invented values.
                continue
            points.append({"territory":{"territory_id":row[0],"territory_type":row[1],"name":row[2]},
                "periode_pop":row[3],"periode_artif":row[4],"taux_variation_population":row[5],
                "artif_m2_par_habitant":row[6],"artif_m3_par_habitant":row[7]})
    return {"status":"available" if points else "unavailable",
        "reason":None if points else ("no_selected_members" if not members else "source_records_absent" if 'absent' in locals() and absent else "no_plottable_members"),"groupe":group,"scope":scope,
        "selected_member_count":len(set(members)),"plotted_member_count":len(points),
        "unavailable_member_count":len(set(members))-len(points),
        "source_absent_member_count":len(absent) if 'absent' in locals() else 0,
        "unavailable_members":[{"territory_id":r[0],"territory_type":r[1],"reason":r[2],"source_id":r[3],"vintage_id":r[4],"source_snapshot_sha256":r[5]} for r in absent] if 'absent' in locals() else [],
        "content_version":marker[0],"points":points}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/territories/{territory_type}/{territory_id}/profiles/{indicator_id}")
def declared_profile(
    territory_type: Literal["commune", "epci", "departement"],
    territory_id: str = Path(min_length=1, max_length=32),
    indicator_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,95}$"),
    comparison_scope: Literal["bretagne", "departement", "epci"] = Query(default="bretagne"),
    comparison_scope_id: str | None = Query(default=None, min_length=1, max_length=32),
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Return a complete, descriptor-ordered profile; never substitutes static data."""
    if comparison_scope == "bretagne":
        if comparison_scope_id is not None:
            raise HTTPException(422, "Bretagne comparison scope does not accept an identifier")
    elif territory_type != "commune":
        raise HTTPException(422, "Local comparison scopes are valid only for communes")
    elif comparison_scope_id is None:
        raise HTTPException(422, "Local comparison scope requires an identifier")
    with repository.connections.connection() as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            marker = conn.execute(
                """SELECT p.content_version,p.row_count,
                          p.reference_content_version,t.content_version AS territory_version
                     FROM table_publication p LEFT JOIN table_publication t ON t.table_name='territory_reference'
                    WHERE p.table_name='declared_profile'""").fetchone()
            if (marker is None or not marker[0] or marker[1] < 1 or
                    not marker[2] or marker[2] != marker[3]):
                raise HTTPException(503, "Profile publication is unavailable")
            if comparison_scope in ("departement", "epci") and comparison_scope_id is not None:
                membership_column = "department_id" if comparison_scope == "departement" else "epci_id"
                membership = conn.execute(
                    f"SELECT {membership_column} FROM territory_reference WHERE territory_id=%s AND territory_type='commune'",
                    (territory_id,)).fetchone()
                # A missing territory remains classified by the existing profile read below.
                if membership is not None and membership[0] != comparison_scope_id:
                    raise HTTPException(422, "Comparison scope identifier does not match the focal territory")
            descriptor = conn.execute(
                "SELECT label,unit,allowed_levels,completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction FROM profile_descriptor WHERE indicator_id=%s",
                (indicator_id,)).fetchone()
            if descriptor is None or territory_type not in descriptor[2]:
                raise HTTPException(404, "Declared profile is unavailable")
            scalar_facet = conn.execute("SELECT comparison_scalar FROM profile_descriptor WHERE indicator_id=%s",
                                        (indicator_id,)).fetchone()
            if scalar_facet and scalar_facet[0]:
                profiles, _ = focal_profiles(conn, territory_type, territory_id, indicator_id=indicator_id)
                profile = profiles[0]
                department_id = comparison_scope_id if comparison_scope == 'departement' else None
                epci_id = comparison_scope_id if comparison_scope == 'epci' else None
                peers = conn.execute("""SELECT t.territory_id,t.name,o.value,o.status FROM scalar_observation o
                    JOIN territory_reference t USING(territory_id) WHERE o.indicator_id=%s AND o.territory_type=%s
                      AND (%s::text IS NULL OR t.department_id=%s) AND (%s::text IS NULL OR t.epci_id=%s)
                    ORDER BY t.name,t.territory_id LIMIT %s""", (scalar_facet[0], territory_type,
                    department_id, department_id, epci_id, epci_id, MAX_TERRITORY_SEARCH_SCAN+1)).fetchall()
                if len(peers) > MAX_TERRITORY_SEARCH_SCAN or not any(p[0] == territory_id for p in peers):
                    raise HTTPException(503, 'Profile comparison scope is unavailable')
                profile['comparison'] = {'indicator': scalar_facet[0], 'direction': descriptor[7],
                    'scope': comparison_scope, 'scope_id': comparison_scope_id,
                    'values': [{'territory_id': tid, 'name': name, 'value': value, 'status': status}
                               for tid,name,value,status in peers]}
                return profile
            if (not descriptor[5] or not descriptor[6] or descriptor[7] not in ("high", "low")):
                raise HTTPException(503, "Profile comparison descriptor is invalid")
            department_id = comparison_scope_id if comparison_scope == "departement" else None
            epci_id = comparison_scope_id if comparison_scope == "epci" else None
            if territory_type != "commune":
                department_id = epci_id = None
            axes = conn.execute(
                "SELECT axis_name,axis_key,label,ordinal FROM profile_axis WHERE indicator_id=%s ORDER BY axis_name,ordinal",
                (indicator_id,)).fetchall()
            if (not axes or {axis[0] for axis in axes} != {"detail", "sex"} or
                    len({(axis[0],axis[1]) for axis in axes}) != len(axes) or
                    len({(axis[0],axis[3]) for axis in axes}) != len(axes)):
                raise HTTPException(503, "Profile descriptor axes are invalid")
            detail_keys = {axis[1] for axis in axes if axis[0] == "detail"}
            sex_keys = {axis[1] for axis in axes if axis[0] == "sex"}
            if descriptor[5] not in detail_keys or descriptor[6] not in sex_keys:
                raise HTTPException(503, "Profile comparison facet is not declared by its axes")
            rows = conn.execute(
                "SELECT o.territory_type,o.detail_key,o.sex_key,o.value,o.status FROM profile_observation o LEFT JOIN profile_axis d ON d.indicator_id=o.indicator_id AND d.axis_name='detail' AND d.axis_key=o.detail_key LEFT JOIN profile_axis s ON s.indicator_id=o.indicator_id AND s.axis_name='sex' AND s.axis_key=o.sex_key WHERE o.indicator_id=%s AND o.territory_id=%s AND o.territory_type=%s ORDER BY d.ordinal NULLS LAST,s.ordinal NULLS LAST",
                (indicator_id, territory_id, territory_type)).fetchall()
            expected = sum(1 for axis in axes if axis[0] == 'detail') * sum(1 for axis in axes if axis[0] == 'sex')
            if not rows:
                raise HTTPException(404, "Profile territory is absent")
            coordinates = [(row[1], row[2]) for row in rows]
            if (len(rows) != expected or len(set(coordinates)) != len(coordinates) or
                    any(detail not in detail_keys or sex not in sex_keys for detail, sex in coordinates)):
                raise HTTPException(503, "Profile publication is incomplete")
            sources = conn.execute(
                """SELECT DISTINCT sd.source_id,sd.name,sv.version,sv.reference_date,sv.publication_date
                     FROM profile_observation_source os JOIN source_dataset sd USING(source_id)
                     JOIN source_vintage sv USING(source_id,vintage_id)
                    WHERE os.indicator_id=%s AND os.territory_id=%s
                    ORDER BY sd.source_id""", (indicator_id, territory_id)).fetchall()
            if not sources:
                raise HTTPException(503, "Profile provenance is unavailable")
            peers = conn.execute(
                """SELECT t.territory_id,t.name,o.value,o.status
                     FROM profile_observation o JOIN territory_reference t USING(territory_id)
                    WHERE o.indicator_id=%s AND o.territory_type=%s
                      AND o.detail_key=%s AND o.sex_key=%s
                      AND (%s::text IS NULL OR t.department_id=%s)
                      AND (%s::text IS NULL OR t.epci_id=%s)
                    ORDER BY t.name,t.territory_id LIMIT %s""",
                (indicator_id, territory_type, descriptor[5], descriptor[6],
                 department_id, department_id, epci_id, epci_id, MAX_TERRITORY_SEARCH_SCAN + 1)).fetchall()
            if len(peers) > MAX_TERRITORY_SEARCH_SCAN:
                raise HTTPException(503, "Declared comparison scope exceeds the bounded profile read")
            if not any(peer[0] == territory_id for peer in peers):
                raise HTTPException(503, "Focal territory is not eligible in declared comparison scope")
            return {"indicator": indicator_id, "label": descriptor[0], "unit": descriptor[1],
                    "descriptor_version": descriptor[4], "content_version": marker[0],
                    "sources": [{"source_id": source_id, "name": name, "version": version,
                        "reference_date": str(reference_date) if reference_date else None,
                        "publication_date": str(publication_date) if publication_date else None}
                        for source_id,name,version,reference_date,publication_date in sources],
                    "comparison": {"detail": descriptor[5], "sex": descriptor[6],
                        "direction": descriptor[7], "scope": comparison_scope,
                        "scope_id": comparison_scope_id, "values": [
                            {"territory_id": tid, "name": name, "value": value, "status": status}
                            for tid,name,value,status in peers]},
                    "axes": [{"name": name, "key": key, "label": label, "order": order}
                             for name,key,label,order in axes],
                    "cells": [{"detail": detail, "sex": sex, "value": value, "status": status}
                              for _level,detail,sex,value,status in rows]}


def _owned_series_route(conn, indicator_id):
    exists = conn.execute("SELECT to_regclass('series_dataset_descriptor')").fetchone()[0]
    if not exists:
        return None
    declared = conn.execute("SELECT 1 FROM series_dataset_descriptor WHERE indicator_id=%s LIMIT 1",
                            (indicator_id,)).fetchone()
    column = conn.execute("""SELECT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='series_dataset_descriptor'
          AND column_name='active_read_route')""").fetchone()[0]
    if declared and not column:
        raise HTTPException(503, "Owned-series active publication route is not declared")
    routes = (conn.execute("""SELECT dataset_id,theme_id,indicator_id FROM series_dataset_descriptor
        WHERE indicator_id=%s AND active_read_route""", (indicator_id,)).fetchall()
        if column else [])
    has_reference_descriptors=conn.execute("SELECT to_regclass('series_named_reference_descriptor')").fetchone()[0]
    reference_aliases = (conn.execute("""SELECT d.dataset_id,s.theme_id,d.indicator_id,d.reference_id
        FROM series_named_reference_descriptor d JOIN series_dataset_descriptor s
          USING(dataset_id,indicator_id)
        WHERE d.reference_indicator_id=%s AND d.active_read_route""",(indicator_id,)).fetchall()
        if has_reference_descriptors else [])
    declared_alias = (conn.execute("""SELECT 1 FROM series_named_reference_descriptor
        WHERE reference_indicator_id=%s LIMIT 1""",(indicator_id,)).fetchone()
        if has_reference_descriptors else None)
    if len(routes)+len(reference_aliases)>1:
        raise HTTPException(503, "Indicator has ambiguous active owned-series routes")
    if routes:
        dataset_id,theme_id,owner_indicator=routes[0]
        return (dataset_id,theme_id,False,owner_indicator,None)
    if reference_aliases:
        dataset_id,theme_id,owner_indicator,reference_id=reference_aliases[0]
        return (dataset_id,theme_id,True,owner_indicator,reference_id)
    if declared or declared_alias:
        raise HTTPException(503, "Owned-series active publication route is not declared")
    return None


def _owned_series_context(conn, dataset_id, indicator_id, territory_type, territory_id, points):
    """Only the declared matching-period parent facts, in the caller snapshot."""
    if not conn.execute("SELECT to_regclass('series_context_parent_policy')").fetchone()[0]:
        return {}
    policies = dict(conn.execute("""SELECT focal_level,parent_level FROM series_context_parent_policy
        WHERE dataset_id=%s AND indicator_id=%s""", (dataset_id,indicator_id)).fetchall())
    if not policies:
        return {}
    parent_level = policies.get(territory_type)
    if not parent_level or not points:
        return {"context": None}
    if parent_level == "epci":
        parents = conn.execute("""SELECT p.territory_id,p.territory_type,p.name
            FROM territory_reference f JOIN territory_reference p ON p.territory_id=f.epci_id
            WHERE f.territory_id=%s AND p.territory_type=%s""", (territory_id,parent_level)).fetchall()
    else:
        parents = conn.execute("SELECT territory_id,territory_type,name FROM territory_reference WHERE territory_type=%s",
                               (parent_level,)).fetchall()
    if len(parents) > 1:
        raise HTTPException(503,"Series context parent reference is ambiguous")
    if not parents:
        return {"context": None}
    parent_id,parent_type,parent_name = parents[0]
    axes = [point["axis"] for point in points]
    rows = conn.execute("""SELECT o.axis_value,o.observation_period,o.value,o.status,
        json_agg(json_build_object('revision_id',v.provenance_revision_id,'source_id',v.source_id,
          'vintage_id',v.vintage_id,'source_name',v.source_name,'dataset_name',v.dataset_name,
          'version',v.source_version,'reference_date',v.reference_date,'publication_date',v.publication_date,
          'revision_hash',v.revision_hash) ORDER BY v.provenance_revision_id)
        FROM series_dataset_observation o JOIN series_observation_provenance p
          USING(dataset_id,indicator_id,territory_id,axis_value)
        JOIN series_provenance_revision v USING(provenance_revision_id)
        WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_id=%s
          AND o.axis_value=ANY(%s) AND o.observation_period=o.axis_value
        GROUP BY o.axis_value,o.observation_period,o.value,o.status ORDER BY o.axis_value""",
        (dataset_id,indicator_id,parent_id,axes)).fetchall()
    return {"context": {"parent":{"id":parent_id,"type":parent_type,"name":parent_name},
        "points":[{"axis":axis,"observation_period":period,"value":value,"status":status,"provenance":sources}
                  for axis,period,value,status,sources in rows]}}


def _owned_series_snapshot(conn, dataset_id, territory_type, territory_id, indicator_id):
    """Read one active owned series, its focal points and named references in the caller snapshot."""
    marker = conn.execute("""SELECT p.content_version,p.reference_content_version,p.row_count,p.published_at,
        t.content_version FROM series_dataset_publication p CROSS JOIN table_publication t
        WHERE p.dataset_id=%s AND t.table_name='territory_reference'""", (dataset_id,)).fetchone()
    if not marker or marker[1] != marker[4]:
        raise HTTPException(503, "Owned-series publication is stale or unavailable")
    descriptor = conn.execute("""SELECT axis_kind,axis_values,axis_numeric_values,completeness,label,unit,
        direction,descriptor_version,allowed_levels,comparison_point,theme_id,observation_period_kind,
        COALESCE(to_jsonb(series_dataset_descriptor)->>'absence_semantics','unavailable')
        FROM series_dataset_descriptor WHERE dataset_id=%s AND indicator_id=%s AND active_read_route""",
        (dataset_id,indicator_id)).fetchone()
    if not descriptor:
        raise HTTPException(503, "Owned-series active publication route is not declared")
    if territory_type not in descriptor[8]:
        raise HTTPException(422, "Owned series is not declared for this territory level")
    focal = conn.execute("SELECT name,territory_type FROM territory_reference WHERE territory_id=%s",
                         (territory_id,)).fetchone()
    if not focal:
        raise HTTPException(404, "Focal territory not found")
    if focal[1] != territory_type:
        raise HTTPException(422, "Focal territory type does not match route")
    facts = conn.execute("""SELECT o.axis_value,o.observation_period,o.value,o.status,o.missing_reason,
        p.provenance_revision_id,p.source_id,p.vintage_id,p.source_name,p.dataset_name,p.source_version,
        p.reference_date,p.publication_date,p.revision_hash,o.state_role
        FROM series_dataset_observation o LEFT JOIN series_observation_provenance a
        USING(dataset_id,indicator_id,territory_id,axis_value)
        LEFT JOIN series_provenance_revision p USING(provenance_revision_id)
        WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_id=%s
        ORDER BY array_position(%s::text[],o.axis_value),p.provenance_revision_id""",
        (dataset_id,indicator_id,territory_id,list(descriptor[1]))).fetchall()
    references = conn.execute("""SELECT r.reference_id,d.reference_label,d.reference_role,d.reference_statistic,
        r.axis_value,r.observation_period,r.value,r.status,r.missing_reason,p.provenance_revision_id,
        p.source_id,p.vintage_id,p.source_name,p.dataset_name,p.source_version,p.reference_date,p.publication_date,
        p.revision_hash,d.required
        FROM series_named_reference_descriptor d LEFT JOIN series_named_reference r
          USING(dataset_id,indicator_id,reference_id)
        LEFT JOIN series_named_reference_provenance a USING(dataset_id,indicator_id,reference_id,axis_value)
        LEFT JOIN series_provenance_revision p USING(provenance_revision_id)
        WHERE d.dataset_id=%s AND d.indicator_id=%s
        ORDER BY d.reference_id,array_position(%s::text[],r.axis_value),p.provenance_revision_id""",
        (dataset_id,indicator_id,list(descriptor[1]))).fetchall()
    row_count = conn.execute("""SELECT (SELECT count(*) FROM series_dataset_observation WHERE dataset_id=%s) +
        (SELECT count(*) FROM series_named_reference WHERE dataset_id=%s)""",(dataset_id,dataset_id)).fetchone()[0]
    if row_count != marker[2]:
        raise HTTPException(503, "Owned series marker row count does not match its facts")
    no_record = not facts and descriptor[12] == "no_record" and descriptor[3] == "may_be_missing"
    if not facts and not no_record:
        raise HTTPException(503, "Owned series focal curve is incomplete")
    def lineage(row, offset):
        if row[offset] is None:
            raise HTTPException(503, "Owned series provenance is incomplete")
        return {"revision_id":row[offset],"source_id":row[offset+1],"vintage_id":row[offset+2],
            "source_name":row[offset+3],"dataset_name":row[offset+4],"version":row[offset+5],
            "reference_date":row[offset+6],"publication_date":row[offset+7],"revision_hash":row[offset+8]}
    points=[]
    for axis in descriptor[1]:
        if no_record:
            break
        matching=[row for row in facts if row[0]==axis]
        if not matching:
            if descriptor[3]=="dense_complete":
                raise HTTPException(503,"Owned series declared axis point is missing")
            points.append({"axis":axis,"observation_period":None,"value":None,"status":"missing",
                "missing_reason":None,"provenance":[]})
            continue
        row=matching[0]
        points.append({"axis":row[0],"observation_period":row[1],"value":row[2],"status":row[3],
            "missing_reason":row[4],"provenance":[lineage(item,5) for item in matching]})
        if row[14] is not None:
            points[-1]["state_role"] = row[14]
    reference_groups={}
    required_ids=set()
    for row in references:
        rid,label,role,statistic,axis,period,value,status,reason=row[:9]
        if row[18]: required_ids.add(rid)
        if axis is None:
            if row[18]: raise HTTPException(503,"Required owned named reference is empty")
            continue
        if axis not in descriptor[1]:
            raise HTTPException(503,"Owned named reference contains an undeclared axis")
        group=reference_groups.setdefault(rid,{"id":rid,"label":label,"role":role,
            "statistic":statistic,"unit":descriptor[5],
            "observation_period_kind":descriptor[11],"points":[]})
        point=next((item for item in group["points"] if item["axis"]==axis),None)
        if point is None:
            point={"axis":axis,"observation_period":period,"value":value,"status":status,
                "missing_reason":reason,"provenance":[]}
            group["points"].append(point)
        point["provenance"].append(lineage(row,9))
    for rid in required_ids:
        group=reference_groups.get(rid)
        if not group or (descriptor[3]=="dense_complete" and
            [point["axis"] for point in group["points"]] != list(descriptor[1])):
            raise HTTPException(503,"Required owned named reference is incomplete")
    return {"dataset_id":dataset_id,"publication_id":marker[0],"reference_content_version":marker[1],
        "published_at":marker[3],"territory":{"id":territory_id,"type":territory_type,"name":focal[0]},
        "indicator_id":indicator_id,"theme_id":descriptor[10],"axis_kind":descriptor[0],
        "axis_values":descriptor[1],"axis_numeric_values":descriptor[2],"completeness":descriptor[3],
        "label":descriptor[4],"unit":descriptor[5],"direction":descriptor[6],
        "descriptor_version":descriptor[7],"comparison_point":descriptor[9],"points":points,"scope_series":[],
        "observation_period_kind":descriptor[11],
        **_owned_series_context(conn,dataset_id,indicator_id,territory_type,territory_id,points),
        "named_references":list(reference_groups.values()),"availability":"no_record" if no_record else "complete" if all(
            point["status"]=="measured" for point in points) else "incomplete"}


def _theme_owned_series_contract(series_rows):
    """Keep owned-series descriptors and named analytical references separate from observations."""
    metadata, references = [], []
    for series in series_rows:
        metadata.append({key: value for key, value in series.items()
            if key not in ("points", "scope_series", "named_references")})
        references.extend({"indicator_id": series["indicator_id"], **reference}
            for reference in series.get("named_references", []))
    return metadata, references


def _theme_owned_series_indicator(series, point):
    """Project one real owned point without collapsing its axis or revision lineage."""
    numeric_axis = next((value for axis, value in zip(series.get("axis_values") or [],
        series.get("axis_numeric_values") or []) if axis == point.get("axis")), None)
    return {"indicator_id":series["indicator_id"],"label":series["label"],"unit":series["unit"],
        "value":point.get("value"),"status":point.get("status"),
        "sources":[{**source,"name":source.get("source_name")} for source in point.get("provenance", [])],
        "dimensions":{"axis":point.get("axis"),"numeric_axis_value":numeric_axis,
            **({"observation_period":point["observation_period"]} if point.get("observation_period") is not None else {}),
            **({"state_role":point["state_role"]} if point.get("state_role") is not None else {})}}


def _owned_named_reference_snapshot(conn, route, territory_type, territory_id, indicator_id):
    dataset_id, theme_id, _is_reference, owner_indicator, reference_id = route
    marker=conn.execute("""SELECT p.content_version,p.reference_content_version,p.row_count,
        t.content_version FROM series_dataset_publication p LEFT JOIN table_publication t
        ON t.table_name='territory_reference' WHERE p.dataset_id=%s""",(dataset_id,)).fetchone()
    if not marker or not marker[0] or marker[1]!=marker[3]:
        raise HTTPException(503,"Owned named-reference publication is unavailable or stale")
    territory=conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",
                           (territory_id,)).fetchone()
    if not territory:
        raise HTTPException(404,"Territory context not found")
    if territory[0]!=territory_type:
        raise HTTPException(422,"Territory context type does not match route")
    descriptor=conn.execute("""SELECT s.axis_kind,s.axis_values,s.unit,d.reference_label,d.reference_role,
        d.reference_statistic,d.required,d.reference_indicator_id,s.observation_period_kind
        FROM series_dataset_descriptor s JOIN series_named_reference_descriptor d
          USING(dataset_id,indicator_id)
        WHERE s.dataset_id=%s AND s.indicator_id=%s AND s.active_read_route
          AND d.reference_id=%s AND d.active_read_route""",
        (dataset_id,owner_indicator,reference_id)).fetchone()
    if not descriptor or descriptor[7]!=indicator_id:
        raise HTTPException(503,"Owned analytical-reference route is unavailable")
    rows=conn.execute("""SELECT r.axis_value,r.observation_period,r.value,r.status,r.missing_reason,
        p.provenance_revision_id,p.source_id,p.vintage_id,p.source_name,p.dataset_name,p.source_version,
        p.reference_date,p.publication_date,p.revision_hash
        FROM series_named_reference r LEFT JOIN series_named_reference_provenance a
          USING(dataset_id,indicator_id,reference_id,axis_value)
        LEFT JOIN series_provenance_revision p USING(provenance_revision_id)
        WHERE r.dataset_id=%s AND r.indicator_id=%s AND r.reference_id=%s
        ORDER BY array_position(%s::text[],r.axis_value),p.provenance_revision_id""",
        (dataset_id,owner_indicator,reference_id,list(descriptor[1]))).fetchall()
    if not rows or (descriptor[6] and {row[0] for row in rows}!=set(descriptor[1])):
        raise HTTPException(503,"Required analytical reference is incomplete")
    points=[]
    for axis in descriptor[1]:
        matching=[row for row in rows if row[0]==axis]
        if not matching:
            points.append({"axis":axis,"observation_period":None,"value":None,"status":"missing",
                "missing_reason":None,"provenance":[]})
            continue
        row=matching[0]
        if any(item[5] is None for item in matching):
            raise HTTPException(503,"Analytical-reference provenance is incomplete")
        points.append({"axis":row[0],"observation_period":row[1],"value":row[2],"status":row[3],
            "missing_reason":row[4],"provenance":[{"revision_id":item[5],"source_id":item[6],
                "vintage_id":item[7],"source_name":item[8],"dataset_name":item[9],
                "version":item[10],"reference_date":item[11],"publication_date":item[12],
                "revision_hash":item[13]} for item in matching]})
    row_count=conn.execute("""SELECT (SELECT count(*) FROM series_dataset_observation
          WHERE dataset_id=%s)+(SELECT count(*) FROM series_named_reference WHERE dataset_id=%s)""",
        (dataset_id,dataset_id)).fetchone()[0]
    if row_count!=marker[2]:
        raise HTTPException(503,"Owned named-reference marker row count is inconsistent")
    return {"dataset_id":dataset_id,"publication_id":marker[0],
        "reference_content_version":marker[1],"indicator_id":indicator_id,"theme_id":theme_id,
        "reference":{"id":reference_id,"label":descriptor[3],"role":descriptor[4],
            "statistic":descriptor[5],"required":descriptor[6]},
        "axis_kind":descriptor[0],"axis_values":descriptor[1],"unit":descriptor[2],
        "observation_period_kind":descriptor[8],
        "points":points,"availability":"complete" if all(p["status"]=="measured" for p in points) else "incomplete"}


def _owned_reference_comparison_result(conn, route, territory_type, territory_id, indicator_id, selection):
    dataset_id,theme_id,_is_reference,owner_indicator,reference_id=route
    marker=conn.execute("""SELECT p.content_version,p.reference_content_version,t.content_version
        FROM series_dataset_publication p LEFT JOIN table_publication t ON t.table_name='territory_reference'
        WHERE p.dataset_id=%s""",(dataset_id,)).fetchone()
    if not marker or not marker[0] or marker[1]!=marker[2]:
        raise HTTPException(503,"Owned analytical-reference publication is unavailable or stale")
    territory=conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",
                           (territory_id,)).fetchone()
    if not territory: raise HTTPException(404,"Territory context not found")
    if territory[0]!=territory_type: raise HTTPException(422,"Territory context type does not match route")
    identity=conn.execute("""SELECT reference_label,reference_role,reference_statistic,active_read_route
        FROM series_named_reference_descriptor WHERE dataset_id=%s AND indicator_id=%s AND reference_id=%s
          AND reference_indicator_id=%s""",(dataset_id,owner_indicator,reference_id,indicator_id)).fetchone()
    if not identity or identity[1]!="analytical_reference":
        raise HTTPException(503,"Analytical-reference identity is unavailable")
    return {"contract":"indicator-comparison-v1","complete_theme":False,"indicator_id":indicator_id,
        "theme_id":theme_id,"shape":"named_reference","content_version":marker[0],
        "reference_content_version":marker[2],"selection":None if selection is None else [
            {"territory_type":level,"territory_id":code} for level,code in selection],
        "scope":None,"result":{"indicator_id":indicator_id,"label":identity[0],
            "role":identity[1],"statistic":identity[2],"status":"unavailable",
            "reason":"analytical_reference_has_no_focal_or_cohort_comparison",
            "selected_member_count":0,"eligible_count":0,"median":None,"rank":None,
            "comparison_sources":[]}}


def _owned_series_comparison_results(conn, routes, territory_type, territory_id, selection,
                                     cohort=None):
    if not routes:
        return [], {}, None, [], None
    cohort_type,members,scope=cohort or _comparison_cohort(
        conn,territory_type,territory_id,selection)
    datasets=list(dict.fromkeys(route[0] for route in routes))
    indicators=list(dict.fromkeys(route[3] for route in routes))
    markers=conn.execute("""SELECT p.dataset_id,p.content_version,p.reference_content_version,
        t.content_version FROM series_dataset_publication p LEFT JOIN table_publication t
          ON t.table_name='territory_reference' WHERE p.dataset_id=ANY(%s)""",(datasets,)).fetchall()
    marker_by_dataset={row[0]:row for row in markers}
    if len(marker_by_dataset)!=len(datasets) or any(not row[1] or row[2]!=row[3] for row in markers):
        raise HTTPException(503,"Owned-series publication is unavailable or stale")
    ids=list(dict.fromkeys([*members,territory_id]))
    rows=conn.execute("""SELECT d.dataset_id,d.indicator_id,d.theme_id,d.comparison_point,d.label,d.unit,
        d.direction,d.allowed_levels,d.descriptor_version,d.axis_values,d.comparison_statistic,
        d.comparison_scope,p.content_version,
        p.reference_content_version,t.content_version,o.territory_id,o.value,o.status,
        v.source_id,v.vintage_id,v.source_name,v.dataset_name,v.source_version,v.reference_date,
        v.publication_date,v.revision_hash,
        CASE WHEN to_jsonb(d)->>'comparison_levels' IS NULL THEN d.allowed_levels
          ELSE ARRAY(SELECT jsonb_array_elements_text(to_jsonb(d)->'comparison_levels')) END
        FROM series_dataset_descriptor d
        JOIN series_dataset_publication p USING(dataset_id)
        LEFT JOIN table_publication t ON t.table_name='territory_reference'
        LEFT JOIN series_dataset_observation o ON o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id
          AND o.axis_value=d.comparison_point AND o.territory_type=%s AND o.territory_id=ANY(%s)
        LEFT JOIN series_observation_provenance a ON a.dataset_id=d.dataset_id
          AND a.indicator_id=d.indicator_id AND a.territory_id=o.territory_id
          AND a.axis_value=o.axis_value
        LEFT JOIN series_provenance_revision v USING(provenance_revision_id)
        WHERE d.dataset_id=ANY(%s) AND d.indicator_id=ANY(%s) AND d.active_read_route
        ORDER BY d.dataset_id,d.indicator_id,o.territory_id,v.provenance_revision_id""",
        (cohort_type,ids,datasets,indicators)).fetchall()
    by_route={}
    for row in rows:
        key=(row[0],row[1]); by_route.setdefault(key,[]).append(row)
    results=[]
    for dataset_id,theme_id,_is_reference,indicator_id,*_ in routes:
        key=(dataset_id,indicator_id); matching=by_route.get(key,[])
        if not matching:
            raise HTTPException(503,"Owned-series active publication route is unavailable")
        first=matching[0]
        (_dataset,_indicator,_theme,point,label,unit,direction,levels,version,axes,
         statistic,comparison_scope,content_version,reference_version,territory_version)=first[:15]
        if not content_version or reference_version!=territory_version:
            raise HTTPException(503,"Owned-series publication is stale or unavailable")
        if territory_type not in levels:
            raise HTTPException(422,"Indicator is not declared for this territory level")
        valid=bool(point and point in axes and direction in ("high","low") and
            statistic=="median" and comparison_scope=="default_group" and
            territory_type in first[26] and cohort_type in first[26])
        observations=[r for r in matching if r[15] is not None]
        if valid and any(r[18] is None for r in observations):
            raise HTTPException(503,"Owned series comparison provenance is incomplete")
        values=[(r[15],float(r[16])) for r in observations if r[15] in members and
            r[17]=="measured" and r[16] is not None]
        focal=next((r for r in observations if r[15]==territory_id),None)
        focal_value=float(focal[16]) if focal and focal[17]=="measured" and focal[16] is not None else None
        enough=valid and len(values)>=2
        rank=(1+sum(value>focal_value if direction=="high" else value<focal_value
            for _,value in values)) if enough and focal_value is not None and territory_id in members else None
        sources=[];seen=set()
        for row in observations:
            if row[15] not in members: continue
            source=(row[18],row[19])
            if source in seen: continue
            seen.add(source);sources.append({"source_id":row[18],"vintage_id":row[19],
                "source_name":row[20],"dataset_name":row[21],"version":row[22],
                "reference_date":row[23],"publication_date":row[24],"revision_hash":row[25]})
        results.append({"indicator_id":indicator_id,"theme_id":theme_id,"label":label,"unit":unit,
            "direction":direction,"descriptor_version":version,"source_facet":point,
            "statistic":statistic,"status":"available" if enough else "unavailable",
            "reason":None if enough else ("fewer_than_two_comparable_values" if values else
                ("no_selected_comparable_values" if valid else "unsupported_comparison_contract")),
            "selected_member_count":len(members),"eligible_count":len(values),
            "missing_count":max(0,len(members)-len(values)),"focal_value":focal_value,
            "focal_in_selection":territory_id in members,
            "median":median([value for _,value in values]) if enough else None,
            "rank":rank,"rank_size":len(values) if rank is not None else None,
            "comparison_sources":sources,"owned_content_version":content_version})
    return results, marker_by_dataset, cohort_type, members, scope


def _owned_series_comparison_result(conn, route, territory_type, territory_id, indicator_id, selection):
    results,markers,_cohort_type,members,scope=_owned_series_comparison_results(
        conn,[route],territory_type,territory_id,selection)
    result=results[0]
    return {"contract":"indicator-comparison-v1","complete_theme":False,
        "indicator_id":indicator_id,"theme_id":route[1],"shape":"series",
        "content_version":result["owned_content_version"],
        "reference_content_version":(markers[route[0]][3] if markers else None),
        "selection":None if selection is None else [
            {"territory_type":level,"territory_id":code} for level,code in selection],
        "scope":{**scope,"member_count":len(members)} if scope else None,
        "result":_comparison_result_without_focal_value(result)}


def _bpe_profile_publication(conn):
    marker = conn.execute("""SELECT p.content_version,p.reference_content_version,r.content_version,
        d.descriptor_version,d.allowed_levels,d.completeness,d.classification_id,d.universe_count,
        d.universe_sha256,d.registry_filename,d.registry_semantic_effect,d.source_id,sd.name,sv.version,
        sv.reference_date,sv.publication_date,d.indicator_id,p.row_count,d.membership_sha256
      FROM table_publication p JOIN table_publication r ON r.table_name='territory_reference'
      JOIN bpe_profile_evidence_descriptor d ON d.singleton
      JOIN source_dataset sd ON sd.source_id=d.source_id
      JOIN source_vintage sv ON sv.source_id=d.source_id AND sv.vintage_id=d.vintage_id
      WHERE p.table_name='bpe_profile_evidence'""").fetchone()
    if (not marker or not marker[0] or marker[1] != marker[2]
            or not marker[18] or len(marker[18]) != 64):
        raise HTTPException(503, "BPE profile publication is unavailable or incompatible")
    published_rows = conn.execute("SELECT count(*) FROM bpe_profile_evidence").fetchone()[0]
    if int(published_rows) != int(marker[17]):
        raise HTTPException(503, "BPE profile row count differs from its publication marker")
    return marker


def _bpe_profile_comparison(conn, territory_type, territory_id, selection):
    marker = _bpe_profile_publication(conn)
    cohort_type, members, scope = _comparison_cohort(conn, territory_type, territory_id, selection)
    axes = conn.execute("SELECT class_key,label,direction FROM bpe_profile_class_axis ORDER BY ordinal").fetchall()
    if not axes or len(axes) != 4:
        raise HTTPException(503, "BPE class axes are unavailable or incompatible")
    # Comparison-only reads contain only selected group members. The focal fact
    # is needed solely when the focal territory is itself selected.
    read_ids = sorted(set(members))
    rows = conn.execute("""SELECT territory_id,class_key,class_count,universe_count
      FROM bpe_profile_evidence WHERE territory_type=%s AND territory_id=ANY(%s)""",
      (cohort_type, read_ids)).fetchall() if read_ids else []
    facts = {(row[0], row[1]): (int(row[2]), int(row[3])) for row in rows}
    results=[]
    for class_key,label,direction in axes:
        class_members = [(code, facts[(code,class_key)][0]) for code in members
                         if (code,class_key) in facts and facts[(code,class_key)][1] == marker[7]]
        focal = facts.get((territory_id,class_key))
        focal_count = focal[0] if focal and focal[1] == marker[7] else None
        eligible = [value for _,value in class_members]
        enough = len(eligible) >= 2
        mean_value = sum(eligible)/len(eligible) if enough else None
        rank = (1 + sum((value > focal_count) if direction == "high" else (value < focal_count)
                        for value in eligible)) if enough and focal_count is not None and territory_id in members else None
        ties = sum(value == focal_count for value in eligible) if rank is not None else None
        results.append({"indicator_id":"bpe_access_profile","detail":class_key,"label":label,"direction":direction,
          "statistic":"mean","metric_type":"mean","status":"available" if enough else "unavailable",
          "reason":None if enough else ("fewer_than_two_comparable_values" if eligible else
            ("no_selected_comparable_values" if members else "empty_selection")),
          "selected_member_count":len(members),"eligible_count":len(eligible),
          "missing_count":max(0,len(members)-len(eligible)),"mean":mean_value,
          "rank":rank,"rank_size":len(eligible) if rank is not None else None,"rank_ties":ties})
    return {"content_version":marker[0],"reference_content_version":marker[2],
      "selection":None if selection is None else [{"territory_type":level,"territory_id":code}
        for level,code in selection],"scope":{**scope,"member_count":len(members)} if scope else None,
      "results":results}


def _bpe_profile_snapshot(conn, territory_type, territory_id, *, default_comparison):
    marker = _bpe_profile_publication(conn)
    territory = conn.execute("SELECT territory_id,name,territory_type FROM territory_reference WHERE territory_id=%s AND territory_type=%s",
                             (territory_id,territory_type)).fetchone()
    if not territory:
        raise HTTPException(404,"Territory not found")
    rows = conn.execute("""SELECT e.class_key,a.label,a.direction,e.class_count,e.universe_count,
       e.exemplar_typequ,e.exemplar_label,e.exemplar_c,e.exemplar_b,e.exemplar_t,
       sd.source_id,sd.name,sv.version,sv.reference_date,sv.publication_date
      FROM bpe_profile_evidence e JOIN bpe_profile_class_axis a USING(class_key)
      JOIN bpe_profile_evidence_source es USING(territory_type,territory_id,class_key)
      JOIN source_dataset sd USING(source_id) JOIN source_vintage sv USING(source_id,vintage_id)
      WHERE e.territory_type=%s AND e.territory_id=%s ORDER BY a.ordinal""",
      (territory_type,territory_id)).fetchall()
    if len(rows) != 4:
        raise HTTPException(404,"Complete BPE classification evidence is unavailable for this territory")
    if (sum(int(r[3]) for r in rows) != int(marker[7])
            or any(int(r[4]) != int(marker[7]) for r in rows)
            or any(r[10] != marker[11] or r[11] != marker[12] or r[12] != marker[13]
                   or r[13] != marker[14] or r[14] != marker[15] for r in rows)):
        raise HTTPException(503,"BPE class rows do not match their universe or source descriptor")
    sources = [{"source_id":marker[11],"name":marker[12],"version":marker[13],
                "reference_date":marker[14].isoformat() if marker[14] else None,
                "publication_date":marker[15].isoformat() if marker[15] else None}]
    evidence = [{"class_key":r[0],"label":r[1],"direction":r[2],"count":r[3],
      "universe_count":r[4],"exemplar":None if r[5] is None else {
        "typequ":r[5],"label":r[6],"access":{"car":r[7],"bike":r[8],"walk_transit":r[9]}}}
      for r in rows]
    payload={"contract":"bpe-profile-evidence-v1","indicator_id":marker[16],"shape":"bpe_profile_evidence",
      "territory":{"territory_id":territory[0],"name":territory[1],"territory_type":territory[2]},
      "content_version":marker[0],"reference_content_version":marker[2],
      "descriptor":{"version":marker[3],"allowed_levels":marker[4],"completeness":marker[5],
        "classification_id":marker[6],"universe_count":marker[7],"universe_sha256":marker[8],
        "registry_filename":marker[9],"registry_semantic_effect":marker[10],
        "membership_sha256":marker[18]},
      "classes":evidence,"sources":sources}
    if default_comparison:
        payload["default_comparison"]=_bpe_profile_comparison(conn,territory_type,territory_id,None)
    return payload


@app.get("/api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}")
def scalar_observation(
    territory_type: Literal["commune", "epci", "departement", "region"],
    territory_id: str = Path(min_length=1, max_length=32),
    indicator_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,95}$"),
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Read a named indicator using its declared published storage shape.

    This is the stable indicator-name URL.  Shape choice comes from producer
    descriptors, not from the caller or a maintained list of indicator keys.
    The scalar branch below remains unchanged for existing scalar consumers.
    """
    with repository.connections.connection() as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            # Shape probes are restricted to the fixed descriptor tables in the
            # serving contract; this also supports installations mid expand/migrate.
            shape_rows = []
            if conn.execute("SELECT to_regclass('bpe_profile_evidence_descriptor')").fetchone()[0]:
                bpe_descriptor = conn.execute(
                    "SELECT indicator_id FROM bpe_profile_evidence_descriptor WHERE singleton").fetchone()
                if bpe_descriptor and bpe_descriptor[0] == indicator_id:
                    return _bpe_profile_snapshot(conn, territory_type, territory_id,
                                                 default_comparison=True)
            bpe = conn.execute("SELECT indicator_id FROM bpe_profile_evidence_descriptor WHERE singleton").fetchone() \
                if conn.execute("SELECT to_regclass('bpe_profile_evidence_descriptor')").fetchone()[0] else None
            if bpe and bpe[0] == indicator_id:
                return _bpe_profile_snapshot(conn, territory_type, territory_id, default_comparison=True)
            for table, shape in (("scalar_descriptor", "scalar"),
                                 ("profile_descriptor", "profile"),
                                 ("series_descriptor", "series")):
                if conn.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0] and conn.execute(
                        f"SELECT 1 FROM {table} WHERE indicator_id=%s", (indicator_id,)).fetchone():
                    shape_rows.append((table, shape))
            owned = _owned_series_route(conn,indicator_id)
            if owned:
                if owned[2]:
                    return _owned_named_reference_snapshot(conn,owned,territory_type,territory_id,indicator_id)
                return _owned_series_snapshot(conn,owned[0],territory_type,territory_id,indicator_id)
            collections = collection_descriptors(conn,indicator_id=indicator_id)
            if collections:
                if shape_rows:
                    raise HTTPException(503,"Indicator has ambiguous collection/storage declarations")
                return collection_snapshot(conn,collections[0],territory_type,territory_id)
            if len(shape_rows) > 1:
                raise HTTPException(503, "Indicator has ambiguous published storage shapes")
            shape = shape_rows[0][1] if shape_rows else None
            if shape is None:
                raise HTTPException(404, "Indicator descriptor is unavailable")
            if shape == "profile":
                descriptor = conn.execute(
                    "SELECT theme_id FROM profile_descriptor WHERE indicator_id=%s", (indicator_id,)
                ).fetchone()
                if not descriptor:
                    raise HTTPException(404, "Profile descriptor is unavailable")
                profiles, _ = focal_profiles(conn, territory_type, territory_id,
                                             indicator_id=indicator_id)
                if not profiles:
                    raise HTTPException(422, "Profile is not declared for this territory level")
                profile = profiles[0]
                cohort_type, members, scope = _comparison_cohort(conn, territory_type, territory_id, None)
                profile_comparison_results = _profile_comparison_results(
                    conn, [profile], members, cohort_type, territory_id)
                profile["default_comparison"] = {
                    "scope": scope, "results": profile_comparison_results}
                return profile
            if shape == "series":
                return _focal_series_snapshot(conn, territory_type, territory_id, indicator_id)
            # Scalar route: focal observation only. Comparison reads use the
            # dedicated bounded theme comparison endpoint.
            marker = conn.execute(
                """SELECT scalar.content_version,
                          scalar.reference_content_version,
                          territory.content_version AS territory_version
                   FROM table_publication scalar
                   LEFT JOIN table_publication territory
                     ON territory.table_name = 'territory_reference'
                   WHERE scalar.table_name = 'scalar_observation'"""
            ).fetchone()
            if marker is None:
                raise HTTPException(503, "Scalar publication is unavailable")
            if (not marker[0] or not marker[0].strip() or marker[1] is None
                    or marker[2] is None or marker[1] != marker[2]):
                raise HTTPException(503, "Scalar publication is stale or incompatible")
            cursor = conn.execute(
                """SELECT o.indicator_id, o.territory_id, o.territory_type,
                          o.value, o.status, o.support_count, o.denominator_count,
                          d.label, d.unit, d.direction, d.comparison_facet,
                          p.content_version,
                          (SELECT json_agg(json_build_object('source_id', os.source_id,
                              'name', sd.name, 'vintage_id', os.vintage_id,
                              'version', sv.version, 'reference_date', sv.reference_date,
                              'publication_date', sv.publication_date)
                           ORDER BY os.source_id, os.vintage_id)
                           FROM scalar_observation_source os
                           JOIN source_dataset sd ON sd.source_id=os.source_id
                           JOIN source_vintage sv ON sv.source_id=os.source_id AND sv.vintage_id=os.vintage_id
                           WHERE os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id) AS sources
                   FROM scalar_observation o
                   JOIN scalar_descriptor d USING (indicator_id)
                   JOIN table_publication p ON p.table_name = 'scalar_observation'
                   WHERE o.indicator_id = %s AND o.territory_id = %s
                     AND o.territory_type = %s AND o.territory_type = ANY(d.allowed_levels)""",
                (indicator_id, territory_id, territory_type),
            )
            row = cursor.fetchone()
            if row is None:
                raise HTTPException(404, "Declared scalar observation is unavailable")
            return dict(zip((column.name for column in cursor.description), row))


def _mobility_service_reference_snapshot(conn):
    """Return only the registered regional building-count fact consumed by services."""
    marker = conn.execute("""SELECT s.content_version,s.reference_content_version,t.content_version
        FROM table_publication s LEFT JOIN table_publication t
          ON t.table_name='territory_reference'
        WHERE s.table_name='scalar_observation'""").fetchone()
    if not marker or not marker[0] or marker[1] != marker[2]:
        raise HTTPException(503, "Mobility service reference publication is unavailable")
    rows = conn.execute("""SELECT t.territory_id,t.territory_type,t.name,
          d.indicator_id,d.label,d.unit,o.value,o.status,
          COALESCE((SELECT json_agg(json_build_object('source_id',os.source_id,'name',sd.name,
            'vintage_id',os.vintage_id,'version',sv.version,'reference_date',sv.reference_date,
            'publication_date',sv.publication_date) ORDER BY os.source_id,os.vintage_id)
            FROM scalar_observation_source os JOIN source_dataset sd USING(source_id)
            JOIN source_vintage sv USING(source_id,vintage_id)
            WHERE os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id),'[]'::json)
        FROM territory_reference t JOIN scalar_observation o
          ON o.territory_id=t.territory_id AND o.territory_type=t.territory_type
        JOIN scalar_descriptor d USING(indicator_id)
        WHERE t.territory_type='region' AND d.theme_id='mobilite'
          AND d.indicator_id='nb_buildings'""").fetchall()
    if len(rows) != 1:
        raise HTTPException(503, "Registered regional Mobility service denominator is unavailable")
    territory_id, territory_type, name, indicator_id, label, unit, value, status, sources = rows[0]
    if status != "measured" or value is None or not sources:
        raise HTTPException(503, "Registered regional Mobility service denominator is unavailable")
    return {"territory": {"territory_id": territory_id, "territory_type": territory_type,
                          "name": name},
            "indicator_id": indicator_id, "label": label, "unit": unit,
            "value": value, "status": status, "sources": sources,
            "content_version": marker[0]}


def _mobility_density_distribution_snapshot(conn, territory_type, territory_id):
    installed = conn.execute("SELECT to_regclass('mobility_density_distribution_descriptor')").fetchone()[0]
    if not installed:
        return None
    marker = conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version,
        d.descriptor_version,d.source_id,d.vintage_id,d.axis_count,d.density_unit,d.decile_unit,
        sd.name,sv.version,sv.reference_date,sv.publication_date,m.source_id,m.vintage_id,m.source_version,
        m.reference_date,m.publication_date,d.allowed_levels
        FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
        JOIN mobility_density_distribution_descriptor d ON d.singleton
        JOIN source_dataset sd ON sd.source_id=d.source_id
        JOIN source_vintage sv ON sv.source_id=d.source_id AND sv.vintage_id=d.vintage_id
        JOIN mobility_reading_descriptor m ON m.singleton
        WHERE p.table_name='mobility_density_distribution'""").fetchone()
    if not marker:
        exists = conn.execute("SELECT 1 FROM mobility_density_distribution_range LIMIT 1").fetchone()
        if exists:
            raise HTTPException(503,"Mobility density distribution publication marker is unavailable")
        return None
    if (not marker[0] or marker[1]<1 or marker[2]!=marker[3] or marker[4]!=marker[0] or
        marker[5]!="mobilite_snapshot" or marker[5]!=marker[14] or marker[6]!=marker[15] or
        marker[11]!=marker[16] or marker[12]!=marker[17] or marker[13]!=marker[18]):
        raise HTTPException(503,"Mobility density distribution publication is incompatible")
    if territory_type not in marker[19]:
        return {"status":"unsupported","range":{"minimum":None,"maximum":None,"status":"unsupported"},
            "points":[],"units":{"density":marker[8],"decile":marker[9]},"provenance":{
                "source_id":marker[5],"source_name":marker[10],"vintage_id":marker[6],"source_version":marker[11],
                "source_reference_date":marker[12],"source_publication_date":marker[13]},
            "allowed_levels":marker[19],"content_version":marker[0],"descriptor_version":marker[4]}
    focal = conn.execute("""SELECT minimum,maximum,status,source_id,vintage_id FROM mobility_density_distribution_range
        WHERE territory_id=%s AND territory_type=%s""",(territory_id,territory_type)).fetchone()
    if not focal:
        return {"status":"unsupported","range":{"minimum":None,"maximum":None,"status":"unsupported"},
            "points":[],"units":{"density":marker[8],"decile":marker[9]},"provenance":{
                "source_id":marker[5],"source_name":marker[10],"vintage_id":marker[6],"source_version":marker[11],
                "source_reference_date":marker[12],"source_publication_date":marker[13]},
            "allowed_levels":marker[19],
            "content_version":marker[0],"descriptor_version":marker[4]}
    if focal[3]!=marker[5] or focal[4]!=marker[6]:
        raise HTTPException(503,"Mobility density distribution fact has incompatible provenance")
    points = conn.execute("""SELECT ordinal,density,density_status,decile,decile_status,source_id,vintage_id
        FROM mobility_density_distribution_point WHERE territory_id=%s AND territory_type=%s ORDER BY ordinal""",
        (territory_id,territory_type)).fetchall()
    if (len(points)!=marker[7] or [row[0] for row in points]!=list(range(marker[7])) or
        any(row[5]!=marker[5] or row[6]!=marker[6] for row in points)):
        raise HTTPException(503,"Mobility density distribution coordinates or provenance are incomplete")
    return {"status":focal[2],"range":{"minimum":focal[0],"maximum":focal[1],"status":focal[2]},
        "points":[{"ordinal":r[0],"density":r[1],"density_status":r[2],"decile":r[3],"decile_status":r[4]} for r in points],
        "units":{"density":marker[8],"decile":marker[9]},"provenance":{
            "source_id":marker[5],"source_name":marker[10],"vintage_id":marker[6],"source_version":marker[11],
            "source_reference_date":marker[12],"source_publication_date":marker[13]},
        "allowed_levels":marker[19],
        "content_version":marker[0],"descriptor_version":marker[4]}


@app.get("/api/territories/{territory_type}/{territory_id}/themes/{theme_id}/facts")
def theme_facts(
    territory_type: Literal["commune", "epci", "departement", "region"],
    territory_id: str = Path(min_length=1, max_length=32),
    theme_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,63}$"),
    service_comparison: Literal["densite", "epci", "bretagne"] | None = Query(
        default=None, alias="comparison"),
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Compact published focal facts/profiles.

    This endpoint deliberately reports its coverage per published shape; a
    scalar/profile subset must never be mistaken for a complete theme model.
    """
    if territory_type != "commune" and service_comparison is not None:
        raise HTTPException(422, "Explicit service comparison modes apply only to communes")
    with repository.connections.connection() as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            return _theme_facts_snapshot(
                conn, territory_type, territory_id, theme_id, service_comparison, repository)


@app.post("/api/territories/{territory_type}/{territory_id}/themes/{theme_id}/facts")
def selected_theme_facts(
    territory_type: Literal["commune", "epci", "departement", "region"],
    theme_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,63}$"),
    territory_id: str = Path(min_length=1, max_length=32),
    request: ThemeComparisonRequest = ...,
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Acquire focal theme facts and selected comparisons in one snapshot."""
    if request.theme_id != theme_id:
        raise HTTPException(422, "Body theme_id must match the theme facts route")
    selected = None if request.selection is None else [
        (item.territory_type, item.territory_id) for item in request.selection]
    with repository.connections.connection() as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            payload = _theme_facts_snapshot(
                conn, territory_type, territory_id, theme_id, None, repository,
                selection=selected)
            payload.pop("default_comparison", None)
            comparison = payload.pop("_selected_comparison")
            nested = {key: comparison[key] for key in (
                "contract", "complete_theme", "theme_id", "content_version",
                "reference_content_version", "selection", "scope", "results",
                "profile_content_version", "profile_comparisons", "reading_content_version", "reading_cloud")}
            nested["results"] = [_comparison_result_without_focal_value(row) for row in nested["results"]]
            nested["profile_comparisons"] = [_comparison_result_without_focal_value(row)
                                               for row in nested["profile_comparisons"]]
            payload["comparison"] = nested
            return payload


def _theme_facts_snapshot(conn, territory_type, territory_id, theme_id, service_comparison,
                           repository, selection=None) -> dict:
    """Build the public theme-facts response from one caller-owned snapshot."""
    territory = conn.execute("""SELECT territory_id,name,territory_type FROM territory_reference
        WHERE territory_id=%s AND territory_type=%s""", (territory_id, territory_type)).fetchone()
    if not territory:
        raise HTTPException(404, "Territory not found")
    descriptors = conn.execute(
        "SELECT indicator_id FROM scalar_descriptor WHERE theme_id=%s ORDER BY indicator_id",
        (theme_id,)).fetchall()
    rows = []
    marker = None
    if descriptors:
        marker = conn.execute("""SELECT s.content_version,s.reference_content_version,
             t.content_version FROM table_publication s LEFT JOIN table_publication t
             ON t.table_name='territory_reference' WHERE s.table_name='scalar_observation'""").fetchone()
        if not marker or not marker[0] or not marker[1] or marker[1] != marker[2]:
            raise HTTPException(503, "Scalar publication is unavailable or incompatible")
        rows = conn.execute("""SELECT d.indicator_id,d.label,d.unit,d.direction,d.comparison_facet,
             d.descriptor_version,o.value,o.status,o.support_count,o.denominator_count,
             COALESCE((SELECT json_agg(json_build_object('source_id',os.source_id,'name',sd.name,
               'vintage_id',os.vintage_id,'version',sv.version,'reference_date',sv.reference_date,
               'publication_date',sv.publication_date) ORDER BY os.source_id,os.vintage_id)
               FROM scalar_observation_source os JOIN source_dataset sd USING(source_id)
               JOIN source_vintage sv USING(source_id,vintage_id)
               WHERE os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id),'[]'::json)
             FROM scalar_descriptor d JOIN scalar_observation o USING(indicator_id)
             WHERE d.theme_id=%s AND o.territory_id=%s AND o.territory_type=%s
               AND o.territory_type=ANY(d.allowed_levels) ORDER BY d.indicator_id""",
             (theme_id, territory_id, territory_type)).fetchall()
    profiles, profile_version = focal_profiles(conn, territory_type, territory_id, theme_id=theme_id)
    owned_series=[]
    collections=[]
    bpe_profile=None
    density_distribution=None
    if conn.execute("SELECT to_regclass('series_dataset_descriptor')").fetchone()[0]:
        has_theme=conn.execute("""SELECT EXISTS(SELECT 1 FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name='series_dataset_descriptor' AND column_name='theme_id')""").fetchone()[0]
        has_route=conn.execute("""SELECT EXISTS(SELECT 1 FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name='series_dataset_descriptor' AND column_name='active_read_route')""").fetchone()[0]
        if has_theme and has_route:
            routes=conn.execute("""SELECT dataset_id,indicator_id FROM series_dataset_descriptor
                WHERE theme_id=%s AND active_read_route ORDER BY indicator_id""",(theme_id,)).fetchall()
            owned_series=[_owned_series_snapshot(conn,dataset_id,territory_type,territory_id,indicator)
                          for dataset_id,indicator in routes]
    bpe_profile = (_bpe_profile_snapshot(conn,territory_type,territory_id,default_comparison=False)
        if theme_id == "mobilite" and conn.execute("SELECT to_regclass('bpe_profile_evidence_descriptor')").fetchone()[0]
        and conn.execute("SELECT 1 FROM bpe_profile_evidence_descriptor WHERE singleton AND indicator_id='bpe_access_profile'").fetchone()
        else None)
    collections = [collection_snapshot(conn,descriptor,territory_type,territory_id)
                   for descriptor in collection_descriptors(conn,theme_id=theme_id)
                   if territory_type in descriptor["allowed_levels"]]
    readings = []
    reading_version = None
    reading_descriptor_version = None
    reading_availability = None
    if not rows and not profiles and not owned_series and not bpe_profile and not collections and theme_id not in ("demographie", "habitat", "milieux", "mobilite"):
        raise HTTPException(404, "No published facts for this theme and territory")
    readings = []
    reading_version = None
    if theme_id == "demographie":
        reading_table = conn.execute("SELECT to_regclass('demographic_typed_reading')").fetchone()[0]
        reading_marker = conn.execute("""SELECT p.content_version,p.row_count,
            p.reference_content_version,t.content_version,d.descriptor_version,
            d.source_id,sd.name,sv.vintage_id,sv.version,sv.reference_date,sv.publication_date
            ,d.rate_unit
            FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
            JOIN demographic_reading_descriptor d ON d.singleton
            JOIN source_dataset sd ON sd.source_id=d.source_id
            JOIN source_vintage sv ON sv.source_id=d.source_id AND sv.vintage_id=d.vintage_id
            WHERE p.table_name='demographic_typed_reading'""").fetchone() if reading_table else None
        if reading_marker and (not reading_marker[0] or reading_marker[1] <= 0 or
                reading_marker[2] != reading_marker[3]):
            raise HTTPException(503, "Demographic reading publication is unavailable or incompatible")
        reading_rows = conn.execute("""SELECT groupe,story_key,salience_reason,periode,
            solde_naturel,solde_migratoire,taux_solde_naturel,taux_solde_migratoire,
            classification,status,source_id,vintage_id
            FROM demographic_typed_reading WHERE territory_id=%s AND territory_type=%s
            ORDER BY groupe""", (territory_id, territory_type)).fetchall() if reading_marker else []
        if reading_marker and not reading_rows:
            raise HTTPException(404, "No selected demographic reading for this territory")
        reading_version = reading_marker[0] if reading_marker else None
        reading_names = ("groupe","story_key","salience_reason","periode","solde_naturel",
            "solde_migratoire","taux_solde_naturel","taux_solde_migratoire","classification",
            "status","source_id","vintage_id")
        provenance = ({"source_id":reading_marker[5],"source_name":reading_marker[6],
            "vintage_id":reading_marker[7],"source_version":reading_marker[8],
            "source_reference_date":reading_marker[9],"source_publication_date":reading_marker[10]}
            if reading_marker else None)
        readings = [{**dict(zip(reading_names,row)),"provenance":provenance}
            for row in reading_rows]
        for reading in readings:
            reading["rate_unit"] = reading_marker[11]
    elif theme_id == "mobilite":
        installed = conn.execute("SELECT to_regclass('mobility_typed_reading')").fetchone()[0]
        if not installed:
            raise HTTPException(503,"Mobility reading publication is unavailable")
        reading_marker = conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,
            t.content_version,d.descriptor_version,d.source_id,d.vintage_id,d.source_name,d.dataset_name,
            d.source_version,d.reference_date,d.publication_date,d.unit,d.direction,d.allowed_levels,
            d.missing_status,d.classification_values,d.field_keys,d.story_count,d.clock_count,
            sd.name,sv.version,sv.reference_date,sv.publication_date
            FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
            JOIN mobility_reading_descriptor d ON d.singleton
            JOIN source_dataset sd ON sd.source_id=d.source_id
            JOIN source_vintage sv ON sv.source_id=d.source_id AND sv.vintage_id=d.vintage_id
            WHERE p.table_name='mobility_typed_reading'""").fetchone()
        if not reading_marker or not reading_marker[0] or reading_marker[1] < 1 or reading_marker[2] != reading_marker[3]:
            raise HTTPException(503,"Mobility reading publication is unavailable or incompatible")
        if (not reading_marker[4] or not reading_marker[5] or not reading_marker[6] or
            reading_marker[7] != reading_marker[20] or reading_marker[9] != reading_marker[21] or
            reading_marker[10] != reading_marker[22] or reading_marker[11] != reading_marker[23] or
            not reading_marker[8] or not reading_marker[12] or
            reading_marker[13] not in ("high","low","none") or not reading_marker[14] or
            reading_marker[15] != "unavailable" or not reading_marker[16] or
            not {"groupe","story_key","salience_reason","classification_saillance","div_loss_t","div_loss_b","status"}.issubset(set(reading_marker[17]))):
            raise HTTPException(503,"Mobility reading descriptor differs from its registered source contract")
        reading_availability = "available" if territory_type in reading_marker[14] else "unsupported"
        clocks = conn.execute("""SELECT clock_name,frequency,reference,trigger FROM mobility_reading_clock
            ORDER BY ordinal""").fetchall()
        story_descriptors = conn.execute("""SELECT story_key,groupe,salience_reason FROM mobility_reading_story
            ORDER BY ordinal""").fetchall()
        if len(clocks)!=reading_marker[19] or len(story_descriptors)!=reading_marker[18]:
            raise HTTPException(503,"Mobility reading semantic descriptor is incomplete")
        source_provenance={"source_id":reading_marker[5],"source_name":reading_marker[7],
            "dataset_name":reading_marker[8],"vintage_id":reading_marker[6],
            "source_version":reading_marker[9],"source_reference_date":reading_marker[10],
            "source_publication_date":reading_marker[11],
            "windows":[dict(zip(("name","frequency","reference","trigger"),clock)) for clock in clocks]}
        story_bindings={(story,group,reason) for story,group,reason in story_descriptors}
        reading_rows = conn.execute("""SELECT r.groupe,r.story_key,r.salience_reason,r.classification_saillance,
            r.div_loss_t,r.div_loss_b,r.status,r.source_id,r.vintage_id,s.story_key
            FROM mobility_typed_reading r LEFT JOIN mobility_reading_story s
              ON s.groupe=r.groupe AND s.story_key=r.story_key AND s.salience_reason=r.salience_reason
            WHERE r.territory_id=%s AND r.territory_type=%s ORDER BY r.groupe""",
            (territory_id,territory_type)).fetchall() if reading_availability == "available" else []
        if reading_availability == "available" and not reading_rows:
            raise HTTPException(503,"Declared eligible Mobility reading is absent for this territory")
        for row in reading_rows:
            if (row[9] is None or (row[1],row[0],row[2]) not in story_bindings or
                row[7]!=reading_marker[5] or row[8]!=reading_marker[6] or row[2] is None or
                (row[3] is not None and row[3] not in reading_marker[16]) or
                (row[6]=="measured" and (row[4] is None or row[5] is None)) or
                (row[6]==reading_marker[15] and row[4] is not None and row[5] is not None) or
                (row[6] not in ("measured",reading_marker[15]))):
                raise HTTPException(503,"Mobility reading fields differ from their registered descriptor")
            readings.append(dict(zip(("groupe","story_key","salience_reason","classification_saillance",
                "div_loss_t","div_loss_b","status","source_id","vintage_id"),row[:9]),
                unit=reading_marker[12],direction=reading_marker[13],provenance=source_provenance))
        reading_version = reading_marker[0]
        reading_descriptor_version = reading_marker[4]
    elif theme_id == "habitat":
        installed = conn.execute("SELECT to_regclass('habitat_typed_reading')").fetchone()[0]
        if installed:
            selected_marker = conn.execute("""SELECT p.content_version,p.reference_content_version,
                t.content_version,p.row_count,d.descriptor_version,d.source_id,sd.name,sv.vintage_id,
                sv.version,sv.reference_date,sv.publication_date,d.linked_content_version,
                dp.content_version,sp.content_version,dp.reference_content_version,pd.required_scalar_version,
                st.content_version,st.row_count,st.reference_content_version
                FROM selected_reading_publication p JOIN selected_reading_descriptor d USING(theme_id)
                JOIN table_publication t ON t.table_name='territory_reference'
                JOIN table_publication dp ON dp.table_name='declared_profile'
                JOIN table_publication sp ON sp.table_name='scalar_observation'
                JOIN table_publication st ON st.table_name='selected_reading'
                JOIN profile_descriptor pd ON pd.indicator_id='distribution_dpe'
                JOIN source_dataset sd ON sd.source_id=d.source_id
                JOIN source_vintage sv ON sv.source_id=d.source_id AND sv.vintage_id=d.vintage_id
                WHERE p.theme_id=%s""",(theme_id,)).fetchone()
            if not selected_marker:
                selected_exists=conn.execute("SELECT 1 FROM selected_reading_publication WHERE theme_id='habitat'").fetchone()
                if selected_exists:
                    raise HTTPException(503,"Selected habitat reading dependencies are unavailable")
            if selected_marker:
                if (selected_marker[0]!=selected_marker[4] or selected_marker[1]!=selected_marker[2] or
                    not selected_marker[11] or selected_marker[3]<1 or
                    selected_marker[15] != selected_marker[13] or
                    not selected_marker[11].endswith(f"-{selected_marker[12]}-{selected_marker[13]}-{selected_marker[14]}") or
                    selected_marker[16] != selected_marker[0] or selected_marker[17] != selected_marker[3] or
                    selected_marker[18] != selected_marker[1]):
                    raise HTTPException(503,"Selected reading publication is unavailable or incompatible")
                provenance={"source_id":selected_marker[5],"source_name":selected_marker[6],
                    "vintage_id":selected_marker[7],"source_version":selected_marker[8],
                    "source_reference_date":selected_marker[9],"source_publication_date":selected_marker[10]}
                habitat_rows=conn.execute("""SELECT groupe,story_key,salience_reason,classification,
                    part_passoires,part_abc,n_dpe,status,source_id,vintage_id FROM habitat_typed_reading
                    WHERE territory_id=%s AND territory_type=%s ORDER BY groupe""",(territory_id,territory_type)).fetchall()
                if any(row[8]!=selected_marker[5] or row[9]!=selected_marker[7] for row in habitat_rows):
                    raise HTTPException(503,"Selected habitat reading provenance is incompatible")
                readings=[dict(zip(("groupe","story_key","salience_reason","classification","part_passoires",
                    "part_abc","n_dpe","status","source_id","vintage_id"),row),provenance=provenance) for row in habitat_rows]
                if not readings: raise HTTPException(404,"No selected reading for this territory")
                reading_version=selected_marker[0]
    elif theme_id == "economie":
        installed=conn.execute("SELECT to_regclass('economy_typed_reading')").fetchone()[0]
        if not installed:
            raise HTTPException(503,"Economy reading publication is unavailable")
        if installed:
            selected_marker=conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,
                t.content_version,e.content_version,e.row_count,e.reference_content_version
                FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
                JOIN table_publication e ON e.table_name='economy_activity_evidence'
                WHERE p.table_name='economy_typed_reading'""").fetchone()
            if not selected_marker:
                raise HTTPException(503,"Economy reading publication is unavailable")
            if (selected_marker[0]!=selected_marker[4] or selected_marker[1]<1 or
                selected_marker[2]!=selected_marker[3] or selected_marker[6]!=selected_marker[3] or
                selected_marker[5]<0):
                raise HTTPException(503,"Economy reading publication is unavailable or incompatible")
            reading_rows=conn.execute("""SELECT groupe,story_key,salience_reason,status,source_id,vintage_id
                FROM economy_typed_reading WHERE territory_id=%s AND territory_type=%s ORDER BY groupe""",
                (territory_id,territory_type)).fetchall()
            reading_availability = "available" if reading_rows else "unsupported"
            reading_source_id=reading_rows[0][4] if reading_rows else None
            source=conn.execute("""SELECT sd.name,v.version,v.reference_date,v.publication_date
                FROM source_vintage v JOIN source_dataset sd USING(source_id)
                WHERE v.source_id=%s AND v.vintage_id=%s""",
                (reading_source_id,reading_rows[0][5])).fetchone() if reading_rows else None
            if reading_rows and (not source or any(row[4]!=reading_source_id or row[5]!=reading_rows[0][5] for row in reading_rows)):
                raise HTTPException(503,"Economy reading provenance is incompatible")
            provenance=({"source_id":reading_source_id,"source_name":source[0],"vintage_id":reading_rows[0][5],
                "source_version":source[1],"source_reference_date":source[2],"source_publication_date":source[3]}
                if reading_rows else None)
            evidence=conn.execute("""SELECT groupe,rank,activity_code,activity_label,lq,establishment_count,park_share,source_id,vintage_id
                FROM economy_activity_evidence WHERE territory_id=%s AND territory_type=%s ORDER BY groupe,rank""",
                (territory_id,territory_type)).fetchall()
            by_group={}
            for row in evidence:
                if row[7]!=reading_source_id or row[8]!=reading_rows[0][5]:
                    raise HTTPException(503,"Economy activity evidence provenance is incompatible")
                by_group.setdefault(row[0],[]).append({"rank":row[1],"activity_code":row[2],"activity_label":row[3],
                    "lq":row[4],"n":row[5],"part_parc":row[6]})
            if any([item["rank"] for item in items] != list(range(1,len(items)+1)) for items in by_group.values()) or any(
                row[3]=="measured" and not by_group.get(row[0]) for row in reading_rows):
                raise HTTPException(503,"Economy activity evidence is incomplete")
            readings=[{"groupe":row[0],"story_key":row[1],"salience_reason":row[2],"status":row[3],
                "activities":by_group.get(row[0],[]),"provenance":provenance} for row in reading_rows]
            reading_version=selected_marker[0]
    elif theme_id == "milieux":
        installed=conn.execute("SELECT to_regclass('milieux_typed_reading')").fetchone()[0]
        if not installed:
            raise HTTPException(503,"Milieux reading publication is unavailable")
        milieux_marker=conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version
            FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
            WHERE p.table_name='milieux_typed_reading'""").fetchone()
        if not milieux_marker or milieux_marker[0] is None or milieux_marker[1] < 1 or milieux_marker[2] != milieux_marker[3]:
            raise HTTPException(503,"Milieux reading publication is unavailable or incompatible")
        milieux_rows=conn.execute("""SELECT r.groupe,r.story_key,r.salience_reason,r.periode_pop,r.periode_artif,
            r.delta_population,r.taux_variation_population,r.artif_m2_par_habitant,r.artif_m3_par_habitant,
            r.trajectoire_artif_par_habitant,r.classification,r.status,r.source_id,r.vintage_id
            FROM milieux_typed_reading r
            WHERE r.territory_id=%s AND r.territory_type=%s ORDER BY r.groupe""",
            (territory_id,territory_type)).fetchall()
        if not milieux_rows and selection != []:
            raise HTTPException(404,"No selected Milieux reading for this territory")
        source_rows=conn.execute("""SELECT b.groupe,b.field_key,b.source_id,b.source_name,b.vintage_id,b.source_version,
            b.reference_date,b.publication_date,b.observation_period,b.dataset_id,b.dataset_content_version,
            b.state_role,b.provenance_revision_id,b.axis_value,b.population_revision_id,
            COALESCE(p.source_id,s.source_id),COALESCE(p.vintage_id,s.vintage_id),
            COALESCE(p.source_name,s.source_name),COALESCE(p.source_version,s.source_version),
            COALESCE(p.reference_date,s.reference_date),COALESCE(p.publication_date,s.publication_date)
            FROM milieux_reading_source b
            LEFT JOIN milieux_population_provenance_revision p ON p.population_revision_id=b.population_revision_id
            LEFT JOIN series_provenance_revision s ON s.provenance_revision_id=b.provenance_revision_id
            WHERE b.territory_id=%s AND b.territory_type=%s
            ORDER BY b.groupe,b.field_key,b.source_id,b.vintage_id""",(territory_id,territory_type)).fetchall()
        by_reading={}
        for source_row in source_rows:
            if source_row[9] is not None:
                current=conn.execute("SELECT content_version,reference_content_version FROM series_dataset_publication WHERE dataset_id=%s",
                    (source_row[9],)).fetchone()
                if not current or current[0]!=source_row[10] or current[1]!=milieux_marker[3]:
                    raise HTTPException(503,"Milieux OCS-GE source association is stale or incompatible")
            if (source_row[2]!=source_row[15] or source_row[4]!=source_row[16] or source_row[3]!=source_row[17] or
                source_row[5]!=source_row[18] or source_row[6]!=source_row[19] or source_row[7]!=source_row[20] or
                (source_row[1]=="population" and (source_row[14] is None or source_row[12] is not None)) or
                (source_row[1]!="population" and (source_row[12] is None or source_row[14] is not None))):
                raise HTTPException(503,"Milieux source clock differs from its immutable provenance revision")
            by_reading.setdefault(source_row[0],[]).append({"field":source_row[1],"source_id":source_row[15],
                "source_name":source_row[17],"vintage_id":source_row[16],"source_version":source_row[18],
                "source_reference_date":source_row[19],"source_publication_date":source_row[20],
                "observation_period":source_row[8],"dataset_id":source_row[9],
                "dataset_content_version":source_row[10],"state_role":source_row[11],
                "provenance_revision_id":source_row[12],"population_revision_id":source_row[14],
                "axis_value":source_row[13]})
        readings=[]
        for row in milieux_rows:
            associations=by_reading.get(row[0],[])
            if not any(a["field"]=="population" for a in associations) or not any(a["field"]=="artif_m2_par_habitant" for a in associations) or not any(a["field"]=="artif_m3_par_habitant" for a in associations):
                raise HTTPException(503,"Milieux reading source/window associations are incomplete")
            population_associations=[a for a in associations if a["field"]=="population"]
            if len(population_associations)!=1 or population_associations[0]["source_id"]!=row[12] or population_associations[0]["vintage_id"]!=row[13]:
                raise HTTPException(503,"Milieux population reading is detached from its canonical vintage")
            for association in associations:
                expected_period=row[3] if association["field"]=="population" else row[4]
                expected_role={"artif_m2_par_habitant":"M2","artif_m3_par_habitant":"M3"}.get(association["field"])
                if association["observation_period"]!=expected_period or (expected_role and association["state_role"]!=expected_role):
                    raise HTTPException(503,"Milieux reading source/window association disagrees with selected producer window")
                if expected_role:
                    registered=conn.execute("""SELECT r.source_id,r.vintage_id,r.provenance_revision_id,o.state_role,o.observation_period
                        FROM series_dataset_observation o JOIN series_observation_provenance a
                          USING(dataset_id,indicator_id,territory_id,axis_value)
                        JOIN series_provenance_revision r USING(provenance_revision_id)
                        WHERE o.dataset_id=%s AND o.indicator_id='artif_par_habitant' AND o.territory_id=%s
                          AND o.territory_type=%s AND o.axis_value=%s""",
                        (association["dataset_id"],territory_id,territory_type,association["axis_value"])).fetchall()
                    actual_for_field=[a for a in associations if a["field"]==association["field"]]
                    registered_keys={(r[0],r[1],r[2]) for r in registered}
                    bound_keys={(a["source_id"],a["vintage_id"],a["provenance_revision_id"]) for a in actual_for_field}
                    if not registered or registered_keys!=bound_keys or any(r[3]!=expected_role or r[4]!=expected_period for r in registered):
                        raise HTTPException(503,"Milieux source-component bindings differ from the registered OCS-GE state publication")
            readings.append(dict(zip(("groupe","story_key","salience_reason","periode_pop","periode_artif",
                "delta_population","taux_variation_population","artif_m2_par_habitant","artif_m3_par_habitant",
                "trajectoire_artif_par_habitant","classification","status","source_id","vintage_id"),row[:14]),
                provenance={"source_id":population_associations[0]["source_id"],
                "source_name":population_associations[0]["source_name"],
                "vintage_id":population_associations[0]["vintage_id"],
                "source_version":population_associations[0]["source_version"],
                "source_reference_date":population_associations[0]["source_reference_date"],
                "source_publication_date":population_associations[0]["source_publication_date"],
                "associations":associations}))
        reading_version=milieux_marker[0]
    comparison = _theme_comparison_snapshot(conn, territory_type, territory_id, theme_id, selection,
        profiles=profiles, profile_version=profile_version, has_readings=bool(readings))
    building_access = None
    service_reference = None
    essential_service_access = None
    if theme_id == "mobilite":
        # Reuse the registered essential-service reader inside this
        # endpoint's snapshot. For communes this is the established
        # density-class default; larger territory levels use their
        # same-level published peers. Do not open a nested connection.
        service_mode = service_comparison or "densite"
        if selection is None:
            service_snapshot = (repository.read(territory_id, service_mode, connection=conn)
                if territory_type == "commune"
                else repository.read_level(territory_type, territory_id, connection=conn))
        else:
            service_snapshot = repository.read_selected(territory_type, territory_id, selection,
                                                        connection=conn)
        essential_service_access = compare(service_snapshot).model_dump(mode="json")
        density_distribution=_mobility_density_distribution_snapshot(conn,territory_type,territory_id)
        try:
            building_access = repository.read_building_initial(
                territory_type, territory_id,
                service_mode if territory_type == "commune" else None,
                selected=selection,
                connection=conn)
        except HTTPException as exc:
            # Older installations can serve the existing theme facts
            # before the additive registered building publication is
            # installed. Keep that pre-existing theme contract intact.
            if exc.status_code != 503 or exc.detail != "No building-access dataset has been published":
                raise
        service_contract = conn.execute("""SELECT EXISTS(
            SELECT 1 FROM scalar_descriptor WHERE theme_id='mobilite'
              AND indicator_id LIKE 'share_%')""").fetchone()[0]
        if service_contract:
            service_reference = _mobility_service_reference_snapshot(conn)
    names=("indicator_id","label","unit","direction","comparison_facet","descriptor_version",
           "value","status","support_count","denominator_count","sources")
    # A public theme response exposes observations as indicator facts, rather
    # than leaking the storage families (scalar/profile/series) as collections.
    indicators = []
    indicator_metadata = []
    for row in rows:
        fact = dict(zip(names, row))
        indicators.append({**fact, "dimensions": {}})
    for profile in profiles:
        indicator_metadata.append({"indicator_id": profile["indicator"], "kind": "declared_dimensions",
            "label": profile["label"], "unit": profile["unit"],
            "denominator_semantics": profile.get("denominator_semantics"),
            "descriptor_version": profile["descriptor_version"],
            "allowed_levels": profile["allowed_levels"],
            "axes": profile["axes"], "comparison_point": profile.get("comparison_point"),
            "comparison_scalar": profile.get("comparison_scalar"),
            "required_scalar_version": profile.get("required_scalar_version")})
        for cell in profile["cells"]:
            indicators.append({"indicator_id": profile["indicator"], "label": profile["label"],
                "unit": cell["unit"], "value": cell["value"], "status": cell["status"],
                "sources": cell["sources"], "dimensions": {"detail": cell["detail"],
                    **({"sex": cell["sex"]} if cell.get("sex") is not None else {}),
                    **({"observation_period": cell["observation_period"]} if cell.get("observation_period") is not None else {})},
                "denominator_semantics": cell.get("denominator_semantics")})
    series_metadata, named_reference_evidence = _theme_owned_series_contract(owned_series)
    indicator_metadata.extend(series_metadata)
    for series in owned_series:
        for point in series.get("points", []):
            # Sparse axis positions without an observation are not facts.
            if point.get("value") is None and point.get("status") == "missing" and not point.get("provenance"):
                continue
            indicators.append(_theme_owned_series_indicator(series, point))
    payload = {"contract":"theme-facts-v1","complete_theme":False,"theme_id":theme_id,
       "territory":{"territory_id":territory[0],"name":territory[1],"territory_type":territory[2]},
        "content_version":marker[0] if marker else comparison["content_version"],
        "owned_series_content_versions":[item["publication_id"] for item in owned_series],
        "reference_content_version":comparison["reference_content_version"],
         "profile_content_version":profile_version,
         "indicator_metadata":indicator_metadata,
         "named_reference_evidence":named_reference_evidence,
         "readings":readings,"reading_content_version":reading_version,"reading_descriptor_version":reading_descriptor_version,
         "reading_availability":reading_availability,
         "bpe_profile_evidence":bpe_profile,
        "collections":collections,
        "indicators":indicators,
         "default_comparison":{"scope":comparison["scope"],"results":comparison["results"],
                               "profile_comparisons":comparison["profile_comparisons"]}}
    if selection is not None:
        payload["_selected_comparison"] = comparison
    if building_access is not None:
        payload["building_access"] = building_access
    if density_distribution is not None:
        payload["density_distribution"] = density_distribution
    if service_reference is not None:
        payload["service_reference"] = service_reference
    if essential_service_access is not None:
        payload["essential_service_access"] = essential_service_access
    return payload


@app.post("/api/territories/{territory_type}/{territory_id}/themes/comparison")
def theme_comparison(
    territory_type: Literal["commune", "epci", "departement", "region"],
    request: ThemeComparisonRequest,
    territory_id: str = Path(min_length=1, max_length=32),
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Request-scoped compact comparison over a typed selected/default cohort."""
    selected = None if request.selection is None else [
        (item.territory_type, item.territory_id) for item in request.selection]
    with repository.connections.connection() as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            return _theme_comparison_snapshot(conn, territory_type, territory_id,
                                              request.theme_id, selected)


@app.post("/api/territories/{territory_type}/{territory_id}/themes/{theme_id}/comparison")
def theme_comparison_only(
    territory_type: Literal["commune", "epci", "departement", "region"],
    theme_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,63}$"),
    territory_id: str = Path(min_length=1, max_length=32),
    request: ThemeComparisonRequest = ...,
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Return only scoped comparison statistics, without focal fact payloads."""
    if request.theme_id != theme_id:
        raise HTTPException(422, "Body theme_id must match the comparison route")
    selected = None if request.selection is None else [
        (item.territory_type, item.territory_id) for item in request.selection]
    with repository.connections.connection() as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            result = _theme_comparison_snapshot(
                conn, territory_type, territory_id, theme_id, selected)
            response = {key: result[key] for key in (
                "contract", "complete_theme", "theme_id", "content_version",
                "reference_content_version", "selection", "scope", "results",
                "profile_content_version", "profile_comparisons", "reading_content_version", "reading_cloud",
            )}
            response["results"] = [_comparison_result_without_focal_value(row)
                                   for row in response["results"]]
            response["profile_comparisons"] = [
                _comparison_result_without_focal_value(row)
                for row in response["profile_comparisons"]]
            if theme_id == "mobilite":
                if selected is None:
                    try:
                        building = repository.read_building_initial(
                            territory_type, territory_id,
                            "densite" if territory_type == "commune" else None,
                            connection=conn)
                    except HTTPException as exc:
                        if exc.status_code != 503 or exc.detail != "No building-access dataset has been published":
                            raise
                    else:
                        response["building_access"] = {
                            "scope": building["scope"],
                            "ramp": building["peer_ramp"],
                            "distribution": building["peer_distribution"],
                        }
                elif not selected:
                    response["building_access"] = {
                        "scope": {"kind": "custom", "member_count": 0},
                        "ramp": None, "distribution": None,
                    }
                else:
                    building = repository.read_building(
                        territory_type, territory_id, tuple(selected), connection=conn)
                    try:
                        member_ids = resolve_commune_members(
                            building["reference"], tuple(selected),
                            max_members=len(building["reference"]))
                        ramp = weighted_peer_ramp(
                            building["ramp_rows"], member_ids,
                            max_members=len(building["reference"]))
                        distribution = pooled_peer_distribution(
                            building["grid_rows"], member_ids,
                            max_members=len(building["reference"]))
                    except ComparisonInputError as exc:
                        raise HTTPException(503, "Incomplete building-access publication") from exc
                    response["building_access"] = {
                        "scope": {"kind": "custom", "member_count": len(member_ids)},
                        "ramp": ramp, "distribution": distribution,
                    }
            return response


def _comparison_result_without_focal_value(result):
    """Serialize a dedicated comparison result without repeating a focal fact."""
    return {key: value for key, value in result.items() if key != "focal_value"}


def _series_comparison_snapshot(conn, territory_type, territory_id, indicator_id, selection):
    marker = conn.execute(
        """SELECT s.content_version,s.reference_content_version,t.content_version
           FROM table_publication s LEFT JOIN table_publication t
             ON t.table_name='territory_reference'
           WHERE s.table_name='ordered_series'"""
    ).fetchone()
    if not marker or not marker[0] or not marker[1] or marker[1] != marker[2]:
        raise HTTPException(503, "Series publication is unavailable or incompatible")
    descriptor = conn.execute(
        """SELECT comparison_point,label,unit,direction,allowed_levels,descriptor_version,
                  axis_values,completeness,source_id,vintage_id
           FROM series_descriptor WHERE indicator_id=%s""", (indicator_id,)
    ).fetchone()
    if not descriptor:
        raise HTTPException(404, "Series descriptor is unavailable")
    point, label, unit, direction, levels, version = descriptor[:6]
    if territory_type not in levels:
        raise HTTPException(422, "Series is not declared for this territory level")
    target = conn.execute(
        "SELECT territory_type FROM territory_reference WHERE territory_id=%s",
        (territory_id,),
    ).fetchone()
    if not target:
        raise HTTPException(404, "Focal territory not found")
    if target[0] != territory_type:
        raise HTTPException(422, "Focal territory type does not match route")
    if not point or direction not in ("high", "low"):
        cohort_type, members, scope = _comparison_cohort(conn, territory_type, territory_id, selection)
        return {"contract": "indicator-comparison-v1", "complete_theme": False,
            "indicator_id": indicator_id, "shape": "series",
            "content_version": marker[0], "reference_content_version": marker[2],
            "selection": None if selection is None else [
                {"territory_type": level, "territory_id": code} for level, code in selection],
            "scope": {**scope, "member_count": len(members)} if scope else None,
            "result": {"indicator_id": indicator_id, "label": label, "facet": None,
                "source_facet": None,
                "unit": unit, "direction": direction, "descriptor_version": version,
                "status": "unavailable", "reason": "unsupported_comparison_contract",
                "selected_member_count": len(members), "eligible_count": 0,
                "median": None, "rank": None, "comparison_sources": []}}
    if point not in descriptor[6]:
        raise HTTPException(503, "Series comparison point is not a declared axis")
    cohort_type, members, scope = _comparison_cohort(conn, territory_type, territory_id, selection)
    if cohort_type not in levels:
        raise HTTPException(422, "Series comparison is not declared for this cohort level")
    read_ids = list(dict.fromkeys([*members, territory_id]))
    rows = conn.execute(
        """SELECT s.territory_id,s.value,s.status,
                  json_build_object('source_id',s.source_id,'vintage_id',s.vintage_id,
                    'name',d.name,'version',v.version,'reference_date',v.reference_date,
                    'publication_date',v.publication_date)
           FROM ordered_series s JOIN source_dataset d USING(source_id)
           JOIN source_vintage v USING(source_id,vintage_id)
           WHERE s.indicator_id=%s AND s.axis_value=%s AND s.territory_type=%s
             AND s.territory_id=ANY(%s)
           ORDER BY s.territory_id""",
        (indicator_id, point, cohort_type, read_ids),
    ).fetchall()
    values = [(row[0], float(row[1])) for row in rows
              if row[0] in members and row[2] == "measured" and row[1] is not None]
    focal_row = next((row for row in rows if row[0] == territory_id), None)
    focal_value = (float(focal_row[1]) if focal_row and focal_row[2] == "measured"
                   and focal_row[1] is not None else None)
    better = (sum(value > focal_value if direction == "high" else value < focal_value
                  for _, value in values) if focal_value is not None else None)
    ties = sum(value == focal_value for _, value in values) if focal_value is not None else None
    enough = len(values) >= 2
    sources, seen = [], set()
    for row in rows:
        if row[0] not in members:
            continue
        source = row[3]
        key = (source["source_id"], source["vintage_id"])
        if key not in seen:
            seen.add(key)
            sources.append(source)
    result = {"indicator_id": indicator_id, "label": label, "facet": point,
        "source_facet": point,
        "unit": unit, "direction": direction, "descriptor_version": version,
        "statistic": "median", "status": "available" if enough else "unavailable",
        "reason": None if enough else (
            "fewer_than_two_comparable_values" if values else "no_selected_comparable_values"),
        "selected_member_count": len(members), "eligible_count": len(values),
        "focal_value": focal_value, "focal_in_selection": territory_id in members,
        "median": median([value for _, value in values]) if enough else None,
        "rank": better + 1 if enough and better is not None and territory_id in members else None,
        "rank_size": len(values) if enough and better is not None and territory_id in members else None,
        "rank_ties": ties if enough and better is not None and territory_id in members else None,
        "comparison_sources": sources}
    return {"contract": "indicator-comparison-v1", "complete_theme": False,
        "indicator_id": indicator_id, "shape": "series", "content_version": marker[0],
        "reference_content_version": marker[2],
        "selection": None if selection is None else [
            {"territory_type": level, "territory_id": code} for level, code in selection],
        "scope": {**scope, "member_count": len(members)} if scope else None,
        "result": result}


@app.post("/api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}/comparison")
def indicator_comparison_only(
    territory_type: Literal["commune", "epci", "departement", "region"],
    territory_id: str = Path(min_length=1, max_length=32),
    indicator_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,95}$"),
    request: IndicatorComparisonRequest | None = None,
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Compare one descriptor identity, independent of its theme or shape."""
    selection = None if request is None or request.selection is None else [
        (item.territory_type, item.territory_id) for item in request.selection]
    with repository.connections.connection() as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            if conn.execute("SELECT to_regclass('bpe_profile_evidence_descriptor')").fetchone()[0]:
                bpe_descriptor=conn.execute("SELECT indicator_id FROM bpe_profile_evidence_descriptor WHERE singleton").fetchone()
                if bpe_descriptor and bpe_descriptor[0] == indicator_id:
                    result=_bpe_profile_comparison(conn,territory_type,territory_id,selection)
                    return {"contract":"indicator-comparison-v1","complete_theme":False,
                        "indicator_id":indicator_id,"shape":"bpe_profile_evidence",
                        "content_version":result["content_version"],
                        "reference_content_version":result["reference_content_version"],
                        "selection":result["selection"],"scope":result["scope"],
                        "results":result["results"]}
            active_owned=_owned_series_route(conn,indicator_id)
            if active_owned:
                if active_owned[2]:
                    return _owned_reference_comparison_result(conn,active_owned,territory_type,
                        territory_id,indicator_id,selection)
                return _owned_series_comparison_result(conn,active_owned,territory_type,
                    territory_id,indicator_id,selection)
            collections = collection_descriptors(conn,indicator_id=indicator_id)
            if collections:
                focal = conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",(territory_id,)).fetchone()
                if not focal:
                    raise HTTPException(404,"Focal territory not found")
                if focal[0]!=territory_type:
                    raise HTTPException(422,"Focal territory type does not match route")
                cohort_type,members,scope = _comparison_cohort(conn,territory_type,territory_id,selection)
                result = collection_comparison(conn,collections[0],territory_type,territory_id,cohort_type,members)
                return {"contract":"indicator-comparison-v1","complete_theme":False,"indicator_id":indicator_id,
                    "theme_id":collections[0]["theme_id"],"shape":"observed_collection",
                    "content_version":result["content_version"],"reference_content_version":result["reference_content_version"],
                    "selection":None if selection is None else [{"territory_type":level,"territory_id":code} for level,code in selection],
                    "scope":{**scope,"member_count":len(members)} if scope else None,"result":result}
            shapes = []
            for table, shape in (("scalar_descriptor", "scalar"),
                                 ("profile_descriptor", "profile"),
                                 ("series_descriptor", "series")):
                if conn.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0]:
                    descriptor = conn.execute(
                        f"SELECT 1 FROM {table} WHERE indicator_id=%s", (indicator_id,)
                    ).fetchone()
                    if descriptor:
                        shapes.append((table, shape))
            if len(shapes) > 1:
                raise HTTPException(503, "Indicator has ambiguous published storage shapes")
            if not shapes:
                raise HTTPException(404, "Indicator descriptor is unavailable")
            shape = shapes[0][1]
            focal = conn.execute(
                "SELECT territory_type FROM territory_reference WHERE territory_id=%s",
                (territory_id,),
            ).fetchone()
            if not focal:
                raise HTTPException(404, "Focal territory not found")
            if focal[0] != territory_type:
                raise HTTPException(422, "Focal territory type does not match route")
            if shape == "series":
                comparison = _series_comparison_snapshot(conn, territory_type, territory_id,
                                                         indicator_id, selection)
                comparison["result"] = _comparison_result_without_focal_value(comparison["result"])
                return comparison
            if shape == "scalar":
                descriptor = conn.execute(
                    "SELECT theme_id,allowed_levels FROM scalar_descriptor WHERE indicator_id=%s",
                    (indicator_id,),
                ).fetchone()
            else:
                descriptor = conn.execute(
                    "SELECT theme_id,allowed_levels FROM profile_descriptor WHERE indicator_id=%s",
                    (indicator_id,),
                ).fetchone()
            if not descriptor:
                raise HTTPException(404, "Indicator descriptor is unavailable")
            if territory_type not in descriptor[1]:
                raise HTTPException(422, "Indicator is not declared for this territory level")
            if not descriptor[0]:
                raise HTTPException(503, "Indicator theme metadata is unavailable")
            comparison = _theme_comparison_snapshot(conn, territory_type, territory_id,
                descriptor[0], selection, indicator_id=indicator_id)
            result_rows = comparison["results"] if shape == "scalar" else comparison["profile_comparisons"]
            if len(result_rows) != 1:
                raise HTTPException(503, "Indicator comparison facet is unavailable or ambiguous")
            result = dict(result_rows[0])
            if shape == "profile":
                source_facet = result.pop("facet", None)
                result.pop("indicator", None)
                result["indicator_id"] = indicator_id
                result["source_facet"] = source_facet
                if isinstance(source_facet, str):
                    result["source_facet_indicator_id"] = source_facet
            else:
                result["source_facet"] = indicator_id
            result = _comparison_result_without_focal_value(result)
            return {"contract": "indicator-comparison-v1", "complete_theme": False,
                "indicator_id": indicator_id, "shape": shape,
                "content_version": comparison["content_version"],
                "scalar_content_version": (result.get("required_scalar_version")
                    if shape == "profile" and result.get("source_facet_indicator_id") else None),
                "profile_content_version": comparison["profile_content_version"],
                "reference_content_version": comparison["reference_content_version"],
                "selection": comparison["selection"], "scope": comparison["scope"],
                "result": result}


def _focal_series_snapshot(conn, territory_type, territory_id, indicator_id):
    marker = conn.execute(
        """SELECT s.content_version,s.reference_content_version,t.content_version
           FROM table_publication s LEFT JOIN table_publication t ON t.table_name='territory_reference'
           WHERE s.table_name='ordered_series'"""
    ).fetchone()
    if not marker or not marker[0] or not marker[1] or not marker[2] or marker[1] != marker[2]:
        raise HTTPException(503, "Series publication is unavailable or incompatible")
    descriptor = conn.execute(
        """SELECT axis_kind,axis_values,completeness,comparison_point,label,unit,direction,
                  source_id,vintage_id,descriptor_version,allowed_levels
           FROM series_descriptor WHERE indicator_id=%s""", (indicator_id,)
    ).fetchone()
    if not descriptor:
        raise HTTPException(404, "Series descriptor is unavailable")
    if territory_type not in descriptor[10]:
        raise HTTPException(422, "Series is not declared for this territory level")
    territory = conn.execute(
        "SELECT territory_id,name FROM territory_reference WHERE territory_id=%s AND territory_type=%s",
        (territory_id, territory_type),
    ).fetchone()
    if not territory:
        raise HTTPException(404, "Territory not found")
    rows = conn.execute(
        """SELECT s.axis_value,s.observation_period,s.value,s.status,s.source_id,s.vintage_id,
                  v.version,v.reference_date,v.publication_date
           FROM ordered_series s JOIN source_vintage v USING(source_id,vintage_id)
           WHERE s.indicator_id=%s AND s.territory_id=%s AND s.territory_type=%s
           ORDER BY array_position(%s::text[],s.axis_value)""",
        (indicator_id, territory_id, territory_type, list(descriptor[1])),
    ).fetchall()
    by_axis = {row[0]: row for row in rows}
    if len(by_axis) != len(rows) or any(axis not in descriptor[1] for axis in by_axis):
        raise HTTPException(503, "Invalid published series axis")
    if descriptor[2] == "dense_complete" and set(by_axis) != set(descriptor[1]):
        raise HTTPException(503, "Incomplete published series")
    points = []
    for axis in descriptor[1]:
        row = by_axis.get(axis)
        points.append({"axis": axis, "status": row[3] if row else "missing",
            "value": row[2] if row else None, "observation_period": row[1] if row else None,
            "source_id": row[4] if row else descriptor[7],
            "vintage_id": row[5] if row else descriptor[8],
            "source_version": row[6] if row else None,
            "source_reference_date": row[7] if row else None,
            "source_publication_date": row[8] if row else None})
    return {"publication_id": marker[0], "territory": {"id": territory_id,
        "type": territory_type, "name": territory[1]}, "indicator_id": indicator_id,
        "axis_kind": descriptor[0], "completeness": descriptor[2], "label": descriptor[4],
        "unit": descriptor[5], "direction": descriptor[6], "descriptor_version": descriptor[9],
        "comparison_point": descriptor[3], "points": points,
        "availability": "complete" if all(p["status"] == "measured" for p in points) else "incomplete"}


@app.get("/api/territories/{territory_type}/{territory_id}/indicator-cohorts/{indicator_id}")
def scalar_indicator_cohort(
    territory_type: Literal["commune", "epci", "departement", "region"],
    territory_id: str = Path(min_length=1, max_length=32),
    indicator_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,95}$"),
    scope_level: Literal["commune", "epci", "departement", "region"] = Query(default="commune"),
    department_id: str | None = Query(default=None, min_length=1, max_length=8),
    epci_id: str | None = Query(default=None, min_length=1, max_length=16),
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Read one declared scalar's focal value and bounded, versioned peer cohort."""
    if scope_level != "commune" and (department_id is not None or epci_id is not None):
        raise HTTPException(422, "Commune filters are not valid for this cohort level")
    with repository.connections.connection() as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            marker = conn.execute(
                """SELECT scalar.content_version, scalar.reference_content_version,
                          territory.content_version, scalar.row_count FROM table_publication scalar
                   LEFT JOIN table_publication territory ON territory.table_name='territory_reference'
                   WHERE scalar.table_name='scalar_observation'""").fetchone()
            if (marker is None or not marker[0] or marker[3] < 1 or not marker[1]
                    or marker[1] != marker[2]):
                raise HTTPException(503, "Scalar publication is unavailable or incompatible")
            descriptor = conn.execute(
                """SELECT label,unit,direction,comparison_facet,allowed_levels,completeness
                   FROM scalar_descriptor WHERE indicator_id=%s""", (indicator_id,)).fetchone()
            if descriptor is None:
                raise HTTPException(404, "Declared scalar comparison is unavailable")
            if scope_level not in descriptor[4]:
                raise HTTPException(422, "Cohort level is not declared for this scalar")
            if not descriptor[3] or descriptor[3] != indicator_id:
                raise HTTPException(503, "Scalar comparison facet is not served by this cohort")
            # Validate focal identity and explicit commune filters against the published
            # reference before reading facts. A valid territory outside the requested
            # cohort is a scope error, not a missing-fact 404.
            focal = conn.execute(
                """SELECT territory_id,territory_type,department_id,epci_id
                   FROM territory_reference WHERE territory_id=%s""", (territory_id,)).fetchone()
            if focal is None:
                raise HTTPException(404, "Focal territory is unknown")
            if focal[1] != territory_type:
                raise HTTPException(422, "Focal territory type does not match the route")
            if territory_type != scope_level:
                raise HTTPException(422, "Focal territory type must match the cohort level")
            if department_id:
                exists = conn.execute("SELECT 1 FROM territory_reference WHERE territory_id=%s AND territory_type='departement'", (department_id,)).fetchone()
                if not exists:
                    raise HTTPException(422, "Unknown department scope")
            if epci_id:
                exists = conn.execute("SELECT 1 FROM territory_reference WHERE territory_id=%s AND territory_type='epci'", (epci_id,)).fetchone()
                if not exists:
                    raise HTTPException(422, "Unknown EPCI scope")
            if (department_id and focal[2] != department_id) or (epci_id and focal[3] != epci_id):
                raise HTTPException(422, "Focal territory is outside the declared cohort scope")
            # Preserve the published rank universes (compute_ranks/groups_comparaison):
            # communes with an EPCI rank only against their EPCI; communes without one
            # fall back to the regional commune group; EPCIs/departments rank regionally;
            # department ranks for communes and ranks for a region are deliberately null.
            # The URL cohort predicates stay outside this materialized ranking snapshot.
            rows = conn.execute(
                """WITH ranked AS MATERIALIZED (
                   SELECT t.territory_id,t.territory_type,t.name,t.department_id,t.epci_id,
                          o.indicator_id,o.value,o.status,o.support_count,o.denominator_count,
                          CASE WHEN t.territory_type='commune' AND t.epci_id IS NOT NULL AND o.status='measured'
                               THEN RANK() OVER (PARTITION BY t.epci_id ORDER BY
                                    CASE WHEN d.direction='high' THEN o.value END DESC NULLS LAST,
                                    CASE WHEN d.direction='low' THEN o.value END ASC NULLS LAST) END AS rang_epci,
                          CASE WHEN t.territory_type='commune' AND t.epci_id IS NOT NULL AND o.status='measured'
                               THEN COUNT(o.value) OVER (PARTITION BY t.epci_id) END AS rang_epci_n,
                          NULL::bigint AS rang_dep,
                          NULL::bigint AS rang_dep_n,
                          CASE WHEN o.status='measured' AND
                                    (t.territory_type IN ('epci','departement') OR
                                     (t.territory_type='commune' AND t.epci_id IS NULL))
                               THEN RANK() OVER (PARTITION BY t.territory_type ORDER BY
                                    CASE WHEN d.direction='high' AND
                                      (t.territory_type <> 'commune' OR t.epci_id IS NULL) THEN o.value END DESC NULLS LAST,
                                    CASE WHEN d.direction='low' AND
                                      (t.territory_type <> 'commune' OR t.epci_id IS NULL) THEN o.value END ASC NULLS LAST) END AS rang_reg,
                          CASE WHEN o.status='measured' AND
                                    (t.territory_type IN ('epci','departement') OR
                                     (t.territory_type='commune' AND t.epci_id IS NULL))
                               THEN COUNT(CASE WHEN t.territory_type <> 'commune' OR t.epci_id IS NULL
                                               THEN o.value END) OVER (PARTITION BY t.territory_type) END AS rang_reg_n,
                          d.direction
                   FROM territory_reference t
                   CROSS JOIN scalar_descriptor d
                   LEFT JOIN scalar_observation o
                     ON o.territory_id=t.territory_id AND o.territory_type=t.territory_type
                    AND o.indicator_id=d.indicator_id
                   WHERE d.indicator_id=%s AND t.territory_type=%s
                   ), cohort AS (
                   SELECT territory_id,name,value,status,support_count,denominator_count,
                          rang_epci,rang_epci_n,rang_dep,rang_dep_n,rang_reg,rang_reg_n,
                          COALESCE((SELECT json_agg(json_build_object('source_id',os.source_id,
                            'name',sd.name,'vintage_id',os.vintage_id,'version',sv.version,
                            'reference_date',sv.reference_date,'publication_date',sv.publication_date)
                            ORDER BY os.source_id,os.vintage_id)
                           FROM scalar_observation_source os JOIN source_dataset sd USING(source_id)
                            JOIN source_vintage sv USING(source_id,vintage_id)
                           WHERE os.indicator_id=cohort_source.indicator_id
                             AND os.territory_id=cohort_source.territory_id),'[]'::json) AS sources
                   FROM ranked cohort_source
                   )
                   SELECT territory_id,name,value,status,support_count,denominator_count,sources,
                          rang_epci,rang_epci_n,rang_dep,rang_dep_n,rang_reg,rang_reg_n
                   FROM cohort
                   WHERE (%s::text IS NULL OR EXISTS (SELECT 1 FROM territory_reference t
                          WHERE t.territory_id=cohort.territory_id AND t.department_id=%s))
                     AND (%s::text IS NULL OR EXISTS (SELECT 1 FROM territory_reference t
                          WHERE t.territory_id=cohort.territory_id AND t.epci_id=%s))
                   ORDER BY name,territory_id LIMIT %s""",
                (indicator_id, scope_level, department_id, department_id, epci_id, epci_id,
                 MAX_TERRITORY_SEARCH_SCAN + 1)).fetchall()
            if len(rows) > MAX_TERRITORY_SEARCH_SCAN:
                raise HTTPException(503, "Declared scalar cohort exceeds the bounded read")
            focal_row = next((row for row in rows if row[0] == territory_id), None)
            if focal_row is None:
                raise HTTPException(404, "Focal scalar observation is unavailable in this cohort")
            if focal_row[3] is not None and not focal_row[6]:
                raise HTTPException(503, "Focal scalar provenance is unavailable")
            if any(row[3] is not None and not row[6] for row in rows):
                raise HTTPException(503, "Peer scalar provenance is unavailable")
    return {"indicator_id": indicator_id, "territory_type": scope_level,
            "label": descriptor[0], "unit": descriptor[1], "direction": descriptor[2],
            "comparison_facet": descriptor[3], "completeness": descriptor[5],
            "content_version": marker[0],
            "observations": [{"territory_id": tid,"name": name,"value": value,
                              "status": status or "not_published", "support_count": support,
                              "denominator_count": denominator,"sources": sources,
                              "rang_epci": rang_epci,"rang_epci_n": rang_epci_n,
                              "rang_dep": rang_dep,"rang_dep_n": rang_dep_n,
                              "rang_reg": rang_reg,"rang_reg_n": rang_reg_n}
                             for tid,name,value,status,support,denominator,sources,
                                 rang_epci,rang_epci_n,rang_dep,rang_dep_n,rang_reg,rang_reg_n in rows]}


@app.get("/api/territories/{territory_type}/{territory_id}/series/{indicator_id}")
def annual_series(territory_type: Literal["commune", "epci", "departement", "region"],
                  territory_id: str = Path(min_length=1, max_length=32),
                  indicator_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,95}$"),
                  scope_level: Literal["commune", "epci", "departement", "region"] = Query(default="commune"),
                  department_id: str | None = Query(default=None, min_length=1, max_length=8),
                  epci_id: str | None = Query(default=None, min_length=1, max_length=16),
                  repository: ReadRepository = Depends(get_repository)) -> dict:
    return repository.read_series(territory_type, territory_id, indicator_id, scope_level,
                                  department_id, epci_id)


@app.get("/api/series-datasets/{dataset_id}/territories/{territory_type}/{territory_id}/{indicator_id}")
def owned_series(dataset_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,95}$"),
                 territory_type: Literal["commune","epci","departement","region"] = Path(),
                 territory_id: str = Path(min_length=1,max_length=32),
                 indicator_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,95}$"),
                 scope_level: Literal["commune","epci","departement","region"] = Query(default="commune"),
                 department_id: str | None = Query(default=None,min_length=1,max_length=8),
                 epci_id: str | None = Query(default=None,min_length=1,max_length=16),
                 comparison_detail: str | None = Query(default=None,min_length=1,max_length=32),
                 repository: ReadRepository = Depends(get_repository)) -> dict:
    return repository.read_owned_series(dataset_id,territory_type,territory_id,indicator_id,
        scope_level,department_id,epci_id,comparison_detail)


@app.get("/api/territories/commune/{territory_id}/essential-services", response_model=ComparisonResponse)
def essential_services(
    territory_id: str,
    comparison: Literal["densite", "epci", "bretagne"] = Query(default="densite"),
    repository: ReadRepository = Depends(get_repository),
) -> ComparisonResponse:
    return compare(repository.read(territory_id, comparison))


@app.get("/api/territories/epci/{territory_id}/essential-services", response_model=ComparisonResponse)
def epci_essential_services(territory_id: str, repository: ReadRepository = Depends(get_repository)) -> ComparisonResponse:
    return compare(repository.read_level("epci", territory_id))


@app.get("/api/territories/departement/{territory_id}/essential-services", response_model=ComparisonResponse)
def department_essential_services(territory_id: str, repository: ReadRepository = Depends(get_repository)) -> ComparisonResponse:
    return compare(repository.read_level("departement", territory_id))


@app.get("/api/territories/region/{territory_id}/essential-services", response_model=ComparisonResponse)
def region_essential_services(territory_id: str, repository: ReadRepository = Depends(get_repository)) -> ComparisonResponse:
    return compare(repository.read_level("region", territory_id))
