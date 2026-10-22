"""Bounded, read-only comparisons over R-published access facts."""

from contextlib import asynccontextmanager
from functools import lru_cache
import os

from fastapi import Depends, FastAPI, HTTPException, Query
from psycopg_pool import ConnectionPool
from api.resource_catalogue import ResourceCatalogue, default_resource_catalogue
from api.resource_routes import create_resource_router
from api.semantic_resource_reader import SemanticResourceReader
from api.repository import ReadRepository
from api.snapshot_reads import (
    _comparison_field_selection,
    _indicator_comparison_preflight, _indicator_comparison_snapshot,
    _indicator_facts_snapshot, _owned_named_reference_snapshot,
    _owned_series_route,
)


MAX_OWNED_SERIES_PROVENANCE_PER_POINT = 8


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


app = FastAPI(
    title="Lusk read API",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    swagger_ui_oauth2_redirect_url=None,
)


def get_repository() -> ReadRepository:
    return ReadRepository(pool())


def get_resource_catalogue() -> ResourceCatalogue:
    """Return validated discovery metadata derived from pipeline declarations."""
    return default_resource_catalogue()


def get_semantic_resource_reader() -> SemanticResourceReader:
    """Compose the semantic dispatcher with retained snapshot/read adapters."""
    return SemanticResourceReader(
        indicator_facts_snapshot=_indicator_facts_snapshot,
        indicator_comparison_preflight=_indicator_comparison_preflight,
        indicator_comparison_snapshot=_indicator_comparison_snapshot,
        owned_series_route=_owned_series_route,
        owned_named_reference_snapshot=_owned_named_reference_snapshot,
        comparison_field_selection=_comparison_field_selection,
        max_owned_series_provenance_per_point=MAX_OWNED_SERIES_PROVENANCE_PER_POINT,
    )


app.include_router(create_resource_router(
    get_repository=get_repository,
    get_catalogue=get_resource_catalogue,
    get_reader=get_semantic_resource_reader,
))


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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
