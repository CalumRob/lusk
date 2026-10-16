"""HTTP adapter for semantic discovery and bounded resource reads."""

from fastapi import APIRouter, Depends

from api.resource_catalogue import ResourceCatalogue
from api.resource_execution import execute_batch, execute_single
from api.resource_requests import ResourceBatchRequest, ResourceReadItem
from api.semantic_resource_reader import SemanticResourceReader


def create_resource_router(*, get_repository, get_catalogue, get_reader):
    """Build semantic resource routes from explicit application dependencies."""
    router = APIRouter()

    @router.get("/api/resources")
    def discover_resources(catalogue: ResourceCatalogue = Depends(get_catalogue)) -> dict:
        return catalogue.discovery_payload()

    @router.post("/api/resources/read")
    def read_resource(item: ResourceReadItem,
                      repository=Depends(get_repository),
                      catalogue: ResourceCatalogue = Depends(get_catalogue),
                      reader: SemanticResourceReader = Depends(get_reader)) -> dict:
        return execute_single(repository.connections, item, catalogue,
            lambda conn, resource_item: reader.preflight(conn, resource_item, catalogue),
            lambda conn, resource_item: reader.read(conn, resource_item, catalogue))

    @router.post("/api/resources/read-batch")
    def read_resource_batch(request: ResourceBatchRequest,
                            repository=Depends(get_repository),
                            catalogue: ResourceCatalogue = Depends(get_catalogue),
                            reader: SemanticResourceReader = Depends(get_reader)) -> dict:
        return execute_batch(repository.connections, request, catalogue,
            lambda conn, resource_item: reader.preflight(conn, resource_item, catalogue),
            lambda conn, resource_item: reader.read(conn, resource_item, catalogue))

    return router
