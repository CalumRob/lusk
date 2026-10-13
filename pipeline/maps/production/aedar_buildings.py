"""Prepare compact, complete address-level facts for AEDAR map rendering.

The source AEDAR Parquets have one sparse row per (address, TYPEQU). This module
filters those Parquets by commune in Arrow before scanning, aggregates equipment
counts to one address row, then left-joins the complete address-origin spine so
addresses absent from the sparse source remain explicit zero-valued points.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as ds


BASE_ADDRESS_FIELDS = ("code_insee", "cle_interop_adr", "lon", "lat")
SUPPORTED_HORIZONS = (10, 15, 20)
MODE_COUNT_SUFFIX = {
    "car": "car",
    "bike_lts2": "bike_lts2",
    "bike_lts4": "bike_lts4",
    "walk": "walk",
    # Product owner selected the optimistic transit scenario for this trial.
    "transit": "transit_p1",
    "transit_gain": "transit_gain_p1",
}


def _codes_filter(codes: Iterable[str]):
    values = tuple(dict.fromkeys(str(code) for code in codes))
    if not values or any(not code for code in values):
        raise ValueError("at least one non-empty code_insee is required")
    return ds.field("code_insee").isin(values), values


def _require_fields(dataset, required: Iterable[str], label: str) -> None:
    available = set(dataset.schema.names)
    missing = sorted(set(required) - available)
    if missing:
        raise ValueError(f"{label} is missing required fields: {missing}")


def derive_lost_equipment_type_facts(
    car_type_rows: pa.Table,
    mode_type_rows: pa.Table,
    address_spine: pa.Table,
    *,
    mode_count_field: str,
    horizon: int = 15,
) -> pa.Table:
    """Count car-reachable TYPEQUs absent from the selected mode per address.

    This is a true set difference. A TYPEQU reachable only by the comparison
    mode does not cancel a different TYPEQU reachable only by car.
    """
    keys = ("code_insee", "cle_interop_adr", "TYPEQU")
    car_count_field = f"count_{horizon}_car"
    _require_fields(car_type_rows, (*keys, car_count_field), "AEDAR car type rows")
    _require_fields(mode_type_rows, (*keys, mode_count_field), "AEDAR comparison-mode type rows")
    if not mode_count_field.startswith(f"count_{horizon}_"):
        raise ValueError("comparison-mode count field does not match the requested horizon")

    def accessible(rows: pa.Table, count_field: str, label: str) -> pa.Table:
        for key in keys:
            if pc.any(pc.is_null(rows[key])).as_py():
                raise ValueError(f"{label} contains null {key} values")
        counts = rows[count_field]
        if pc.any(pc.is_null(counts)).as_py():
            raise ValueError(f"{label} contains null type counts")
        minimum = pc.min(counts).as_py()
        if minimum is not None and minimum < 0:
            raise ValueError(f"{label} contains negative type counts")
        grouped = rows.select([*keys, count_field]).group_by(
            list(keys), use_threads=True
        ).aggregate([(count_field, "sum")])
        return grouped.filter(pc.greater(grouped[f"{count_field}_sum"], 0)).select(list(keys))

    car_access = accessible(car_type_rows, car_count_field, "AEDAR car type rows")
    mode_access = accessible(mode_type_rows, mode_count_field,
                             "AEDAR comparison-mode type rows")
    return count_lost_equipment_type_keys(car_access, mode_access, address_spine)


def count_lost_equipment_type_keys(
    car_access: pa.Table,
    mode_access: pa.Table,
    address_spine: pa.Table | None = None,
) -> pa.Table:
    """Count exact car-only TYPEQU keys against every address in the spine."""
    keys = ("code_insee", "cle_interop_adr", "TYPEQU")
    _require_fields(car_access, keys, "AEDAR car-accessible TYPEQU keys")
    _require_fields(mode_access, keys, "AEDAR mode-accessible TYPEQU keys")
    for label, table in (("car-accessible", car_access), ("mode-accessible", mode_access)):
        if any(pc.any(pc.is_null(table[key])).as_py() for key in keys):
            raise ValueError(f"AEDAR {label} TYPEQU keys contain null values")
    # AEDAR address sources have one sparse row per (address, TYPEQU). The
    # per-scan builder preserves that uniqueness, so don't regroup tens of
    # millions of keys just to deduplicate them again here.
    car_access = car_access.select(list(keys))
    mode_access = mode_access.select(list(keys))
    lost = car_access.join(mode_access, keys=list(keys), join_type="left anti")
    lost_counts = lost.group_by(["code_insee", "cle_interop_adr"], use_threads=True).aggregate(
        [("TYPEQU", "count")]
    ).rename_columns(["code_insee", "cle_interop_adr", "lost_diversity_15"])

    if address_spine is None:
        return lost_counts
    _require_fields(address_spine, BASE_ADDRESS_FIELDS, "AEDAR address-origin spine")

    spine_keys = address_spine.select(["code_insee", "cle_interop_adr"])
    duplicate_spine = spine_keys.group_by(["code_insee", "cle_interop_adr"], use_threads=True).aggregate(
        [("code_insee", "count")]
    )
    if duplicate_spine.num_rows and pc.max(duplicate_spine["code_insee_count"]).as_py() > 1:
        raise ValueError("address-origin spine has duplicate (code_insee, cle_interop_adr) rows")
    orphaned = lost_counts.join(spine_keys, keys=["code_insee", "cle_interop_adr"], join_type="left anti")
    if orphaned.num_rows:
        raise ValueError("AEDAR type rows contain addresses absent from the address-origin spine")

    result = address_spine.join(lost_counts, keys=["code_insee", "cle_interop_adr"],
                                join_type="left outer")
    values = pc.fill_null(result["lost_diversity_15"], 0)
    result = result.set_column(result.schema.get_field_index("lost_diversity_15"),
                               "lost_diversity_15", pc.cast(values, pa.int64()))
    indices = pc.sort_indices(result, sort_keys=[("code_insee", "ascending"),
                                                  ("cle_interop_adr", "ascending")])
    return result.take(indices)


def _filtered_scanner(dataset, columns, predicate, label):
    """Build a projected, predicate-filtered Arrow scanner before reading rows."""
    try:
        return dataset.scanner(columns=list(columns), filter=predicate,
                               use_threads=True, batch_size=65_536)
    except (pa.ArrowInvalid, pa.ArrowNotImplementedError) as error:
        raise ValueError(f"Could not scan {label} with the requested code_insee filter: {error}") from error


def prepare_accessible_equipment_type_keys(
    source_path: str | Path,
    *,
    code_insee: Iterable[str],
    mode: str,
    horizon: int = 15,
) -> pa.Table:
    """Read only reachable address/TYPEQU keys for a cached aggregate generation."""
    if mode not in MODE_COUNT_SUFFIX:
        raise ValueError(f"unsupported AEDAR map mode: {mode}")
    predicate, codes = _codes_filter(code_insee)
    count_field = f"count_{horizon}_{MODE_COUNT_SUFFIX[mode]}"
    keys = ("code_insee", "cle_interop_adr", "TYPEQU")
    dataset = ds.dataset(str(source_path), format="parquet")
    _require_fields(dataset, (*keys, count_field), f"AEDAR {mode} source")
    scanner = _filtered_scanner(
        dataset, (*keys, count_field),
        predicate & (ds.field(count_field) > 0), f"AEDAR {mode} accessible TYPEQUs",
    )
    partials = []
    for batch in scanner.to_batches():
        table = pa.Table.from_batches([batch]).select(list(keys))
        if any(pc.any(pc.is_null(table[key])).as_py() for key in keys):
            raise ValueError(f"AEDAR {mode} source contains null accessible TYPEQU keys")
        partials.append(table.group_by(list(keys), use_threads=True).aggregate(
            [("TYPEQU", "count")]
        ).select(list(keys)))
    if not partials:
        schema = scanner.projected_schema
        return pa.table({key: pa.array([], type=schema.field(key).type) for key in keys})
    combined = pa.concat_tables(partials, promote_options="default")
    return combined.group_by(list(keys), use_threads=True).aggregate(
        [("TYPEQU", "count")]
    ).select(list(keys))


def _partial_address_sums(scanner, mode: str, horizons: tuple[int, ...],
                          expected_codes: tuple[str, ...], *,
                          include_type_access: bool = False) -> tuple[pa.Table, pa.Table | None]:
    """Aggregate addresses and, optionally, retain positive (address, TYPEQU) keys."""
    suffix = MODE_COUNT_SUFFIX[mode]
    count_columns = {minutes: f"count_{minutes}_{suffix}" for minutes in horizons}
    keys = ["code_insee", "cle_interop_adr"]
    partials = []
    type_access_partials = []
    for batch in scanner.to_batches():
        table = pa.Table.from_batches([batch])
        if not set(table.column("code_insee").to_pylist()) <= set(expected_codes):
            raise ValueError("AEDAR source scan returned rows outside the requested communes")
        missing = sorted(set((*BASE_ADDRESS_FIELDS, "TYPEQU", *count_columns.values()))
                         - set(table.column_names))
        if missing:
            raise ValueError(f"AEDAR {mode} source is missing required fields: {missing}")
        for coordinate in ("lon", "lat"):
            values = table[coordinate]
            if (pc.any(pc.is_null(values)).as_py()
                    or pc.any(pc.invert(pc.is_finite(values))).as_py()):
                raise ValueError(f"AEDAR {mode} {coordinate} contains null or non-finite coordinates")
        aggregates = [("lon", "min"), ("lon", "max"),
                      ("lat", "min"), ("lat", "max")]
        for minutes, count_column in count_columns.items():
            count_values = table[count_column]
            if pc.any(pc.is_null(count_values)).as_py():
                raise ValueError(f"AEDAR {mode} {count_column} contains null values")
            minimum = pc.min(count_values).as_py()
            if minimum is not None and minimum < 0:
                raise ValueError(f"AEDAR {mode} {count_column} contains negative values")
            diversity_column = f"__diversity_{minutes}"
            table = table.append_column(
                diversity_column,
                pc.cast(pc.greater(count_values, 0), pa.int64()),
            )
            aggregates.extend(((diversity_column, "sum"), (count_column, "sum")))
        if include_type_access:
            access_count = table[f"count_15_{suffix}"]
            type_access = table.filter(pc.greater(access_count, 0)).select(
                [*keys, "TYPEQU"]
            )
            if type_access.num_rows:
                type_access_partials.append(type_access)
        grouped = table.group_by(keys, use_threads=True).aggregate(aggregates)
        rename = {}
        for minutes, count_column in count_columns.items():
            rename[f"__diversity_{minutes}_sum"] = f"diversity_{minutes}"
            rename[f"{count_column}_sum"] = f"count_{minutes}"
        partials.append(grouped.rename_columns([
            rename.get(name, name) for name in grouped.column_names
        ]))

    if not partials:
        empty = {"code_insee": pa.array([], pa.string()),
                 "cle_interop_adr": pa.array([], pa.string()),
                 "lon_min": pa.array([], pa.float64()),
                 "lon_max": pa.array([], pa.float64()),
                 "lat_min": pa.array([], pa.float64()),
                 "lat_max": pa.array([], pa.float64())}
        empty.update({name: pa.array([], pa.int64()) for minutes in horizons
                      for name in (f"diversity_{minutes}", f"count_{minutes}")})
        empty_sums = pa.table(empty)
        if not include_type_access:
            return empty_sums, None
        schema = scanner.projected_schema
        empty_types = pa.table({name: pa.array([], type=schema.field(name).type)
                                for name in (*keys, "TYPEQU")})
        return empty_sums, empty_types
    combined = pa.concat_tables(partials, promote_options="default")
    sums = [("lon_min", "min"), ("lon_max", "max"),
            ("lat_min", "min"), ("lat_max", "max"),
            *[item for minutes in horizons
              for item in ((f"diversity_{minutes}", "sum"), (f"count_{minutes}", "sum"))]]
    grouped = combined.group_by(keys, use_threads=True).aggregate(sums)
    rename = {f"{name}_{aggregate}": name for name, aggregate in sums}
    sums = grouped.rename_columns([rename.get(name, name) for name in grouped.column_names])
    if not include_type_access:
        return sums, None
    if not type_access_partials:
        schema = scanner.projected_schema
        empty_types = pa.table({name: pa.array([], type=schema.field(name).type)
                                for name in (*keys, "TYPEQU")})
        return sums, empty_types
    # Source contract: one sparse row per (code_insee, cle_interop_adr, TYPEQU).
    return sums, pa.concat_tables(type_access_partials, promote_options="default")


def prepare_aedar_building_facts(
    address_parquet: str | Path,
    address_origin_spine: str | Path | pa.Table,
    *,
    code_insee: Iterable[str],
    mode: str,
    horizons: Iterable[int] = SUPPORTED_HORIZONS,
    include_type_access: bool = False,
    spine_is_validated: bool = False,
) -> pa.Table | tuple[pa.Table, pa.Table]:
    """Return one complete row per selected residential address.

    The Parquet scanner projects only the address/type/count columns needed and
    applies `code_insee` as a predicate before Arrow materializes any rows.
    Missing sparse AEDAR rows are zero only after a left join from the complete
    address-origin spine.
    """
    if mode not in MODE_COUNT_SUFFIX:
        raise ValueError(f"unsupported AEDAR map mode: {mode}")
    horizons = tuple(int(value) for value in horizons)
    if not horizons or any(value not in SUPPORTED_HORIZONS for value in horizons):
        raise ValueError(f"horizons must be selected from {SUPPORTED_HORIZONS}")
    if len(set(horizons)) != len(horizons):
        raise ValueError("duplicate AEDAR map horizon")
    if include_type_access and 15 not in horizons:
        raise ValueError("TYPEQU access keys require the 15-minute horizon")
    address_predicate, codes = _codes_filter(code_insee)
    suffix = MODE_COUNT_SUFFIX[mode]
    count_columns = [f"count_{minutes}_{suffix}" for minutes in horizons]
    address_columns = (*BASE_ADDRESS_FIELDS, "TYPEQU", *count_columns)

    address_dataset = ds.dataset(str(address_parquet), format="parquet")
    _require_fields(address_dataset, address_columns, f"AEDAR {mode} source")
    address_scanner = _filtered_scanner(address_dataset, address_columns,
                                        address_predicate, f"AEDAR {mode} source")

    # Collapse (address, TYPEQU) rows by address. The scanner has already applied
    # the requested commune predicate; aggregation then runs only on that slice.
    sums, type_access = _partial_address_sums(
        address_scanner, mode, horizons, codes,
        include_type_access=include_type_access,
    )
    if isinstance(address_origin_spine, pa.Table):
        spine = address_origin_spine
        _require_fields(spine, BASE_ADDRESS_FIELDS, "address-origin spine")
        spine = spine.filter(pc.is_in(spine["code_insee"], value_set=pa.array(codes)))
    else:
        spine_dataset = ds.dataset(str(address_origin_spine), format="parquet")
        spine_columns = ("address_id", "code_insee", "lon", "lat")
        _require_fields(spine_dataset, spine_columns, "address-origin spine")
        spine = _filtered_scanner(spine_dataset, spine_columns,
                                  ds.field("code_insee").isin(codes),
                                  "address-origin spine").to_table()
        spine = spine.rename_columns([
            "cle_interop_adr" if name == "address_id" else name
            for name in spine.column_names
        ])
    if spine.num_rows == 0:
        raise ValueError(f"address-origin spine has no addresses for {', '.join(codes)}")
    if not spine_is_validated:
        for coordinate in ("lon", "lat"):
            values = spine[coordinate]
            if (pc.any(pc.is_null(values)).as_py()
                    or pc.any(pc.invert(pc.is_finite(values))).as_py()):
                raise ValueError(f"address-origin spine {coordinate} contains null or non-finite coordinates")
        spine_key_counts = spine.select(["code_insee", "cle_interop_adr"]).group_by(
            ["code_insee", "cle_interop_adr"], use_threads=True
        ).aggregate([("code_insee", "count")])
        if pc.max(spine_key_counts["code_insee_count"]).as_py() > 1:
            raise ValueError("address-origin spine has duplicate (code_insee, cle_interop_adr) rows")

    # A sparse accessibility row that cannot be attached to the authoritative
    # address universe is a source mismatch, not a new address to invent.
    orphaned = sums.join(spine.select(["code_insee", "cle_interop_adr"]),
                         keys=["code_insee", "cle_interop_adr"], join_type="left anti")
    if orphaned.num_rows:
        raise ValueError(f"AEDAR {mode} contains {orphaned.num_rows} addresses absent from the origin spine")

    # Every sparse address must resolve to one stable source coordinate, and
    # that coordinate must agree with the authoritative origin spine.
    if sums.num_rows:
        inconsistent = sums.filter(
            pc.or_(pc.not_equal(sums["lon_min"], sums["lon_max"]),
                   pc.not_equal(sums["lat_min"], sums["lat_max"]))
        )
        if inconsistent.num_rows:
            raise ValueError(f"AEDAR {mode} has conflicting coordinates for {inconsistent.num_rows} addresses")
        source_coords = sums.select(["code_insee", "cle_interop_adr", "lon_min", "lat_min"])
        joined_coords = source_coords.join(
            spine.select(["code_insee", "cle_interop_adr", "lon", "lat"]),
            keys=["code_insee", "cle_interop_adr"], join_type="inner")
        mismatches = pc.or_(
            pc.greater(pc.abs(pc.subtract(joined_coords["lon_min"], joined_coords["lon"])), 1e-7),
            pc.greater(pc.abs(pc.subtract(joined_coords["lat_min"], joined_coords["lat"])), 1e-7),
        )
        if pc.any(mismatches).as_py():
            raise ValueError(f"AEDAR {mode} coordinates disagree with the address-origin spine")
        sums = sums.drop(["lon_min", "lon_max", "lat_min", "lat_max"])

    result = spine.join(sums, keys=["code_insee", "cle_interop_adr"],
                        join_type="left outer")
    if not spine_is_validated:
        order = pc.sort_indices(result, sort_keys=[("code_insee", "ascending"),
                                                   ("cle_interop_adr", "ascending")])
        result = result.take(order)
    output_columns = list(BASE_ADDRESS_FIELDS)
    for minutes in horizons:
        for measure in (f"diversity_{minutes}", f"count_{minutes}"):
            column = result[measure]
            result = result.set_column(result.schema.get_field_index(measure), measure,
                                       pc.fill_null(column, 0))
            output_columns.append(measure)
    result = result.select(output_columns)
    metadata = dict(result.schema.metadata or {})
    metadata.update({
        b"dataset": b"AEDAR 2026-v1 address-level map facts",
        b"mode": mode.encode("utf-8"),
        b"transit_scenario": b"p1" if mode in {"transit", "transit_gain"} else b"not-applicable",
        b"zero_policy": b"left-join complete address-origin spine; absent sparse rows are zero",
        b"code_insee_filter": ",".join(codes).encode("utf-8"),
    })
    result = result.replace_schema_metadata(metadata)
    return (result, type_access) if include_type_access else result
