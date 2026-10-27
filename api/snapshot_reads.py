"""Retained PostgreSQL snapshot readers and comparison assembly.

The module owns coherent query snapshots; HTTP composition and transaction
framing live in api.main and api.resource_execution respectively.
"""

import math
from statistics import median
from typing import NamedTuple

from fastapi import HTTPException

from api.comparison_members import ComparisonInputError, resolve_commune_members
from api.field_selection import normalize_field_selection
from api.observed_collections import (collection_comparison, collection_comparison_preflight,
    collection_descriptors, collection_marker, collection_snapshot)
from api.profile_reads import focal_profiles
from api.typed_reading_snapshots import (
    _demographic_reading_cloud, _demographic_reading_marker,
    _milieux_reading_cloud, _milieux_reading_marker,
)

_COMPARISON_RESULT_FIELDS = {
    "focal_value", "median", "rank", "rank_size", "rank_ties",
    "selected_member_count", "eligible_count", "missing_count", "mean", "mean_curve", "member_ranks",
}
_COMPARISON_MANDATORY_FIELDS = {"status", "reason"}
def _comparison_field_selection(fields):
    return normalize_field_selection(fields, _COMPARISON_RESULT_FIELDS | _COMPARISON_MANDATORY_FIELDS)




def _validate_comparison_fields(fields, supported):
    selection = _comparison_field_selection(fields)
    if selection is not None:
        unsupported = set(selection) - set(supported) - _COMPARISON_MANDATORY_FIELDS
        if unsupported:
            raise HTTPException(422, "Field selection is not declared for this comparison resource")
    return selection


def _theme_comparison_projection(fields):
    if fields is None:
        return None
    return tuple(field for field in fields
                 if field in _COMPARISON_RESULT_FIELDS | _COMPARISON_MANDATORY_FIELDS)


def _project_comparison_result_fields(result, selection):
    """Project optional published/computed result attributes, retaining status and provenance."""
    if selection is None or not isinstance(result, dict):
        return result
    selected = set(selection)
    projected = {key: value for key, value in result.items()
                 if key not in _COMPARISON_RESULT_FIELDS or key in selected}
    if isinstance(projected.get("mean_curve"), dict):
        curve = dict(projected["mean_curve"])
        if "mean_curve" in selected:
            curve["points"] = [{key: value for key, value in point.items()
                                if key != "value" or "mean_curve" in selected}
                               for point in curve.get("points", [])]
        projected["mean_curve"] = curve
    return projected


def _project_comparison_payload_fields(payload, selection):
    if selection is None:
        return payload
    projected = dict(payload)
    for key in ("results", "profile_comparisons"):
        if key in projected:
            projected[key] = [_project_comparison_result_fields(row, selection)
                              for row in projected[key]]
    if "result" in projected:
        projected["result"] = _project_comparison_result_fields(projected["result"], selection)
    return projected


def summarize_series_comparison(values: list[tuple[str, float]], focal_id: str,
                                focal_value: float | None, direction: str) -> dict:
    """Direction-aware rank/median for one metadata-declared axis point."""
    if direction not in ("high", "low"):
        raise ValueError("Series comparison requires declared high/low direction")
    members = {territory_id: value for territory_id, value in values if territory_id != focal_id}
    if focal_value is not None:
        members[focal_id] = focal_value
    ordered = list(members.values())
    if focal_value is None:
        rank = ties = None
    else:
        better = sum(value > focal_value if direction == "high" else value < focal_value
                     for value in ordered)
        rank = better + 1
        ties = sum(value == focal_value for value in ordered)
    return {"value": focal_value, "median": median(ordered) if ordered else None,
            "rank": rank, "ties": ties, "comparable_count": len(ordered)}


class _ResolvedIndicatorResource(NamedTuple):
    bpe_indicator: str | None
    shape_rows: tuple[tuple[str, str], ...]
    owned_route: tuple | None
    collections: tuple[dict, ...]
    scalar_descriptor: tuple[str, tuple[str, ...]] | None
    profile_descriptor: tuple[str, tuple[str, ...]] | None


class _BatchReadSnapshotState:
    """Typed resolutions reusable only inside one batch MVCC snapshot."""

    def __init__(self):
        self.cohorts: dict[
            tuple[str, str, tuple[tuple[str, str], ...] | None],
            tuple[str, tuple[str, ...], dict | None],
        ] = {}
        self.indicator_resources: dict[str, _ResolvedIndicatorResource] = {}
        self.territory_reference_rows: tuple[tuple, ...] | None = None


def _comparison_cohort(conn, territory_type, territory_id, selection, *, snapshot_state=None):
    if snapshot_state is not None:
        key = (territory_type, territory_id,
               None if selection is None else tuple(selection))
        if key in snapshot_state.cohorts:
            return snapshot_state.cohorts[key]
    target = conn.execute(
        "SELECT territory_id,territory_type,density_class_code FROM territory_reference WHERE territory_id=%s",
        (territory_id,),
    ).fetchone()
    if not target:
        raise HTTPException(404, "Focal territory not found")
    if target[1] != territory_type:
        raise HTTPException(422, "Focal territory type does not match route")
    if snapshot_state is None or snapshot_state.territory_reference_rows is None:
        reference_rows = tuple(conn.execute(
            "SELECT territory_id,territory_type,department_id,epci_id,density_class_code FROM territory_reference"
        ).fetchall())
        if snapshot_state is not None:
            snapshot_state.territory_reference_rows = reference_rows
    else:
        reference_rows = snapshot_state.territory_reference_rows
    refs = [dict(zip(("territoire", "type", "departement", "epci", "densite"), row))
            for row in reference_rows]
    if selection is None:
        if territory_type == "commune":
            density = target[2]
            if not density:
                raise HTTPException(503, "Published default density class is unavailable")
            members = tuple(sorted(r["territoire"] for r in refs
                                   if r["type"] == "commune" and r["densite"] == density))
            result = ("commune", members, {"kind": "density_class", "density_class_code": density,
                                           "territory_type": "commune"})
            if snapshot_state is not None:
                snapshot_state.cohorts[key] = result
            return result
        if territory_type in ("epci", "departement"):
            members = tuple(sorted(r["territoire"] for r in refs if r["type"] == territory_type))
            result = (territory_type, members, {"kind": "same_level", "territory_type": territory_type})
        else:
            result = (territory_type, (), None)
        if snapshot_state is not None:
            snapshot_state.cohorts[key] = result
        return result
    if not selection:
        result = ("commune", (), {"kind": "explicit_selection"})
        if snapshot_state is not None:
            snapshot_state.cohorts[key] = result
        return result
    try:
        members = resolve_commune_members(refs, selection, max_members=len(refs))
    except ComparisonInputError as exc:
        raise HTTPException(422, str(exc)) from exc
    result = ("commune", members, {"kind": "explicit_selection"})
    if snapshot_state is not None:
        snapshot_state.cohorts[key] = result
    return result


def _comparison_cohort_in_snapshot(conn, territory_type, territory_id, selection, snapshot_state):
    if snapshot_state is None:
        return _comparison_cohort(conn, territory_type, territory_id, selection)
    return _comparison_cohort(conn, territory_type, territory_id, selection,
                              snapshot_state=snapshot_state)


def _fixed_scalar_comparison_context(conn, territory_type, territory_id, selection,
                                     cohort_type, members, scope, *, snapshot_state=None):
    """Resolve a request to a published context only when its member set is exact."""
    reference_rows = (snapshot_state.territory_reference_rows
                      if snapshot_state is not None else None)
    if selection is None:
        if territory_type == "commune" and scope and scope.get("kind") == "density_class":
            return ("density_class", scope["density_class_code"], "commune")
        if territory_type in ("epci", "departement") and scope and scope.get("kind") == "same_level":
            region = ([(row[0],) for row in reference_rows if row[1] == "region"]
                      if reference_rows is not None else conn.execute(
                          "SELECT territory_id FROM territory_reference WHERE territory_type='region'").fetchall())
            if len(region) != 1 or not region[0][0]:
                raise HTTPException(503, "Published Bretagne comparison identity is unavailable")
            return ("same_level", region[0][0], territory_type)
        return None

    # A user-defined peer set must not accidentally select an aggregate unless
    # it is exactly one of the currently offered commune contexts.
    if territory_type != "commune" or cohort_type != "commune" or not members:
        return None
    refs = ([(row[0], row[3], row[4]) for row in reference_rows if row[1] == "commune"]
            if reference_rows is not None else conn.execute("""SELECT territory_id,epci_id,density_class_code
                FROM territory_reference WHERE territory_type='commune'""").fetchall())
    by_id = {row[0]: row[1:] for row in refs}
    focal = by_id.get(territory_id)
    if not focal:
        return None
    selected = set(members)
    epci_id, density_class = focal
    if epci_id:
        epci_members = {row[0] for row in refs if row[1] == epci_id}
        if selected == epci_members:
            return ("epci", epci_id, "commune")
    bretagne_members = {row[0] for row in refs}
    if selected == bretagne_members:
        region = ([(row[0],) for row in reference_rows if row[1] == "region"]
                  if reference_rows is not None else conn.execute(
                      "SELECT territory_id FROM territory_reference WHERE territory_type='region'").fetchall())
        if len(region) != 1 or not region[0][0]:
            raise HTTPException(503, "Published Bretagne comparison identity is unavailable")
        return ("bretagne", region[0][0], "commune")
    if density_class:
        density_members = {row[0] for row in refs if row[2] == density_class}
        if selected == density_members:
            return ("density_class", density_class, "commune")
    return None


def _comparison_sources_by_indicator(rows):
    sources = {}
    for row in rows:
        sources.setdefault(row[0], []).append({
            "source_id": row[1], "name": row[3], "vintage_id": row[2],
            "version": row[4], "reference_date": row[5], "publication_date": row[6],
        })
    return sources


def _published_comparison_sources(conn, *, family, context, group_id, cohort_type, facets,
                                  content_version, expected_counts):
    """Read source/vintage metadata published for one resolved comparison group.

    Fixed-context reads deliberately address the group/facet lineage projection;
    they must not rediscover provenance by joining the cohort's observations.
    """
    if not facets:
        return {}
    try:
        rows = _execute_comparison_publication_read(conn,
        """SELECT l.facet_id,l.source_id,l.vintage_id,sd.name,sv.version,
                  sv.reference_date,sv.publication_date,l.comparison_content_version
           FROM comparison_source_lineage l
           JOIN source_dataset sd USING(source_id)
           JOIN source_vintage sv USING(source_id,vintage_id)
           WHERE l.comparison_family=%s AND l.comparison_context=%s
             AND l.group_id=%s AND l.territory_type=%s AND l.facet_id=ANY(%s)
           ORDER BY l.facet_id,l.source_id,l.vintage_id""",
         (family, context, group_id, cohort_type, sorted(facets)),
        ).fetchall()
    except Exception as error:
        if getattr(error, "sqlstate", None) in ("42P01", "42703"):
            raise HTTPException(503, "Published comparison provenance is unavailable") from error
        raise
    result = _comparison_sources_by_indicator(rows)
    counts = {facet: 0 for facet in facets}
    for row in rows:
        if row[7] != content_version:
            raise HTTPException(503, "Published comparison provenance is stale")
        counts[row[0]] += 1
    if counts != expected_counts or any(counts[k] and k not in result for k in facets):
        raise HTTPException(503, "Published comparison provenance is incomplete")
    return result


def _execute_comparison_publication_read(conn, query, params=None):
    """Fail closed when an older serving schema lacks comparison columns/tables."""
    try:
        return conn.execute(query, params)
    except Exception as error:
        if getattr(error, "sqlstate", None) in ("42P01", "42703"):
            raise HTTPException(503, "Published comparison schema is unavailable") from error
        raise


def _selected_profile_comparison_sources(conn, *, external, details, cohort_type, members,
                                         detail=None, sex=None):
    """Fetch distinct provenance for profile comparison facets, not every cell."""
    external_sources = []
    if external and members:
        external_sources = conn.execute(
            """SELECT DISTINCT p.indicator_id,os.source_id,os.vintage_id,sd.name,
                      sv.version,sv.reference_date,sv.publication_date
               FROM profile_descriptor p
               JOIN scalar_descriptor s ON s.indicator_id=p.comparison_scalar
               JOIN scalar_observation o ON o.indicator_id=s.indicator_id
               JOIN scalar_observation_source os
                 ON os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id
               JOIN source_dataset sd USING(source_id)
               JOIN source_vintage sv USING(source_id,vintage_id)
               WHERE p.indicator_id=ANY(%s) AND o.territory_type=%s
                 AND o.territory_id=ANY(%s)
               ORDER BY p.indicator_id,os.source_id,os.vintage_id""",
            (list(external), cohort_type, list(members)),
        ).fetchall()
    detail_sources = []
    if details and members:
        detail_sources = conn.execute(
            """SELECT DISTINCT p.indicator_id,os.source_id,os.vintage_id,sd.name,
                      sv.version,sv.reference_date,sv.publication_date
               FROM profile_descriptor p
               JOIN profile_observation o
                  ON o.indicator_id=p.indicator_id
                   AND o.detail_key=COALESCE(%s,p.comparison_detail)
                   AND o.sex_key=COALESCE(%s,COALESCE(p.comparison_sex,''))
               JOIN profile_observation_source os
                 ON os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id
                  AND os.detail_key=o.detail_key AND os.sex_key=o.sex_key
               JOIN source_dataset sd USING(source_id)
               JOIN source_vintage sv USING(source_id,vintage_id)
               WHERE p.indicator_id=ANY(%s) AND o.territory_type=%s
                 AND o.territory_id=ANY(%s)
               ORDER BY p.indicator_id,os.source_id,os.vintage_id""",
             (detail, sex, list(details), cohort_type, list(members)),
        ).fetchall()
    return (_comparison_sources_by_indicator(external_sources),
            _comparison_sources_by_indicator(detail_sources))


def _profile_comparison_publication_marker(conn):
    installed = conn.execute("SELECT to_regclass('profile_comparison_publication')").fetchone()
    if not installed or not installed[0]:
        raise HTTPException(503, "Published profile comparison is unavailable")
    marker = _execute_comparison_publication_read(conn, """SELECT p.content_version,p.profile_content_version,p.reference_content_version,
        p.group_row_count,p.territory_row_count,d.content_version,t.content_version
        FROM profile_comparison_publication p
        JOIN table_publication d ON d.table_name='declared_profile'
        JOIN table_publication t ON t.table_name='territory_reference' WHERE p.singleton""").fetchone()
    if (not marker or not marker[0] or marker[1] != marker[5] or marker[2] != marker[6]
            or marker[3] < 1 or marker[4] < 1):
        raise HTTPException(503, "Published profile comparison is stale or incompatible")
    return marker


