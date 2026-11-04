"""Source-grain AEDAR aggregate, fixed-comparison and selected-comparison snapshots."""

from math import fsum

from fastapi import HTTPException

from api.aedar_models import AEDAR_AGGREGATE_READINGS, AEDAR_MEASURE_KEYS
from api.field_selection import normalize_field_selection

_AEDAR_COMPARISON_OPTIONAL_FIELDS = {
    "group_value", "value",
}
# Request-time rank fields of the registry-wide aggregate readings (ADR-0039's
# 2026-11-04 amendment, #914): granted for the fixed intent on the aggregate
# facets only, alongside the selected intent's existing grant.
_AEDAR_AGGREGATE_RANK_FIELDS = {"rank", "rank_size", "rank_ties"}
_AEDAR_COMPARISON_MANDATORY_FIELDS = {
    "comparison_context", "group_id", "territory_type", "typequ", "typequ_label",
    "source_id", "vintage_id", "source_url", "licence", "attribution", "reference_date",
    "publication_date", "measure", "statistic", "group_n_addresses", "group_n_observed",
    "group_coverage_status", "n_addresses", "n_observed", "coverage_status", "status",
}

def _aedar_comparison_optional_fields(aggregate):
    return _AEDAR_COMPARISON_OPTIONAL_FIELDS | (_AEDAR_AGGREGATE_RANK_FIELDS if aggregate else set())

def _aedar_comparison_field_selection(fields, aggregate=False):
    return normalize_field_selection(
        fields, _aedar_comparison_optional_fields(aggregate) | _AEDAR_COMPARISON_MANDATORY_FIELDS)


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


def _aedar_registry_size(conn):
    """Size of the published TYPEQU registry; fail closed when it is absent."""
    row = conn.execute("SELECT count(DISTINCT typequ) FROM aedar_territorial_aggregate").fetchone()
    size = int(row[0]) if row and row[0] is not None else 0
    if size < 1:
        raise HTTPException(503, "AEDAR TYPEQU registry publication is unavailable")
    return size


_AEDAR_AGGREGATE_RECORDS_SQL = """SELECT territory_id,
       count(*) AS n_rows,
       count((measures->>%s)::double precision) AS n_measured,
       sum((measures->>%s)::double precision) AS total,
       min(n_addresses) AS na_min, max(n_addresses) AS na_max,
       sum(n_observed) AS observed_sum,
       count(DISTINCT coverage_status) AS n_coverage,
       min(coverage_status) AS coverage_status
FROM aedar_territorial_aggregate
WHERE territory_type=%s AND territory_id=ANY(%s::text[])
GROUP BY territory_id"""


def _aedar_aggregate_records(conn, territory_type, territory_ids, underlying, registry_size):
    """Per-territory registry-wide sum of one per-type measure, aggregated in SQL.

    A territory's reading is the sum over its complete published registry; an
    incomplete universe yields no partial sum — the reading stays unknown,
    never a fabricated partial value (ADR-0039's 2026-11-04 amendment, #914).
    """
    cursor = conn.execute(_AEDAR_AGGREGATE_RECORDS_SQL,
                          (underlying, underlying, territory_type, sorted(set(territory_ids))))
    records = {}
    for row in cursor.fetchall():
        (territory_id, n_rows, n_measured, total, na_min, na_max,
         observed_sum, n_coverage, coverage) = row
        complete = n_rows == registry_size and na_min == na_max
        records[territory_id] = {
            "value": float(total) if complete and n_measured == registry_size else None,
            "complete": complete,
            "n_addresses": na_max if na_min == na_max else None,
            "n_observed": observed_sum,
            "coverage_status": coverage if n_coverage == 1 else None,
        }
    return records


def _aedar_focal_provenance(conn, territory_type, territory_id):
    """Shared source provenance of one territory's published aggregate rows."""
    row = conn.execute("""SELECT source_id,vintage_id,source_url,licence,attribution,
        reference_date,publication_date FROM aedar_territorial_aggregate
        WHERE territory_type=%s AND territory_id=%s LIMIT 1""",
        (territory_type, territory_id)).fetchone()
    if not row:
        raise HTTPException(404, "No published focal AEDAR value")
    return row


def _aedar_direct_aggregate(conn, underlying, reference_type, group_id, registry_size):
    """Registry-wide sum of a direct reference territory's published rows."""
    record = _aedar_aggregate_records(conn, reference_type, [group_id], underlying,
                                      registry_size).get(group_id)
    if record is None:
        raise HTTPException(404, "No published result for this fixed context")
    if not record["complete"]:
        raise HTTPException(503, "AEDAR aggregate publication is incomplete for the reference territory")
    return {
        "value": record["value"],
        "n_addresses": record["n_addresses"],
        "n_observed": record["n_observed"],
        "coverage_status": record["coverage_status"],
        "statistic": "direct",
    }


