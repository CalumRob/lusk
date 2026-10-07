"""Bounded custom-group comparison of canonical per-commune building ramps.

The eleven ordinates remain percentiles for each individual commune, but their
peer ordinates are building-count-weighted *means*, not pooled-building
percentiles. Inputs must come from one committed publication; this calculation
does not read files, choose scope membership or manufacture display copy.
"""

from collections import defaultdict
import math


class ComparisonInputError(ValueError):
    """The selection or its canonical ramp rows cannot produce a peer curve."""


_MODES = ("c", "b", "t")
_POSITIONS = tuple(index / 10 for index in range(11))


def resolve_commune_members(reference, selected, *, max_members):
    """Resolve whole territories to non-overlapping communes in the publication.

    The reference is the same published territory universe as the ramp. A
    cross-boundary EPCI includes only its communes present in this universe.
    """
    if not isinstance(max_members, int) or isinstance(max_members, bool) or max_members < 2:
        raise ComparisonInputError("Invalid member bound")
    targets = tuple(selected)
    if not targets or len(targets) > max_members or len(set(targets)) != len(targets):
        raise ComparisonInputError("Invalid territory selection")
    by_target = {(row["type"], row["territoire"]): row for row in reference}
    if len(by_target) != len(reference):
        raise ComparisonInputError("Ambiguous territory reference")
    communes = [row for row in reference if row["type"] == "commune"]
    members = set()
    for level, code in targets:
        if (level, code) not in by_target:
            raise ComparisonInputError("Unknown selected territory")
        if level == "commune":
            matched = [code]
        elif level == "epci":
            matched = [row["territoire"] for row in communes if row.get("epci") == code]
        elif level == "departement":
            matched = [row["territoire"] for row in communes if row.get("departement") == code]
        elif level == "region":
            matched = [row["territoire"] for row in communes]
        else:
            raise ComparisonInputError("Unsupported territory level")
        if not matched:
            raise ComparisonInputError("Selected territory has no member communes")
        members.update(matched)
        if len(members) > max_members:
            raise ComparisonInputError("Unbounded commune selection")
    return tuple(sorted(members))


def _selected_communes(rows, member_ids, max_members, member_type="commune"):
    members = tuple(member_ids)
    if (not isinstance(max_members, int) or isinstance(max_members, bool)
            or max_members < 1 or not 1 <= len(members) <= max_members
            or any(not isinstance(code, str) or not code for code in members)
            or len(set(members)) != len(members)):
        raise ComparisonInputError("Invalid or unbounded commune selection")
    by_member = defaultdict(list)
    for row in rows:
        code = row.get("territoire")
        if code not in members or row.get("type") != member_type:
            raise ComparisonInputError("Unexpected territory in ramp publication")
        by_member[code].append(row)
    if set(by_member) != set(members):
        raise ComparisonInputError("Missing comparison rows for selected commune")
    provenance = {(row.get("source_id"), row.get("version"))
                  for member_rows in by_member.values() for row in member_rows}
    if (len(provenance) != 1 or
            any(not all(isinstance(value, str) and value for value in source)
                for source in provenance)):
        raise ComparisonInputError("Missing or mixed comparison provenance")
    return members, by_member