def _published_profile_comparison_results(conn, profiles, fixed_context, cohort_type, members, territory_id,
                                         selected_fields=None):
    """Read published detail aggregates and the focal row; scalar-backed profiles use scalar publication.

    The canonical profile publisher validates full membership and derives every peer's
    median/rank/ties before atomically replacing this projection. Keep this read bounded:
    re-auditing peer rows here repeats that publication work on every request.
    """
    context, group_id, territory_type = fixed_context
    details = [p for p in profiles if not p.get("comparison_scalar")]
    if not details:
        return {}
    selected = _validate_comparison_fields(selected_fields,
        _COMPARISON_RESULT_FIELDS-{"mean","mean_curve"})
    marker = _profile_comparison_publication_marker(conn)
    ids = [p["indicator"] for p in details]
    # Peer-rank arrays can be cohort-sized. Preserve the existing compact default
    # response and load them only when callers explicitly request that field.
    selected = (_COMPARISON_RESULT_FIELDS - {"member_ranks"}) if selected is None else set(selected)
    expected_keys = set()
    for profile in details:
        point = profile.get("comparison_point") or {}
        expected_keys.add((profile["indicator"], point.get("detail"), point.get("sex") or ""))
    expected_key_list = sorted(expected_keys)
    expected_indicator_ids = [key[0] for key in expected_key_list]
    expected_details = [key[1] for key in expected_key_list]
    expected_sexes = [key[2] for key in expected_key_list]
    groups = _execute_comparison_publication_read(conn, """SELECT indicator_id,detail_key,sex_key,statistic,
        CASE WHEN %s THEN median ELSE NULL::double precision END,member_count,
        eligible_count,missing_count,lineage_source_count,profile_content_version,reference_content_version,
        ((eligible_count=0 AND median IS NULL) OR (eligible_count>0 AND median IS NOT NULL
          AND median NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))) AS median_valid
        FROM profile_comparison_group WHERE comparison_context=%s AND group_id=%s
        AND territory_type=%s AND indicator_id=ANY(%s)
        AND (indicator_id,detail_key,sex_key) IN
            (SELECT * FROM unnest(%s::text[],%s::text[],%s::text[]))""",
        ("median" in selected,context, group_id, territory_type, ids,
         expected_indicator_ids, expected_details, expected_sexes)).fetchall()
    territories = _execute_comparison_publication_read(conn, """SELECT indicator_id,detail_key,sex_key,territory_id,
        CASE WHEN %s THEN value ELSE NULL::double precision END,status,
        CASE WHEN %s THEN rank ELSE NULL::integer END,
        CASE WHEN %s THEN tie_count ELSE NULL::integer END,
        CASE WHEN %s THEN rank_size ELSE NULL::integer END,profile_content_version,reference_content_version,
        ((status='measured' AND value IS NOT NULL AND rank IS NOT NULL AND tie_count IS NOT NULL AND rank_size IS NOT NULL
          AND tie_count>=1 AND rank_size>=1 AND rank>=1 AND rank<=rank_size AND tie_count<=rank_size
          AND rank+tie_count<=rank_size+1) OR
         (status<>'measured' AND value IS NULL AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)) AS result_valid
         FROM profile_comparison_territory
         WHERE comparison_context=%s AND group_id=%s AND territory_type=%s
           AND indicator_id=ANY(%s) AND territory_id=%s
           AND (indicator_id,detail_key,sex_key) IN
               (SELECT * FROM unnest(%s::text[],%s::text[],%s::text[]))""",
        ("focal_value" in selected,"rank" in selected,"rank_ties" in selected,"rank_size" in selected,
         context, group_id, territory_type, ids, territory_id,
         expected_indicator_ids, expected_details, expected_sexes)).fetchall()
    member_rows = []
    if "member_ranks" in selected:
        member_rows = _execute_comparison_publication_read(conn, """SELECT indicator_id,detail_key,sex_key,
            territory_id,status,rank,tie_count,rank_size,profile_content_version,reference_content_version,
            ((status='measured' AND rank IS NOT NULL AND tie_count IS NOT NULL AND rank_size IS NOT NULL
              AND tie_count>=1 AND rank_size>=1 AND rank>=1 AND rank<=rank_size AND tie_count<=rank_size
              AND rank+tie_count<=rank_size+1) OR
             (status<>'measured' AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)) AS result_valid
            FROM profile_comparison_territory
            WHERE comparison_context=%s AND group_id=%s AND territory_type=%s
              AND indicator_id=ANY(%s) AND territory_id=ANY(%s)
              AND (indicator_id,detail_key,sex_key) IN
                  (SELECT * FROM unnest(%s::text[],%s::text[],%s::text[]))
            ORDER BY indicator_id,detail_key,sex_key,territory_id""",
            (context, group_id, territory_type, ids, list(members),
             expected_indicator_ids, expected_details, expected_sexes)).fetchall()
    group_map = {(r[0], r[1], r[2]): r for r in groups}
    territory_map = {(r[0], r[1], r[2]): r for r in territories}
    member_map = {}
    for row in member_rows:
        point_key = (row[0], row[1], row[2])
        rows = member_map.setdefault(point_key, {})
        if row[3] in rows:
            raise HTTPException(503, "Published profile comparison has duplicate peer ranks")
        rows[row[3]] = row[4:]
    if (len(group_map) != len(groups) or len(territory_map) != len(territories)
            or set(group_map) != expected_keys or set(territory_map) != expected_keys):
        raise HTTPException(503, "Published profile comparison has missing or duplicate results")
    source_map = _published_comparison_sources(conn, family="profile", context=context,
        group_id=group_id, cohort_type=cohort_type,
        facets={profile["indicator"] for profile in details}, content_version=marker[0],
        expected_counts={profile["indicator"]: next((r[8] for r in groups if r[0] == profile["indicator"]), 0)
                         for profile in details})
    output = {}
    for profile in details:
        point = profile.get("comparison_point") or {}
        key = (profile["indicator"], point.get("detail"), point.get("sex") or "")
        group, row = group_map.get(key), territory_map.get(key)
        if not group or not row or row[3] != territory_id:
            raise HTTPException(503, "Published profile comparison is incomplete")
        _, _, _, stat, med, member_count, eligible, missing, lineage_count, pv, rv, median_valid = group
        _, _, _, _, value, status, rank, ties, rank_size, tpv, trv, result_valid = row
        if (stat != "median" or member_count != len(members) or eligible < 0 or missing < 0
                or eligible + missing != member_count or pv != marker[1] or rv != marker[2]
                or tpv != marker[1] or trv != marker[2]
                or not median_valid or not result_valid
                or status not in ("measured", "suppressed", "unsupported", "not_available", "not_published")
                ):
            raise HTTPException(503, "Published profile comparison result is invalid")
        enough = eligible >= 2
        output[profile["indicator"]] = {**({"median":med if enough else None} if "median" in selected else {}),
            **({"focal_value":value if status == "measured" else None} if "focal_value" in selected else {}),
            **({"rank":rank if enough else None} if "rank" in selected else {}),
            **({"rank_size":rank_size if enough and status == "measured" else None} if "rank_size" in selected else {}),
            **({"rank_ties":ties if enough and status == "measured" else None} if "rank_ties" in selected else {}),
            **({"eligible_count":eligible} if "eligible_count" in selected else {}),
            "status": "available" if enough else "unavailable",
            "reason": None if enough else "fewer_than_two_comparable_values",
            **({"selected_member_count":member_count} if "selected_member_count" in selected else {}),
            "comparison_sources": source_map.get(profile["indicator"], [])}
        if "member_ranks" in selected:
            rows = member_map.get(key, {})
            if set(rows) != set(members) or len(rows) != len(members):
                raise HTTPException(503, "Published profile comparison peer ranks are incomplete")
            peer_eligible = 0
            peer_missing = 0
            ranks = []
            for member_id in members:
                peer_status, peer_rank, peer_ties, peer_size, peer_pv, peer_rv, peer_valid = rows[member_id]
                if (peer_status not in ("measured", "suppressed", "unsupported", "not_available", "not_published")
                        or peer_pv != marker[1] or peer_rv != marker[2] or not peer_valid
                        or (peer_status == "measured" and peer_size != eligible)):
                    raise HTTPException(503, "Published profile comparison peer rank is invalid")
                peer_eligible += peer_status == "measured"
                peer_missing += peer_status != "measured"
                ranks.append({"territory_id": member_id,
                    **({"rank": peer_rank, "rank_size": peer_size, "rank_ties": peer_ties}
                       if enough and peer_status == "measured" else
                        {"rank": None, "rank_size": None, "rank_ties": None})})
            if peer_eligible != eligible or peer_missing != missing:
                raise HTTPException(503, "Published profile comparison peer statuses do not match group counts")
            output[profile["indicator"]]["member_ranks"] = ranks
    return output


def _profile_comparison_results(conn, profiles, members, cohort_type, territory_id, fixed_context=None,
                                selected_fields=None, profile_coordinates=None):
    """Compare only declared profile facets, using one batch query per facet grain."""
    external = [p for p in profiles if p.get("comparison_scalar")]
    details = [p for p in profiles if not p.get("comparison_scalar")]
    if profile_coordinates and details:
        if len(details) != 1:
            raise HTTPException(503, "Coordinate-selected profile comparison is ambiguous")
        profile = details[0]
        default_point = profile.get("comparison_point") or {}
        details = [{**profile, "comparison_point": {
            "detail": profile_coordinates["detail"],
            "sex": profile_coordinates.get("sex"),
            "direction": default_point.get("direction"),
        }}]
    profile_fields = (None if selected_fields is None else
        tuple(field for field in selected_fields if field not in {"mean", "mean_curve"}))
    internal_profile_fields = (None if profile_fields is None else
        tuple(dict.fromkeys((*profile_fields,"eligible_count"))))
    if internal_profile_fields is not None and "missing_count" in (profile_fields or ()):
        internal_profile_fields = tuple(dict.fromkeys((*internal_profile_fields,
            "selected_member_count")))
    published_detail = (_published_profile_comparison_results(conn, details, fixed_context,
        cohort_type, members, territory_id, **({} if internal_profile_fields is None else {"selected_fields":internal_profile_fields}))
        if fixed_context and details else {})
    scalar_descriptors = (conn.execute("""SELECT indicator_id,label,unit,direction,comparison_facet,
        allowed_levels,descriptor_version FROM scalar_descriptor WHERE indicator_id=ANY(%s)""",
        ([p["comparison_scalar"] for p in external],)).fetchall() if fixed_context and external else [])
    published_scalar = (_published_scalar_comparison_results(conn, scalar_descriptors, fixed_context,
        cohort_type, members, territory_id, include_ties=True,
        **({"include_member_ranks": True} if internal_profile_fields is not None and
           "member_ranks" in internal_profile_fields else {}),
        **({} if internal_profile_fields is None else {"selected_fields":internal_profile_fields})) if fixed_context and external else {})
    read_ids = list(dict.fromkeys([*members, territory_id]))
    # Published adapters already supply complete comparison provenance. Only
    # dynamic comparisons consume these separate facet source maps.
    external_sources, detail_sources = _selected_profile_comparison_sources(
        conn, external=[p["indicator"] for p in external],
        details=[p["indicator"] for p in details],
        cohort_type=cohort_type, members=members,
        detail=(profile_coordinates or {}).get("detail"),
        sex=(profile_coordinates or {}).get("sex")) if not fixed_context else ({}, {})
    scalar_rows = []
    if external and not fixed_context:
        scalar_rows = conn.execute(
            """SELECT p.indicator_id,s.label,s.unit,s.direction,s.comparison_facet,s.allowed_levels,
                      s.descriptor_version,o.territory_id,o.value,o.status
               FROM profile_descriptor p
               JOIN scalar_descriptor s ON s.indicator_id=p.comparison_scalar
               LEFT JOIN scalar_observation o ON o.indicator_id=s.indicator_id
                    AND o.territory_type=%s AND o.territory_id=ANY(%s)
               WHERE p.indicator_id=ANY(%s) ORDER BY p.indicator_id,o.territory_id""",
            (cohort_type, read_ids, [p["indicator"] for p in external]),
        ).fetchall()
    detail_rows = []
    detail_contracts = {}
    if details and not fixed_context:
        if profile_coordinates:
            detail = profile_coordinates["detail"]
            sex = profile_coordinates.get("sex")
            sex_key = sex or ""
            detail_contracts = {row[0]: row for row in conn.execute(
                """SELECT d.indicator_id,%s,%s,d.unit,d.denominator_semantics,
                          d.descriptor_version,d.detail_units_required,a.unit
                   FROM profile_descriptor d LEFT JOIN profile_axis a
                     ON a.indicator_id=d.indicator_id AND a.axis_name='detail' AND a.axis_key=%s
                   WHERE d.indicator_id=ANY(%s)""",
                (detail, sex, detail, [p["indicator"] for p in details]),
            ).fetchall()}
            detail_rows = conn.execute(
                """SELECT d.indicator_id,o.territory_id,o.value,o.status
                    FROM profile_descriptor d JOIN profile_observation o
                      ON o.indicator_id=d.indicator_id AND o.detail_key=%s AND o.sex_key=%s
                    WHERE d.indicator_id=ANY(%s) AND o.territory_type=%s AND o.territory_id=ANY(%s)
                    ORDER BY d.indicator_id,o.territory_id""",
                (detail, sex_key, [p["indicator"] for p in details], cohort_type, read_ids),
            ).fetchall()
        else:
            detail_contracts = {row[0]: row for row in conn.execute(
                """SELECT d.indicator_id,d.comparison_detail,d.comparison_sex,d.unit,
                          d.denominator_semantics,d.descriptor_version,d.detail_units_required,a.unit
                   FROM profile_descriptor d LEFT JOIN profile_axis a
                     ON a.indicator_id=d.indicator_id AND a.axis_name='detail'
                      AND a.axis_key=d.comparison_detail
                   WHERE d.indicator_id=ANY(%s)""",
                ([p["indicator"] for p in details],),
            ).fetchall()}
            detail_rows = conn.execute(
                """SELECT d.indicator_id,o.territory_id,o.value,o.status
                   FROM profile_descriptor d JOIN profile_observation o
                     ON o.indicator_id=d.indicator_id AND o.detail_key=d.comparison_detail
                      AND o.sex_key=COALESCE(d.comparison_sex,'')
                   WHERE d.indicator_id=ANY(%s) AND o.territory_type=%s AND o.territory_id=ANY(%s)
                   ORDER BY d.indicator_id,o.territory_id""",
                ([p["indicator"] for p in details], cohort_type, read_ids),
            ).fetchall()
    scalar_by_profile, detail_by_profile = {}, {}
    for row in scalar_rows:
        scalar_by_profile.setdefault(row[0], []).append(row)
    for row in detail_rows:
        detail_by_profile.setdefault(row[0], []).append(row)

    def summary(profile, facet, unit, direction, rows, sources, *, include_missing_count=False):
        indicator = profile["indicator"]
        values = [(row[0], float(row[1])) for row in rows
                  if row[0] in members and row[2] == "measured" and row[1] is not None]
        focal_row = next((row for row in rows if row[0] == territory_id), None)
        focal_value = (float(focal_row[1]) if focal_row and focal_row[2] == "measured"
                       and focal_row[1] is not None else None)
        better = sum(v > focal_value if direction == "high" else v < focal_value for _, v in values) if focal_value is not None else None
        ties = sum(v == focal_value for _, v in values) if focal_value is not None else None
        enough = len(values) >= 2
        result = {"indicator": indicator, "facet": facet, "label": profile["label"],
            "unit": unit, "direction": direction, "statistic": "median",
            "profile_descriptor_version": profile.get("descriptor_version"),
            "scalar_descriptor_version": profile.get("scalar_descriptor_version"),
            "required_scalar_version": profile.get("required_scalar_version"),
            "source_facet_label": profile.get("source_facet_label"),
            "denominator_semantics": profile.get("denominator_semantics"),
            "status": "available" if enough else "unavailable",
            "reason": None if enough else "fewer_than_two_comparable_values",
            "selected_member_count": len(members), "eligible_count": len(values),
            "focal_value": focal_value, "focal_in_selection": territory_id in members,
            "median": median([v for _, v in values]) if enough else None,
            "rank": better + 1 if enough and territory_id in members and focal_value is not None else None,
            "rank_size": len(values) if enough and territory_id in members and focal_value is not None else None,
            "rank_ties": ties if enough and territory_id in members and focal_value is not None else None,
            "comparison_sources": sources}
        if selected_fields is not None and "member_ranks" in selected_fields:
            values_by_id = {member_id: value for member_id, value in values}
            counts = {}
            for _member_id, value in values:
                counts[value] = counts.get(value, 0) + 1
            ranks_by_value = {}
            preceding = 0
            for value in sorted(counts):
                count = counts[value]
                better = preceding if direction == "low" else len(values) - preceding - count
                ranks_by_value[value] = (better + 1, count)
                preceding += count
            result["member_ranks"] = [{
                "territory_id": member_id,
                **({"rank": ranks_by_value[values_by_id[member_id]][0],
                   "rank_size": len(values),
                   "rank_ties": ranks_by_value[values_by_id[member_id]][1]}
                   if enough and member_id in values_by_id else
                   {"rank": None, "rank_size": None, "rank_ties": None}),
            } for member_id in members]
        if include_missing_count:
            result["missing_count"] = max(0, len(members) - len(values))
        return result

    output = []
    for profile in external:
        if fixed_context:
            published = published_scalar.get(profile["comparison_scalar"])
            if published is None:
                raise HTTPException(503, "Published scalar profile comparison is incomplete")
            point = profile.get("comparison_point") or {}
            scalar_descriptor = next((r for r in scalar_descriptors if r[0] == profile["comparison_scalar"]), None)
            enough = published["eligible_count"] >= 2
            profile_result_fields = {field: value for field, value in published.items()
                if field != "missing_count"}
            profile_result={"indicator": profile["indicator"], "facet": profile["comparison_scalar"],
                "label": profile["label"], "unit": scalar_descriptor[2] if scalar_descriptor else profile.get("unit"),
                "direction": scalar_descriptor[3] if scalar_descriptor else point.get("direction"),
                "statistic": "median", "profile_descriptor_version": profile.get("descriptor_version"),
                "scalar_descriptor_version": scalar_descriptor[6] if scalar_descriptor else None,
                "required_scalar_version": profile.get("required_scalar_version"),
                "source_facet_label": scalar_descriptor[1] if scalar_descriptor else None,
                "denominator_semantics": profile.get("denominator_semantics"), "focal_in_selection": territory_id in members,
                **profile_result_fields, "status": "available" if enough else "unavailable",
                "reason": None if enough else "fewer_than_two_comparable_values"}
            requested_profile_fields=None if selected_fields is None else set(selected_fields)
            for field in ("median","focal_value","rank","rank_size","rank_ties",
                          "eligible_count","missing_count","selected_member_count"):
                if field == "missing_count" and requested_profile_fields is None:
                    continue
                if field in published and (requested_profile_fields is None or field in requested_profile_fields):
                    profile_result[field]=(published[field] if field in ("eligible_count","missing_count","selected_member_count")
                                           or field not in {"median","rank","rank_size","rank_ties","focal_value"}
                                           else published[field] if enough else None)
            if selected_fields is not None:
                profile_result=_project_comparison_result_fields(profile_result,selected_fields)
            output.append(profile_result)
            continue
        rows = scalar_by_profile.get(profile["indicator"], [])
        if not rows:
            raise HTTPException(503, "Profile scalar comparison facet is unavailable")
        descriptor = rows[0]
        if descriptor[4] != profile["comparison_scalar"] or descriptor[3] not in ("high", "low"):
            raise HTTPException(503, "Profile scalar comparison facet is invalid")
        if cohort_type not in descriptor[5]:
            output.append({"indicator": profile["indicator"], "facet": profile["comparison_scalar"],
                           "status": "unavailable", "reason": "facet_not_eligible_for_cohort"})
            continue
        normalized = [(r[7], r[8], r[9]) for r in rows if r[7] is not None]
        profile_metadata = {**profile, "source_facet_label": descriptor[1],
                            "scalar_descriptor_version": descriptor[6]}
        output.append(summary(profile_metadata, profile["comparison_scalar"], descriptor[2], descriptor[3],
                              normalized, external_sources.get(profile["indicator"], []),
                              include_missing_count=(selected_fields is not None and
                                  "missing_count" in selected_fields)))
    for profile in details:
        if fixed_context:
            published = published_detail.get(profile["indicator"])
            if published is None:
                raise HTTPException(503, "Published profile comparison is incomplete")
            point = profile["comparison_point"]
            cell = next(c for c in profile["cells"] if c["detail"] == point["detail"] and c.get("sex") == point.get("sex"))
            profile_result={"indicator": profile["indicator"], "facet": {"detail": point["detail"], "sex": point.get("sex")},
                "label": profile["label"], "unit": cell["unit"], "direction": point["direction"], "statistic": "median",
                "profile_descriptor_version": profile.get("descriptor_version"), "required_scalar_version": profile.get("required_scalar_version"),
                "scalar_descriptor_version": profile.get("scalar_descriptor_version"),
                "source_facet_label": profile.get("source_facet_label"),
                "denominator_semantics": profile.get("denominator_semantics"), "focal_in_selection": territory_id in members,
                **published}
            if "selected_member_count" in published and "eligible_count" in published:
                profile_result["missing_count"] = max(
                    0, published["selected_member_count"] - published["eligible_count"])
            if selected_fields is not None:
                profile_result=_project_comparison_result_fields(profile_result,selected_fields)
            output.append(profile_result)
            continue
        point = profile.get("comparison_point")
        if not point or point.get("direction") not in ("high", "low"):
            raise HTTPException(503, "Profile detail comparison point is invalid")
        detail, sex = point["detail"], point.get("sex")
        contract = detail_contracts.get(profile["indicator"])
        if not contract or contract[1] != detail or contract[2] != sex:
            raise HTTPException(503, "Profile comparison point does not match its published descriptor")
        if contract[6]:
            if not contract[7] or not str(contract[7]).strip():
                raise HTTPException(503, "Profile comparison unit is unavailable")
            unit = contract[7]
        else:
            if not contract[3] or (contract[7] is not None and contract[7] != contract[3]):
                raise HTTPException(503, "Legacy profile comparison unit is incompatible")
            unit = contract[7] if contract[7] is not None else contract[3]
        cell = next((c for c in profile["cells"] if c["detail"] == detail and c.get("sex") == sex), None)
        if cell is None:
            raise HTTPException(503, "Profile comparison cell is unavailable")
        normalized = [(r[1], r[2], r[3]) for r in detail_by_profile.get(profile["indicator"], [])]
        output.append(summary(profile, {"detail": detail, "sex": sex}, unit,
                              point["direction"], normalized,
                              detail_sources.get(profile["indicator"], []),
                              include_missing_count=True))
    return output


