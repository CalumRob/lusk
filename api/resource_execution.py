"""Shared transaction and bounded execution for semantic resource reads."""

import json

from fastapi import HTTPException

from api.resource_catalogue import validate_resource_item


MAX_ITEMS = 12
MAX_WORK_UNITS = 200_000
MAX_RESPONSE_BYTES = 8_000_000


def _validate(items, catalogue):
    if not 1 <= len(items) <= MAX_ITEMS:
        raise HTTPException(422, f"Resource batch requires 1-{MAX_ITEMS} items")
    for item in items:
        try:
            validate_resource_item(item, catalogue)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc


def _read_snapshot(pool, items, catalogue, preflight, read, *, batch):
    """Preflight the whole request and then read it on one read-only RR snapshot."""
    _validate(items, catalogue)
    results = []
    response_bytes = len(b'{"contract":"semantic-read-batch-v1","results":[]}')
    with pool.connection() as connection:
        with connection.transaction():
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            work_units = 0
            for item in items:
                estimate = preflight(connection, item)
                if not isinstance(estimate, int) or estimate < 0:
                    raise HTTPException(503, "Resource preflight returned an invalid work estimate")
                work_units += estimate
                if work_units > MAX_WORK_UNITS:
                    raise HTTPException(413, "Resource request exceeds the bounded work limit")
            for item in items:
                data = read(connection, item)
                if not batch:
                    encoded = json.dumps(data, separators=(",", ":"), default=str).encode("utf-8")
                    if len(encoded) > MAX_RESPONSE_BYTES:
                        raise HTTPException(413, "Resource response exceeds the 8 MB limit")
                    return data
                result = {"id": item.id, "resource": item.resource, "data": data}
                encoded = json.dumps(result, separators=(",", ":"), default=str).encode("utf-8")
                response_bytes += len(encoded) + (1 if results else 0)
                if response_bytes > MAX_RESPONSE_BYTES:
                    raise HTTPException(413, "Resource batch response exceeds the 8 MB limit")
                results.append(result)
    return {"contract": "semantic-read-batch-v1", "results": results}


def execute_single(pool, item, catalogue, preflight, read):
    return _read_snapshot(pool, [item], catalogue, preflight, read, batch=False)


def execute_batch(pool, request, catalogue, preflight, read):
    return _read_snapshot(pool, request.items, catalogue, preflight, read, batch=True)
