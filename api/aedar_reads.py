"""Source-grain AEDAR aggregate, fixed-comparison and selected-comparison snapshots."""

from math import fsum

from fastapi import HTTPException

from api.aedar_models import AEDAR_MEASURE_KEYS
from api.field_selection import normalize_field_selection

_AEDAR_COMPARISON_OPTIONAL_FIELDS = {
    "group_value", "value",
}
_AEDAR_COMPARISON_MANDATORY_FIELDS = {
    "comparison_context", "group_id", "territory_type", "typequ", "typequ_label",
    "source_id", "vintage_id", "source_url", "licence", "attribution", "reference_date",
    "publication_date", "measure", "statistic", "group_n_addresses", "group_n_observed",
    "group_coverage_status", "n_addresses", "n_observed", "coverage_status", "status",
}

def _aedar_comparison_field_selection(fields):
    return normalize_field_selection(
        fields, _AEDAR_COMPARISON_OPTIONAL_FIELDS | _AEDAR_COMPARISON_MANDATORY_FIELDS)


def _aedar_territorial_aggregate_snapshot(conn, territory_type, territory_id,
                                         typequ=None, fields=None, limit=50, offset=0,
                                         *, preflight_only=False):
    """Build the published AEDAR aggregate response in a caller-owned snapshot."""
    if typequ is not None and (not typequ or any(not item or len(item)>32 for item in typequ)):
        raise HTTPException(422, "typequ must contain non-empty source codes")
    optional_fields = {"measures." + key for key in AEDAR_MEASURE_KEYS}
    selected_fields = normalize_field_selection(fields, optional_fields)
    selected_measure_keys = ({field.removeprefix("measures.") for field in selected_fields
                              if field.startswith("measures.")} if selected_fields is not None else None)
    marker = conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version
              FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
              WHERE p.table_name='aedar_territorial_aggregate'""").fetchone()
    if not marker or not marker[0] or marker[1] < 1 or marker[2] != marker[3]:
        raise HTTPException(503,"AEDAR territorial publication is unavailable or incompatible")
    supported = conn.execute("SELECT 1 FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
                             (territory_type,territory_id)).fetchone()
    if not supported:
        raise HTTPException(404,"Unknown territory type/id")
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[2]}
    measure_projection = ("measures" if selected_measure_keys is None else
        "COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(aedar_territorial_aggregate.measures) AS m(k,v) WHERE k = ANY(%s::text[])), '{}'::jsonb) AS measures")
    base_projection = """SELECT territory_id,territory_type,typequ,typequ_label,typequ_hierarchy_label,typequ_description,
              typequ_domain_code,typequ_domain_label,typequ_subdomain_code,typequ_subdomain_label,
              typequ_gamme,typequ_gamme_status,typequ_source_order,identity,
              n_addresses,n_observed,coverage_status,""" + measure_projection + """,source_id,vintage_id,source_url,licence,attribution,
              reference_date,publication_date
              FROM aedar_territorial_aggregate
              WHERE territory_type=%s AND territory_id=%s AND (%s::text[] IS NULL OR typequ=ANY(%s))
              ORDER BY typequ LIMIT %s OFFSET %s"""
    params = ((sorted(selected_measure_keys), territory_type,territory_id,typequ,typequ,limit,offset)
              if selected_measure_keys is not None else
              (territory_type,territory_id,typequ,typequ,limit,offset))
    cursor = conn.execute(base_projection, params)
    names = [d.name for d in cursor.description]
    rows = [dict(zip(names,row)) for row in cursor.fetchall()]
    expected_measures = AEDAR_MEASURE_KEYS if selected_measure_keys is None else selected_measure_keys
    if any(set(row["measures"] or {}) != expected_measures for row in rows):
        raise HTTPException(503, "AEDAR measure publication is incomplete for the requested projection")
    required_typequ_metadata = ("typequ_hierarchy_label","typequ_description","typequ_domain_code","typequ_domain_label",
        "typequ_subdomain_code","typequ_subdomain_label","typequ_gamme_status","typequ_source_order")
    if any(any(row[key] is None for key in required_typequ_metadata) for row in rows):
        raise HTTPException(503,"AEDAR TYPEQU metadata publication is incomplete")
    return {"territory":{"territory_type":territory_type,"territory_id":territory_id},
      "content_version":marker[0],"reference_content_version":marker[2],"limit":limit,"offset":offset,
      "facts":rows}


def _aedar_comparison_marker(conn):
    """Read and validate the reference-only AEDAR comparison publication marker."""
    marker = conn.execute("""SELECT p.content_version,p.source_snapshot_id,p.aedar_content_version,
              p.reference_content_version,p.input_content_version,p.input_identity,p.group_row_count,p.territory_row_count,
              p.publication_mode,
              a.content_version,r.content_version
              FROM aedar_comparison_publication p
              JOIN table_publication a ON a.table_name='aedar_territorial_aggregate'
              JOIN table_publication r ON r.table_name='territory_reference'
              WHERE p.singleton""").fetchone()
    if not marker or marker[2] != marker[9] or marker[3] != marker[10] or marker[6] < 1 or marker[7] != 0 or marker[8] != "reference_only" or marker[1] != "2026-v1":
        raise HTTPException(503, "AEDAR comparison publication is unavailable or stale")
    return marker


def _aedar_direct_reference(conn, measure, reference_type, group_id, typequ):
    """Read one direct published aggregate as a fixed reference (statistic direct)."""
    row = conn.execute("""SELECT (measures->>%s)::double precision AS value,n_addresses,n_observed,coverage_status
        FROM aedar_territorial_aggregate WHERE territory_type=%s AND territory_id=%s AND typequ=%s""",
        (measure,reference_type,group_id,typequ)).fetchone()
    return (*row, "direct") if row else None


def _aedar_comparison_snapshot(conn, territory_type, territory_id, context,
                               typequ, measure, fields=None, *, preflight_only=False):
    """Build one fixed AEDAR result inside a caller-owned snapshot."""
    if measure not in AEDAR_MEASURE_KEYS:
        raise HTTPException(422, "Unknown AEDAR measure")
    selected_fields = _aedar_comparison_field_selection(fields)
    selected = set(_AEDAR_COMPARISON_OPTIONAL_FIELDS) if selected_fields is None else set(selected_fields)
    marker = _aedar_comparison_marker(conn)
    territory = conn.execute("SELECT 1 FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
                             (territory_type, territory_id)).fetchone()
    if not territory:
        raise HTTPException(404, "Unknown territory type/id")
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[3]}
    focal = conn.execute("""SELECT t.epci_id,r.territory_id
        FROM territory_reference t CROSS JOIN territory_reference r
        WHERE t.territory_type=%s AND t.territory_id=%s AND r.territory_type='region'""",
        (territory_type,territory_id)).fetchone()
    if not focal:
        raise HTTPException(404, "Unknown territory type/id")
    if context == "density_class":
        from api.snapshot_reads import _comparison_cohort
        _, _, scope = _comparison_cohort(conn, territory_type, territory_id, None)
        if territory_type != "commune" or not scope or scope.get("kind") != "density_class":
            raise HTTPException(422, "Density reference is available for commune scopes only")
        group_id, reference_type = scope["density_class_code"], "commune"
        group_row = conn.execute("""SELECT value,n_addresses,n_observed,coverage_status,statistic
            FROM aedar_comparison_group WHERE comparison_context='density_class' AND group_id=%s
              AND territory_type='commune' AND typequ=%s AND measure=%s""",
            (group_id,typequ,measure)).fetchone()
    elif context == "same_level":
        # The published EPCI/departement same-level median summaries are retired
        # (#768/#859): the reference is the Region's own direct published AEDAR
        # aggregate ("Moyenne de Bretagne"), as commune Bretagne references already do.
        if territory_type not in ("epci","departement"):
            raise HTTPException(422, "Same-level reference is unavailable for this territory scope")
        reference_type, group_id = "region", focal[1]
        group_row = _aedar_direct_reference(conn, measure, reference_type, group_id, typequ)
    elif context in ("epci", "bretagne"):
        if territory_type != "commune":
            raise HTTPException(422, "Commune reference is unavailable for this territory scope")
        reference_type = "epci" if context == "epci" else "region"
        group_id = focal[0] if context == "epci" else focal[1]
        if not group_id:
            raise HTTPException(503, "Published AEDAR reference identity is unavailable")
        group_row = _aedar_direct_reference(conn, measure, reference_type, group_id, typequ)
    else:
        raise HTTPException(422, "AEDAR comparison context is not declared")
    if not group_row:
        raise HTTPException(404, "No published result for this fixed context")
    focal_row = conn.execute("""SELECT a.typequ_label,a.source_id,a.vintage_id,a.source_url,a.licence,
        a.attribution,a.reference_date,a.publication_date,(a.measures->>%s)::double precision AS value,a.n_addresses,
        a.n_observed,a.coverage_status FROM aedar_territorial_aggregate a
        WHERE a.territory_type=%s AND a.territory_id=%s AND a.typequ=%s""",
        (measure,territory_type,territory_id,typequ)).fetchone()
    if not focal_row:
        raise HTTPException(404, "No published focal AEDAR value")
    result = {
        "comparison_context": context,
        "group_id": group_id,
        "territory_type": reference_type,
        "typequ": typequ,
        "typequ_label": focal_row[0],
        "source_id": focal_row[1],
        "vintage_id": focal_row[2],
        "source_url": focal_row[3],
        "licence": focal_row[4],
        "attribution": focal_row[5],
        "reference_date": focal_row[6],
        "publication_date": focal_row[7],
        "measure": measure,
        "statistic": group_row[4],
        "group_value": group_row[0],
        "group_n_addresses": group_row[1],
        "group_n_observed": group_row[2],
        "group_coverage_status": group_row[3],
        "value": focal_row[8],
        "status": "measured" if focal_row[8] is not None else "not_available",
        "n_addresses": focal_row[9],
        "n_observed": focal_row[10],
        "coverage_status": focal_row[11],
    }
    for key in _AEDAR_COMPARISON_OPTIONAL_FIELDS-selected:
        result.pop(key,None)
    return {"territory":{"territory_type":territory_type,"territory_id":territory_id},
      "content_version":marker[0],"source_snapshot_id":marker[1],
      "aedar_content_version":marker[2],"reference_content_version":marker[3],
      "input_content_version":marker[4],"input_identity":marker[5],"comparison":result}


_AEDAR_SELECTED_OPTIONAL_FIELDS = {"group_value", "value", "rank", "rank_size", "rank_ties"}
_AEDAR_SELECTED_MANDATORY_FIELDS = {
    "comparison_context", "group_id", "territory_type", "typequ", "typequ_label",
    "source_id", "vintage_id", "source_url", "licence", "attribution", "reference_date",
    "publication_date", "measure", "statistic", "direction", "comparison_facet",
    "group_n_addresses", "group_n_observed", "group_coverage_status",
    "n_addresses", "n_observed", "coverage_status", "status",
}


def _aedar_selected_field_selection(fields):
    return normalize_field_selection(
        fields, _AEDAR_SELECTED_OPTIONAL_FIELDS | _AEDAR_SELECTED_MANDATORY_FIELDS)


def _aedar_selected_members(conn, territory_type, members):
    """Resolve same-level typed members; fail closed naming any failed member."""
    members = tuple(members)
    if not members:
        raise HTTPException(422, "AEDAR selected comparison requires at least one member")
    if len({(level, code) for level, code in members}) != len(members):
        raise HTTPException(422, "selected comparison members must be unique")
    by_id = {row[0]: row[1] for row in conn.execute(
        "SELECT territory_id,territory_type FROM territory_reference WHERE territory_id=ANY(%s::text[])",
        ([code for _, code in members],)).fetchall()}
    resolved = []
    for level, code in members:
        if code not in by_id:
            raise HTTPException(404, f"Unknown selected comparison member {level}/{code}")
        if by_id[code] != level:
            raise HTTPException(422, f"Selected comparison member type does not match {level}/{code}")
        if level != territory_type:
            raise HTTPException(422, f"Selected comparison member {level}/{code} is not same-level as the focal territory")
        resolved.append((level, code))
    return tuple(resolved)


def _aedar_selected_comparison_snapshot(conn, territory_type, territory_id, members,
                                         typequ, measures, fields=None, measure_facets=None,
                                         *, preflight_only=False):
    """Build one request-time AEDAR selected comparison in a caller-owned snapshot.

    The group statistic is the address-weighted mean of the members' published
    aggregate values (weights = published n_addresses) - exactly the pooled
    address aggregate of the selection - computed per request from one
    committed snapshot, for scalar readings and per-cell curve readings alike.
    The focal receives a direction-aware rank and the group size only when it
    is itself a member; no peer/rank rows are published (#810 stance intact).
    """
    if not typequ or not measures:
        raise HTTPException(422, "AEDAR selected comparison requires typequ and measure coordinates")
    if not set(measures) <= AEDAR_MEASURE_KEYS:
        raise HTTPException(422, "Coordinate measure is not declared for AEDAR")
    facets = measure_facets or {}
    if any(measure not in facets for measure in measures):
        raise HTTPException(503, "AEDAR comparison facet declaration is incomplete for the requested measures")
    selected_fields = _aedar_selected_field_selection(fields)
    selected = set(_AEDAR_SELECTED_OPTIONAL_FIELDS) if selected_fields is None else set(selected_fields)
    marker = _aedar_comparison_marker(conn)
    if not conn.execute("SELECT 1 FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
                        (territory_type,territory_id)).fetchone():
        raise HTTPException(404, "Unknown territory type/id")
    resolved = _aedar_selected_members(conn, territory_type, members)
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[3]}
    typequ_list = sorted(typequ)
    measure_list = sorted(measures)
    member_ids = [code for _, code in resolved]
    member_rows = {}
    cursor = conn.execute("""SELECT territory_id,typequ,n_addresses,n_observed,coverage_status,
              COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(aedar_territorial_aggregate.measures) AS m(k,v)
                        WHERE k = ANY(%s::text[])), '{}'::jsonb) AS measures
              FROM aedar_territorial_aggregate
              WHERE territory_type=%s AND territory_id=ANY(%s::text[]) AND typequ=ANY(%s::text[])""",
        (measure_list, territory_type, member_ids, typequ_list))
    names = [d.name for d in cursor.description]
    for row in cursor.fetchall():
        record = dict(zip(names, row))
        member_rows[(record["territory_id"], record["typequ"])] = record
    focal_rows = {}
    cursor = conn.execute("""SELECT a.typequ,a.typequ_label,a.source_id,a.vintage_id,a.source_url,a.licence,
              a.attribution,a.reference_date,a.publication_date,a.n_addresses,a.n_observed,a.coverage_status,
              COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(a.measures) AS m(k,v)
                        WHERE k = ANY(%s::text[])), '{}'::jsonb) AS measures
              FROM aedar_territorial_aggregate a
              WHERE a.territory_type=%s AND a.territory_id=%s AND a.typequ=ANY(%s::text[])""",
        (measure_list, territory_type, territory_id, typequ_list))
    names = [d.name for d in cursor.description]
    for row in cursor.fetchall():
        record = dict(zip(names, row))
        focal_rows[record["typequ"]] = record
    entries = []
    for typequ_value in typequ_list:
        focal_row = focal_rows.get(typequ_value)
        if not focal_row:
            raise HTTPException(404, "No published focal AEDAR value")
        member_records = []
        for level, code in resolved:
            record = member_rows.get((code, typequ_value))
            if record is None:
                raise HTTPException(422, f"Selected comparison member {level}/{code} has no published AEDAR aggregate for typequ {typequ_value}")
            member_records.append((level, code, record))
        # Honest derived coverage: the members' common published status when
        # they all agree (all covered -> covered); a disagreement has no single
        # derivable coverage and stays unknown (null), never upgraded.
        statuses = {record["coverage_status"] for _, _, record in member_records}
        group_coverage = next(iter(statuses)) if len(statuses) == 1 else None
        for measure in measure_list:
            facet = facets[measure]
            values = []
            for level, code, record in member_records:
                value = (record["measures"] or {}).get(measure)
                weight = record["n_addresses"]
                if value is None or weight is None or weight <= 0:
                    raise HTTPException(422, f"Selected comparison member {level}/{code} has no published value for measure {measure} at typequ {typequ_value}")
                values.append((code, float(value), int(weight), int(record["n_observed"] or 0)))
            total_weight = sum(weight for _, _, weight, _ in values)
            group_value = fsum(value * weight for _, value, weight, _ in values) / total_weight
            total_observed = sum(observed for _, _, _, observed in values)
            rank = rank_size = rank_ties = None
            if facet["ranked"] and territory_id in member_ids:
                focal_value = next(value for code, value, _, _ in values if code == territory_id)
                direction = facet["direction"]
                better = sum(1 for _, value, _, _ in values
                             if (value > focal_value if direction == "high" else value < focal_value))
                rank = better + 1
                rank_ties = sum(1 for _, value, _, _ in values if value == focal_value)
                rank_size = len(values)
            focal_measures = focal_row["measures"] or {}
            focal_value = focal_measures.get(measure)
            entry = {
                "comparison_context": "selected_comparison",
                "group_id": None,
                "territory_type": territory_type,
                "typequ": typequ_value,
                "typequ_label": focal_row["typequ_label"],
                "source_id": focal_row["source_id"],
                "vintage_id": focal_row["vintage_id"],
                "source_url": focal_row["source_url"],
                "licence": focal_row["licence"],
                "attribution": focal_row["attribution"],
                "reference_date": focal_row["reference_date"],
                "publication_date": focal_row["publication_date"],
                "measure": measure,
                "statistic": "pooled",
                "direction": facet["direction"],
                "comparison_facet": facet["facet"],
                "group_value": group_value,
                "group_n_addresses": total_weight,
                "group_n_observed": total_observed,
                "group_coverage_status": group_coverage,
                "value": focal_value,
                "status": "measured" if focal_value is not None else "not_available",
                "n_addresses": focal_row["n_addresses"],
                "n_observed": focal_row["n_observed"],
                "coverage_status": focal_row["coverage_status"],
                "rank": rank,
                "rank_size": rank_size,
                "rank_ties": rank_ties,
            }
            for key in _AEDAR_SELECTED_OPTIONAL_FIELDS - selected:
                entry.pop(key, None)
            entries.append(entry)
    return {"territory":{"territory_type":territory_type,"territory_id":territory_id},
      "content_version":marker[0],"source_snapshot_id":marker[1],
      "aedar_content_version":marker[2],"reference_content_version":marker[3],
      "input_content_version":marker[4],"input_identity":marker[5],
      "selection":[{"territory_type":level,"territory_id":code} for level, code in resolved],
      "scope":{"kind":"explicit_selection","member_count":len(resolved),"territory_type":territory_type},
      "comparisons":entries}