_AEDAR_POOLED_GROUP_SQL = """SELECT count(*) AS n_rows, count(value) AS n_measured,
       sum(value) AS total,
       min(n_addresses) AS na_min, max(n_addresses) AS na_max,
       sum(n_observed) AS observed_sum,
       count(DISTINCT statistic) AS n_statistic, min(statistic) AS statistic,
       count(DISTINCT coverage_status) AS n_coverage, min(coverage_status) AS coverage_status
FROM aedar_comparison_group
WHERE comparison_context='density_class' AND group_id=%s AND territory_type='commune' AND measure=%s"""


def _aedar_pooled_group_aggregate(conn, group_id, underlying, registry_size):
    """Registry-wide sum of the pooled density artifact's per-type rows."""
    row = conn.execute(_AEDAR_POOLED_GROUP_SQL, (group_id, underlying)).fetchone()
    if not row or not row[0]:
        raise HTTPException(404, "No published result for this fixed context")
    (n_rows, n_measured, total, na_min, na_max, observed_sum,
     n_statistic, statistic, n_coverage, coverage) = row
    if n_rows != registry_size or n_statistic != 1 or na_min != na_max:
        raise HTTPException(503, "AEDAR pooled publication is incomplete for the aggregate reading")
    return {
        "value": float(total) if n_measured == n_rows else None,
        "n_addresses": na_max,
        "n_observed": observed_sum,
        "coverage_status": coverage if n_coverage == 1 else None,
        "statistic": statistic,
    }


def _aedar_fixed_peer_ids(conn, territory_type, territory_id, context):
    """Resolved peer group of a declared fixed context (ADR-0021 scopes).

    The ambient comparison group behind a request-time aggregate rank: the
    communes of the focal EPCI, all Breton communes, the density class, or the
    same-level territories — resolved from the published territory reference
    in the same committed snapshot.
    """
    focal = conn.execute(
        "SELECT epci_id,density_class_code FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
        (territory_type, territory_id)).fetchone()
    if not focal:
        raise HTTPException(404, "Unknown territory type/id")
    if context == "density_class":
        rows = conn.execute(
            "SELECT territory_id FROM territory_reference WHERE territory_type='commune' AND density_class_code=%s",
            (focal[1],)).fetchall()
    elif context == "same_level":
        if territory_type not in ("epci", "departement"):
            raise HTTPException(422, "Same-level reference is unavailable for this territory scope")
        rows = conn.execute("SELECT territory_id FROM territory_reference WHERE territory_type=%s",
                            (territory_type,)).fetchall()
    elif context == "epci":
        if territory_type != "commune":
            raise HTTPException(422, "Commune reference is unavailable for this territory scope")
        if not focal[0]:
            raise HTTPException(503, "Published AEDAR reference identity is unavailable")
        rows = conn.execute(
            "SELECT territory_id FROM territory_reference WHERE territory_type='commune' AND epci_id=%s",
            (focal[0],)).fetchall()
    elif context == "bretagne":
        if territory_type != "commune":
            raise HTTPException(422, "Commune reference is unavailable for this territory scope")
        rows = conn.execute(
            "SELECT territory_id FROM territory_reference WHERE territory_type='commune'").fetchall()
    else:
        raise HTTPException(422, "AEDAR comparison context is not declared")
    ids = sorted({row[0] for row in rows})
    if territory_id not in ids:
        ids = sorted([*ids, territory_id])
    return ids


def _aedar_comparison_snapshot(conn, territory_type, territory_id, context,
                               typequ, measure, fields=None, measure_facets=None, *,
                               preflight_only=False):
    """Build one fixed AEDAR result inside a caller-owned snapshot."""
    aggregate = measure in AEDAR_AGGREGATE_READINGS
    if not aggregate and measure not in AEDAR_MEASURE_KEYS:
        raise HTTPException(422, "Unknown AEDAR measure")
    if aggregate and typequ:
        raise HTTPException(422, "Aggregate readings are registry-wide and take no typequ coordinate")
    if not aggregate and not typequ:
        raise HTTPException(422, "AEDAR per-cell comparison requires one TYPEQU coordinate")
    facet = None
    if aggregate:
        facet = (measure_facets or {}).get(measure)
        if not facet or not facet.get("ranked"):
            raise HTTPException(503, "AEDAR comparison facet declaration is incomplete for the requested measures")
    selected_fields = _aedar_comparison_field_selection(fields, aggregate)
    optional_fields = _aedar_comparison_optional_fields(aggregate)
    selected = set(optional_fields) if selected_fields is None else set(selected_fields)
    marker = _aedar_comparison_marker(conn)
    territory = conn.execute("SELECT 1 FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
                             (territory_type, territory_id)).fetchone()
    if not territory:
        raise HTTPException(404, "Unknown territory type/id")
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[3]}
    if aggregate:
        return _aedar_fixed_aggregate_snapshot(conn, territory_type, territory_id, context,
                                               measure, facet, selected, marker)
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
    for key in optional_fields-selected:
        result.pop(key,None)
    return {"territory":{"territory_type":territory_type,"territory_id":territory_id},
      "content_version":marker[0],"source_snapshot_id":marker[1],
      "aedar_content_version":marker[2],"reference_content_version":marker[3],
      "input_content_version":marker[4],"input_identity":marker[5],"comparison":result}