def weighted_peer_ramp(rows, member_ids, *, max_members, member_type="commune"):
    """Compare distinct communes from one publication; return None for <2 available.

    The caller resolves whole selected territories into disjoint commune IDs and
    fetches ONLY those rows in the same publication before calling this seam.
    Missing or malformed rows are errors, not an absent comparison.
    """
    members, by_member = _selected_communes(rows, member_ids, max_members, member_type)

    complete = []
    for code in members:
        member_rows = by_member[code]
        statuses = {row.get("availability") for row in member_rows}
        if statuses == {"absent"}:
            if (len(member_rows) != len(_MODES) or
                    {row.get("mode") for row in member_rows} != set(_MODES) or
                    any(row.get("total_buildings") != 0 or row.get("quantile") is not None
                        or row.get("accessible_types") is not None for row in member_rows)):
                raise ComparisonInputError("Incomplete absent ramp")
            continue
        if statuses != {"complete"} or len(member_rows) != len(_MODES) * len(_POSITIONS):
            raise ComparisonInputError("Incomplete peer ramp")
        counts = [row.get("total_buildings") for row in member_rows]
        if (not all(isinstance(count, int) and not isinstance(count, bool) and count > 0
                    for count in counts) or len(set(counts)) != 1):
            raise ComparisonInputError("Invalid ramp building count")
        weight = counts[0]
        by_mode = defaultdict(list)
        for row in member_rows:
            if row.get("mode") not in _MODES:
                raise ComparisonInputError("Unknown ramp mode")
            by_mode[row["mode"]].append(row)
        curves = {}
        for mode in _MODES:
            ordered = by_mode[mode]
            if len(ordered) != len(_POSITIONS):
                raise ComparisonInputError("Missing ramp mode")
            if any(not isinstance(row.get("quantile"), (float, int)) or
                   not math.isfinite(row["quantile"]) for row in ordered):
                raise ComparisonInputError("Invalid ramp position")
            ordered = sorted(ordered, key=lambda row: row["quantile"])
            for expected, row in zip(_POSITIONS, ordered):
                quantile = row.get("quantile")
                value = row.get("accessible_types")
                if (not isinstance(quantile, (float, int)) or
                        not math.isfinite(quantile) or abs(quantile - expected) > 1e-12 or
                        not isinstance(value, (float, int)) or
                        not math.isfinite(value) or value < 0):
                    raise ComparisonInputError("Invalid ramp point")
            values = [row["accessible_types"] for row in ordered]
            if any(left > right for left, right in zip(values, values[1:])):
                raise ComparisonInputError("Non-monotone ramp")
            curves[mode] = values
        complete.append((weight, curves))

    if len(complete) < 2:
        return None
    total = sum(weight for weight, _ in complete)
    return {
        "statistic": "mean",
        "member_count": len(complete),
        "total_buildings": total,
        "points": [
            {"mode": mode, "quantile": quantile,
             "accessible_types": sum(weight * curves[mode][index]
                                     for weight, curves in complete) / total}
            for mode in _MODES for index, quantile in enumerate(_POSITIONS)
        ],
    }


def pooled_peer_distribution(rows, member_ids, *, max_members, member_type="commune"):
    """The grid's peer share is the mean of per-building cell membership (0/1)."""
    members, by_member = _selected_communes(rows, member_ids, max_members, member_type)
    complete = []
    expected_cells = None
    for code in members:
        member_rows = by_member[code]
        statuses = {row.get("availability") for row in member_rows}
        if statuses == {"absent"}:
            if (len(member_rows) != 1 or member_rows[0].get("mode") != "t" or
                    member_rows[0].get("total_buildings") != 0 or
                    member_rows[0].get("building_count") is not None):
                raise ComparisonInputError("Incomplete absent grid")
            continue
        if statuses != {"complete"} or any(row.get("mode") != "t" for row in member_rows):
            raise ComparisonInputError("Incomplete peer grid")
        counts = [row.get("total_buildings") for row in member_rows]
        if (not all(isinstance(count, int) and not isinstance(count, bool) and count > 0
                    for count in counts) or len(set(counts)) != 1):
            raise ComparisonInputError("Invalid grid building count")
        cells = {}
        for row in member_rows:
            cell = (row.get("breadth_bucket"), row.get("depth_bucket"))
            count = row.get("building_count")
            if (not all(isinstance(bucket, str) and bucket for bucket in cell)
                    or cell in cells or not isinstance(count, int) or
                    isinstance(count, bool) or count < 0):
                raise ComparisonInputError("Invalid grid cell")
            cells[cell] = count
        if sum(cells.values()) != counts[0] or (expected_cells is not None and set(cells) != expected_cells):
            raise ComparisonInputError("Incomplete grid cells")
        expected_cells = set(cells)
        complete.append((counts[0], cells))
    if len(complete) < 2:
        return None
    total = sum(count for count, _ in complete)
    return {
        "statistic": "mean",
        "member_count": len(complete),
        "total_buildings": total,
        "cells": [
            {"breadth_bucket": breadth, "depth_bucket": depth,
             "building_count": count, "share": count / total}
            for breadth, depth in sorted(expected_cells)
            for count in [sum(cells[(breadth, depth)] for _, cells in complete)]
        ],
    }
