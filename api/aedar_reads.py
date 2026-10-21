"""Source-grain AEDAR aggregate and fixed-comparison snapshots."""

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


def _aedar_comparison_snapshot(conn, territory_type, territory_id, context,
                               typequ, measure, fields=None, *, preflight_only=False):
    """Build one fixed AEDAR result inside a caller-owned snapshot."""
    if measure not in AEDAR_MEASURE_KEYS:
        raise HTTPException(422, "Unknown AEDAR measure")
    selected_fields = _aedar_comparison_field_selection(fields)
    selected = set(_AEDAR_COMPARISON_OPTIONAL_FIELDS) if selected_fields is None else set(selected_fields)
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
    territory = conn.execute("SELECT 1 FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
                             (territory_type, territory_id)).fetchone()
    if not territory:
        raise HTTPException(404, "Unknown territory type/id")
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[3]}
    focal = conn.execute("""SELECT t.epci_id,t.density_class_code,r.territory_id
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
        from api.snapshot_reads import _comparison_cohort
        _, _, scope = _comparison_cohort(conn, territory_type, territory_id, None)
        if territory_type not in ("epci","departement") or not scope or scope.get("kind") != "same_level":
            raise HTTPException(422, "Same-level reference is unavailable for this territory scope")
        group_id, reference_type = focal[2], territory_type
        group_row = conn.execute("""SELECT value,n_addresses,n_observed,coverage_status,statistic
            FROM aedar_comparison_group WHERE comparison_context='same_level' AND group_id=%s
              AND territory_type=%s AND typequ=%s AND measure=%s""",
            (group_id,reference_type,typequ,measure)).fetchone()
    elif context in ("epci", "bretagne"):
        if territory_type != "commune":
            raise HTTPException(422, "Commune reference is unavailable for this territory scope")
        reference_type = "epci" if context == "epci" else "region"
        group_id = focal[0] if context == "epci" else focal[2]
        if not group_id:
            raise HTTPException(503, "Published AEDAR reference identity is unavailable")
        group_row = conn.execute("""SELECT (measures->>%s)::double precision AS value,n_addresses,n_observed,coverage_status
            FROM aedar_territorial_aggregate WHERE territory_type=%s AND territory_id=%s AND typequ=%s""",
            (measure,reference_type,group_id,typequ)).fetchone()
        if group_row:
            group_row = (*group_row, "direct")
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