def _selected_scalar_comparison_inputs(conn, *, theme_id, indicator_id, cohort_type,
                                       members, territory_id, territory_type):
    """Read scalar values and the distinct provenance needed by their comparison.

    Comparison results expose the set of sources per indicator, not provenance
    for every observation. Keep the large value result narrow, then fetch each
    peer indicator's distinct source/vintage records in one bounded query.
    """
    observations = conn.execute(
        """SELECT o.indicator_id,o.territory_id,o.territory_type,o.value,o.status
           FROM scalar_observation o JOIN scalar_descriptor d USING(indicator_id)
           WHERE d.theme_id=%s AND (%s::text IS NULL OR d.indicator_id=%s)
             AND ((o.territory_type=%s AND o.territory_id=ANY(%s))
               OR (o.territory_id=%s AND o.territory_type=%s))""",
        (theme_id, indicator_id, indicator_id, cohort_type, list(members),
         territory_id, territory_type),
    ).fetchall()
    source_rows = []
    if members:
        source_rows = conn.execute(
            """SELECT DISTINCT os.indicator_id,os.source_id,os.vintage_id,sd.name,
                      sv.version,sv.reference_date,sv.publication_date
               FROM scalar_observation_source os
               JOIN scalar_descriptor d USING(indicator_id)
               JOIN territory_reference t ON t.territory_id=os.territory_id
               JOIN source_dataset sd USING(source_id)
               JOIN source_vintage sv USING(source_id,vintage_id)
               WHERE d.theme_id=%s AND (%s::text IS NULL OR d.indicator_id=%s)
                 AND os.territory_id=ANY(%s) AND t.territory_type=%s
               ORDER BY os.indicator_id,os.source_id,os.vintage_id""",
            (theme_id, indicator_id, indicator_id, list(members), cohort_type),
        ).fetchall()
    return observations, _comparison_sources_by_indicator(source_rows)


def _scalar_comparison_publication_marker(conn):
    """Return a compatible fixed-scalar comparison marker from this snapshot."""
    installed = conn.execute("SELECT to_regclass('scalar_comparison_publication')").fetchone()
    if not installed or not installed[0]:
        raise HTTPException(503, "Published scalar comparison is unavailable")
    marker = _execute_comparison_publication_read(conn, """SELECT p.content_version,p.scalar_content_version,p.reference_content_version,
            p.group_row_count,p.territory_row_count,s.content_version,s.reference_content_version,
            t.content_version
        FROM scalar_comparison_publication p
        JOIN table_publication s ON s.table_name='scalar_observation'
        JOIN table_publication t ON t.table_name='territory_reference'
        WHERE p.singleton""").fetchone()
    if (not marker or not marker[0] or marker[1] != marker[5] or marker[2] != marker[7]
            or marker[6] != marker[7] or marker[3] < 1 or marker[4] < 1):
        raise HTTPException(503, "Published scalar comparison is stale or incompatible")
    return marker


def _published_scalar_comparison_results(conn, scalar_descriptors, fixed_context,
                                         cohort_type, members, territory_id, *, include_ties=False,
                                         include_member_ranks=False, selected_fields=None):
    """Read validated group statistics and one territory's precomputed result."""
    context, group_id, territory_type = fixed_context
    comparable = [row for row in scalar_descriptors
        if row[4] == row[0] and row[3] in ("high", "low") and cohort_type in row[5]]
    if not comparable:
        return {}
    marker = _scalar_comparison_publication_marker(conn)
    indicator_ids = [row[0] for row in comparable]
    selected = (_COMPARISON_RESULT_FIELDS - {"member_ranks"}) if selected_fields is None else set(selected_fields)
    groups = _execute_comparison_publication_read(conn, """SELECT indicator_id,statistic,
        CASE WHEN %s THEN median ELSE NULL::double precision END,member_count,eligible_count,missing_count,lineage_source_count,
        ((eligible_count=0 AND median IS NULL) OR
         (eligible_count>0 AND median IS NOT NULL AND median NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))) AS median_valid
        FROM scalar_comparison_group
        WHERE comparison_context=%s AND group_id=%s AND territory_type=%s
          AND indicator_id=ANY(%s)""", ("median" in selected,context, group_id, territory_type, indicator_ids)).fetchall()
    territories = _execute_comparison_publication_read(conn, """SELECT indicator_id,
        CASE WHEN %s THEN value ELSE NULL::double precision END,status,
        CASE WHEN %s THEN rank ELSE NULL::integer END,
        CASE WHEN %s THEN tie_count ELSE NULL::integer END,
        CASE WHEN %s THEN rank_size ELSE NULL::integer END,
         ((status='measured' AND value IS NOT NULL AND rank IS NOT NULL AND tie_count IS NOT NULL AND rank_size IS NOT NULL
             AND tie_count>=1 AND rank_size>=1 AND rank>=1 AND rank<=rank_size AND tie_count<=rank_size
             AND rank+tie_count<=rank_size+1)
         OR (status IN ('suppressed','unsupported','not_available','not_published')
             AND value IS NULL AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)) AS result_valid
        FROM scalar_comparison_territory
        WHERE comparison_context=%s AND group_id=%s AND territory_type=%s
          AND territory_id=%s AND indicator_id=ANY(%s)""",
        ("focal_value" in selected,"rank" in selected,"rank_ties" in selected,"rank_size" in selected,
         context, group_id, territory_type, territory_id, indicator_ids)).fetchall()
    peer_territories = []
    if include_member_ranks and "member_ranks" in selected:
        peer_territories = _execute_comparison_publication_read(conn, """SELECT indicator_id,territory_id,status,
            rank,tie_count,rank_size,
             ((status='measured' AND value IS NOT NULL AND rank IS NOT NULL AND tie_count IS NOT NULL
                 AND rank_size IS NOT NULL AND tie_count>=1 AND rank_size>=1 AND rank>=1
                 AND rank<=rank_size AND tie_count<=rank_size AND rank+tie_count<=rank_size+1) OR
             (status IN ('suppressed','unsupported','not_available','not_published') AND value IS NULL
                AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)) AS result_valid
            FROM scalar_comparison_territory
            WHERE comparison_context=%s AND group_id=%s AND territory_type=%s
              AND territory_id=ANY(%s) AND indicator_id=ANY(%s)
            ORDER BY indicator_id,territory_id""",
            (context, group_id, territory_type, list(members), indicator_ids)).fetchall()
    group_by_indicator = {row[0]: row[1:] for row in groups}
    territory_by_indicator = {row[0]: row[1:] for row in territories}
    peers_by_indicator = {}
    for row in peer_territories:
        indicator_id, territory_id = row[:2]
        peers = peers_by_indicator.setdefault(indicator_id, {})
        if territory_id in peers:
            raise HTTPException(503, "Published scalar comparison contains duplicate peer ranks")
        peers[territory_id] = row[2:]
    if len(group_by_indicator) != len(groups) or len(territory_by_indicator) != len(territories):
        raise HTTPException(503, "Published scalar comparison contains duplicate results")
    for indicator_id in indicator_ids:
        group = group_by_indicator.get(indicator_id)
        territory = territory_by_indicator.get(indicator_id)
        if not group or not territory:
            raise HTTPException(503, "Published scalar comparison is incomplete")
        statistic, median_value, member_count, eligible_count, missing_count, lineage_count, median_valid = group
        value, status, rank, tie_count, rank_size = territory[:5]
        territory_valid = territory[5]
        if (statistic != "median" or member_count != len(members) or
                eligible_count + missing_count != member_count or
                not median_valid or not territory_valid):
            raise HTTPException(503, "Published scalar comparison result is invalid")
    sources = _published_comparison_sources(conn, family="scalar", context=context,
        group_id=group_id, cohort_type=cohort_type, facets=set(indicator_ids),
        content_version=marker[0], expected_counts={indicator: group_by_indicator[indicator][5]
            for indicator in indicator_ids})
    results = {}
    for indicator_id in indicator_ids:
        _statistic, median_value, member_count, eligible_count, missing_count, _lineage_count, _median_valid = group_by_indicator[indicator_id]
        value, status, rank, tie_count, rank_size = territory_by_indicator[indicator_id][:5]
        results[indicator_id] = {
            "status": "available" if eligible_count else "unavailable",
            "reason": None if eligible_count else "no_selected_comparable_values",
            **({"selected_member_count":member_count} if "selected_member_count" in selected else {}),
            **({"eligible_count":eligible_count} if "eligible_count" in selected else {}),
            **({"missing_count":missing_count} if "missing_count" in selected else {}),
            **({"focal_value":value if status == "measured" else None} if "focal_value" in selected else {}),
            **({"median":median_value} if "median" in selected else {}),
            **({"rank":rank} if "rank" in selected else {}),
            **({"rank_size":rank_size if rank is not None else None} if "rank_size" in selected else {}),
            "comparison_sources": sources.get(indicator_id, []),
        }
        if include_ties and "rank_ties" in selected:
            results[indicator_id]["rank_ties"] = tie_count if status == "measured" else None
        if include_member_ranks and "member_ranks" in selected:
            peer_map = peers_by_indicator.get(indicator_id, {})
            if set(peer_map) != set(members) or len(peer_map) != len(members):
                raise HTTPException(503, "Published scalar comparison peer ranks are incomplete")
            peer_eligible = 0
            peer_missing = 0
            ranks = []
            for member_id in members:
                peer_status, peer_rank, peer_ties, peer_size, peer_valid = peer_map[member_id]
                if (peer_status not in ("measured", "suppressed", "unsupported", "not_available", "not_published")
                        or not peer_valid or (peer_status == "measured" and peer_size != eligible_count)):
                    raise HTTPException(503, "Published scalar comparison peer rank is invalid")
                peer_eligible += peer_status == "measured"
                peer_missing += peer_status != "measured"
                ranks.append({"territory_id": member_id,
                    **({"rank": peer_rank, "rank_size": peer_size, "rank_ties": peer_ties}
                       if eligible_count >= 2 and peer_status == "measured" else
                        {"rank": None, "rank_size": None, "rank_ties": None})})
            if peer_eligible != eligible_count or peer_missing != missing_count:
                raise HTTPException(503, "Published scalar comparison peer statuses do not match group counts")
            results[indicator_id]["member_ranks"] = ranks
    return results


