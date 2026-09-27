"""Bounded, read-only comparisons over R-published access facts."""

from contextlib import asynccontextmanager
from functools import lru_cache
import os
from statistics import median
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query
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
                markers = dict(connection.execute(
                    """SELECT dataset_key, publication_id FROM dataset_publication
                       WHERE dataset_key IN ('building_access', 'essential_service_access')"""
                ).fetchall())
                if ('building_access' not in markers or
                        markers['building_access'] != markers.get('essential_service_access')):
                    raise HTTPException(503, "No building-access dataset has been published")
                rows = connection.execute(
                    """SELECT territory_type, territory_id, name FROM territory_reference
                       ORDER BY territory_type, name, territory_id"""
                ).fetchall()
                return {"publication_id": markers['building_access'],
                        "territories": [dict(zip(("type", "id", "name"), row)) for row in rows]}

    def read_building(self, territory_type: str, territory_id: str,
                      selected: tuple[tuple[str, str], ...]) -> dict:
        # The reference, publication marker and selected rows share one MVCC view.
        with self.connections.connection() as connection:
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                markers = connection.execute(
                    """SELECT dataset_key, publication_id FROM dataset_publication
                       WHERE dataset_key IN ('building_access', 'essential_service_access')"""
                ).fetchall()
                versions = dict(markers)
                if ('building_access' not in versions or
                        versions['building_access'] != versions.get('essential_service_access')):
                    raise HTTPException(503, "No building-access dataset has been published")
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
                       FROM building_ramp WHERE territory_id = ANY(%s)""",
                    (list(members),),
                ).fetchall()
                grid_rows = connection.execute(
                    """SELECT territory_id, territory_type, availability, mode,
                              breadth_bucket, depth_bucket, building_count,
                              total_buildings, source_id, source_version
                       FROM building_grid WHERE territory_id = ANY(%s)""",
                    (list(members),),
                ).fetchall()
                directions = {row[9] for row in ramp_rows}
                if len(directions) != 1 or next(iter(directions)) not in ("high", "low"):
                    raise HTTPException(503, "Inconsistent published ramp direction")
                return {
                    "publication_id": versions['building_access'],
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
                    """SELECT publication_id, bretagne_kind, bretagne_label
                       FROM dataset_publication WHERE dataset_key = 'essential_service_access'"""
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
