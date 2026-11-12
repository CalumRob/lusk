"""Shared transaction and bounded execution for semantic resource reads."""

import json

from fastapi import HTTPException

from api.publication_outcomes import PublicationUnavailable
from api.resource_catalogue import validate_resource_item


MAX_WORK_UNITS = 200_000
MAX_RESPONSE_BYTES = 8_000_000

V1_CONTRACT = "semantic-read-batch-v1"
V2_CONTRACT = "semantic-read-batch-v2"


def _validate(items, catalogue):
    if not items:
        raise HTTPException(422, "Resource batch requires at least one item")
    for item in items:
        try:
            validate_resource_item(item, catalogue)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc


def _encoded(value):
    return json.dumps(value, separators=(",", ":"), default=str).encode("utf-8")


def _read_snapshot(pool, items, catalogue, preflight, read, *, batch, outcomes=False):
    """Preflight the whole request and then read it on one read-only RR snapshot.

    With ``outcomes`` the executor may replace a *classified*
    :class:`PublicationUnavailable` raised for one item with that item's typed
    outcome. Every other exception, and every unclassified ``503``, still
    aborts the whole request before a partial envelope is returned. Preflight
    still runs for every item before any read, and the work/byte bounds are
    unchanged.
    """
    _validate(items, catalogue)
    contract = V2_CONTRACT if outcomes else V1_CONTRACT
    results = [None] * len(items)
    response_bytes = len(_encoded({"contract": contract, "results": []}))
    with pool.connection() as connection:
        with connection.transaction():
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            work_units = 0
            for index, item in enumerate(items):
                try:
                    estimate = preflight(connection, item, MAX_WORK_UNITS - work_units)
                except PublicationUnavailable as exc:
                    if not outcomes:
                        raise
                    results[index] = exc
                    work_units += 1
                    if work_units > MAX_WORK_UNITS:
                        raise HTTPException(413, "Resource request exceeds the bounded work limit")
                    continue
                if not isinstance(estimate, int) or estimate < 0:
                    raise HTTPException(503, "Resource preflight returned an invalid work estimate")
                # Every item consumes at least one unit, including fixed-cost reads.
                work_units += max(1, estimate)
                if work_units > MAX_WORK_UNITS:
                    raise HTTPException(413, "Resource request exceeds the bounded work limit")
            for index, item in enumerate(items):
                if isinstance(results[index], PublicationUnavailable):
                    # A soft preflight outcome is never read; its state was not
                    # used and the shared snapshot keeps serving other items.
                    continue
                try:
                    data = read(connection, item)
                except PublicationUnavailable as exc:
                    if not outcomes:
                        raise
                    results[index] = exc
                    continue
                if not batch:
                    if len(_encoded(data)) > MAX_RESPONSE_BYTES:
                        raise HTTPException(413, "Resource response exceeds the 8 MB limit")
                    return data
                result = ({"id": item.id, "resource": item.resource,
                           "status": "available", "data": data}
                          if outcomes else
                          {"id": item.id, "resource": item.resource, "data": data})
                response_bytes += len(_encoded(result)) + (1 if index else 0)
                if response_bytes > MAX_RESPONSE_BYTES:
                    raise HTTPException(413, "Resource batch response exceeds the 8 MB limit")
                results[index] = result
            if not batch:
                # execute_single always has exactly one item and returns in the
                # read loop above; this keeps the invariant explicit.
                raise HTTPException(500, "Single resource read produced no result")
            for index, item in enumerate(items):
                if isinstance(results[index], PublicationUnavailable):
                    result = {"id": item.id, "resource": item.resource,
                              **results[index].outcome()}
                    response_bytes += len(_encoded(result)) + (1 if index else 0)
                    if response_bytes > MAX_RESPONSE_BYTES:
                        raise HTTPException(413, "Resource batch response exceeds the 8 MB limit")
                    results[index] = result
    return {"contract": contract, "results": results}


def execute_single(pool, item, catalogue, preflight, read):
    return _read_snapshot(pool, [item], catalogue, preflight, read, batch=False)


def execute_batch(pool, request, catalogue, preflight, read, *, outcomes=False):
    return _read_snapshot(pool, request.items, catalogue, preflight, read,
                          batch=True, outcomes=outcomes)