def _theme_comparison_snapshot(conn, territory_type, territory_id, theme_id, selection,
                               *, indicator_id=None, profiles=None, profile_version=None, has_readings=False,
                               result_fields=None, preflight_only=False, snapshot_state=None,
                               include_owned_series=True, include_fixed_context=False,
                               profile_coordinates=None):
    """Read scalar and profile comparisons from the caller's MVCC snapshot."""
    scalar_descriptors = conn.execute(
        """SELECT indicator_id,label,unit,direction,comparison_facet,allowed_levels,descriptor_version
           FROM scalar_descriptor WHERE theme_id=%s AND (%s::text IS NULL OR indicator_id=%s)
           ORDER BY indicator_id""", (theme_id, indicator_id, indicator_id)
    ).fetchall()
    if preflight_only and profiles is None:
        profile_rows = conn.execute("""SELECT indicator_id,comparison_scalar FROM profile_descriptor
            WHERE theme_id=%s AND %s=ANY(allowed_levels)
              AND (%s::text IS NULL OR indicator_id=%s)
            ORDER BY indicator_id""",
            (theme_id, territory_type, indicator_id, indicator_id)).fetchall()
        profiles = [{"indicator": row[0], "comparison_scalar": row[1]}
                    for row in profile_rows]
    elif profiles is None:
        profiles, profile_version = focal_profiles(conn, territory_type, territory_id,
            theme_id=theme_id, indicator_id=indicator_id)
    owned_descriptors=[]
    if include_owned_series and conn.execute(
            "SELECT to_regclass('series_dataset_descriptor')").fetchone()[0]:
        has_theme=conn.execute("""SELECT EXISTS(SELECT 1 FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name='series_dataset_descriptor' AND column_name='theme_id')""").fetchone()[0]
        has_route=conn.execute("""SELECT EXISTS(SELECT 1 FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name='series_dataset_descriptor' AND column_name='active_read_route')""").fetchone()[0]
        if has_theme and has_route:
            owned_descriptors=conn.execute("""SELECT dataset_id,indicator_id FROM series_dataset_descriptor
                WHERE theme_id=%s AND active_read_route AND %s=ANY(allowed_levels)
                  AND (%s::text IS NULL OR indicator_id=%s)
                ORDER BY indicator_id""",(theme_id,territory_type,indicator_id,indicator_id)).fetchall()
    collections = collection_descriptors(conn,indicator_id=indicator_id,theme_id=theme_id)
    available_comparison_fields = set()
    if scalar_descriptors or profiles:
        available_comparison_fields.update(_COMPARISON_RESULT_FIELDS - {"mean", "mean_curve"})
    if owned_descriptors:
        owned_stats=conn.execute("""SELECT DISTINCT COALESCE(comparison_statistic,'median')
            FROM series_dataset_descriptor WHERE (dataset_id,indicator_id) IN
              (SELECT * FROM unnest(%s::text[],%s::text[])) AND active_read_route""",
            ([route[0] for route in owned_descriptors],[route[1] for route in owned_descriptors])).fetchall()
        for (statistic,) in owned_stats:
            available_comparison_fields.update({"selected_member_count","eligible_count","missing_count",
                "focal_value","rank","rank_size","rank_ties"})
            available_comparison_fields.add("mean" if statistic=="mean" else "median")
            if statistic=="mean": available_comparison_fields.add("mean_curve")
    for descriptor in collections:
        if descriptor["kind"]=="period_detail":
            available_comparison_fields.update({"selected_member_count","eligible_count","missing_count",
                "median","rank","rank_size"})
        else:
            available_comparison_fields.add("selected_member_count")
    if result_fields is not None:
        unsupported=set(result_fields)-available_comparison_fields-_COMPARISON_MANDATORY_FIELDS
        if unsupported:
            raise HTTPException(422,"Field selection is not declared by any participating comparison resource")
    reading_marker = _demographic_reading_marker(conn) if theme_id == "demographie" else None
    milieux_marker = _milieux_reading_marker(conn) if theme_id == "milieux" else None
    if not scalar_descriptors and not profiles and not owned_descriptors and not collections and not has_readings and not reading_marker and not milieux_marker:
        raise HTTPException(404, "No published facts for this theme")
    reference = conn.execute(
        "SELECT content_version FROM table_publication WHERE table_name='territory_reference'"
    ).fetchone()
    if not reference or not reference[0]:
        raise HTTPException(503, "Territory reference publication is unavailable")
    scalar_marker = None
    if scalar_descriptors:
        scalar_marker = conn.execute(
            """SELECT content_version,reference_content_version FROM table_publication
               WHERE table_name='scalar_observation'"""
        ).fetchone()
        if not scalar_marker or not scalar_marker[0] or scalar_marker[1] != reference[0]:
            raise HTTPException(503, "Scalar publication is unavailable or incompatible")
    cohort_type, members, scope = _comparison_cohort_in_snapshot(
        conn, territory_type, territory_id, selection, snapshot_state)
    if preflight_only:
        fixed_context = _fixed_scalar_comparison_context(conn,territory_type,territory_id,
            selection,cohort_type,members,scope,snapshot_state=snapshot_state)
        if territory_id not in members:
            fixed_context = None
        if any(not p["comparison_scalar"] for p in (profiles or [])):
            if profile_coordinates:
                profile_marker = conn.execute("""SELECT p.content_version,p.reference_content_version,
                    t.content_version FROM table_publication p LEFT JOIN table_publication t
                    ON t.table_name='territory_reference' WHERE p.table_name='declared_profile'""").fetchone()
                if (not profile_marker or not profile_marker[0] or not profile_marker[1]
                        or profile_marker[1] != profile_marker[2]):
                    raise HTTPException(503, "Profile publication is unavailable or incompatible")
            elif fixed_context:
                _profile_comparison_publication_marker(conn)
        scalar_backed_profiles = [p for p in (profiles or []) if p["comparison_scalar"]]
        comparable_scalars = [row for row in scalar_descriptors
            if row[4] == row[0] and row[3] in ("high", "low") and cohort_type in row[5]]
        if fixed_context and (comparable_scalars or scalar_backed_profiles):
            _scalar_comparison_publication_marker(conn)
        if include_owned_series and owned_descriptors:
            routes = [(dataset_id,theme_id,False,indicator,None)
                      for dataset_id,indicator in owned_descriptors]
            _owned_series_comparison_results(conn,routes,territory_type,territory_id,
                selection,cohort=(cohort_type,members,scope),selected_fields=result_fields,
                preflight_only=True)
        for descriptor in collections:
            marker = collection_marker(conn,descriptor)
            collection_comparison_preflight(conn,descriptor,result_fields,fixed_context,marker)
        return {"supported_fields": available_comparison_fields,
                "cohort_type": cohort_type, "members": members, "scope": scope,
                "fixed_context": fixed_context}
    fixed_context = (_fixed_scalar_comparison_context(conn, territory_type, territory_id,
        selection, cohort_type, members, scope, snapshot_state=snapshot_state)
        if scalar_descriptors or profiles or collections else None)
    if fixed_context and territory_id not in members:
        # The current fixed groups all include the focal territory. Keep the
        # request-time contract if a future resolver ever identifies a group
        # that does not, rather than returning that territory's stored peer rank.
        fixed_context = None
    results = []
    if scalar_descriptors:
        published_scalar = (_published_scalar_comparison_results(conn, scalar_descriptors,
            fixed_context, cohort_type, members, territory_id,
            selected_fields=result_fields,
            include_ties=(result_fields is not None and "rank_ties" in result_fields)) if fixed_context else {})
        if fixed_context:
            scalar_sources_by_indicator = {}
            scalar_rows = []
        else:
            scalar_rows, scalar_sources_by_indicator = _selected_scalar_comparison_inputs(
                conn, theme_id=theme_id, indicator_id=indicator_id,
                cohort_type=cohort_type, members=members,
                territory_id=territory_id, territory_type=territory_type)
        by_indicator = {}
        for row in scalar_rows:
            by_indicator.setdefault(row[0], []).append(row)
        for indicator, label, unit, direction, facet, levels, version in scalar_descriptors:
            if not facet or facet != indicator or direction not in ("high", "low") or cohort_type not in levels:
                results.append({"indicator_id": indicator, "status": "unavailable",
                                "reason": "unsupported_comparison_contract"})
                continue
            if fixed_context:
                published = published_scalar.get(indicator)
                if published is None:
                    raise HTTPException(503, "Published scalar comparison omits a declared indicator")
                results.append({"indicator_id": indicator, "label": label, "unit": unit,
                    "direction": direction, "statistic": "median", "descriptor_version": version,
                    "focal_in_selection": territory_id in members, **published})
                continue
            rows = by_indicator.get(indicator, [])
            peers = [row for row in rows if row[2] == cohort_type and row[1] in members]
            values = [(row[1], float(row[3])) for row in peers
                      if row[4] == "measured" and row[3] is not None]
            focal = next((row for row in rows if row[1] == territory_id and row[2] == territory_type), None)
            focal_value = float(focal[3]) if focal and focal[4] == "measured" and focal[3] is not None else None
            rank = (1 + sum(v > focal_value if direction == "high" else v < focal_value
                            for _, v in values)) if focal_value is not None and territory_id in members else None
            sources = scalar_sources_by_indicator.get(indicator, [])
            results.append({"indicator_id": indicator, "label": label, "unit": unit,
                "direction": direction, "statistic": "median", "descriptor_version": version,
                "status": "available" if values else "unavailable",
                "reason": None if values else "no_selected_comparable_values",
                "selected_member_count": len(members), "eligible_count": len(values),
                "missing_count": max(0, len(members) - len(values)), "focal_value": focal_value,
                "focal_in_selection": territory_id in members,
                "median": median([value for _, value in values]) if values else None,
                "rank": rank, "rank_size": len(values) if rank is not None else None,
                "comparison_sources": sources})
    profile_fixed_context = fixed_context if profiles else None
    if profile_coordinates and any(not p.get("comparison_scalar") for p in (profiles or [])):
        # Published comparison projections contain the descriptor's default
        # point. A requested alternate cell is computed from its own published
        # observations in this same read-only snapshot instead.
        profile_fixed_context = None
    profile_result_kwargs = {} if result_fields is None else {"selected_fields":result_fields}
    if profile_coordinates is not None:
        profile_result_kwargs["profile_coordinates"] = profile_coordinates
    profile_results = _profile_comparison_results(conn, profiles, members, cohort_type, territory_id,
        profile_fixed_context, **profile_result_kwargs)
    owned_markers = {}
    if include_owned_series:
        owned_results,owned_markers,_,_,_=_owned_series_comparison_results(conn,
            [(dataset_id,theme_id,False,owned_indicator,None)
              for dataset_id,owned_indicator in owned_descriptors],
            territory_type,territory_id,selection,cohort=(cohort_type,members,scope),
            selected_fields=result_fields)
        results.extend(owned_results)
    collection_results = []
    for descriptor in collections:
        collection_supported=({"status","reason","selected_member_count"}
            if descriptor["kind"]=="anchored_membership" else
            {"status","reason","selected_member_count","eligible_count","missing_count","median","rank","rank_size"})
        collection_fields=(None if result_fields is None else
            tuple(field for field in result_fields if field in collection_supported))
        if collection_fields == ():
            collection_fields=("status",)
        collection_args=(conn,descriptor,territory_type,territory_id,cohort_type,members,
                         fixed_context if territory_id in members else None)
        collection_results.append(collection_comparison(*collection_args) if collection_fields is None else
            collection_comparison(*collection_args,fields=collection_fields))
    results.extend(collection_results)
    reading_cloud = (_demographic_reading_cloud(conn, reading_marker, territory_type, territory_id,
        cohort_type, members, scope) if reading_marker else None)
    if milieux_marker:
        reading_cloud = _milieux_reading_cloud(conn, milieux_marker, territory_type, territory_id,
            cohort_type, members, scope)
    return {"contract": "theme-comparison-v1", "complete_theme": False, "theme_id": theme_id,
        "content_version": (
            scalar_marker[0] if scalar_marker else
            next(iter(owned_markers.values()))[1] if owned_markers else
            collection_results[0]["content_version"] if collection_results else
            reading_marker[0] if reading_marker else
            milieux_marker[0] if milieux_marker else
            None),
        "reading_content_version": reading_marker[0] if reading_marker else milieux_marker[0] if milieux_marker else None,
        "reading_cloud": reading_cloud,
        "collection_content_versions":{result["indicator_id"]:result["content_version"] for result in collection_results},
        "scalar_content_version": scalar_marker[0] if scalar_marker else None,
        "owned_series_content_versions": {
            dataset_id: {"content_version": marker[1], "reference_content_version": marker[2]}
            for dataset_id, marker in owned_markers.items()},
        "service_publication_id": None,
        "building_publication_id": None,
        "reference_content_version": reference[0],
        "selection": None if selection is None else [
            {"territory_type": level, "territory_id": code} for level, code in selection],
        "scope": {**scope, "member_count": len(members)} if scope else None,
        "results": results, "profile_content_version": profile_version,
        "profile_comparisons": profile_results,
        **({"_fixed_context": fixed_context} if include_fixed_context else {})}










def _owned_series_route(conn, indicator_id):
    exists = conn.execute("SELECT to_regclass('series_dataset_descriptor')").fetchone()[0]
    if not exists:
        return None
    declared = conn.execute("SELECT 1 FROM series_dataset_descriptor WHERE indicator_id=%s LIMIT 1",
                            (indicator_id,)).fetchone()
    column = conn.execute("""SELECT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='series_dataset_descriptor'
          AND column_name='active_read_route')""").fetchone()[0]
    if declared and not column:
        raise HTTPException(503, "Owned-series active publication route is not declared")
    routes = (conn.execute("""SELECT dataset_id,theme_id,indicator_id FROM series_dataset_descriptor
        WHERE indicator_id=%s AND active_read_route""", (indicator_id,)).fetchall()
        if column else [])
    has_reference_descriptors=conn.execute("SELECT to_regclass('series_named_reference_descriptor')").fetchone()[0]
    reference_aliases = (conn.execute("""SELECT d.dataset_id,s.theme_id,d.indicator_id,d.reference_id
        FROM series_named_reference_descriptor d JOIN series_dataset_descriptor s
          USING(dataset_id,indicator_id)
        WHERE d.reference_indicator_id=%s AND d.active_read_route""",(indicator_id,)).fetchall()
        if has_reference_descriptors else [])
    declared_alias = (conn.execute("""SELECT 1 FROM series_named_reference_descriptor
        WHERE reference_indicator_id=%s LIMIT 1""",(indicator_id,)).fetchone()
        if has_reference_descriptors else None)
    if len(routes)+len(reference_aliases)>1:
        raise HTTPException(503, "Indicator has ambiguous active owned-series routes")
    if routes:
        dataset_id,theme_id,owner_indicator=routes[0]
        return (dataset_id,theme_id,False,owner_indicator,None)
    if reference_aliases:
        dataset_id,theme_id,owner_indicator,reference_id=reference_aliases[0]
        return (dataset_id,theme_id,True,owner_indicator,reference_id)
    if declared or declared_alias:
        raise HTTPException(503, "Owned-series active publication route is not declared")
    return None


def _batch_indicator_resource(conn, indicator_id, snapshot_state):
    """Resolve route metadata once for an indicator within this batch snapshot."""
    cached = snapshot_state.indicator_resources.get(indicator_id)
    if cached is not None:
        return cached
    shape_rows = []
    scalar_descriptor = None
    profile_descriptor = None
    scalar_exists = conn.execute("SELECT to_regclass('scalar_descriptor')").fetchone()[0]
    scalar_row = (conn.execute(
        "SELECT theme_id,allowed_levels FROM scalar_descriptor WHERE indicator_id=%s",
        (indicator_id,)).fetchone() if scalar_exists else None)
    if scalar_row:
        scalar_descriptor = (scalar_row[0], tuple(scalar_row[1]))
        shape_rows.append(("scalar_descriptor", "scalar"))
    profile_exists = conn.execute("SELECT to_regclass('profile_descriptor')").fetchone()[0]
    profile_row = (conn.execute(
        "SELECT theme_id,allowed_levels FROM profile_descriptor WHERE indicator_id=%s",
        (indicator_id,)).fetchone() if profile_exists else None)
    if profile_row:
        profile_descriptor = (profile_row[0], tuple(profile_row[1]))
        shape_rows.append(("profile_descriptor", "profile"))
    series_exists = conn.execute("SELECT to_regclass('series_descriptor')").fetchone()[0]
    if series_exists and conn.execute(
            "SELECT 1 FROM series_descriptor WHERE indicator_id=%s", (indicator_id,)).fetchone():
        shape_rows.append(("series_descriptor", "series"))
    owned = _owned_series_route(conn, indicator_id)
    collections = tuple(collection_descriptors(conn, indicator_id=indicator_id))
    resolved = _ResolvedIndicatorResource(None, tuple(shape_rows), owned, collections,
                                          scalar_descriptor, profile_descriptor)
    snapshot_state.indicator_resources[indicator_id] = resolved
    return resolved


def _owned_series_context(conn, dataset_id, indicator_id, territory_type, territory_id, points, *, project_value=True):
    """Only the declared matching-period parent facts, in the caller snapshot."""
    if not conn.execute("SELECT to_regclass('series_context_parent_policy')").fetchone()[0]:
        return {}
    policies = dict(conn.execute("""SELECT focal_level,parent_level FROM series_context_parent_policy
        WHERE dataset_id=%s AND indicator_id=%s""", (dataset_id,indicator_id)).fetchall())
    if not policies:
        return {}
    parent_level = policies.get(territory_type)
    if not parent_level or not points:
        return {"context": None}
    if parent_level == "epci":
        parents = conn.execute("""SELECT p.territory_id,p.territory_type,p.name
            FROM territory_reference f JOIN territory_reference p ON p.territory_id=f.epci_id
            WHERE f.territory_id=%s AND p.territory_type=%s""", (territory_id,parent_level)).fetchall()
    else:
        parents = conn.execute("SELECT territory_id,territory_type,name FROM territory_reference WHERE territory_type=%s",
                               (parent_level,)).fetchall()
    if len(parents) > 1:
        raise HTTPException(503,"Series context parent reference is ambiguous")
    if not parents:
        return {"context": None}
    parent_id,parent_type,parent_name = parents[0]
    axes = [point["axis"] for point in points]
    rows = conn.execute("""SELECT o.axis_value,o.observation_period,
        CASE WHEN %s THEN o.value ELSE NULL::double precision END AS value,o.status,
        json_agg(json_build_object('revision_id',v.provenance_revision_id,'source_id',v.source_id,
          'vintage_id',v.vintage_id,'source_name',v.source_name,'dataset_name',v.dataset_name,
          'version',v.source_version,'reference_date',v.reference_date,'publication_date',v.publication_date,
          'revision_hash',v.revision_hash) ORDER BY v.provenance_revision_id)
        FROM series_dataset_observation o JOIN series_observation_provenance p
          USING(dataset_id,indicator_id,territory_id,axis_value)
        JOIN series_provenance_revision v USING(provenance_revision_id)
        WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_id=%s
          AND o.axis_value=ANY(%s) AND o.observation_period=o.axis_value
        GROUP BY o.axis_value,o.observation_period,o.value,o.status ORDER BY o.axis_value""",
        (project_value,dataset_id,indicator_id,parent_id,axes)).fetchall()
    return {"context": {"parent":{"id":parent_id,"type":parent_type,"name":parent_name},
        "points":[{"axis":axis,"observation_period":period,**({"value":value} if project_value else {}),"status":status,"provenance":sources}
                  for axis,period,value,status,sources in rows]}}


def _owned_series_snapshot(conn, dataset_id, territory_type, territory_id, indicator_id, *, fields=None,
                           preflight_only=False):
    """Read one active owned series, its focal points and named references in the caller snapshot."""
    selection = normalize_field_selection(fields, {"value", "status"})
    project_value = selection is None or "value" in selection
    marker = conn.execute("""SELECT p.content_version,p.reference_content_version,p.row_count,p.published_at,
        t.content_version FROM series_dataset_publication p CROSS JOIN table_publication t
        WHERE p.dataset_id=%s AND t.table_name='territory_reference'""", (dataset_id,)).fetchone()
    if not marker or marker[1] != marker[4]:
        raise HTTPException(503, "Owned-series publication is stale or unavailable")
    descriptor = conn.execute("""SELECT axis_kind,axis_values,axis_numeric_values,completeness,label,unit,
        direction,descriptor_version,allowed_levels,comparison_point,theme_id,observation_period_kind,
        COALESCE(to_jsonb(series_dataset_descriptor)->>'absence_semantics','unavailable'),
        comparison_statistic,comparison_scope
        FROM series_dataset_descriptor WHERE dataset_id=%s AND indicator_id=%s AND active_read_route""",
        (dataset_id,indicator_id)).fetchone()
    if not descriptor:
        raise HTTPException(503, "Owned-series active publication route is not declared")
    if territory_type not in descriptor[8]:
        raise HTTPException(422, "Owned series is not declared for this territory level")
    focal = conn.execute("SELECT name,territory_type FROM territory_reference WHERE territory_id=%s",
                         (territory_id,)).fetchone()
    if not focal:
        raise HTTPException(404, "Focal territory not found")
    if focal[1] != territory_type:
        raise HTTPException(422, "Focal territory type does not match route")
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[1],
                "supported_fields": {"value", "status"}}
    facts = conn.execute("""SELECT o.axis_value,o.observation_period,
        CASE WHEN %s THEN o.value ELSE NULL::double precision END AS value,o.status,o.missing_reason,
        p.provenance_revision_id,p.source_id,p.vintage_id,p.source_name,p.dataset_name,p.source_version,
        p.reference_date,p.publication_date,p.revision_hash,o.state_role
        FROM series_dataset_observation o LEFT JOIN series_observation_provenance a
        USING(dataset_id,indicator_id,territory_id,axis_value)
        LEFT JOIN series_provenance_revision p USING(provenance_revision_id)
        WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_id=%s
        ORDER BY array_position(%s::text[],o.axis_value),p.provenance_revision_id""",
        (project_value,dataset_id,indicator_id,territory_id,list(descriptor[1]))).fetchall()
    references = conn.execute("""SELECT r.reference_id,d.reference_label,d.reference_role,d.reference_statistic,
        r.axis_value,r.observation_period,CASE WHEN %s THEN r.value ELSE NULL::double precision END AS value,r.status,r.missing_reason,p.provenance_revision_id,
        p.source_id,p.vintage_id,p.source_name,p.dataset_name,p.source_version,p.reference_date,p.publication_date,
        p.revision_hash,d.required
        FROM series_named_reference_descriptor d LEFT JOIN series_named_reference r
          USING(dataset_id,indicator_id,reference_id)
        LEFT JOIN series_named_reference_provenance a USING(dataset_id,indicator_id,reference_id,axis_value)
        LEFT JOIN series_provenance_revision p USING(provenance_revision_id)
        WHERE d.dataset_id=%s AND d.indicator_id=%s
        ORDER BY d.reference_id,array_position(%s::text[],r.axis_value),p.provenance_revision_id""",
        (project_value,dataset_id,indicator_id,list(descriptor[1]))).fetchall()
    row_count = conn.execute("""SELECT (SELECT count(*) FROM series_dataset_observation WHERE dataset_id=%s) +
        (SELECT count(*) FROM series_named_reference WHERE dataset_id=%s)""",(dataset_id,dataset_id)).fetchone()[0]
    if row_count != marker[2]:
        raise HTTPException(503, "Owned series marker row count does not match its facts")
    no_record = not facts and descriptor[12] == "no_record" and descriptor[3] == "may_be_missing"
    if not facts and not no_record:
        raise HTTPException(503, "Owned series focal curve is incomplete")
    def lineage(row, offset):
        if row[offset] is None:
            raise HTTPException(503, "Owned series provenance is incomplete")
        return {"revision_id":row[offset],"source_id":row[offset+1],"vintage_id":row[offset+2],
            "source_name":row[offset+3],"dataset_name":row[offset+4],"version":row[offset+5],
            "reference_date":row[offset+6],"publication_date":row[offset+7],"revision_hash":row[offset+8]}
    points=[]
    for axis in descriptor[1]:
        if no_record:
            break
        matching=[row for row in facts if row[0]==axis]
        if not matching:
            if descriptor[3]=="dense_complete":
                raise HTTPException(503,"Owned series declared axis point is missing")
            missing_point={"axis":axis,"observation_period":None,"status":"missing",
                "missing_reason":None,"provenance":[]}
            if project_value: missing_point["value"]=None
            points.append(missing_point)
            continue
        row=matching[0]
        point={"axis":row[0],"observation_period":row[1],"status":row[3],
            "missing_reason":row[4],"provenance":[lineage(item,5) for item in matching]}
        if project_value: point["value"]=row[2]
        points.append(point)
        if row[14] is not None:
            points[-1]["state_role"] = row[14]
    reference_groups={}
    required_ids=set()
    for row in references:
        rid,label,role,statistic,axis,period,value,status,reason=row[:9]
        if row[18]: required_ids.add(rid)
        if axis is None:
            if row[18]: raise HTTPException(503,"Required owned named reference is empty")
            continue
        if axis not in descriptor[1]:
            raise HTTPException(503,"Owned named reference contains an undeclared axis")
        group=reference_groups.setdefault(rid,{"id":rid,"label":label,"role":role,
            "statistic":statistic,"unit":descriptor[5],
            "observation_period_kind":descriptor[11],"points":[]})
        point=next((item for item in group["points"] if item["axis"]==axis),None)
        if point is None:
            point={"axis":axis,"observation_period":period,"status":status,
                "missing_reason":reason,"provenance":[]}
            if project_value: point["value"]=value
            group["points"].append(point)
            point["provenance"].append(lineage(row,9))
    for rid in required_ids:
        group=reference_groups.get(rid)
        if not group or (descriptor[3]=="dense_complete" and
            [point["axis"] for point in group["points"]] != list(descriptor[1])):
            raise HTTPException(503,"Required owned named reference is incomplete")
    return {"dataset_id":dataset_id,"publication_id":marker[0],"reference_content_version":marker[1],
        "published_at":marker[3],"territory":{"id":territory_id,"type":territory_type,"name":focal[0]},
        "indicator_id":indicator_id,"theme_id":descriptor[10],"axis_kind":descriptor[0],
        "axis_values":descriptor[1],"axis_numeric_values":descriptor[2],"completeness":descriptor[3],
        "label":descriptor[4],"unit":descriptor[5],"direction":descriptor[6],
        "descriptor_version":descriptor[7],"comparison_point":descriptor[9],"points":points,"scope_series":[],
        "observation_period_kind":descriptor[11],
        **({"comparison_contract":{"statistic":descriptor[13],"scope":descriptor[14]}}
           if descriptor[14]=="selected_group" else {}),
        **_owned_series_context(conn,dataset_id,indicator_id,territory_type,territory_id,points,
                                project_value=project_value),
        "named_references":list(reference_groups.values()),"availability":"no_record" if no_record else "complete" if all(
            point["status"]=="measured" for point in points) else "incomplete"}


