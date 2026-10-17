"""HTTP routes for source-grain AEDAR aggregates and comparisons."""

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, Query

from api.aedar_models import AEDAR_MEASURE_KEYS, AEDARTerritorialAggregateResponse
from api.aedar_reads import (
    _aedar_comparison_field_selection, _aedar_comparison_snapshot,
    _aedar_territorial_aggregate_snapshot,
)
from api.field_selection import normalize_field_selection


def create_aedar_router(*, get_pool):
    router = APIRouter()

    @router.get("/api/aedar/territories/{territory_type}/{territory_id}/aggregates",
                response_model=AEDARTerritorialAggregateResponse)
    def aedar_territorial_aggregates(
        territory_type: Literal["commune", "epci", "departement", "region"],
        territory_id: str = Path(min_length=1, max_length=32),
        typequ: list[str] | None = Query(default=None, max_length=100),
        fields: list[str] | None = Query(default=None, max_length=313),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0, le=10000),
    ):
        """Bounded source-grain AEDAR read; no SQL or unbounded territory dump."""
        if typequ is not None and (not typequ or any(not item or len(item) > 32 for item in typequ)):
            raise HTTPException(422, "typequ must contain non-empty source codes")
        normalize_field_selection(fields, {"measures." + key for key in AEDAR_MEASURE_KEYS})
        with get_pool().connection() as conn:
            with conn.transaction():
                conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                return _aedar_territorial_aggregate_snapshot(
                    conn, territory_type, territory_id, typequ, fields, limit, offset)

    @router.get("/api/aedar/territories/{territory_type}/{territory_id}/comparisons")
    def aedar_fixed_comparisons(
        territory_type: Literal["commune", "epci", "departement"],
        context: Literal["density_class", "epci", "bretagne", "same_level"] = Query(...),
        territory_id: str = Path(min_length=1, max_length=32),
        typequ: str = Query(min_length=4, max_length=4),
        measure: str = Query(min_length=1, max_length=64),
        fields: Annotated[list[str] | None, Query(max_length=32)] = None,
    ):
        """Bounded read of one published AEDAR fixed-context measure."""
        if measure not in AEDAR_MEASURE_KEYS:
            raise HTTPException(422, "Unknown AEDAR measure")
        _aedar_comparison_field_selection(fields)
        with get_pool().connection() as conn:
            with conn.transaction():
                conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                return _aedar_comparison_snapshot(
                    conn, territory_type, territory_id, context, typequ, measure, fields)

    return router