def _aedar_fixed_aggregate_snapshot(conn, territory_type, territory_id, context,
                                    measure, facet, selected, marker):
    """One fixed-context registry-wide aggregate reading with its request-time rank.

    The group statistic keeps the declared context semantics unchanged (the
    direct EPCI/Bretagne/Région aggregate, or the pooled density artifact summed
    over the complete registry); the focal's direction-aware rank, group size
    and tie count are computed per request over the context's resolved peer
    group from published per-type rows in the same committed snapshot — no
    peer/rank rows are published (#810 stance intact; ADR-0039's 2026-11-04
    amendment, #914).
    """
    underlying = AEDAR_AGGREGATE_READINGS[measure]
    registry_size = _aedar_registry_size(conn)
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
        group = _aedar_pooled_group_aggregate(conn, group_id, underlying, registry_size)
    elif context == "same_level":
        # Same-level keeps the Région's own direct published aggregate
        # ("Moyenne de Bretagne"); the reference is the registry-wide sum of
        # the Région's per-type rows.
        if territory_type not in ("epci","departement"):
            raise HTTPException(422, "Same-level reference is unavailable for this territory scope")
        reference_type, group_id = "region", focal[1]
        group = _aedar_direct_aggregate(conn, underlying, reference_type, group_id, registry_size)
    elif context in ("epci", "bretagne"):
        if territory_type != "commune":
            raise HTTPException(422, "Commune reference is unavailable for this territory scope")
        reference_type = "epci" if context == "epci" else "region"
        group_id = focal[0] if context == "epci" else focal[1]
        if not group_id:
            raise HTTPException(503, "Published AEDAR reference identity is unavailable")
        group = _aedar_direct_aggregate(conn, underlying, reference_type, group_id, registry_size)
    else:
        raise HTTPException(422, "AEDAR comparison context is not declared")
    peer_ids = _aedar_fixed_peer_ids(conn, territory_type, territory_id, context)
    peer_records = _aedar_aggregate_records(conn, territory_type, peer_ids, underlying, registry_size)
    focal_record = peer_records.get(territory_id)
    if focal_record is None:
        raise HTTPException(404, "No published focal AEDAR value")
    if not focal_record["complete"]:
        raise HTTPException(503, "AEDAR aggregate publication is incomplete for the focal territory")
    provenance = _aedar_focal_provenance(conn, territory_type, territory_id)
    direction = facet["direction"]
    focal_value = focal_record["value"]
    rank = rank_size = rank_ties = None
    if focal_value is not None:
        # Peers without a complete measured registry are not comparable and
        # stay out of the rank; ties share the focal's rank.
        comparable = {peer_id: record["value"] for peer_id, record in peer_records.items()
                      if record["value"] is not None}
        better = sum(1 for value in comparable.values()
                     if (value > focal_value if direction == "high" else value < focal_value))
        rank = better + 1
        rank_ties = sum(1 for value in comparable.values() if value == focal_value)
        rank_size = len(comparable)
    result = {
        "comparison_context": context,
        "group_id": group_id,
        "territory_type": reference_type,
        "typequ": None,
        "typequ_label": None,
        "source_id": provenance[0],
        "vintage_id": provenance[1],
        "source_url": provenance[2],
        "licence": provenance[3],
        "attribution": provenance[4],
        "reference_date": provenance[5],
        "publication_date": provenance[6],
        "measure": measure,
        "statistic": group["statistic"],
        "group_value": group["value"],
        "group_n_addresses": group["n_addresses"],
        "group_n_observed": group["n_observed"],
        "group_coverage_status": group["coverage_status"],
        "value": focal_value,
        "status": "measured" if focal_value is not None else "not_available",
        "n_addresses": focal_record["n_addresses"],
        "n_observed": focal_record["n_observed"],
        "coverage_status": focal_record["coverage_status"],
        "rank": rank,
        "rank_size": rank_size,
        "rank_ties": rank_ties,
    }
    for key in _aedar_comparison_optional_fields(True)-selected:
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
    The registry-wide aggregate readings (#914) reuse the same pooled semantics
    over each member's sum over the complete TYPEQU registry.
    """
    if not measures:
        raise HTTPException(422, "AEDAR selected comparison requires measure coordinates")
    if not set(measures) <= AEDAR_MEASURE_KEYS | set(AEDAR_AGGREGATE_READINGS):
        raise HTTPException(422, "Coordinate measure is not declared for AEDAR")
    aggregate = set(measures) <= set(AEDAR_AGGREGATE_READINGS)
    if aggregate and typequ:
        raise HTTPException(422, "Aggregate readings are registry-wide and take no typequ coordinate")
    if not aggregate:
        if not typequ:
            raise HTTPException(422, "AEDAR selected comparison requires typequ and measure coordinates")
        if not set(measures) <= AEDAR_MEASURE_KEYS:
            raise HTTPException(422, "Coordinate measure mixes aggregate readings with per-cell measures")
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
    if aggregate:
        return _aedar_selected_aggregate_snapshot(conn, territory_type, territory_id, resolved,
                                                  sorted(measures), selected, marker, facets)
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


def _aedar_selected_aggregate_snapshot(conn, territory_type, territory_id, resolved,
                                       measure_list, selected, marker, facets):
    """Request-time registry-wide aggregate readings over an explicit selection.

    Each member's reading is the sum of its per-type measure over the complete
    published TYPEQU registry; the group statistic keeps #859's address-weighted
    pooled semantics (weights = published n_addresses) over those readings -
    exactly the pooled address aggregate of the selection's overview scalars -
    and the focal receives a direction-aware rank within the selection when it
    is itself a member. Computed per request from one committed snapshot; no
    peer/rank rows are published (ADR-0039's 2026-11-04 amendment, #914).
    """
    registry_size = _aedar_registry_size(conn)
    underlying_by_measure = {measure: AEDAR_AGGREGATE_READINGS[measure] for measure in measure_list}
    underlying_list = sorted(set(underlying_by_measure.values()))
    member_ids = [code for _, code in resolved]
    member_records = {underlying: _aedar_aggregate_records(conn, territory_type, member_ids,
                                                           underlying, registry_size)
                      for underlying in underlying_list}
    focal_records = {underlying: _aedar_aggregate_records(conn, territory_type, [territory_id],
                                                          underlying, registry_size).get(territory_id)
                     for underlying in underlying_list}
    if all(record is None for record in focal_records.values()):
        raise HTTPException(404, "No published focal AEDAR value")
    provenance = _aedar_focal_provenance(conn, territory_type, territory_id)
    entries = []
    for measure in measure_list:
        facet = facets[measure]
        underlying = underlying_by_measure[measure]
        records = member_records[underlying]
        values = []
        for level, code in resolved:
            record = records.get(code)
            if (record is None or not record["complete"] or record["value"] is None
                    or record["n_addresses"] is None or record["n_addresses"] <= 0):
                raise HTTPException(422, f"Selected comparison member {level}/{code} has no published aggregate reading for measure {measure}")
            values.append((code, record["value"], int(record["n_addresses"]), int(record["n_observed"] or 0)))
        statuses = {records[code]["coverage_status"] for _, code in resolved}
        group_coverage = next(iter(statuses)) if len(statuses) == 1 else None
        total_weight = sum(weight for _, _, weight, _ in values)
        group_value = fsum(value * weight for _, value, weight, _ in values) / total_weight
        total_observed = sum(observed for _, _, _, observed in values)
        focal_record = focal_records[underlying]
        if focal_record is not None and not focal_record["complete"]:
            raise HTTPException(503, "AEDAR aggregate publication is incomplete for the focal territory")
        focal_value = focal_record["value"] if focal_record else None
        rank = rank_size = rank_ties = None
        if facet["ranked"] and territory_id in member_ids and focal_value is not None:
            better = sum(1 for _, value, _, _ in values
                         if (value > focal_value if facet["direction"] == "high" else value < focal_value))
            rank = better + 1
            rank_ties = sum(1 for _, value, _, _ in values if value == focal_value)
            rank_size = len(values)
        entry = {
            "comparison_context": "selected_comparison",
            "group_id": None,
            "territory_type": territory_type,
            "typequ": None,
            "typequ_label": None,
            "source_id": provenance[0],
            "vintage_id": provenance[1],
            "source_url": provenance[2],
            "licence": provenance[3],
            "attribution": provenance[4],
            "reference_date": provenance[5],
            "publication_date": provenance[6],
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
            "n_addresses": focal_record["n_addresses"] if focal_record else None,
            "n_observed": focal_record["n_observed"] if focal_record else None,
            "coverage_status": focal_record["coverage_status"] if focal_record else None,
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