def _owned_named_reference_snapshot(conn, route, territory_type, territory_id, indicator_id, *, fields=None,
                                    preflight_only=False, reference_target_id=None):
    dataset_id, theme_id, _is_reference, owner_indicator, reference_id = route
    selection=normalize_field_selection(fields,{"value","status"})
    project_value=selection is None or "value" in selection
    marker=conn.execute("""SELECT p.content_version,p.reference_content_version,p.row_count,
        t.content_version FROM series_dataset_publication p LEFT JOIN table_publication t
        ON t.table_name='territory_reference' WHERE p.dataset_id=%s""",(dataset_id,)).fetchone()
    if not marker or not marker[0] or marker[1]!=marker[3]:
        raise HTTPException(503,"Owned named-reference publication is unavailable or stale")
    if reference_target_id is None:
        territory=conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",
                               (territory_id,)).fetchone()
        if not territory:
            raise HTTPException(404,"Territory context not found")
        if territory[0]!=territory_type:
            raise HTTPException(422,"Territory context type does not match route")
    elif reference_target_id != reference_id:
        raise HTTPException(404,"Named reference not found")
    descriptor=conn.execute("""SELECT s.axis_kind,s.axis_values,s.unit,d.reference_label,d.reference_role,
        d.reference_statistic,d.required,d.reference_indicator_id,s.observation_period_kind
        FROM series_dataset_descriptor s JOIN series_named_reference_descriptor d
          USING(dataset_id,indicator_id)
        WHERE s.dataset_id=%s AND s.indicator_id=%s AND s.active_read_route
          AND d.reference_id=%s AND d.active_read_route""",
        (dataset_id,owner_indicator,reference_id)).fetchone()
    if not descriptor or descriptor[7]!=indicator_id:
        raise HTTPException(503,"Owned analytical-reference route is unavailable")
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[1],
                "supported_fields": {"value", "status"}}
    rows=conn.execute("""SELECT r.axis_value,r.observation_period,
        CASE WHEN %s THEN r.value ELSE NULL::double precision END AS value,r.status,r.missing_reason,
        p.provenance_revision_id,p.source_id,p.vintage_id,p.source_name,p.dataset_name,p.source_version,
        p.reference_date,p.publication_date,p.revision_hash
        FROM series_named_reference r LEFT JOIN series_named_reference_provenance a
          USING(dataset_id,indicator_id,reference_id,axis_value)
        LEFT JOIN series_provenance_revision p USING(provenance_revision_id)
        WHERE r.dataset_id=%s AND r.indicator_id=%s AND r.reference_id=%s
        ORDER BY array_position(%s::text[],r.axis_value),p.provenance_revision_id""",
        (project_value,dataset_id,owner_indicator,reference_id,list(descriptor[1]))).fetchall()
    if not rows or (descriptor[6] and {row[0] for row in rows}!=set(descriptor[1])):
        raise HTTPException(503,"Required analytical reference is incomplete")
    points=[]
    for axis in descriptor[1]:
        matching=[row for row in rows if row[0]==axis]
        if not matching:
            missing_point={"axis":axis,"observation_period":None,"status":"missing",
                "missing_reason":None,"provenance":[]}
            if project_value: missing_point["value"]=None
            points.append(missing_point)
            continue
        row=matching[0]
        if any(item[5] is None for item in matching):
            raise HTTPException(503,"Analytical-reference provenance is incomplete")
        point={"axis":row[0],"observation_period":row[1],"status":row[3],
            "missing_reason":row[4],"provenance":[{"revision_id":item[5],"source_id":item[6],
                "vintage_id":item[7],"source_name":item[8],"dataset_name":item[9],
                "version":item[10],"reference_date":item[11],"publication_date":item[12],
                "revision_hash":item[13]} for item in matching]}
        if project_value: point["value"]=row[2]
        points.append(point)
    row_count=conn.execute("""SELECT (SELECT count(*) FROM series_dataset_observation
          WHERE dataset_id=%s)+(SELECT count(*) FROM series_named_reference WHERE dataset_id=%s)""",
        (dataset_id,dataset_id)).fetchone()[0]
    if row_count!=marker[2]:
        raise HTTPException(503,"Owned named-reference marker row count is inconsistent")
    return {"dataset_id":dataset_id,"publication_id":marker[0],
        "reference_content_version":marker[1],"indicator_id":indicator_id,"theme_id":theme_id,
        "reference":{"id":reference_id,"label":descriptor[3],"role":descriptor[4],
            "statistic":descriptor[5],"required":descriptor[6]},
        "axis_kind":descriptor[0],"axis_values":descriptor[1],"unit":descriptor[2],
        "observation_period_kind":descriptor[8],
        "points":points,"availability":"complete" if all(p["status"]=="measured" for p in points) else "incomplete"}


def _owned_reference_comparison_result(conn, route, territory_type, territory_id, indicator_id, selection):
    dataset_id,theme_id,_is_reference,owner_indicator,reference_id=route
    marker=conn.execute("""SELECT p.content_version,p.reference_content_version,t.content_version
        FROM series_dataset_publication p LEFT JOIN table_publication t ON t.table_name='territory_reference'
        WHERE p.dataset_id=%s""",(dataset_id,)).fetchone()
    if not marker or not marker[0] or marker[1]!=marker[2]:
        raise HTTPException(503,"Owned analytical-reference publication is unavailable or stale")
    territory=conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",
                           (territory_id,)).fetchone()
    if not territory: raise HTTPException(404,"Territory context not found")
    if territory[0]!=territory_type: raise HTTPException(422,"Territory context type does not match route")
    identity=conn.execute("""SELECT reference_label,reference_role,reference_statistic,active_read_route
        FROM series_named_reference_descriptor WHERE dataset_id=%s AND indicator_id=%s AND reference_id=%s
          AND reference_indicator_id=%s""",(dataset_id,owner_indicator,reference_id,indicator_id)).fetchone()
    if not identity or identity[1]!="analytical_reference":
        raise HTTPException(503,"Analytical-reference identity is unavailable")
    return {"contract":"indicator-comparison-v1","complete_theme":False,"indicator_id":indicator_id,
        "theme_id":theme_id,"shape":"named_reference","content_version":marker[0],
        "reference_content_version":marker[2],"selection":None if selection is None else [
            {"territory_type":level,"territory_id":code} for level,code in selection],
        "scope":None,"result":{"indicator_id":indicator_id,"label":identity[0],
            "role":identity[1],"statistic":identity[2],"status":"unavailable",
            "reason":"analytical_reference_has_no_focal_or_cohort_comparison",
            "selected_member_count":0,"eligible_count":0,"median":None,"rank":None,
            "comparison_sources":[]}}


