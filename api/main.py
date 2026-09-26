"""Bounded, read-only comparisons over R-published access facts."""

from contextlib import asynccontextmanager
from functools import lru_cache
import os
from statistics import median
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel
from psycopg_pool import ConnectionPool


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
    scope: dict[str, str | int]
    services: list[ServiceComparison]


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
        # A single repeatable-read transaction pins both the active version and its rows.
        # Successive HTTP requests are free to observe different publications.
        with self.connections.connection() as connection:
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                active = connection.execute(
                    "SELECT publication_id FROM active_publication WHERE singleton = TRUE"
                ).fetchone()
                if not active:
                    raise HTTPException(503, "No access dataset has been published")
                publication = active[0]
                target = connection.execute(
                    """SELECT territory_id, name, territory_type, epci_id,
                              density_class_code, density_class_label
                       FROM territory_reference
                       WHERE publication_id = %s AND territory_id = %s AND territory_type = 'commune'""",
                    (publication, territory_id),
                ).fetchone()
                if target is None:
                    raise HTTPException(404, "Commune not found")
                code, name, _, epci, density, density_label = target
                if comparison == "densite":
                    if not density or not density_label:
                        raise HTTPException(422, "Density comparison unavailable for this commune")
                    condition, value = "density_class_code", density
                    kind, label = "communes-densite", density_label
                elif comparison == "epci":
                    if not epci:
                        raise HTTPException(422, "EPCI comparison unavailable for this commune")
                    parent = connection.execute(
                        """SELECT name FROM territory_reference
                           WHERE publication_id = %s AND territory_id = %s AND territory_type = 'epci'""",
                        (publication, epci),
                    ).fetchone()
                    if not parent:
                        raise HTTPException(503, "Published EPCI reference is incomplete")
                    condition, value = "epci_id", epci
                    kind, label = "communes-epci", f"communes de {parent[0]}"
                else:
                    condition, value = "territory_type", "commune"
                    kind, label = "communes-bretagne", "communes bretonnes"
                # `condition` is selected exclusively from the three literals above; all
                # externally supplied values are parameters, never SQL identifiers.
                rows = connection.execute(
                    f"""SELECT a.territory_id, a.service, a.mode, a.share, a.indicator_label,
                               a.effective_direction, a.source_id, a.source_name, a.source_version,
                               a.reference_date, a.source_publication_date
                        FROM essential_service_access a
                        JOIN territory_reference t ON t.publication_id = a.publication_id
                          AND t.territory_id = a.territory_id
                        WHERE a.publication_id = %s AND t.territory_type = 'commune'
                          AND t.{condition} = %s""",
                    (publication, value),
                ).fetchall()
                return {
                    "publication_id": publication,
                    "territory": {"id": code, "name": name, "type": "commune"},
                    "scope": {"kind": kind, "label": label},
                    "rows": [dict(zip(("territory_id", "service", "mode", "share",
                                     "indicator_label", "direction", "source_id", "source_name",
                                     "source_version", "reference_date", "source_publication_date"), row)) for row in rows],
                }


def get_repository() -> ReadRepository:
    return ReadRepository(pool())


def compare(data: dict) -> ComparisonResponse:
    target = data["territory"]["id"]
    members = {row["territory_id"] for row in data["rows"]}
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
            rank = None if value is None else Rank(
                position=1 + sum(v > value if direction == "high" else v < value for v in values),
                size=len(values),
            )
            response_modes[mode] = ModeComparison(
                value=value, median=median(values) if values else None, rank=rank,
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
            peer_median_car_gap=median_difference("car", "walk_transit"),
            peer_median_bike_gain=median_difference("bike", "walk_transit"),
        ))
    return ComparisonResponse(
        publication_id=data["publication_id"], territory=data["territory"],
        scope={**data["scope"], "member_count": len(members)}, services=services,
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
