"""Validated, transactional importer for the published essential-service projection."""

from dataclasses import dataclass
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import math


class ImportError(ValueError):
    """An artifact set is not a complete, internally consistent publication."""


@dataclass(frozen=True)
class ServiceRow:
    territory_id: str
    territory_type: str
    service: str
    mode: str
    share: float | None
    indicator_label: str
    effective_direction: str
    source_id: str
    source_name: str
    source_version: str
    reference_date: str | None
    source_publication_date: str | None


@dataclass(frozen=True)
class Publication:
    publication_id: str
    rows: tuple[ServiceRow, ...]
    territories: tuple[dict, ...]
    provenance: tuple[dict, ...]


_MODES = {"t": "walk_transit", "b": "bike", "c": "car"}
_SHARE_KEY = re.compile(r"^share_([a-z0-9]+)_([tbc])$")


def _read_json(path: Path, name: str):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ImportError(f"Cannot read {name}: {exc}") from exc


def _read_parquet(path: Path, name: str):
    try:
        import pyarrow.parquet as pq
        return pq.read_table(path).to_pylist()
    except Exception as exc:
        raise ImportError(f"Cannot read {name} as Parquet: {exc}") from exc


def _default_metadata_path() -> Path:
    return Path(__file__).resolve().parents[1] / "pipeline/inst/extdata/theme-metadata/theme_mobilite.json"


def load_publication(artifacts_dir: str | Path, metadata_path: str | Path | None = None) -> Publication:
    """Load validated Parquet publication artifacts and pipeline-owned theme metadata."""
    root = Path(artifacts_dir)
    metadata_file = Path(metadata_path) if metadata_path is not None else _default_metadata_path()
    territories_raw = _read_parquet(root / "territoires.parquet", "territoires.parquet")
    data = _read_parquet(root / "indicateurs_mobilite.parquet", "indicateurs_mobilite.parquet")
    vintages = _read_parquet(root / "vintages.parquet", "vintages.parquet")
    theme = _read_json(metadata_file, str(metadata_file))
    if not isinstance(theme, dict):
        raise ImportError("Unexpected metadata shape")

    territory_types = {}
    for row in data:
        if row.get("theme") == "mobilite":
            tid = str(row.get("territoire"))
            typ = row.get("type")
            if tid in territory_types and territory_types[tid] != typ:
                raise ImportError(f"Conflicting territory type for {tid}")
            territory_types[tid] = typ
    territories = []
    for item in territories_raw:
        tid = str(item["territoire"])
        if tid not in territory_types:
            raise ImportError(f"Missing territory type for {tid}")
        territories.append({**item, "territoire": tid, "type": territory_types[tid]})
    territory_by_id = {str(t["territoire"]): t for t in territories}
    if len(territory_by_id) != len(territories):
        raise ImportError("Duplicate territory reference")
    try:
        vintage_by_id = {v["id"]: v for v in vintages}
    except (KeyError, TypeError) as exc:
        raise ImportError("Invalid vintage metadata") from exc
    if len(vintage_by_id) != len(vintages):
        raise ImportError("Duplicate vintage id")
    sources = theme.get("sources", {})
    labels = theme.get("indicator_labels", {})
    subgroups = theme.get("subgroups")
    if not isinstance(subgroups, list) or not subgroups:
        raise ImportError("Theme metadata has no valid subgroups")
    indicators_list = []
    for group in subgroups:
        if not isinstance(group, dict) or not isinstance(group.get("key"), str) or not group["key"].strip():
            raise ImportError("Invalid theme subgroup key")
        members = group.get("indicators")
        if not isinstance(members, list) or any(not isinstance(k, str) or not k for k in members):
            raise ImportError(f"Invalid indicators for subgroup {group['key']}")
        indicators_list.extend(members)
    if len(set(indicators_list)) != len(indicators_list):
        raise ImportError("Duplicate declared indicator")
    indicators = set(indicators_list)
    directions = theme.get("indicator_directions", {})
    if not isinstance(sources, dict) or not isinstance(labels, dict) or not isinstance(directions, dict):
        raise ImportError("Invalid source, label, or direction metadata")
    service_modes: dict[str, dict[str, str]] = {}
    for key in indicators:
        match = _SHARE_KEY.fullmatch(key)
        if match:
            service, mode = match.groups()
            service_modes.setdefault(service, {})[mode] = key
    if not service_modes or any(set(modes) != set(_MODES) for modes in service_modes.values()):
        raise ImportError("Theme metadata does not declare complete service triptychs")

    grouped = {}
    for row in data:
        if row.get("theme") != "mobilite" or row.get("key") not in indicators:
            continue
        match = _SHARE_KEY.fullmatch(row["key"])
        if not match:
            if str(row.get("key", "")).startswith("share_"):
                raise ImportError(f"Invalid declared share key: {row.get('key')}")
            continue
        tid = str(row.get("territoire"))
        service, mode = match.groups()
        identity = (tid, service)
        if identity in grouped and mode in grouped[identity]:
            raise ImportError(f"Duplicate value in triptych for {identity}")
        grouped.setdefault(identity, {})[mode] = row

    expected = {(tid, service) for tid in territory_by_id for service in service_modes}
    if set(grouped) != expected or any(set(values) != set(_MODES) for values in grouped.values()):
        raise ImportError("Incomplete triptych: expected every service and mode for every territory")
    result = []
    for (tid, service), values in grouped.items():
        for code, raw in values.items():
            key, value = raw["key"], raw.get("value")
            if value is not None:
                if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not 0 <= value <= 1:
                    raise ImportError(f"Share {key} for {tid} must be in 0..1 or null")
            if raw.get("unit") != "%":
                raise ImportError(f"Unexpected unit for {key}: {raw.get('unit')}")
            source_id = sources.get(key)
            vintage = vintage_by_id.get(source_id)
            if not source_id or not vintage:
                raise ImportError(f"Missing source mapping/vintage for {key}")
            if (raw.get("vintage_source") != vintage.get("source")
                    or raw.get("vintage_version") != vintage.get("version")
                    or raw.get("vintage_date_reference") != vintage.get("date_reference")
                    or raw.get("vintage_date_publication") != vintage.get("date_publication")):
                raise ImportError(f"Source provenance mismatch for {key}")
            direction = directions.get(key, "high")
            if direction not in {"high", "low"}:
                raise ImportError(f"Invalid effective direction for {key}")
            source_name, source_version = vintage.get("source"), vintage.get("version")
            if not isinstance(source_name, str) or not source_name.strip() or not isinstance(source_version, str) or not source_version.strip():
                raise ImportError(f"Invalid source metadata for {key}")
            territory = territory_by_id[tid]
            label = labels.get(key)
            if not isinstance(label, str) or not label.strip():
                raise ImportError(f"Missing published indicator label for {key}")
            result.append(ServiceRow(tid, territory["type"], service, _MODES[code], value,
                label, direction,
                source_id, source_name, source_version, vintage.get("date_reference"),
                vintage.get("date_publication")))
    result.sort(key=lambda r: (r.territory_id, r.service, r.mode))
    digest_hash = hashlib.sha256()
    for path in (root / "indicateurs_mobilite.parquet", root / "territoires.parquet", root / "vintages.parquet", metadata_file):
        digest_hash.update(path.name.encode("utf-8") + b"\0" + path.read_bytes() + b"\0")
    digest = digest_hash.hexdigest()[:16]
    publication_id = f"{max((r.source_publication_date or '' for r in result), default='undated')}-{digest}"
    return Publication(publication_id, tuple(result), tuple(territories), tuple(vintages))


