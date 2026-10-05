"""Independent, atomic persistence for prepared network-source families."""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
from typing import Callable, Mapping
from uuid import uuid4
from time import perf_counter


@dataclass(frozen=True)
class FamilyPreparation:
    """Signature and builder for one independently reusable source family."""

    signature: Mapping[str, object]
    artifacts: Mapping[str, str]
    build: Callable[[Path], None]
    validate: Callable[[Mapping[str, Path]], None] | None = None


def _canonical_signature(signature: Mapping[str, object]) -> dict:
    """Round-trip through JSON so cache comparison uses stored value types."""
    try:
        return json.loads(json.dumps(signature, sort_keys=True))
    except (TypeError, ValueError) as error:
        raise ValueError(f"Network cache signature must be JSON serializable: {error}") from error


def _validate_names(family: str, preparation: FamilyPreparation) -> None:
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", family):
        raise ValueError(f"Invalid network cache family name: {family!r}")
    if not preparation.artifacts:
        raise ValueError(f"Network cache family {family!r} has no artifacts")
    filenames = list(preparation.artifacts.values())
    if len(filenames) != len(set(filenames)):
        raise ValueError(f"Network cache family {family!r} has duplicate artifact filenames")
    for filename in filenames:
        if Path(filename).name != filename or not filename.endswith(".fgb"):
            raise ValueError(f"Invalid FlatGeobuf artifact filename: {filename!r}")


def _load_family(
    family_root: Path,
    family: str,
    preparation: FamilyPreparation,
    signature: dict,
) -> dict[str, Path] | None:
    pointer_path = family_root / "current.json"
    try:
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        generation = pointer["generation"]
        if (
            pointer.get("schema_version") != 1
            or pointer.get("family") != family
            or pointer.get("signature") != signature
            or not isinstance(generation, str)
            or Path(generation).name != generation
        ):
            return None

        generation_dir = family_root / "generations" / generation
        manifest = json.loads((generation_dir / "manifest.json").read_text(encoding="utf-8"))
        if (
            manifest.get("schema_version") != 1
            or manifest.get("family") != family
            or manifest.get("signature") != signature
        ):
            return None
        records = manifest.get("artifacts")
        if not isinstance(records, dict) or set(records) != set(preparation.artifacts):
            return None

        paths = {}
        for key, filename in preparation.artifacts.items():
            record = records[key]
            if record.get("filename") != filename:
                return None
            path = generation_dir / filename
            if not path.is_file() or path.stat().st_size == 0:
                return None
            if path.stat().st_size != record.get("size_bytes"):
                return None
            paths[key] = path
        if preparation.validate is not None:
            preparation.validate(paths)
        return paths
    except (OSError, json.JSONDecodeError, KeyError, TypeError, AttributeError, ValueError):
        return None
    except Exception:
        # A family-specific validator may raise a QGIS/GDAL exception type.
        return None


def _publish_family(
    cache_root: Path,
    family: str,
    preparation: FamilyPreparation,
    signature: dict,
) -> dict[str, Path]:
    family_root = cache_root / family
    generations = family_root / "generations"
    generations.mkdir(parents=True, exist_ok=True)
    generation = f"generation-{uuid4().hex}"
    staging = family_root / f".staging-{uuid4().hex}"
    staging.mkdir()

    try:
        preparation.build(staging)
        paths = {key: staging / filename for key, filename in preparation.artifacts.items()}
        for path in paths.values():
            if not path.is_file() or path.stat().st_size == 0:
                raise ValueError(f"Network preparation did not produce a nonempty artifact: {path.name}")
        unexpected = {
            path.name for path in staging.iterdir()
            if path.name not in set(preparation.artifacts.values())
        }
        if unexpected:
            raise ValueError(f"Network preparation produced unexpected files: {sorted(unexpected)}")
        if preparation.validate is not None:
            preparation.validate(paths)

        manifest = {
            "schema_version": 1,
            "family": family,
            "signature": signature,
            "artifacts": {
                key: {"filename": preparation.artifacts[key], "size_bytes": paths[key].stat().st_size}
                for key in preparation.artifacts
            },
        }
        (staging / "manifest.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8"
        )

        generation_dir = generations / generation
        os.replace(staging, generation_dir)
        pointer = {
            "schema_version": 1,
            "family": family,
            "signature": signature,
            "generation": generation,
        }
        pointer_temp = family_root / f".current-{uuid4().hex}.tmp"
        pointer_temp.write_text(json.dumps(pointer, indent=2, sort_keys=True), encoding="utf-8")
        os.replace(pointer_temp, family_root / "current.json")
        return {key: generation_dir / filename for key, filename in preparation.artifacts.items()}
    except Exception as error:
        shutil.rmtree(staging, ignore_errors=True)
        raise RuntimeError(
            f"Could not prepare network cache family {family!r}; its previous generation remains untouched"
        ) from error


def prepare_network_sources(
    cache_root: str | Path,
    preparations: Mapping[str, FamilyPreparation],
    *, force: bool = False, report: list | None = None, read_only: bool = False,
) -> dict[str, dict[str, Path]]:
    """Reuse or atomically prepare each family using its own cache signature."""
    if not preparations:
        raise ValueError("At least one network source family is required")
    if read_only and force:
        raise ValueError("read-only network source cache cannot be force-refreshed")
    cache_root = Path(cache_root)
    result = {}
    for family, preparation in preparations.items():
        started = perf_counter()
        _validate_names(family, preparation)
        signature = _canonical_signature(preparation.signature)
        signature_identity = sha256(json.dumps(signature, sort_keys=True,
            separators=(",", ":")).encode()).hexdigest()
        family_root = cache_root / family
        paths = None if force else _load_family(family_root, family, preparation, signature)
        if paths is not None:
            generation = paths[next(iter(paths))].parent.name
            print(f"[network-prep] {family}: reused {generation}", flush=True)
            result[family] = paths
            if report is not None:
                report.append({"stage": f"network-{family}", "profile": "shared",
                    "identity": signature_identity, "decision": "reused", "seconds": round(perf_counter()-started, 3)})
            continue

        if read_only:
            raise RuntimeError(f"read-only network source cache has no validated current generation for {family!r}")

        print(f"[network-prep] {family}: preparing indexed FlatGeobuf sources", flush=True)
        result[family] = _publish_family(cache_root, family, preparation, signature)
        print(f"[network-prep] {family}: prepared {len(result[family])} artifacts", flush=True)
        if report is not None:
            report.append({"stage": f"network-{family}", "profile": "shared",
                "identity": signature_identity, "decision": "built", "seconds": round(perf_counter()-started, 3)})
    return result
