"""Producer-declaration fixtures for the shared guarded publication writer."""

from __future__ import annotations

import json
from pathlib import Path

from api.tests.integration.resource_publication_helper import publish_resource


DEFAULT_METADATA = Path(__file__).resolve().parents[3] / "pipeline/inst/extdata/theme-metadata"


def _named(mapping, key):
    return {key: mapping[key]} if key in mapping else None


def indicator_declaration(resource_id, metadata_directory=DEFAULT_METADATA):
    """Project one resource exactly as ``declaration_ressource_metadata`` does."""
    metadata_directory = Path(metadata_directory)
    for path in sorted(metadata_directory.glob("theme_*.json")):
        metadata = json.loads(path.read_text(encoding="utf-8"))
        if resource_id not in metadata.get("indicator_keys", ()):
            continue
        routes = metadata.get("owned_series_routes") or {}
        aliases = {
            route.get("reference_indicator"): owner
            for owner, route in routes.items()
            if route.get("reference_read_route") and route.get("reference_indicator")
        }
        owner = aliases.get(resource_id, resource_id)
        collection = (metadata.get("observed_collection_contracts") or {}).get(resource_id)
        page = (metadata.get("indicator_pages") or {}).get(resource_id)
        if page is None and owner != resource_id:
            page = (metadata.get("indicator_pages") or {}).get(owner)
        page = page or collection
        source_id = (metadata.get("sources") or {}).get(resource_id)
        page_sources = (page or {}).get("sources") or ()
        if isinstance(page_sources, str):
            page_sources = (page_sources,)
        source_keys = list(dict.fromkeys(filter(None, [source_id, *page_sources])))
        records = metadata.get("source_records") or {}
        declaration = {
            "theme": metadata["theme"],
            "indicator_keys": [resource_id],
            "sources": {resource_id: source_id},
            "source_records": {key: records[key] for key in source_keys if key in records},
        }
        page_map = _named(metadata.get("indicator_pages") or {}, owner if owner != resource_id else resource_id)
        if page_map is not None:
            declaration["indicator_pages"] = page_map
        elif collection is not None:
            declaration["indicator_pages"] = {resource_id: collection}
        for name in (
            "indicator_labels", "scalar_contracts", "profile_contracts",
            "distribution_contracts", "observed_collection_contracts", "detail_labels",
            "map_layers",
        ):
            value = _named(metadata.get(name) or {}, resource_id)
            if value is not None:
                declaration[name] = value
        route = _named(routes, owner)
        if route is not None:
            declaration["owned_series_routes"] = route
        return {"kind": "indicator", "metadata": declaration}, owner
    raise ValueError(f"No producer declaration for {resource_id}")


def publish_indicator(connection, resource_id, shape, version, *,
                      reference_content_version, metadata_directory=DEFAULT_METADATA,
                      publication_id=None, scalar_version=None):
    """Publish an indicator and any producer-declared named-reference alias."""
    declaration, owner = indicator_declaration(resource_id, metadata_directory)
    metadata = declaration["metadata"]
    route = (metadata.get("owned_series_routes") or {}).get(owner, {})
    page = (metadata.get("indicator_pages") or {}).get(resource_id) or {}
    if shape == "owned_series":
        publication_id = (publication_id or page.get("series_dataset_id")
                          or route.get("dataset_id") or owner)
    else:
        publication_id = publication_id or resource_id
    declarations = {resource_id: declaration}
    alias = route.get("reference_indicator")
    if route.get("reference_read_route") and alias and alias != resource_id:
        alias_declaration, alias_owner = indicator_declaration(alias, metadata_directory)
        if alias_owner != owner:
            raise ValueError(f"Alias {alias} is not owned by {owner}")
        declarations[alias] = alias_declaration
    publish_resource(
        connection, publication_id, shape, version,
        reference_content_version=reference_content_version,
        declarations=declarations,
    )
    # A dual scalar/owned-series resource has two independent live registry
    # identities but one discovery descriptor bound to the owned dataset.
    if (shape == "owned_series" and publication_id != resource_id
            and resource_id in (metadata.get("scalar_contracts") or {})):
        publish_resource(
            connection, resource_id, "scalar", scalar_version or version,
            reference_content_version=reference_content_version,
        )
    return publication_id