def import_publication(connection, artifacts_dir: str | Path, metadata_path: str | Path | None = None) -> Publication:
    """Validate then atomically stage a version and switch the active publication pointer.

    `connection` is a psycopg-compatible connection; schema.sql must be applied separately.
    The active pointer is updated last inside one transaction, so any error rolls back staging.
    """
    publication = load_publication(artifacts_dir, metadata_path)
    with connection.transaction():
        with connection.cursor() as cur:
            cur.execute("SELECT status FROM import_publication WHERE publication_id = %s FOR UPDATE", (publication.publication_id,))
            existing = cur.fetchone()
            if existing:
                if existing[0] == "validated":
                    cur.execute("""INSERT INTO active_publication (singleton, publication_id)
                                   VALUES (TRUE, %s)
                                   ON CONFLICT (singleton) DO UPDATE
                                   SET publication_id = EXCLUDED.publication_id""",
                                (publication.publication_id,))
                    return publication
                raise ImportError(f"Publication {publication.publication_id} already exists but is not validated")
            cur.execute("INSERT INTO import_publication (publication_id, status) VALUES (%s, 'loading')", (publication.publication_id,))
            cur.executemany("""INSERT INTO territory_reference
                (publication_id, territory_id, territory_type, name, department_id, epci_id,
                 density_class_code, density_class_label)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(publication.publication_id, str(t["territoire"]), t["type"], t.get("nom", ""),
                  t.get("departement"), t.get("epci"), t.get("classe_densite_code"),
                  t.get("classe_densite_libelle_public")) for t in publication.territories])
            cur.executemany("""INSERT INTO essential_service_access
                (publication_id, territory_id, service, mode, share, indicator_label,
                 effective_direction, source_id, source_name, source_version, reference_date,
                 source_publication_date)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(publication.publication_id, r.territory_id, r.service, r.mode,
                  r.share, r.indicator_label, r.effective_direction, r.source_id, r.source_name, r.source_version,
                  r.reference_date, r.source_publication_date)
                  for r in publication.rows])
            cur.execute("UPDATE import_publication SET status='validated', row_count=%s WHERE publication_id=%s", (len(publication.rows), publication.publication_id))
            cur.execute("INSERT INTO active_publication (singleton, publication_id) VALUES (TRUE,%s) ON CONFLICT (singleton) DO UPDATE SET publication_id=EXCLUDED.publication_id", (publication.publication_id,))
    return publication


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish a validated access-to-services dataset")
    parser.add_argument("artifacts_dir", type=Path, help="Directory containing published Parquet inputs")
    parser.add_argument("--check", action="store_true", help="Validate inputs without connecting to PostgreSQL")
    parser.add_argument("--metadata", type=Path, help="Pipeline theme metadata descriptor (defaults to repository path)")
    args = parser.parse_args()
    if args.check:
        publication = load_publication(args.artifacts_dir, args.metadata)
    else:
        import psycopg

        dsn = os.environ.get("PUBLISH_DATABASE_URL")
        if not dsn:
            parser.error("PUBLISH_DATABASE_URL must be set to publish (not the read-only API credential)")
        with psycopg.connect(dsn, autocommit=True) as connection:
            publication = import_publication(connection, args.artifacts_dir, args.metadata)
    print(f"{publication.publication_id}: {len(publication.rows)} access observations validated")


if __name__ == "__main__":
    main()
