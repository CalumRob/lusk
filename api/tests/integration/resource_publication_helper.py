"""One guarded-test writer for a published resource and its discovery descriptors.

The SQL mirrors ``ecrire_registre_ressource`` and
``ecrire_descripteurs_ressource`` in ``pipeline/R/registre_ressource.R``:
registry upsert first, then replace the descriptors bound to that publication
resource with the supplied Version de ressource publiée. The caller owns the
connection and transaction; this helper never connects, commits, or rolls back.
"""

from __future__ import annotations

import re


PUBLICATION_SHAPES = (
    "scalar",
    "declared_profile",
    "owned_series",
    "observed_collection",
    "aedar",
)
_RESOURCE_ID = re.compile(r"^[a-z][a-z0-9_]{0,95}$")


def _validate_resource_id(resource_id):
    if not isinstance(resource_id, str) or not _RESOURCE_ID.fullmatch(resource_id):
        raise ValueError("Resource identity is invalid: expected a stable semantic resource id")


def publish_resource(connection, resource_id, shape, content_version, *,
                     reference_content_version=None, retired=False, declarations=None):
    """Publish one resource version and its named semantic descriptors.

    ``declarations`` maps each semantic API identity to the producer descriptor
    object. It may contain aliases (for example both AEDAR grammar identities)
    that share ``resource_id`` as their publication resource.
    """
    _validate_resource_id(resource_id)
    if shape not in PUBLICATION_SHAPES:
        raise ValueError(f"Unknown resource publication shape: {shape!r}")
    if not isinstance(content_version, str) or not content_version:
        raise ValueError("Resource descriptor version is invalid")
    if (reference_content_version is not None
            and not isinstance(reference_content_version, str)):
        raise ValueError("Resource reference version is invalid")
    if type(retired) is not bool:
        raise ValueError("Resource retirement flag must be boolean")
    if declarations is None:
        declarations = {}
    if not isinstance(declarations, dict):
        raise ValueError("Resource discovery declarations must be named by semantic resource")
    for semantic_resource_id, descriptor in declarations.items():
        _validate_resource_id(semantic_resource_id)
        if not isinstance(descriptor, dict):
            raise ValueError("Published resource descriptor must be an object")

    connection.execute(
        """INSERT INTO resource_publication(resource_id,shape,content_version,
            reference_content_version,published_at,retired) VALUES(%s,%s,%s,%s,now(),%s)
            ON CONFLICT(resource_id) DO UPDATE SET shape=EXCLUDED.shape,
            content_version=EXCLUDED.content_version,
            reference_content_version=EXCLUDED.reference_content_version,
            published_at=EXCLUDED.published_at, retired=EXCLUDED.retired""",
        (resource_id, shape, content_version, reference_content_version, retired),
    )
    connection.execute(
        "DELETE FROM resource_publication_descriptor WHERE publication_resource_id=%s",
        (resource_id,),
    )
    if declarations:
        from psycopg.types.json import Jsonb

        for semantic_resource_id, descriptor in declarations.items():
            connection.execute(
                """INSERT INTO resource_publication_descriptor(resource_id,
                    publication_resource_id,content_version,descriptor)
                    VALUES(%s,%s,%s,%s::jsonb)""",
                (semantic_resource_id, resource_id, content_version, Jsonb(descriptor)),
            )