def _owned_series_comparison_results(conn, routes, territory_type, territory_id, selection,
                                     cohort=None, selected_fields=None, strict_fields=False,
                                     preflight_only=False):
    if not routes:
        return [], {}, None, [], None
    cohort_type,members,scope=cohort or _comparison_cohort(
        conn,territory_type,territory_id,selection)
    fixed_context=_fixed_scalar_comparison_context(conn,territory_type,territory_id,selection,
        cohort_type,members,scope)
    datasets=list(dict.fromkeys(route[0] for route in routes))
    indicators=list(dict.fromkeys(route[3] for route in routes))
    markers=conn.execute("""SELECT p.dataset_id,p.content_version,p.reference_content_version,
        t.content_version FROM series_dataset_publication p LEFT JOIN table_publication t
          ON t.table_name='territory_reference' WHERE p.dataset_id=ANY(%s)""",(datasets,)).fetchall()
    marker_by_dataset={row[0]:row for row in markers}
    if len(marker_by_dataset)!=len(datasets) or any(not row[1] or row[2]!=row[3] for row in markers):
        raise HTTPException(503,"Owned-series publication is unavailable or stale")
    ids=list(dict.fromkeys([*members,territory_id]))
    descriptors=conn.execute("""SELECT d.dataset_id,d.indicator_id,d.theme_id,d.comparison_point,d.label,d.unit,
        d.direction,d.allowed_levels,d.descriptor_version,d.axis_values,d.comparison_statistic,
        d.comparison_scope,
        CASE WHEN to_jsonb(d)->>'comparison_levels' IS NULL THEN d.allowed_levels
          ELSE ARRAY(SELECT jsonb_array_elements_text(to_jsonb(d)->'comparison_levels')) END,d.axis_kind
        FROM series_dataset_descriptor d
        WHERE d.dataset_id=ANY(%s) AND d.indicator_id=ANY(%s) AND d.active_read_route""",
        (datasets,indicators)).fetchall()
    descriptor_by_route={(row[0],row[1]):row for row in descriptors}
    if len(descriptor_by_route)!=len(routes):
        raise HTTPException(503,"Owned-series active publication route is unavailable")
    if strict_fields and selected_fields is not None:
        stats={row[10] or "median" for row in descriptors}
        supported={"status","reason","selected_member_count","eligible_count","missing_count",
                   "focal_value","rank","rank_size","rank_ties"}
        if "median" in stats: supported.add("median")
        if "mean" in stats: supported.update({"mean","mean_curve"})
        _validate_comparison_fields(selected_fields,supported)
    if preflight_only:
        # Dataset/reference markers and descriptors above are metadata-only.
        # Resolve fixed comparison publication dependencies before any item
        # reader can fetch observations or published group/result rows.
        for route in routes:
            descriptor = descriptor_by_route[(route[0], route[3])]
            valid_fixed = bool(fixed_context and descriptor[3] and descriptor[3] in descriptor[9]
                and descriptor[6] in ("high", "low") and descriptor[7] and descriptor[12]
                and territory_type in descriptor[7] and territory_type in descriptor[12]
                and cohort_type in descriptor[12]
                and ((descriptor[10] or "median") == "mean" and descriptor[11] == "selected_group"
                     or (descriptor[10] or "median") == "median" and descriptor[11] == "default_group"))
            if valid_fixed:
                publication = _execute_comparison_publication_read(conn, """SELECT p.content_version,
                    p.ordered_series_content_version,p.reference_content_version,
                    p.group_row_count,p.territory_row_count,s.content_version,t.content_version
                    FROM ordered_series_comparison_publication p
                    JOIN series_dataset_publication s ON s.dataset_id=p.dataset_id
                    JOIN table_publication t ON t.table_name='territory_reference'
                    WHERE p.dataset_id=%s AND p.indicator_id=%s""",
                    (route[0], route[3])).fetchone()
                if (not publication or not publication[0] or publication[1] != marker_by_dataset[route[0]][1]
                        or publication[2] != marker_by_dataset[route[0]][3]
                        or publication[5] != marker_by_dataset[route[0]][1]
                        or publication[6] != marker_by_dataset[route[0]][3]
                        or publication[3] < 1 or publication[4] < 1):
                    raise HTTPException(503, "Owned-series fixed comparison is unavailable or stale")
        return [], {}, fixed_context, members, scope
    fixed_projection_read=bool(fixed_context is not None and fixed_context[2]==cohort_type and all(
        (descriptor:=descriptor_by_route.get((route[0],route[3]))) is not None and
        descriptor[3] and descriptor[3] in descriptor[9] and descriptor[6] in ("high","low") and
        ((descriptor[10] or "median")=="mean" and descriptor[11]=="selected_group" or
         (descriptor[10] or "median")=="median" and descriptor[11]=="default_group") and
        territory_type in descriptor[7] and territory_type in descriptor[12] and cohort_type in descriptor[12]
        for route in routes))
    observation_columns=("o.territory_id,o.status,a.provenance_revision_id,o.axis_value,o.missing_reason"
        if fixed_projection_read else "o.territory_id,o.value,o.status,a.provenance_revision_id,o.axis_value,o.missing_reason")
    rows=([(route[0],route[3]) for route in routes] if fixed_projection_read else conn.execute(f"""SELECT d.dataset_id,d.indicator_id,{observation_columns}
        FROM series_dataset_descriptor d
        LEFT JOIN series_dataset_observation o ON o.dataset_id=d.dataset_id AND o.indicator_id=d.indicator_id
          AND (d.comparison_statistic='mean' OR o.axis_value=d.comparison_point OR
            (d.axis_kind='declared_detail' AND o.state_role IS NOT NULL))
          AND o.territory_type=%s AND o.territory_id=ANY(%s)
        LEFT JOIN series_observation_provenance a ON a.dataset_id=d.dataset_id
          AND a.indicator_id=d.indicator_id AND a.territory_id=o.territory_id
          AND a.axis_value=o.axis_value
        WHERE d.dataset_id=ANY(%s) AND d.indicator_id=ANY(%s) AND d.active_read_route
         ORDER BY d.dataset_id,d.indicator_id,o.territory_id,o.axis_value,a.provenance_revision_id""",
        (cohort_type,ids,datasets,indicators)).fetchall())
    revision_index=4 if fixed_projection_read else 5
    revision_ids=[] if fixed_projection_read else list(dict.fromkeys(row[revision_index] for row in rows if row[revision_index] is not None))
    revisions=conn.execute("""SELECT provenance_revision_id,source_id,vintage_id,source_name,dataset_name,
        source_version,reference_date,publication_date,revision_hash
        FROM series_provenance_revision WHERE provenance_revision_id=ANY(%s)
        ORDER BY provenance_revision_id""",(revision_ids,)).fetchall() if revision_ids else []
    revision_by_id={row[0]:row for row in revisions}
    by_route={}
    for row in rows:
        key=(row[0],row[1]); by_route.setdefault(key,[]).append(row)
    results=[]
    for dataset_id,theme_id,_is_reference,indicator_id,*_ in routes:
        key=(dataset_id,indicator_id); matching=by_route.get(key,[])
        if not matching:
            raise HTTPException(503,"Owned-series active publication route is unavailable")
        descriptor=descriptor_by_route.get(key)
        if descriptor is None:
            raise HTTPException(503,"Owned-series active publication route is unavailable")
        (_dataset,_indicator,_theme,point,label,unit,direction,levels,version,axes,
         statistic,comparison_scope,comparison_levels,axis_kind)=descriptor
        metric = statistic or "median"
        selected = set(_COMPARISON_RESULT_FIELDS) if selected_fields is None else set(selected_fields)
        marker=marker_by_dataset[dataset_id]
        content_version,reference_version,territory_version=marker[1],marker[2],marker[3]
        if not content_version or reference_version!=territory_version:
            raise HTTPException(503,"Owned-series publication is stale or unavailable")
        if territory_type not in levels:
            raise HTTPException(422,"Indicator is not declared for this territory level")
        statistic=statistic or "median"
        mean_contract = statistic=="mean" and comparison_scope=="selected_group"
        median_contract = statistic=="median" and comparison_scope=="default_group"
        valid=bool(point and point in axes and direction in ("high","low") and
            (mean_contract or median_contract) and territory_type in comparison_levels and cohort_type in comparison_levels)
        observations=[] if fixed_projection_read else [r for r in matching if r[2] is not None]
        if fixed_projection_read:
            observations=[(*row[:3],None,*row[3:]) for row in observations]
        provenance_index=5
        if valid and any(r[provenance_index] is None or r[provenance_index] not in revision_by_id for r in observations):
            raise HTTPException(503,"Owned series comparison provenance is incomplete")
        axis_index = 6
        if valid and fixed_context is not None:
            publication=_execute_comparison_publication_read(conn, """SELECT p.content_version,p.ordered_series_content_version,
                p.reference_content_version,p.group_row_count,p.territory_row_count,
                s.content_version,t.content_version,p.comparison_axes
              FROM ordered_series_comparison_publication p
              JOIN series_dataset_publication s ON s.dataset_id=p.dataset_id
              JOIN table_publication t ON t.table_name='territory_reference'
              WHERE p.dataset_id=%s AND p.indicator_id=%s""",(dataset_id,indicator_id)).fetchone()
            if (not publication or not publication[0] or publication[1]!=content_version or
                    publication[2]!=territory_version or publication[5]!=content_version or
                    publication[6]!=territory_version or publication[3]<1 or publication[4]<1):
                raise HTTPException(503,"Owned-series fixed comparison is unavailable or stale")
            context,group_id,fixed_level=fixed_context
            if fixed_level!=cohort_type:
                raise HTTPException(503,"Owned-series fixed comparison level is incompatible")
            groups=_execute_comparison_publication_read(conn, """SELECT axis_value,statistic,
                    CASE WHEN %s THEN group_value ELSE NULL::double precision END,member_count,eligible_count,missing_count,lineage_source_count,
                    ((eligible_count=0 AND group_value IS NULL) OR (eligible_count>0 AND group_value IS NOT NULL
                       AND group_value NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))) AS group_valid
                FROM ordered_series_comparison_group WHERE dataset_id=%s AND indicator_id=%s
                  AND comparison_context=%s AND group_id=%s AND territory_type=%s
                ORDER BY array_position(%s::text[],axis_value)""",
                ((metric in selected) or ("mean_curve" in selected),dataset_id,indicator_id,context,group_id,fixed_level,list(axes))).fetchall()
            territory_results=_execute_comparison_publication_read(conn,"""SELECT t.axis_value,t.territory_id,
                    CASE WHEN %s THEN t.value ELSE NULL::double precision END,t.status,
                    CASE WHEN %s THEN t.rank ELSE NULL::integer END,
                    CASE WHEN %s THEN t.tie_count ELSE NULL::integer END,
                    CASE WHEN %s THEN t.rank_size ELSE NULL::integer END,
                    ((t.status='measured' AND t.value IS NOT NULL AND t.rank IS NOT NULL AND t.tie_count IS NOT NULL
                       AND t.rank_size IS NOT NULL AND t.rank>=1 AND t.rank<=t.rank_size AND t.tie_count>=1
                       AND t.tie_count<=t.rank_size AND t.rank_size=g.eligible_count) OR
                     (t.status<>'measured' AND t.value IS NULL AND t.rank IS NULL AND t.tie_count IS NULL AND t.rank_size IS NULL)) AS result_valid
                FROM ordered_series_comparison_territory t JOIN ordered_series_comparison_group g
                  USING(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value)
                WHERE t.dataset_id=%s AND t.indicator_id=%s AND t.comparison_context=%s
                  AND t.group_id=%s AND t.territory_type=%s AND t.territory_id=%s
                ORDER BY array_position(%s::text[],t.axis_value),t.territory_id""",
                ("focal_value" in selected,"rank" in selected,"rank_ties" in selected,"rank_size" in selected,
                 dataset_id,indicator_id,context,group_id,fixed_level,territory_id,list(axes))).fetchall()
            declared_axes=list(publication[7] or [])
            group_axes=[row[0] for row in groups]
            expected_group_axes=[axis for axis in declared_axes if axis in set(axes)]
            expected_pairs={(axis,territory_id) for axis in group_axes}
            actual_pairs={(row[0],row[1]) for row in territory_results}
            if (not group_axes or group_axes!=expected_group_axes or len(groups)!=len(group_axes) or
                len(territory_results)!=len(expected_pairs) or actual_pairs!=expected_pairs or
                publication[3]<len(groups) or publication[4]<len(territory_results) or
                any(row[1]!=statistic or row[3]!=len(members) or row[3]!=row[4]+row[5] or not row[7]
                    for row in groups)):
                raise HTTPException(503,"Owned-series fixed comparison is incomplete")
            if mean_contract and any(row[4]!=row[3] or row[5]!=0 for row in groups):
                raise HTTPException(503,"Complete-support owned-series comparison is incomplete")
            group_by_axis={row[0]:row for row in groups}
            territory_by_axis_id={(row[0],row[1]):row for row in territory_results}
            comparison_axis=point
            if comparison_axis not in group_by_axis and axis_kind=="declared_detail" and group_axes:
                comparison_axis=group_axes[-1]
            group=group_by_axis.get(comparison_axis)
            focal_result=territory_by_axis_id.get((comparison_axis,territory_id))
            if group is None:
                raise HTTPException(503,"Owned-series fixed comparison point is unavailable")
            enough=group[4]>=2
            comparison_reason=(None if enough else
                ("no_selected_comparable_values" if group[4]==0 else "fewer_than_two_comparable_values"))
            source_axis=None if mean_contract else comparison_axis
            lineage_axes=declared_axes if mean_contract else [comparison_axis]
            lineage_rows=_execute_comparison_publication_read(conn, """SELECT l.axis_value,l.provenance_revision_id
                FROM ordered_series_comparison_lineage l
                WHERE l.dataset_id=%s AND l.indicator_id=%s AND l.comparison_context=%s
                  AND l.group_id=%s AND l.territory_type=%s AND l.axis_value=ANY(%s)
                ORDER BY l.axis_value,l.provenance_revision_id""",
                (dataset_id,indicator_id,context,group_id,fixed_level,lineage_axes)).fetchall()
            lineage_ids=list(dict.fromkeys(row[1] for row in lineage_rows))
            lineage_counts={axis:sum(1 for item in lineage_rows if item[0]==axis) for axis in lineage_axes}
            expected_lineage_counts={row[0]:row[6] for row in groups}
            if (any(expected_lineage_counts.get(axis)!=count
                    for axis,count in lineage_counts.items()) or
                    (not lineage_ids and any(expected_lineage_counts.get(axis,0)>0
                                              for axis in lineage_axes))):
                raise HTTPException(503,"Owned-series comparison provenance is incomplete")
            revisions=conn.execute("""SELECT provenance_revision_id,source_id,vintage_id,source_name,dataset_name,
                source_version,reference_date,publication_date,revision_hash FROM series_provenance_revision
                WHERE provenance_revision_id=ANY(%s) ORDER BY provenance_revision_id""",(lineage_ids,)).fetchall()
            revision_by_id={row[0]:row for row in revisions}
            if set(revision_by_id)!=set(lineage_ids):
                raise HTTPException(503,"Owned-series comparison provenance revision is unavailable")
            sources=[]
            for revision_id in lineage_ids:
                source=revision_by_id.get(revision_id)
                if source is None: raise HTTPException(503,"Owned-series comparison provenance revision is unavailable")
                sources.append({"source_id":source[1],"vintage_id":source[2],"source_name":source[3],
                    "dataset_name":source[4],"version":source[5],"reference_date":source[6],
                    "publication_date":source[7],"revision_hash":source[8]})
            focal_value=(focal_result[2] if focal_result and focal_result[3]=="measured" else None)
            rank=focal_result[4] if focal_result else None
            if focal_result and (focal_result[3] not in ("measured","missing","not_published") or
                                 not focal_result[7]):
                raise HTTPException(503,"Owned-series focal comparison result is incomplete or invalid")
            result={"indicator_id":indicator_id,"theme_id":theme_id,"label":label,"unit":unit,
                "direction":direction,"descriptor_version":version,"source_facet":point,"statistic":statistic,
                "status":"available" if enough else "unavailable",
                "reason":comparison_reason,
                "selected_member_count":len(members),"eligible_count":group[4],"missing_count":group[5],
                "focal_value":focal_value,"focal_in_selection":territory_id in members,
                "rank":rank,"rank_size":focal_result[6] if focal_result and rank is not None else None,
                "comparison_sources":sources,"owned_content_version":content_version}
            if mean_contract:
                zero_rows=_execute_comparison_publication_read(conn, """SELECT reason,member_count FROM ordered_series_comparison_zero_reason
                    WHERE dataset_id=%s AND indicator_id=%s AND comparison_context=%s AND group_id=%s
                      AND territory_type=%s""",(dataset_id,indicator_id,context,group_id,fixed_level)).fetchall()
                zero_reason_counts={row[0]:row[1] for row in zero_rows}
                result["mean"]=group[2] if enough else None
                result["mean_curve"]={"statistic":"mean","axis_kind":axis_kind,
                    "points":[{"axis":row[0],"value":row[2],"status":"measured" if row[4]==row[3] else "unavailable"}
                              for row in groups],"selected_member_count":len(members),
                    "eligible_count":len(members),"model_zero_reason_counts":zero_reason_counts,"scope":scope} if enough else None
            else:
                result["median"]=group[2] if enough else None
            results.append(_project_comparison_result_fields(result,selected_fields))
            continue
        if mean_contract:
            mean_curve_points,member_axis=_complete_owned_mean_curve(axes,members,observations,
                territory_index=2,value_index=3,status_index=4,source_index=5,
                axis_index=axis_index,reason_index=7)
            zero_reason_counts={}
            for member in members:
                reason=member_axis[(member,axes[0])][7]
                if reason:
                    zero_reason_counts[reason]=zero_reason_counts.get(reason,0)+1
            values=[(member,float(member_axis[(member,point)][3])) for member in members
                if (member,point) in member_axis and member_axis[(member,point)][4]=="measured"]
            mean_curve={"statistic":"mean","axis_kind":axis_kind,"points":mean_curve_points,
                "selected_member_count":len(members),"eligible_count":len(members),
                "model_zero_reason_counts":zero_reason_counts,"scope":scope}
        else:
            values=[(r[2],float(r[3])) for r in observations if r[2] in members and
                r[4]=="measured" and r[3] is not None and r[axis_index]==point]
            mean_curve=None
        focal=next((r for r in observations if r[2]==territory_id and r[axis_index]==point),None)
        focal_value=float(focal[3]) if focal and focal[4]=="measured" and focal[3] is not None else None
        enough=valid and len(values)>=2
        rank=(1+sum(value>focal_value if direction=="high" else value<focal_value
            for _,value in values)) if enough and focal_value is not None and territory_id in members else None
        sources=[];seen=set()
        for row in observations:
            if not mean_contract and row[axis_index]!=point: continue
            if row[2] not in members: continue
            revision_id=row[5]
            if revision_id is None or revision_id in seen: continue
            seen.add(revision_id)
            source=revision_by_id.get(revision_id)
            if source is None:
                raise HTTPException(503,"Owned-series comparison provenance revision is unavailable")
            sources.append({"source_id":source[1],"vintage_id":source[2],
                "source_name":source[3],"dataset_name":source[4],"version":source[5],
                "reference_date":source[6],"publication_date":source[7],"revision_hash":source[8]})
        result={"indicator_id":indicator_id,"theme_id":theme_id,"label":label,"unit":unit,
            "direction":direction,"descriptor_version":version,"source_facet":point,
            "statistic":statistic,"status":"available" if enough else "unavailable",
            "reason":None if enough else ("fewer_than_two_comparable_values" if values else
                ("no_selected_comparable_values" if valid else "unsupported_comparison_contract")),
            "selected_member_count":len(members),"eligible_count":len(values),
            "missing_count":max(0,len(members)-len(values)),"focal_value":focal_value,
            "focal_in_selection":territory_id in members,
            "rank":rank,"rank_size":len(values) if rank is not None else None,
            "comparison_sources":sources,"owned_content_version":content_version}
        if mean_contract:
            result["mean"] = mean_curve_points[axes.index(point)]["value"] if enough else None
            result["mean_curve"] = mean_curve if enough else None
        else:
            result["median"] = median([value for _,value in values]) if enough else None
        results.append(result)
    return results, marker_by_dataset, cohort_type, members, scope


def _complete_owned_mean_curve(axes, members, rows, *, territory_index, value_index,
                               status_index, source_index, axis_index, reason_index):
    """Require a complete measured member-by-axis rectangle before averaging.

    Rows are the batched DB observation/provenance join. Multiple provenance
    records for one observation are allowed, but cannot add extra member weight.
    """
    member_set=set(members)
    member_axis={}
    for row in rows:
        territory=row[territory_index]
        axis=row[axis_index]
        if territory not in member_set or axis not in axes:
            continue
        key=(territory,axis)
        previous=member_axis.get(key)
        if previous is not None and (previous[value_index],previous[status_index],previous[reason_index]) != (
                row[value_index],row[status_index],row[reason_index]):
            raise HTTPException(503,"Selected owned-series fact conflicts across provenance rows")
        if previous is None:
            member_axis[key]=row
        if row[source_index] is None:
            raise HTTPException(503,"Selected raccordement member curve lacks provenance")
    for member in members:
        member_rows=[member_axis.get((member,axis)) for axis in axes]
        if any(row is None for row in member_rows):
            continue
        reasons={row[reason_index] for row in member_rows}
        if len(reasons)>1:
            raise HTTPException(503,"Selected raccordement member model-zero reason conflicts across curve axes")
        reason=next(iter(reasons))
        if reason is not None and any(row[value_index] != 0 for row in member_rows):
            raise HTTPException(503,"Selected raccordement model-zero reason conflicts with measured values")
    points=[]
    for axis in axes:
        axis_rows=[member_axis.get((member,axis)) for member in members]
        if members and any(row is None or row[status_index]!="measured" or
                           row[value_index] is None for row in axis_rows):
            raise HTTPException(503,"Selected raccordement member curve is incomplete")
        value=(sum(float(row[value_index]) for row in axis_rows)/len(axis_rows)
               if axis_rows else None)
        points.append({"axis":axis,"value":value,
                       "status":"measured" if axis_rows else "unavailable"})
    return points,member_axis


def _owned_series_comparison_result(conn, route, territory_type, territory_id, indicator_id, selection,
                                    selected_fields=None):
    if selected_fields is not None:
        selected_fields=_validate_comparison_fields(selected_fields,
            _COMPARISON_RESULT_FIELDS-{"focal_value"})
    results,markers,_cohort_type,members,scope=_owned_series_comparison_results(
        conn,[route],territory_type,territory_id,selection,selected_fields=selected_fields,strict_fields=True)
    result=results[0]
    return {"contract":"indicator-comparison-v1","complete_theme":False,
        "indicator_id":indicator_id,"theme_id":route[1],"shape":"series",
        "content_version":result["owned_content_version"],
        "reference_content_version":(markers[route[0]][3] if markers else None),
        "selection":None if selection is None else [
            {"territory_type":level,"territory_id":code} for level,code in selection],
        "scope":{**scope,"member_count":len(members)} if scope else None,
        "result":_comparison_result_without_focal_value(result)}


def _scalar_facet_descriptor(conn, indicator_id, territory_type, expected_theme_id=None):
    row = conn.execute("""SELECT indicator_id,theme_id,label,unit,direction,comparison_facet,
        allowed_levels,denominator_semantics,completeness,descriptor_version
        FROM scalar_descriptor WHERE indicator_id=%s""", (indicator_id,)).fetchone()
    if not row or not row[9] or (expected_theme_id is not None and row[1] != expected_theme_id):
        raise HTTPException(503, "Declared scalar facet descriptor is unavailable or incompatible")
    descriptor = dict(zip(("indicator_id", "theme_id", "label", "unit", "direction",
        "comparison_facet", "allowed_levels", "denominator_semantics", "completeness",
        "descriptor_version"), row))
    if territory_type not in descriptor["allowed_levels"]:
        raise HTTPException(422, "Scalar facet is not declared for this territory level")
    return descriptor


