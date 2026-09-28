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

from api.building_comparison import (
    ComparisonInputError, pooled_peer_distribution, resolve_commune_members,
    weighted_peer_ramp,
)


class Rank(BaseModel):
    position: int
    size: int


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


class ReadRepository:
    def __init__(self, connections: ConnectionPool):
        self.connections = connections

    def read(self, territory_id: str, comparison: str) -> dict:
        return self._read("commune", territory_id, comparison)

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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}")
def scalar_observation(
    territory_type: Literal["commune", "epci", "departement", "region"],
    territory_id: str = Path(min_length=1, max_length=32),
    indicator_id: str = Path(pattern=r"^[a-z][a-z0-9_]{0,95}$"),
    repository: ReadRepository = Depends(get_repository),
) -> dict:
    """Read one declared scalar and its lineage/version from one DB snapshot."""
    with repository.connections.connection() as conn:
        with conn.transaction():
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            marker = conn.execute(
                """SELECT scalar.content_version, scalar.row_count,
                          scalar.reference_content_version,
                          territory.content_version AS territory_version,
                          territory.row_count AS territory_row_count,
                          (SELECT count(*) FROM scalar_observation) AS actual_scalar_rows,
                          (SELECT count(*) FROM territory_reference) AS actual_territories
                   FROM table_publication scalar
                   LEFT JOIN table_publication territory
                     ON territory.table_name = 'territory_reference'
                   WHERE scalar.table_name = 'scalar_observation'"""
            ).fetchone()
            if marker is None:
                raise HTTPException(503, "Scalar publication is unavailable")
            if (marker[2] is None or marker[3] is None or marker[2] != marker[3]
                    or marker[1] != marker[5] or marker[4] != marker[6]):
                raise HTTPException(503, "Scalar publication is stale or incompatible")
            cursor = conn.execute(
                """SELECT o.indicator_id, o.territory_id, o.territory_type,
                          o.value, o.status, o.support_count, o.denominator_count,
                          d.label, d.unit, d.direction, d.comparison_facet,
                          o.source_id, s.name AS source_name, v.version,
                          v.reference_date, v.publication_date, p.content_version,
                          (SELECT json_agg(json_build_object('source_id', os.source_id,
                              'source_name', sd.name, 'vintage_id', os.vintage_id,
                              'version', sv.version, 'reference_date', sv.reference_date,
                              'publication_date', sv.publication_date)
                           ORDER BY os.source_id, os.vintage_id)
                           FROM scalar_observation_source os
                           JOIN source_dataset sd USING (source_id)
                           JOIN source_vintage sv USING (source_id, vintage_id)
                           WHERE os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id) AS provenance
                   FROM scalar_observation o
                   JOIN scalar_descriptor d USING (indicator_id)
                   JOIN source_dataset s ON s.source_id = o.source_id
                   JOIN source_vintage v ON v.source_id = o.source_id AND v.vintage_id = o.vintage_id
                   JOIN table_publication p ON p.table_name = 'scalar_observation'
                   WHERE o.indicator_id = %s AND o.territory_id = %s
                     AND o.territory_type = %s AND o.territory_type = ANY(d.allowed_levels)""",
                (indicator_id, territory_id, territory_type),
            )
            row = cursor.fetchone()
            if row is None:
                raise HTTPException(404, "Declared scalar observation is unavailable")
            return dict(zip((column.name for column in cursor.description), row))


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
