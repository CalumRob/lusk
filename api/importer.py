"""Validated, transactional importer for the published essential-service projection."""

from dataclasses import asdict, dataclass, replace
from collections import Counter
import argparse
import hashlib
import json
from pathlib import Path
import re
import math

from api.building_comparison import (
    ComparisonInputError, pooled_peer_distribution, weighted_peer_ramp,
)


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
    comparison_scope: dict[str, str]
    changed: bool | None = None  # None = validated without a database publication
    building_ramp: tuple[dict, ...] = ()
    building_grid: tuple[dict, ...] = ()
    building_direction: str | None = None


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
    try:
        comparison_scope = theme["comparison_scopes"]["bretagne"]
        if (not isinstance(comparison_scope.get("kind"), str) or not comparison_scope["kind"].strip()
                or not isinstance(comparison_scope.get("label"), str) or not comparison_scope["label"].strip()):
            raise ValueError("invalid scope")
        comparison_scope = {"kind": comparison_scope["kind"], "label": comparison_scope["label"]}
    except (KeyError, TypeError, ValueError) as exc:
        raise ImportError("Missing or invalid published Bretagne comparison scope") from exc

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
            direction = directions.get(key)
            if direction not in {"high", "low"}:
                raise ImportError(f"Missing or invalid pipeline direction for {key}")
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
    # A dataset fingerprint, not a hash of shared Parquet file bytes. A change
    # in a different indicator/vintage or Parquet encoding must not refresh
    # access facts when the validated serving projection is identical.
    serving_territories = [{
        "territory_id": t["territoire"], "territory_type": t["type"],
        "name": t.get("nom", ""), "department_id": t.get("departement"),
        "epci_id": t.get("epci"), "density_class_code": t.get("classe_densite_code"),
        "density_class_label": t.get("classe_densite_libelle_public"),
    } for t in territories]
    ramp_path = root / "rampe_acces_batiments.parquet"
    grid_path = root / "distribution_acces_batiments.parquet"
    if ramp_path.exists() != grid_path.exists():
        raise ImportError("Both building-access artifacts must be published together")
    ramp_rows: list[dict] = []
    grid_rows: list[dict] = []
    direction = None
    if ramp_path.exists():
        descriptor = theme.get("building_comparison", {})
        direction = descriptor.get("direction")
        if descriptor.get("statistic") != "mean" or direction not in ("high", "low"):
            raise ImportError("Missing pipeline building comparison metadata")
        commune_ids = sorted(tid for tid, t in territory_by_id.items() if t["type"] == "commune")
        ramp_rows = [row for row in _read_parquet(ramp_path, ramp_path.name)
                     if row.get("type") == "commune"]
        grid_rows = [row for row in _read_parquet(grid_path, grid_path.name)
                     if row.get("type") == "commune"]
        if not commune_ids:
            raise ImportError("No communes in building-access reference")
        grid_sizes = Counter(row["territoire"] for row in grid_rows)
        grid_complete = {row["territoire"] for row in grid_rows
                         if row["availability"] == "complete"}
        if any(grid_sizes.get(code) != (30 if code in grid_complete else 1)
               for code in commune_ids):
            raise ImportError("Incomplete canonical building-access grid")
        try:
            weighted_peer_ramp(ramp_rows, commune_ids, max_members=len(commune_ids))
            pooled_peer_distribution(grid_rows, commune_ids, max_members=len(commune_ids))
        except (ComparisonInputError, KeyError, TypeError) as exc:
            raise ImportError("Incomplete canonical building-access facts") from exc
        ramp_support = {row["territoire"]: row["total_buildings"] for row in ramp_rows}
        grid_support = {row["territoire"]: row["total_buildings"] for row in grid_rows}
        if ramp_support != grid_support:
            raise ImportError("Building figures disagree on commune building populations")
        for row in ramp_rows + grid_rows:
            source = vintage_by_id.get(row["source_id"])
            if (not source or row["version"] != source.get("version") or
                    row["source"] != source.get("source") or
                    row["date_reference"] != source.get("date_reference") or
                    row["date_publication"] != source.get("date_publication")):
                raise ImportError("Building-access provenance does not match published vintage")
        ramp_rows.sort(key=lambda row: (row["territoire"], row["mode"],
                                        row["quantile"] if row["quantile"] is not None else -1))
        grid_rows.sort(key=lambda row: (row["territoire"], row["breadth_bucket"] or "",
                                        row["depth_bucket"] or ""))
    snapshot = {
        "territories": sorted(serving_territories, key=lambda t: t["territory_id"]),
        "access": [asdict(row) for row in result],
        "comparison_scope": comparison_scope,
        **({"building_ramp": ramp_rows, "building_grid": grid_rows,
            "building_direction": direction} if ramp_rows else {}),
    }
    fingerprint = json.dumps(snapshot, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=False, allow_nan=False, default=str)
    digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:16]
    publication_id = f"{max((r.source_publication_date or '' for r in result), default='undated')}-{digest}"
    return Publication(publication_id, tuple(result), tuple(territories), tuple(vintages),
                       comparison_scope, building_ramp=tuple(ramp_rows),
                       building_grid=tuple(grid_rows), building_direction=direction)