def _scalar_facet_snapshot(conn, territory_type, territory_id, indicator_id, fields=None, *,
                           preflight_only=False, expected_theme_id=None):
    """Read the native scalar facet without changing the ordered-series envelope."""
    marker = conn.execute("""SELECT p.content_version,p.reference_content_version,t.content_version
        FROM table_publication p LEFT JOIN table_publication t
          ON t.table_name='territory_reference' WHERE p.table_name='scalar_observation'""").fetchone()
    if not marker or not marker[0] or not marker[1] or marker[1] != marker[2]:
        raise HTTPException(503, "Scalar facet publication is stale or incompatible")
    descriptor = _scalar_facet_descriptor(conn, indicator_id, territory_type, expected_theme_id)
    territory = conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",
                             (territory_id,)).fetchone()
    if not territory:
        raise HTTPException(404, "Territory not found")
    if territory[0] != territory_type:
        raise HTTPException(422, "Territory target type does not match")

    if fields is None:
        selected = {"value", "support_count", "denominator_count"}
    else:
        selected = set(fields)
        unsupported = selected - {"value", "support_count", "denominator_count"}
        if unsupported:
            raise HTTPException(422, "Field selection is not declared for the scalar facet")
    if preflight_only:
        observation_count = conn.execute("""SELECT count(*) FROM scalar_observation
            WHERE indicator_id=%s AND territory_id=%s AND territory_type=%s""",
            (indicator_id, territory_id, territory_type)).fetchone()[0]
        source_count = conn.execute("""SELECT count(*) FROM scalar_observation_source
            WHERE indicator_id=%s AND territory_id=%s""", (indicator_id, territory_id)).fetchone()[0]
        if observation_count > 1 or (observation_count and not source_count):
            raise HTTPException(503, "Scalar facet observation provenance is incomplete")
        if not observation_count and descriptor["completeness"] != "sparse":
            raise HTTPException(503, "Dense scalar facet observation is missing")
        return {"content_version": marker[0], "reference_content_version": marker[1],
                "work_units": max(1, observation_count + source_count)}

    projections = ["o.status"]
    for field, column in (("value", "value"), ("support_count", "support_count"),
                          ("denominator_count", "denominator_count")):
        if field in selected:
            projections.append(f"o.{column}")
    row = conn.execute("""SELECT """ + ",".join(projections) + """,
        (SELECT json_agg(json_build_object('source_id',os.source_id,'name',sd.name,
            'vintage_id',os.vintage_id,'version',sv.version,'reference_date',sv.reference_date,
            'publication_date',sv.publication_date) ORDER BY os.source_id,os.vintage_id)
         FROM scalar_observation_source os JOIN source_dataset sd USING(source_id)
         JOIN source_vintage sv USING(source_id,vintage_id)
         WHERE os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id) AS sources
        FROM scalar_observation o
        WHERE o.indicator_id=%s AND o.territory_id=%s AND o.territory_type=%s""",
        (indicator_id, territory_id, territory_type)).fetchone()
    observation = {"territory_id": territory_id, "territory_type": territory_type,
                   "status": row[0] if row else "unavailable"}
    if row:
        index = 1
        for field in ("value", "support_count", "denominator_count"):
            if field in selected:
                observation[field] = row[index]
                index += 1
        sources = row[index]
        if not sources:
            raise HTTPException(503, "Scalar facet observation provenance is incomplete")
        observation["sources"] = sources
    else:
        if descriptor["completeness"] != "sparse":
            raise HTTPException(503, "Dense scalar facet observation is missing")
        for field in ("value", "support_count", "denominator_count"):
            if field in selected:
                observation[field] = None
        observation["sources"] = []

    return {"shape": "scalar", "source_facet": indicator_id,
        "content_version": marker[0], "reference_content_version": marker[1],
        "descriptor_version": descriptor["descriptor_version"],
        "descriptor": descriptor, "observation": observation}


def _indicator_facts_snapshot(conn, territory_type, territory_id, indicator_id, fields=None, *,
                              preflight_only=False, snapshot_state=None,
                              require_declared_resource=False, scalar_facet=False,
                              expected_theme_id=None):
    if scalar_facet:
        return _scalar_facet_snapshot(conn, territory_type, territory_id, indicator_id,
            fields, preflight_only=preflight_only, expected_theme_id=expected_theme_id)
    if snapshot_state is None:
        shape_rows = []
    else:
        resource = _batch_indicator_resource(conn, indicator_id, snapshot_state)
        shape_rows = list(resource.shape_rows)
    if snapshot_state is None:
        for table, shape in (("scalar_descriptor", "scalar"),
                             ("profile_descriptor", "profile"),
                             ("series_descriptor", "series")):
            if conn.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0] and conn.execute(
                    f"SELECT 1 FROM {table} WHERE indicator_id=%s", (indicator_id,)).fetchone():
                shape_rows.append((table, shape))
        owned = _owned_series_route(conn,indicator_id)
        collections = collection_descriptors(conn,indicator_id=indicator_id)
    else:
        owned = resource.owned_route
        collections = list(resource.collections)
    if owned:
        if owned[2]:
            return _owned_named_reference_snapshot(conn,owned,territory_type,territory_id,indicator_id,
                fields=fields,preflight_only=preflight_only)
        return _owned_series_snapshot(conn,owned[0],territory_type,territory_id,indicator_id,
            fields=fields,preflight_only=preflight_only)
    if collections:
        if shape_rows:
            raise HTTPException(503,"Indicator has ambiguous collection/storage declarations")
        return collection_snapshot(conn,collections[0],territory_type,territory_id,fields=fields,
                                   preflight_only=preflight_only)
    if len(shape_rows) > 1:
        raise HTTPException(503, "Indicator has ambiguous published storage shapes")
    shape = shape_rows[0][1] if shape_rows else None
    if shape is None:
        if require_declared_resource:
            raise HTTPException(503, "Declared resource publication is unavailable")
        raise HTTPException(404, "Indicator descriptor is unavailable")
    if preflight_only:
        territory = conn.execute(
            "SELECT territory_type FROM territory_reference WHERE territory_id=%s",
            (territory_id,)).fetchone()
        if not territory:
            raise HTTPException(404, "Territory context not found")
        if territory[0] != territory_type:
            raise HTTPException(422, "Territory context type does not match route")
        if shape == "profile":
            profile_selection = normalize_field_selection(fields, {"value", "status"})
            profiles, version = focal_profiles(
                conn, territory_type, territory_id, indicator_id=indicator_id,
                include_cells=False, fields=fields, include_all_descriptors=True)
            if not profiles:
                raise HTTPException(422, "Profile is not declared for this territory level")
            return {"content_version": version, "supported_fields": {"value", "status"}}
        if shape == "series":
            normalize_field_selection(fields, {"value", "status"})
            marker = conn.execute("""SELECT s.content_version,s.reference_content_version,t.content_version
                FROM table_publication s LEFT JOIN table_publication t
                  ON t.table_name='territory_reference' WHERE s.table_name='ordered_series'""").fetchone()
            if not marker or not marker[0] or not marker[1] or marker[1] != marker[2]:
                raise HTTPException(503, "Series publication is unavailable or incompatible")
            return {"content_version": marker[0], "reference_content_version": marker[1],
                    "supported_fields": set()}
        scalar_selection = normalize_field_selection(
            fields, {"value", "support_count", "denominator_count", "status"})
        marker = conn.execute("""SELECT scalar.content_version,scalar.reference_content_version,
            territory.content_version FROM table_publication scalar LEFT JOIN table_publication territory
            ON territory.table_name='territory_reference' WHERE scalar.table_name='scalar_observation'""").fetchone()
        if not marker or not marker[0] or not marker[1] or marker[1] != marker[2]:
            raise HTTPException(503, "Scalar publication is stale or incompatible")
        descriptor = ((resource.scalar_descriptor[1],) if snapshot_state is not None else
                      conn.execute("SELECT allowed_levels FROM scalar_descriptor WHERE indicator_id=%s",
                                   (indicator_id,)).fetchone())
        if not descriptor or territory_type not in descriptor[0]:
            raise HTTPException(422, "Indicator is not declared for this territory level")
        return {"content_version": marker[0], "reference_content_version": marker[1],
                "supported_fields": {"value", "support_count", "denominator_count", "status"}}
    if shape == "profile":
        profile_selection = normalize_field_selection(fields, {"value", "status"})
        descriptor = ((resource.profile_descriptor[0],) if snapshot_state is not None else
                      conn.execute("SELECT theme_id FROM profile_descriptor WHERE indicator_id=%s",
                                   (indicator_id,)).fetchone())
        if not descriptor:
            raise HTTPException(404, "Profile descriptor is unavailable")
        profiles, _ = focal_profiles(conn, territory_type, territory_id,
                                     indicator_id=indicator_id, fields=fields)
        if not profiles:
            raise HTTPException(422, "Profile is not declared for this territory level")
        profile = profiles[0]
        cohort_type, members, scope = _comparison_cohort_in_snapshot(
            conn, territory_type, territory_id, None, snapshot_state)
        fixed_context = _fixed_scalar_comparison_context(conn, territory_type, territory_id,
            None, cohort_type, members, scope, snapshot_state=snapshot_state)
        comparison_fields = _theme_comparison_projection(profile_selection)
        profile_comparison_results = _profile_comparison_results(
            conn, [profile], members, cohort_type, territory_id, fixed_context,
            **({} if comparison_fields is None else {"selected_fields":comparison_fields}))
        profile["default_comparison"] = {
            "scope": scope, "results": profile_comparison_results}
        return profile
    if shape == "series":
        return _focal_series_snapshot(conn, territory_type, territory_id, indicator_id, fields=fields)
    # Scalar route: focal observation only. Comparison reads use the
    # dedicated bounded theme comparison endpoint.
    marker = conn.execute(
        """SELECT scalar.content_version,
                  scalar.reference_content_version,
                  territory.content_version AS territory_version
           FROM table_publication scalar
           LEFT JOIN table_publication territory
             ON territory.table_name = 'territory_reference'
           WHERE scalar.table_name = 'scalar_observation'"""
    ).fetchone()
    if marker is None:
        raise HTTPException(503, "Scalar publication is unavailable")
    if (not marker[0] or not marker[0].strip() or marker[1] is None
            or marker[2] is None or marker[1] != marker[2]):
        raise HTTPException(503, "Scalar publication is stale or incompatible")
    scalar_columns = {"value": "o.value", "support_count": "o.support_count",
                      "denominator_count": "o.denominator_count"}
    scalar_selection = normalize_field_selection(fields, set(scalar_columns) | {"status"})
    selected_scalar_columns = (tuple(scalar_columns) if scalar_selection is None else
                               tuple(name for name in scalar_selection if name in scalar_columns))
    scalar_projection = ["o.indicator_id", "o.territory_id", "o.territory_type"]
    if "value" in selected_scalar_columns:
        scalar_projection.append(scalar_columns["value"])
    scalar_projection.append("o.status")
    scalar_projection.extend(scalar_columns[column] for column in selected_scalar_columns
                             if column != "value")
    cursor = conn.execute(
        """SELECT """ + ", ".join(scalar_projection) + """,
                  d.label, d.unit, d.direction, d.comparison_facet, d.descriptor_version,
                  p.content_version,
                  (SELECT json_agg(json_build_object('source_id', os.source_id,
                      'name', sd.name, 'vintage_id', os.vintage_id,
                      'version', sv.version, 'reference_date', sv.reference_date,
                      'publication_date', sv.publication_date)
                   ORDER BY os.source_id, os.vintage_id)
                   FROM scalar_observation_source os
                   JOIN source_dataset sd ON sd.source_id=os.source_id
                   JOIN source_vintage sv ON sv.source_id=os.source_id AND sv.vintage_id=os.vintage_id
                   WHERE os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id) AS sources
           FROM scalar_observation o
           JOIN scalar_descriptor d USING (indicator_id)
           JOIN table_publication p ON p.table_name = 'scalar_observation'
           WHERE o.indicator_id = %s AND o.territory_id = %s
             AND o.territory_type = %s AND o.territory_type = ANY(d.allowed_levels)""",
        (indicator_id, territory_id, territory_type),
    )
    row = cursor.fetchone()
    if row is None:
        raise HTTPException(404, "Declared scalar observation is unavailable")
    result = dict(zip((column.name for column in cursor.description), row))
    result["reference_content_version"] = marker[1]
    return result


def _comparison_result_without_focal_value(result):
    """Serialize a dedicated comparison result without repeating a focal fact."""
    return {key: value for key, value in result.items() if key != "focal_value"}


def _series_comparison_snapshot(conn, territory_type, territory_id, indicator_id, selection):
    # Compatibility fallback for the legacy series_descriptor store only.
    # Current owned-series routes use _owned_series_comparison_results; do not
    # move this retired request-time path without naming a live legacy consumer.
    marker = conn.execute(
        """SELECT s.content_version,s.reference_content_version,t.content_version
           FROM table_publication s LEFT JOIN table_publication t
             ON t.table_name='territory_reference'
           WHERE s.table_name='ordered_series'"""
    ).fetchone()
    if not marker or not marker[0] or not marker[1] or marker[1] != marker[2]:
        raise HTTPException(503, "Series publication is unavailable or incompatible")
    descriptor = conn.execute(
        """SELECT comparison_point,label,unit,direction,allowed_levels,descriptor_version,
                  axis_values,completeness,source_id,vintage_id
           FROM series_descriptor WHERE indicator_id=%s""", (indicator_id,)
    ).fetchone()
    if not descriptor:
        raise HTTPException(404, "Series descriptor is unavailable")
    point, label, unit, direction, levels, version = descriptor[:6]
    if territory_type not in levels:
        raise HTTPException(422, "Series is not declared for this territory level")
    target = conn.execute(
        "SELECT territory_type FROM territory_reference WHERE territory_id=%s",
        (territory_id,),
    ).fetchone()
    if not target:
        raise HTTPException(404, "Focal territory not found")
    if target[0] != territory_type:
        raise HTTPException(422, "Focal territory type does not match route")
    if not point or direction not in ("high", "low"):
        cohort_type, members, scope = _comparison_cohort(conn, territory_type, territory_id, selection)
        return {"contract": "indicator-comparison-v1", "complete_theme": False,
            "indicator_id": indicator_id, "shape": "series",
            "content_version": marker[0], "reference_content_version": marker[2],
            "selection": None if selection is None else [
                {"territory_type": level, "territory_id": code} for level, code in selection],
            "scope": {**scope, "member_count": len(members)} if scope else None,
            "result": {"indicator_id": indicator_id, "label": label, "facet": None,
                "source_facet": None,
                "unit": unit, "direction": direction, "descriptor_version": version,
                "status": "unavailable", "reason": "unsupported_comparison_contract",
                "selected_member_count": len(members), "eligible_count": 0,
                "median": None, "rank": None, "comparison_sources": []}}
    if point not in descriptor[6]:
        raise HTTPException(503, "Series comparison point is not a declared axis")
    cohort_type, members, scope = _comparison_cohort(conn, territory_type, territory_id, selection)
    if cohort_type not in levels:
        raise HTTPException(422, "Series comparison is not declared for this cohort level")
    read_ids = list(dict.fromkeys([*members, territory_id]))
    rows = conn.execute(
        """SELECT s.territory_id,s.value,s.status,
                  json_build_object('source_id',s.source_id,'vintage_id',s.vintage_id,
                    'name',d.name,'version',v.version,'reference_date',v.reference_date,
                    'publication_date',v.publication_date)
           FROM ordered_series s JOIN source_dataset d USING(source_id)
           JOIN source_vintage v USING(source_id,vintage_id)
           WHERE s.indicator_id=%s AND s.axis_value=%s AND s.territory_type=%s
             AND s.territory_id=ANY(%s)
           ORDER BY s.territory_id""",
        (indicator_id, point, cohort_type, read_ids),
    ).fetchall()
    values = [(row[0], float(row[1])) for row in rows
              if row[0] in members and row[2] == "measured" and row[1] is not None]
    focal_row = next((row for row in rows if row[0] == territory_id), None)
    focal_value = (float(focal_row[1]) if focal_row and focal_row[2] == "measured"
                   and focal_row[1] is not None else None)
    better = (sum(value > focal_value if direction == "high" else value < focal_value
                  for _, value in values) if focal_value is not None else None)
    ties = sum(value == focal_value for _, value in values) if focal_value is not None else None
    enough = len(values) >= 2
    sources, seen = [], set()
    for row in rows:
        if row[0] not in members:
            continue
        source = row[3]
        key = (source["source_id"], source["vintage_id"])
        if key not in seen:
            seen.add(key)
            sources.append(source)
    result = {"indicator_id": indicator_id, "label": label, "facet": point,
        "source_facet": point,
        "unit": unit, "direction": direction, "descriptor_version": version,
        "statistic": "median", "status": "available" if enough else "unavailable",
        "reason": None if enough else (
            "fewer_than_two_comparable_values" if values else "no_selected_comparable_values"),
        "selected_member_count": len(members), "eligible_count": len(values),
        "focal_value": focal_value, "focal_in_selection": territory_id in members,
        "median": median([value for _, value in values]) if enough else None,
        "rank": better + 1 if enough and better is not None and territory_id in members else None,
        "rank_size": len(values) if enough and better is not None and territory_id in members else None,
        "rank_ties": ties if enough and better is not None and territory_id in members else None,
        "comparison_sources": sources}
    return {"contract": "indicator-comparison-v1", "complete_theme": False,
        "indicator_id": indicator_id, "shape": "series", "content_version": marker[0],
        "reference_content_version": marker[2],
        "selection": None if selection is None else [
            {"territory_type": level, "territory_id": code} for level, code in selection],
        "scope": {**scope, "member_count": len(members)} if scope else None,
        "result": result}


def _scalar_facet_comparison_preflight(conn, territory_type, territory_id, indicator_id,
                                       theme_id, selection, selected_fields):
    descriptor = _scalar_facet_descriptor(conn, indicator_id, territory_type, theme_id)
    if (descriptor["comparison_facet"] != indicator_id
            or descriptor["direction"] not in ("high", "low")):
        raise HTTPException(503, "Declared scalar facet comparison is incompatible")
    checked = _theme_comparison_snapshot(conn, territory_type, territory_id, theme_id, selection,
        indicator_id=indicator_id, result_fields=selected_fields, preflight_only=True,
        include_owned_series=False)
    cohort_type = checked["cohort_type"]
    if cohort_type not in descriptor["allowed_levels"]:
        raise HTTPException(422, "Scalar facet comparison is not declared for this cohort level")

    fixed = checked["fixed_context"]
    if fixed is not None and territory_id in checked["members"]:
        context, group_id, fixed_level = fixed
        group = _execute_comparison_publication_read(conn, """SELECT member_count,lineage_source_count
            FROM scalar_comparison_group WHERE comparison_context=%s AND group_id=%s
              AND territory_type=%s AND indicator_id=%s""",
            (context, group_id, fixed_level, indicator_id)).fetchall()
        territory = _execute_comparison_publication_read(conn, """SELECT count(*)
            FROM scalar_comparison_territory WHERE comparison_context=%s AND group_id=%s
              AND territory_type=%s AND indicator_id=%s AND territory_id=%s""",
            (context, group_id, fixed_level, indicator_id, territory_id)).fetchone()[0]
        lineage = _execute_comparison_publication_read(conn, """SELECT count(*)
            FROM comparison_source_lineage WHERE comparison_family='scalar'
              AND comparison_context=%s AND group_id=%s AND territory_type=%s AND facet_id=%s""",
            (context, group_id, fixed_level, indicator_id)).fetchone()[0]
        if (len(group) != 1 or territory != 1 or group[0][0] != len(checked["members"])
                or group[0][1] != lineage):
            raise HTTPException(503, "Published scalar facet comparison is incomplete")
        work_units = 2 + lineage + 1  # group, focal result, lineage, and comparison marker
    else:
        members = list(checked["members"])
        observations = conn.execute("""SELECT count(*) FROM scalar_observation o
            WHERE o.indicator_id=%s AND ((o.territory_type=%s AND o.territory_id=ANY(%s))
              OR (o.territory_id=%s AND o.territory_type=%s))""",
            (indicator_id, cohort_type, members, territory_id, territory_type)).fetchone()[0]
        lineage = (conn.execute("""SELECT count(*) FROM (
                SELECT DISTINCT os.source_id,os.vintage_id FROM scalar_observation_source os
                JOIN territory_reference t ON t.territory_id=os.territory_id
                WHERE os.indicator_id=%s AND os.territory_id=ANY(%s) AND t.territory_type=%s
            ) source_vintages""", (indicator_id, members, cohort_type)).fetchone()[0]
            if members else 0)
        work_units = observations + lineage + 1
    return max(1, int(work_units))


