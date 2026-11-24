"""One read contract for the live per-resource publication registry.

Every semantic shape asks this module the same question. Storage markers remain
shape-specific integrity checks; they never stand in for the resource registry.
"""

from dataclasses import dataclass

from fastapi import HTTPException

from api.publication_outcomes import publication_unavailable


@dataclass(frozen=True)
class PublishedResource:
    resource_id: str
    shape: str
    content_version: str
    reference_content_version: str | None


def live_resource_publications(conn, resource_ids, family, *, reference_content_version=None):
    """Return the live, non-retired rows for ``resource_ids`` on this snapshot.

    Absence (including retirement) is the classified ``503`` publication gap.
    A present row bound to another territory reference is contradictory state,
    not absence, and therefore remains a hard ``503``.
    """
    ids = sorted({str(resource_id) for resource_id in resource_ids})
    if not ids:
        return {}
    rows = conn.execute(
        """SELECT resource_id,shape,content_version,reference_content_version
           FROM resource_publication
           WHERE resource_id=ANY(%s) AND retired=false""",
        (ids,),
    ).fetchall()
    publications = {row[0]: PublishedResource(*row) for row in rows}
    if len(rows) != len(ids) or any(
            not publication.content_version for publication in publications.values()):
        publication_unavailable(family, "Resource publication is unavailable")
    if reference_content_version is not None and any(
            publication.reference_content_version != reference_content_version
            for publication in publications.values()):
        raise HTTPException(503, "Resource publication is stale or incompatible")
    return publications


def live_resource_publication(conn, resource_id, family, *, reference_content_version=None):
    """Single-resource convenience over the one shared registry-read contract."""
    return live_resource_publications(
        conn, [resource_id], family, reference_content_version=reference_content_version,
    )[resource_id]
