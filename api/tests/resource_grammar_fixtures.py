"""Synthetic producer grammar covering the five publication shapes."""

from __future__ import annotations

import json
from pathlib import Path
import shutil

from api.resource_catalogue import ResourceGrammar


ROOT = Path(__file__).parents[2]
SHAPES = (
    ("scalar", "scalar", "scalar_descriptor"),
    ("declared_profile", "profile", "profile_descriptor"),
    ("ordered_series", "ordered_series", "series_descriptor"),
    ("period_detail", "collection", "observed_collection_descriptor"),
    ("aedar_source_grain", "aedar", "aedar_territorial_aggregate"),
)
PUBLISHED_SCALAR = "published_scalar"


def semantic_resource_id(kind):
    return "aedar_territorial_aggregate" if kind == "aedar_source_grain" else "declared_" + kind


def five_shape_grammar(directory, *, include_published_scalar=False):
    """Write a self-contained grammar; AEDAR keeps its real producer declaration."""
    directory = Path(directory)
    source = ROOT / "pipeline/inst/extdata"
    contract = json.loads((source / "semantic-resource-contracts.json").read_text(encoding="utf-8"))
    for kind, _family, relation in SHAPES:
        if kind == "aedar_source_grain":
            continue
        contract["resources"].append({
            "resource_id": semantic_resource_id(kind),
            "kind": kind,
            "fields": ["value"],
            "storage_relation": relation,
            "allowed_levels": ["commune"],
            "intents": ["facts", "fixed_comparison", "selected_comparison"],
        })
    if include_published_scalar:
        contract["resources"].append({
            "resource_id": PUBLISHED_SCALAR,
            "kind": "scalar",
            "fields": ["value"],
            "storage_relation": "scalar_descriptor",
            "allowed_levels": ["commune"],
            "intents": ["facts"],
        })
    path = directory / "semantic-resource-contracts.json"
    path.write_text(json.dumps(contract), encoding="utf-8")
    shutil.copy2(source / "aedar-typequ-universe.json", directory)
    return ResourceGrammar(path, contract)