def _scalar_facet_comparison_snapshot(conn, territory_type, territory_id, indicator_id,
                                      theme_id, selection, selected_fields):
    descriptor = _scalar_facet_descriptor(conn, indicator_id, territory_type, theme_id)
    if (descriptor["comparison_facet"] != indicator_id
            or descriptor["direction"] not in ("high", "low")):
        raise HTTPException(503, "Declared scalar facet comparison is incompatible")
    comparison = _theme_comparison_snapshot(conn, territory_type, territory_id, theme_id, selection,
        indicator_id=indicator_id, result_fields=selected_fields, include_owned_series=False,
        include_fixed_context=True)
    if len(comparison["results"]) != 1:
        raise HTTPException(503, "Published scalar facet comparison is unavailable or ambiguous")
    result = dict(comparison["results"][0])
    result["source_facet"] = indicator_id
    result = _project_comparison_result_fields(result, selected_fields)
    result = _comparison_result_without_focal_value(result)
    facet = {"shape": "scalar", "source_facet": indicator_id,
        "content_version": comparison["scalar_content_version"],
        "reference_content_version": comparison["reference_content_version"],
        "descriptor_version": descriptor["descriptor_version"],
        "descriptor": descriptor, "selection": comparison["selection"],
        "scope": comparison["scope"], "result": result}
    if comparison["_fixed_context"] is not None:
        facet["comparison_content_version"] = _scalar_comparison_publication_marker(conn)[0]
    return facet


def _indicator_comparison_preflight(conn, territory_type, territory_id, indicator_id,
                                    selection, selected_fields, *, snapshot_state=None,
                                    include_scalar_facet=False,
                                    scalar_facet_theme_id=None,
                                    profile_coordinates=None):
    _validate_comparison_fields(selected_fields,
        _COMPARISON_RESULT_FIELDS - {"mean", "mean_curve", "focal_value"})
    focal = conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",
                         (territory_id,)).fetchone()
    if not focal:
        raise HTTPException(404, "Focal territory not found")
    if focal[0] != territory_type:
        raise HTTPException(422, "Focal territory type does not match route")
    resource = (_batch_indicator_resource(conn, indicator_id, snapshot_state)
                if snapshot_state is not None else None)
    active_owned = resource.owned_route if resource else _owned_series_route(conn,indicator_id)
    if include_scalar_facet and (not active_owned or active_owned[2]):
        raise HTTPException(503, "Declared ordered-series facet publication is unavailable")
    if include_scalar_facet and not scalar_facet_theme_id:
        raise HTTPException(503, "Declared scalar facet theme is unavailable")
    if include_scalar_facet and active_owned[1] != scalar_facet_theme_id:
        raise HTTPException(503, "Declared scalar and ordered-series facets have incompatible themes")
    if active_owned:
        if active_owned[2]:
            _validate_comparison_fields(selected_fields,{"selected_member_count"})
            # Existing metadata validator checks the dataset marker, reference
            # identity, and focal territory; it does not read reference facts.
            checked = _owned_reference_comparison_result(conn,active_owned,territory_type,territory_id,
                                                          indicator_id,selection)
            return {"shape": "named_reference", "checked": checked}
        cohort = _comparison_cohort_in_snapshot(conn,territory_type,territory_id,selection,
                                                snapshot_state)
        checked = _owned_series_comparison_results(conn,[active_owned],territory_type,territory_id,
            selection,cohort=cohort,selected_fields=selected_fields,strict_fields=True,
            preflight_only=True)
        scalar_work = 0
        if include_scalar_facet:
            scalar_work = _scalar_facet_comparison_preflight(conn, territory_type, territory_id,
                indicator_id, scalar_facet_theme_id, selection, selected_fields)
        return {"shape": "ordered_series", "cohort_type": cohort[0],
                "members": cohort[1], "scope": cohort[2], "fixed_context": checked[2],
                "checked": checked, "scalar_facet_work_units": scalar_work}
    collections = list(resource.collections) if resource else collection_descriptors(
        conn,indicator_id=indicator_id)
    if collections:
        descriptor = collections[0]
        focal_row = conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",
                                 (territory_id,)).fetchone()
        if not focal_row:
            raise HTTPException(404,"Focal territory not found")
        if focal_row[0] != territory_type:
            raise HTTPException(422,"Focal territory type does not match route")
        cohort_type,members,scope = _comparison_cohort_in_snapshot(
            conn,territory_type,territory_id,selection,snapshot_state)
        fixed_context = _fixed_scalar_comparison_context(conn,territory_type,territory_id,
            selection,cohort_type,members,scope,snapshot_state=snapshot_state)
        marker = collection_marker(conn,descriptor)
        collection_comparison_preflight(conn,descriptor,selected_fields,fixed_context,marker)
        return {"shape": "collection", "cohort_type": cohort_type,
                "members": members, "scope": scope}
    shapes = list(resource.shape_rows) if resource else []
    if resource is None:
        for table, shape in (("scalar_descriptor", "scalar"),
                             ("profile_descriptor", "profile"),
                             ("series_descriptor", "series")):
            if conn.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0] and conn.execute(
                    f"SELECT 1 FROM {table} WHERE indicator_id=%s", (indicator_id,)).fetchone():
                shapes.append((table, shape))
    if len(shapes) > 1:
        raise HTTPException(503, "Indicator has ambiguous published storage shapes")
    if not shapes:
        raise HTTPException(404, "Indicator descriptor is unavailable")
    if shapes[0][1] in ("scalar", "profile"):
        table, shape = shapes[0]
        descriptor = ((resource.scalar_descriptor if shape == "scalar" else resource.profile_descriptor)
                      if resource else conn.execute(
                          f"SELECT theme_id,allowed_levels FROM {table} WHERE indicator_id=%s",
                          (indicator_id,)).fetchone())
        if not descriptor:
            raise HTTPException(404, "Indicator descriptor is unavailable")
        if territory_type not in descriptor[1]:
            raise HTTPException(422, "Indicator is not declared for this territory level")
        if not descriptor[0]:
            raise HTTPException(503, "Indicator theme metadata is unavailable")
        estimate = _theme_comparison_snapshot(conn, territory_type, territory_id, descriptor[0],
                                   selection, indicator_id=indicator_id,
                                   result_fields=selected_fields, preflight_only=True,
                                   snapshot_state=snapshot_state,
                                   profile_coordinates=profile_coordinates)
        return {**estimate, "theme_id": descriptor[0], "shape": shape}
    elif shapes[0][1] == "series":
        result = _indicator_facts_snapshot(conn, territory_type, territory_id, indicator_id,
                                           preflight_only=True, snapshot_state=snapshot_state)
        return {"shape": "series", "content_version": result.get("content_version")}
    # Validate every explicit scope against the published reference before any
    # result query, including collection/owned dynamic readers.
    cohort_type,members,scope = _comparison_cohort_in_snapshot(
        conn, territory_type, territory_id, selection, snapshot_state)
    return {"shape": shapes[0][1], "cohort_type": cohort_type,
            "members": members, "scope": scope}


def _indicator_comparison_snapshot(conn, territory_type, territory_id, indicator_id, selection,
                                   selected_fields, *, snapshot_state=None,
                                   include_scalar_facet=False,
                                   scalar_facet_theme_id=None,
                                   profile_coordinates=None):
    resource = (_batch_indicator_resource(conn, indicator_id, snapshot_state)
                if snapshot_state is not None else None)
    active_owned = resource.owned_route if resource else _owned_series_route(conn,indicator_id)
    if include_scalar_facet and (not active_owned or active_owned[2]):
        raise HTTPException(503, "Declared ordered-series facet publication is unavailable")
    if include_scalar_facet and not scalar_facet_theme_id:
        raise HTTPException(503, "Declared scalar facet theme is unavailable")
    if include_scalar_facet and active_owned[1] != scalar_facet_theme_id:
        raise HTTPException(503, "Declared scalar and ordered-series facets have incompatible themes")
    if active_owned:
        if active_owned[2]:
            _validate_comparison_fields(selected_fields,{"selected_member_count"})
            result=_owned_reference_comparison_result(conn,active_owned,territory_type,
                territory_id,indicator_id,selection)
        else:
            result=_owned_series_comparison_result(conn,active_owned,territory_type,
                territory_id,indicator_id,selection,selected_fields)
        projected = _project_comparison_payload_fields(result,selected_fields)
        if include_scalar_facet:
            projected["scalar_facet"] = _scalar_facet_comparison_snapshot(
                conn, territory_type, territory_id, indicator_id, scalar_facet_theme_id,
                selection, selected_fields)
        return projected
    collections = list(resource.collections) if resource else collection_descriptors(
        conn,indicator_id=indicator_id)
    if collections:
        focal = conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",(territory_id,)).fetchone()
        if not focal:
            raise HTTPException(404,"Focal territory not found")
        if focal[0]!=territory_type:
            raise HTTPException(422,"Focal territory type does not match route")
        cohort_type,members,scope = _comparison_cohort_in_snapshot(
            conn,territory_type,territory_id,selection,snapshot_state)
        fixed_context = _fixed_scalar_comparison_context(conn,territory_type,territory_id,
            selection,cohort_type,members,scope,snapshot_state=snapshot_state)
        if territory_id not in members:
            fixed_context = None
        result = collection_comparison(conn,collections[0],territory_type,territory_id,cohort_type,members,
                                       fixed_context,fields=selected_fields)
        return _project_comparison_payload_fields({"contract":"indicator-comparison-v1","complete_theme":False,"indicator_id":indicator_id,
            "theme_id":collections[0]["theme_id"],"shape":"observed_collection",
            "content_version":result["content_version"],"reference_content_version":result["reference_content_version"],
            "selection":None if selection is None else [{"territory_type":level,"territory_id":code} for level,code in selection],
            "scope":{**scope,"member_count":len(members)} if scope else None,"result":result},selected_fields)
    shapes = list(resource.shape_rows) if resource else []
    if resource is None:
        for table, shape in (("scalar_descriptor", "scalar"),
                             ("profile_descriptor", "profile"),
                             ("series_descriptor", "series")):
            if conn.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0]:
                descriptor = conn.execute(
                    f"SELECT 1 FROM {table} WHERE indicator_id=%s", (indicator_id,)
                ).fetchone()
                if descriptor:
                    shapes.append((table, shape))
    if len(shapes) > 1:
        raise HTTPException(503, "Indicator has ambiguous published storage shapes")
    if not shapes:
        raise HTTPException(404, "Indicator descriptor is unavailable")
    shape = shapes[0][1]
    if shape in ("scalar","profile"):
        _validate_comparison_fields(selected_fields,_COMPARISON_RESULT_FIELDS-{"mean","mean_curve","focal_value"})
    else:
        _validate_comparison_fields(selected_fields,_COMPARISON_RESULT_FIELDS-{"mean","mean_curve","focal_value"})
    focal = conn.execute(
        "SELECT territory_type FROM territory_reference WHERE territory_id=%s",
        (territory_id,),
    ).fetchone()
    if not focal:
        raise HTTPException(404, "Focal territory not found")
    if focal[0] != territory_type:
        raise HTTPException(422, "Focal territory type does not match route")
    if shape == "series":
        comparison = _series_comparison_snapshot(conn, territory_type, territory_id,
                                                 indicator_id, selection)
        comparison["result"] = _comparison_result_without_focal_value(comparison["result"])
        return _project_comparison_payload_fields(comparison,selected_fields)
    if shape == "scalar":
        descriptor = (resource.scalar_descriptor if resource else conn.execute(
            "SELECT theme_id,allowed_levels FROM scalar_descriptor WHERE indicator_id=%s",
            (indicator_id,),
        ).fetchone())
    else:
        descriptor = (resource.profile_descriptor if resource else conn.execute(
            "SELECT theme_id,allowed_levels FROM profile_descriptor WHERE indicator_id=%s",
            (indicator_id,),
        ).fetchone())
    if not descriptor:
        raise HTTPException(404, "Indicator descriptor is unavailable")
    if territory_type not in descriptor[1]:
        raise HTTPException(422, "Indicator is not declared for this territory level")
    if not descriptor[0]:
        raise HTTPException(503, "Indicator theme metadata is unavailable")
    comparison = _theme_comparison_snapshot(conn, territory_type, territory_id,
        descriptor[0], selection, indicator_id=indicator_id,result_fields=selected_fields,
        snapshot_state=snapshot_state, profile_coordinates=profile_coordinates)
    result_rows = comparison["results"] if shape == "scalar" else comparison["profile_comparisons"]
    if len(result_rows) != 1:
        raise HTTPException(503, "Indicator comparison facet is unavailable or ambiguous")
    result = dict(result_rows[0])
    if shape == "profile":
        source_facet = result.pop("facet", None)
        result.pop("indicator", None)
        result["indicator_id"] = indicator_id
        result["source_facet"] = source_facet
        if isinstance(source_facet, str):
            result["source_facet_indicator_id"] = source_facet
    else:
        result["source_facet"] = indicator_id
    result = _comparison_result_without_focal_value(result)
    return _project_comparison_payload_fields({"contract": "indicator-comparison-v1", "complete_theme": False,
        "indicator_id": indicator_id, "shape": shape,
        "content_version": comparison["content_version"],
        "scalar_content_version": (result.get("required_scalar_version")
            if shape == "profile" and result.get("source_facet_indicator_id") else None),
        "profile_content_version": comparison["profile_content_version"],
        "reference_content_version": comparison["reference_content_version"],
        "selection": comparison["selection"], "scope": comparison["scope"],
        "result": result},selected_fields)


def _focal_series_snapshot(conn, territory_type, territory_id, indicator_id, *, fields=None):
    selection = normalize_field_selection(fields, {"value", "status"})
    project_value = selection is None or "value" in selection
    marker = conn.execute(
        """SELECT s.content_version,s.reference_content_version,t.content_version
           FROM table_publication s LEFT JOIN table_publication t ON t.table_name='territory_reference'
           WHERE s.table_name='ordered_series'"""
    ).fetchone()
    if not marker or not marker[0] or not marker[1] or not marker[2] or marker[1] != marker[2]:
        raise HTTPException(503, "Series publication is unavailable or incompatible")
    descriptor = conn.execute(
        """SELECT axis_kind,axis_values,completeness,comparison_point,label,unit,direction,
                  source_id,vintage_id,descriptor_version,allowed_levels
           FROM series_descriptor WHERE indicator_id=%s""", (indicator_id,)
    ).fetchone()
    if not descriptor:
        raise HTTPException(404, "Series descriptor is unavailable")
    if territory_type not in descriptor[10]:
        raise HTTPException(422, "Series is not declared for this territory level")
    territory = conn.execute(
        "SELECT territory_id,name FROM territory_reference WHERE territory_id=%s AND territory_type=%s",
        (territory_id, territory_type),
    ).fetchone()
    if not territory:
        raise HTTPException(404, "Territory not found")
    rows = conn.execute(
        """SELECT s.axis_value,s.observation_period,
                   CASE WHEN %s THEN s.value ELSE NULL::double precision END AS value,s.status,s.source_id,s.vintage_id,
                  v.version,v.reference_date,v.publication_date
           FROM ordered_series s JOIN source_vintage v USING(source_id,vintage_id)
           WHERE s.indicator_id=%s AND s.territory_id=%s AND s.territory_type=%s
           ORDER BY array_position(%s::text[],s.axis_value)""",
        (project_value, indicator_id, territory_id, territory_type, list(descriptor[1])),
    ).fetchall()
    by_axis = {row[0]: row for row in rows}
    if len(by_axis) != len(rows) or any(axis not in descriptor[1] for axis in by_axis):
        raise HTTPException(503, "Invalid published series axis")
    if descriptor[2] == "dense_complete" and set(by_axis) != set(descriptor[1]):
        raise HTTPException(503, "Incomplete published series")
    points = []
    for axis in descriptor[1]:
        row = by_axis.get(axis)
        point = {"axis": axis, "status": row[3] if row else "missing",
            "observation_period": row[1] if row else None,
            "source_id": row[4] if row else descriptor[7],
            "vintage_id": row[5] if row else descriptor[8],
            "source_version": row[6] if row else None,
            "source_reference_date": row[7] if row else None,
            "source_publication_date": row[8] if row else None}
        if project_value:
            point["value"] = row[2] if row else None
        points.append(point)
    return {"publication_id": marker[0], "territory": {"id": territory_id,
        "type": territory_type, "name": territory[1]}, "indicator_id": indicator_id,
        "axis_kind": descriptor[0], "completeness": descriptor[2], "label": descriptor[4],
        "unit": descriptor[5], "direction": descriptor[6], "descriptor_version": descriptor[9],
        "comparison_point": descriptor[3], "points": points,
        "availability": "complete" if all(p["status"] == "measured" for p in points) else "incomplete"}