def import_publication(connection, artifacts_dir: str | Path, metadata_path: str | Path | None = None) -> Publication:
    """Historical publisher for the pre-R schema; forbidden after per-table migration."""
    publication = load_publication(artifacts_dir, metadata_path)
    with connection.transaction():
        with connection.cursor() as cur:
            cur.execute("SELECT to_regclass('table_publication')")
            marker_table = cur.fetchone()
            if marker_table and marker_table[0] is not None:
                raise ImportError("R owns database publication after the per-table migration")
            # Serialize concurrent publishers, including on an initially empty database.
            cur.execute("SELECT pg_advisory_xact_lock(569, 1)")
            cur.execute("""SELECT publication_id FROM dataset_publication
                WHERE dataset_key = 'essential_service_access'""")
            current = cur.fetchone()
            if current and current[0] == publication.publication_id:
                return replace(publication, changed=False)
            cur.execute("""SELECT publication_id FROM dataset_publication
                WHERE dataset_key = 'building_access'""")
            current_building = cur.fetchone()
            if current_building and not publication.building_ramp:
                raise ImportError("A building-access publication requires both canonical building artifacts")
            # There is no ownership marker for shared territory identities.
            # If another fact table references them, compatibility cannot be
            # inferred here, so fail closed rather than reinterpret its facts.
            cur.execute("""SELECT EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_class target ON target.oid = c.confrelid
                JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
                JOIN pg_class source ON source.oid = c.conrelid
                JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace
                WHERE c.contype = 'f'
                  AND target.relname = 'territory_reference'
                  AND target_ns.nspname = current_schema()
                  AND NOT (source.relname = 'essential_service_access'
                           AND source_ns.nspname = current_schema())
                  AND NOT (%s AND source.relname IN ('building_ramp', 'building_grid')
                           AND source_ns.nspname = current_schema())
            )""", (bool(publication.building_ramp),))
            independent_refs = cur.fetchone()
            if independent_refs and independent_refs[0]:
                raise ImportError("Cannot refresh territory references while independently published facts reference them")
            if publication.building_ramp:
                cur.execute("DELETE FROM building_ramp")
                cur.execute("DELETE FROM building_grid")
            cur.execute("DELETE FROM essential_service_access")
            cur.execute("DELETE FROM service_registry")
            cur.executemany("""INSERT INTO territory_reference
                (territory_id, territory_type, name, department_id, epci_id,
                  density_class_code, density_class_label)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (territory_id) DO UPDATE SET
                    territory_type = EXCLUDED.territory_type,
                    name = EXCLUDED.name,
                    department_id = EXCLUDED.department_id,
                    epci_id = EXCLUDED.epci_id,
                    density_class_code = EXCLUDED.density_class_code,
                    density_class_label = EXCLUDED.density_class_label""",
                [(str(t["territoire"]), t["type"], t.get("nom", ""),
                  t.get("departement"), t.get("epci"), t.get("classe_densite_code"),
                  t.get("classe_densite_libelle_public")) for t in publication.territories])
            cur.execute("""DELETE FROM territory_reference
                WHERE NOT (territory_id = ANY(%s))""",
                ([str(t["territoire"]) for t in publication.territories],))
            services = sorted({row.service for row in publication.rows})
            cur.executemany("INSERT INTO service_registry (service) VALUES (%s)", [(service,) for service in services])
            cur.executemany("""INSERT INTO essential_service_access
                (territory_id, service, mode, share, indicator_label,
                  effective_direction, source_id, source_name, source_version, reference_date,
                  source_publication_date)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(r.territory_id, r.service, r.mode,
                   r.share, r.indicator_label, r.effective_direction, r.source_id, r.source_name, r.source_version,
                   r.reference_date, r.source_publication_date)
                   for r in publication.rows])
            cur.execute("SELECT assert_current_dataset_complete(%s)", (len(publication.rows),))
            if publication.building_ramp:
                cur.executemany("""INSERT INTO building_ramp
                    (territory_id, territory_type, availability, mode, quantile_index,
                     quantile, accessible_types, total_buildings, source_id, source_version,
                     effective_direction) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    [(row["territoire"], row["type"], row["availability"], row["mode"],
                      -1 if row["quantile"] is None else round(row["quantile"] * 10),
                      row["quantile"], row["accessible_types"], row["total_buildings"],
                      row["source_id"], row["version"], publication.building_direction)
                     for row in publication.building_ramp])
                cell_indices = {}
                grid_values = []
                for row in publication.building_grid:
                    code = row["territoire"]
                    index = cell_indices.get(code, 0) if row["availability"] == "complete" else -1
                    if index >= 0:
                        cell_indices[code] = index + 1
                    grid_values.append((code, row["type"], row["availability"], row["mode"],
                                        index, row["breadth_bucket"], row["depth_bucket"],
                                        row["building_count"], row["total_buildings"],
                                        row["source_id"], row["version"]))
                cur.executemany("""INSERT INTO building_grid
                    (territory_id, territory_type, availability, mode, cell_index,
                     breadth_bucket, depth_bucket, building_count, total_buildings,
                     source_id, source_version) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    grid_values)
                cur.execute("SELECT assert_building_dataset_complete(%s, %s)",
                            (len(publication.building_ramp), len(publication.building_grid)))
            cur.execute("""INSERT INTO dataset_publication
                (dataset_key, publication_id, row_count, bretagne_kind, bretagne_label)
                VALUES ('essential_service_access', %s, %s, %s, %s)
                ON CONFLICT (dataset_key) DO UPDATE SET
                    publication_id = EXCLUDED.publication_id,
                    row_count = EXCLUDED.row_count,
                    bretagne_kind = EXCLUDED.bretagne_kind,
                    bretagne_label = EXCLUDED.bretagne_label,
                    imported_at = now()""",
                (publication.publication_id, len(publication.rows),
                  publication.comparison_scope["kind"], publication.comparison_scope["label"]))
            if publication.building_ramp:
                cur.execute("""INSERT INTO dataset_publication
                    (dataset_key, publication_id, row_count, bretagne_kind, bretagne_label)
                    VALUES ('building_access', %s, %s, %s, %s)
                    ON CONFLICT (dataset_key) DO UPDATE SET
                        publication_id = EXCLUDED.publication_id,
                        row_count = EXCLUDED.row_count,
                        bretagne_kind = EXCLUDED.bretagne_kind,
                        bretagne_label = EXCLUDED.bretagne_label,
                        imported_at = now()""",
                    (publication.publication_id,
                     len(publication.building_ramp) + len(publication.building_grid),
                     publication.comparison_scope["kind"], publication.comparison_scope["label"]))
    return replace(publication, changed=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate canonical access-to-services Parquet")
    parser.add_argument("artifacts_dir", type=Path, help="Directory containing published Parquet inputs")
    parser.add_argument("--check", action="store_true", help="Validate inputs without connecting to PostgreSQL")
    parser.add_argument("--metadata", type=Path, help="Pipeline theme metadata descriptor (defaults to repository path)")
    parser.add_argument("--host", help="PostgreSQL host for an interactive publication")
    parser.add_argument("--database", help="PostgreSQL database for an interactive publication")
    parser.add_argument("--user", help="PostgreSQL publishing login for an interactive publication")
    args = parser.parse_args()
    if args.check:
        publication = load_publication(args.artifacts_dir, args.metadata)
    else:
        parser.error("Database publication belongs to the desktop R pipeline; use pipeline/scripts/publish-serving-tables.R --publish")
    action = "validated" if publication.changed is None else ("published" if publication.changed else "unchanged")
    print(f"{publication.publication_id}: {len(publication.rows)} access observations {action}")


if __name__ == "__main__":
    main()
