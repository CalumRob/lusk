"""Test-only producer-metadata catalogue builder.

Production discovery never reads theme metadata. Legacy unit fixtures may use
this helper explicitly; HTTP/database proofs use ``database_resource_catalogue``.
"""

from functools import lru_cache
import json
import os
from pathlib import Path

from api.resource_catalogue import ResourceCatalogue, project_resource_catalogue


def discover_indicator_resources(metadata_directory: str | Path,
                                  semantic_contract_path: str | Path | None = None) -> ResourceCatalogue:
    metadata_directory = Path(metadata_directory)
    paths = sorted(metadata_directory.glob("theme_*.json"))
    if not paths:
        raise ValueError("No producer theme metadata files found")
    metadata_by_theme = {}
    for path in paths:
        metadata = json.loads(path.read_text(encoding="utf-8"))
        metadata_by_theme[metadata["theme"]] = metadata
    return project_resource_catalogue(metadata_by_theme, semantic_contract_path)


@lru_cache(maxsize=1)
def default_resource_catalogue() -> ResourceCatalogue:
    root = Path(__file__).resolve().parents[2]
    producer = Path(os.environ.get("LUSK_PRODUCER_METADATA_DIR", root / "pipeline" / "inst" / "extdata"))
    return discover_indicator_resources(producer / "theme-metadata",
                                        producer / "semantic-resource-contracts.json")
