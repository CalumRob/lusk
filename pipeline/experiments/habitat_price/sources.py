"""Source manifest: hashes, sizes and declared provenance of every input."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import config


def sha256_file(path: Path, chunk: int = 1 << 22) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def bdnb_path(department: str, entry: str) -> Path:
    return config.RAW_DIR / f"bdnb-2026-02-a-dep{department}" / entry


def build_manifest(include_hashes: bool = True) -> dict:
    entries = {}
    for key, name in config.SOURCES.items():
        path = config.RAW_DIR / name
        item = {"path": str(path.relative_to(config.REPO_ROOT)), "exists": path.is_file()}
        if item["exists"]:
            item["bytes"] = path.stat().st_size
            if include_hashes:
                item["sha256"] = sha256_file(path)
        entries[key] = item
    for department in config.BDNB_DEPARTMENTS:
        for entry in config.BDNB_ENTRIES:
            path = bdnb_path(department, entry)
            key = f"bdnb_{department}_{entry}"
            item = {"path": str(path.relative_to(config.REPO_ROOT)), "exists": path.is_file()}
            if item["exists"]:
                item["bytes"] = path.stat().st_size
                if include_hashes:
                    item["sha256"] = sha256_file(path)
            entries[key] = item
    return {
        "declared_provenance": {
            "dvf_plus_native": "Cerema DVF+ open data 2026.1, R53_Bretagne "
                                "(DVF_PLUS_2026_1_CSV_R053_ED251.zip)",
            "bdnb": "BDNB Open 2026-02.a / v0.7.11 CSV entries, CSV/GPKG range-read",
            "aedar": "data.gouv 'acces-aux-equipements-depuis-les-adresses-"
                     "residentielles-bretagne' 2026-v1 address-mode Parquets",
        },
        "files": entries,
    }


def write_manifest(path: Path) -> dict:
    manifest = build_manifest()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest
