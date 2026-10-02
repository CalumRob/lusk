"""Bounded, read-only comparisons over R-published access facts."""

from contextlib import asynccontextmanager
from functools import lru_cache
import hashlib
import json
import os
import unicodedata
from statistics import median
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Path, Query
from pydantic import BaseModel, Field
from psycopg_pool import ConnectionPool
from api.profile_reads import focal_profiles

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

    def read(self, territory_id: str, comparison: str) -> dict:
        return self._read("commune", territory_id, comparison)

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

    def read_level(self, territory_type: str, territory_id: str) -> dict:
        return self._read(territory_type, territory_id, None)

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
                              comparison_mode: str | None = None) -> dict:
        """Read canonical focal facts and same-level published default peers."""
        with self.connections.connection() as connection:
            with connection.transaction():
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
                if ttype == "region":
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
                ramp_rows = connection.execute(
                    """SELECT territory_id, territory_type, availability, mode, quantile_index,
                              quantile, accessible_types, total_buildings, source_id, source_version
                       FROM building_ramp WHERE territory_type = %s AND territory_id = ANY(%s)""",
                    (ttype, list(focal_and_peers))
                ).fetchall()
                grid_rows = connection.execute(
                    """SELECT territory_id, territory_type, availability, mode, breadth_bucket,
                              depth_bucket, building_count, total_buildings, source_id, source_version
                       FROM building_grid WHERE territory_type = %s AND territory_id = ANY(%s)""",
                    (ttype, list(focal_and_peers))
                ).fetchall()
                ramp_data = [dict(zip(("territoire", "type", "availability", "mode", "quantile_index",
                                      "quantile", "accessible_types", "total_buildings", "source_id", "version"), row))
                             for row in ramp_rows]
                grid_data = [dict(zip(("territoire", "type", "availability", "mode", "breadth_bucket",
                                      "depth_bucket", "building_count", "total_buildings", "source_id", "version"), row))
                             for row in grid_rows]
                try:
                    peer_ramp = (weighted_peer_ramp(ramp_data, members, max_members=len(reference),
                                                    member_type=peer_type) if members else None)
                    peer_distribution = (pooled_peer_distribution(grid_data, members,
                                                                 max_members=len(reference),
                                                                 member_type=peer_type) if members else None)
                except ComparisonInputError as exc:
                    raise HTTPException(503, "Incomplete building-access publication") from exc
                target_ramp = [r for r in ramp_data if r["territoire"] == tid and r["type"] == ttype]
                target_grid = [r for r in grid_data if r["territoire"] == tid and r["type"] == ttype]
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
                    "scope": None if ttype == "region" else {
                        "kind": kind,
                        "comparison_mode": comparison_mode if ttype == "commune" else "bretagne"},
                    "ramp": None if availability == "absent" else [{"mode": r["mode"], "quantile_index": r["quantile_index"],
                              **{k: r[k] for k in ("quantile", "accessible_types", "total_buildings", "source_id")},
                              "source_version": r["version"]} for r in focal_ramp],
                    "peer_ramp": peer_ramp,
                    "distribution": None if availability == "absent" else [{**{k: r[k] for k in ("breadth_bucket", "depth_bucket", "building_count", "total_buildings", "source_id")},
                                      "source_version": r["version"]} for r in focal_grid],
                    "peer_distribution": peer_distribution,
                }

    def read_building(self, territory_type: str, territory_id: str,
                      selected: tuple[tuple[str, str], ...]) -> dict:
        # The reference, publication marker and selected rows share one MVCC view.
        with self.connections.connection() as connection:
            with connection.transaction():
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

    def _read(self, territory_type: str, territory_id: str, comparison: str | None) -> dict:
        # A repeatable-read snapshot pins metadata and rows to one committed refresh.
        with self.connections.connection() as connection:
            with connection.transaction():
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
                if territory_type == "epci":
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
                    scalar_rows = connection.execute(
                        f"""SELECT o.indicator_id, o.territory_id, o.value, o.status,
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
                             AND o.territory_type = %s AND t.{condition} = %s
                             AND o.territory_type = ANY(d.allowed_levels)
                           ORDER BY o.indicator_id, o.territory_id, sd.source_id, sv.vintage_id""",
                        (territory_type, value),
                    ).fetchall()
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
                        "comparison": territory_type != "region", "rows": converted}
                # `condition` is selected exclusively from the three literals above; all
                # externally supplied values are parameters, never SQL identifiers.
                rows = connection.execute(
                    f"""SELECT a.territory_id, a.service, a.mode, a.share, a.indicator_label,
                               a.effective_direction, a.source_id, a.source_name, a.source_version,
                               a.reference_date, a.source_publication_date
                        FROM essential_service_access a
                         JOIN territory_reference t ON t.territory_id = a.territory_id
                          WHERE t.territory_type = %s
                           AND t.{condition} = %s""",
                    (territory_type, value),
                ).fetchall()
                return {
                    "publication_id": publication,
                    "territory": {"id": code, "name": name, "type": territory_type},
                    "scope": {"kind": kind, **({"label": label} if label is not None else {})} if kind else None,
                    "comparison": territory_type != "region",
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
    comparison: Literal["bretagne", "densite", "epci"] = Query(default="bretagne"),
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
            direction = focal["direction"]
            if direction not in ("high", "low") or any(
                row["direction"] != direction for row in observations.values()
            ):
                raise HTTPException(503, "Inconsistent published comparison direction")
            values = [row["share"] for row in observations.values() if row["share"] is not None]
            value = focal["share"]
            rank = None if value is None or not has_comparison else Rank(
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
                           for tid in modes[first].keys() & modes[second].keys()
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
        scope={**data["scope"], "member_count": len(members)} if data["scope"] else None,
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
    if details:
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
        profile_metadata = {**profile, "label": descriptor[1],
                            "scalar_descriptor_version": descriptor[6]}
        output.append(summary(profile_metadata, profile["comparison_scalar"], descriptor[2], descriptor[3], normalized))
    for profile in details:
        point = profile.get("comparison_point")
        if not point or point.get("direction") not in ("high", "low"):
            raise HTTPException(503, "Profile detail comparison point is invalid")
        detail, sex = point["detail"], point.get("sex")
        cell = next((c for c in profile["cells"] if c["detail"] == detail and c.get("sex") == sex), None)
        if cell is None:
            raise HTTPException(503, "Profile comparison cell is unavailable")
        normalized = [(r[1], r[2], r[3], r[4]) for r in detail_by_profile.get(profile["indicator"], [])]
        unit = point.get("unit", cell.get("unit", profile["unit"]))
        output.append(summary(profile, {"detail": detail, "sex": sex}, unit,
                              point["direction"], normalized))
    return output


def _theme_comparison_snapshot(conn, territory_type, territory_id, theme_id, selection,
                               *, profiles=None, profile_version=None):
    """Read scalar and profile comparisons from the caller's MVCC snapshot."""
    scalar_descriptors = conn.execute(
        """SELECT indicator_id,label,unit,direction,comparison_facet,allowed_levels,descriptor_version
           FROM scalar_descriptor WHERE theme_id=%s ORDER BY indicator_id""", (theme_id,)
    ).fetchall()
    if profiles is None:
        profiles, profile_version = focal_profiles(conn, territory_type, territory_id, theme_id=theme_id)
    if not scalar_descriptors and not profiles:
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
               WHERE d.theme_id=%s AND ((o.territory_type=%s AND o.territory_id=ANY(%s))
                 OR (o.territory_id=%s AND o.territory_type=%s))""",
            (theme_id, cohort_type, list(members), territory_id, territory_type),
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
    return {"contract": "theme-comparison-v1", "complete_theme": False, "theme_id": theme_id,
        "content_version": scalar_marker[0] if scalar_marker else None,
        "reference_content_version": reference[0],
        "selection": None if selection is None else [
            {"territory_type": level, "territory_id": code} for level, code in selection],
        "scope": {**scope, "member_count": len(members)} if scope else None,
        "results": results, "profile_content_version": profile_version,
        "profile_comparisons": profile_results}


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
            for table, shape in (("scalar_descriptor", "scalar"),
                                 ("profile_descriptor", "profile"),
                                 ("series_descriptor", "series")):
                if conn.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0] and conn.execute(
                        f"SELECT 1 FROM {table} WHERE indicator_id=%s", (indicator_id,)).fetchone():
                    shape_rows.append((table, shape))
            owned_table = conn.execute("SELECT to_regclass('series_dataset_descriptor')").fetchone()[0]
            owned = (conn.execute(
                "SELECT dataset_id FROM series_dataset_descriptor WHERE indicator_id=%s LIMIT 1",
                (indicator_id,)).fetchone() if owned_table else None)
            if len(shape_rows) > 1 or (owned and shape_rows):
                raise HTTPException(503, "Indicator has ambiguous published storage shapes")
            shape = shape_rows[0][1] if shape_rows else None
            if owned:
                # Publication ownership alone is insufficient to route a read;
                # the publisher must declare the active serving route.
                raise HTTPException(503, "Owned-series active publication route is not declared")
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


@app.get("/api/territories/{territory_type}/{territory_id}/themes/{theme_id}/facts")
def theme_facts(
    territory_type: Literal["commune", "epci", "departement", "region"],
    territory_id: str = Path(min_length=1, max_length=32),
    theme_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,63}$"),
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Compact published focal facts/profiles.

    This endpoint deliberately reports its coverage per published shape; a
    scalar/profile subset must never be mistaken for a complete theme model.
    """
    with repository.connections.connection() as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
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
            if not rows and not profiles:
                raise HTTPException(404, "No published facts for this theme and territory")
            comparison = _theme_comparison_snapshot(conn, territory_type, territory_id, theme_id, None,
                profiles=profiles, profile_version=profile_version)
    names=("indicator_id","label","unit","direction","comparison_facet","descriptor_version",
           "value","status","support_count","denominator_count","sources")
    payload = {"contract":"theme-facts-v1","complete_theme":False,"theme_id":theme_id,
       "territory":{"territory_id":territory[0],"name":territory[1],"territory_type":territory[2]},
       "content_version":marker[0] if marker else None,
       "reference_content_version":comparison["reference_content_version"],
       "profile_content_version":profile_version,"profiles":profiles,
       "facts":[dict(zip(names,row)) for row in rows],
       "default_comparison":{"scope":comparison["scope"],"results":comparison["results"],
                             "profile_comparisons":comparison["profile_comparisons"]}}
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
            return {key: result[key] for key in (
                "contract", "complete_theme", "theme_id", "content_version",
                "reference_content_version", "selection", "scope", "results",
                "profile_content_version", "profile_comparisons",
            )}


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
